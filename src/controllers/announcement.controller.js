import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { paginate, searchFilter } from '../utils/paginate.js'
import { Announcement, Settings } from '../models/index.js'

// Students see All + Students; teachers see All + Teachers plus the notices they
function audienceFor(user) {
  if (user.role === 'student') return { audience: { $in: ['All', 'Students'] } }
  if (user.role === 'teacher') return { $or: [{ audience: { $in: ['All', 'Teachers'] } }, { createdBy: user._id }] }
  return {}
}

function canSee(user, item) {
  if (user.role === 'student') return ['All', 'Students'].includes(item.audience)
  if (user.role === 'teacher') return ['All', 'Teachers'].includes(item.audience) || String(item.createdBy) === String(user._id)
  return true
}

// GET /api/announcements
export const listAnnouncements = asyncHandler(async (req, res) => {
  const { search, audience, pinned, page, limit } = req.query

  const clauses = [audienceFor(req.user)]
  if (audience && req.user.role === 'admin') clauses.push({ audience })
  if (pinned === 'true') clauses.push({ pinned: true })

  const search$ = searchFilter(search, ['title', 'body', 'author'])
  if (search$) clauses.push(search$)

  const result = await paginate(Announcement, { $and: clauses }, {
    page,
    limit: limit || 20,
    sort: '-pinned -publishDate',
  })

  res.json({ success: true, data: result.items, pagination: result.pagination })
})

// GET /api/announcements/:id
export const getAnnouncement = asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id).lean()
  if (!item) throw ApiError.notFound('That announcement no longer exists.')

  if (!canSee(req.user, item)) {
    throw ApiError.forbidden('That announcement was not published to you.')
  }

  res.json({ success: true, data: item })
})

// POST /api/announcements
export const createAnnouncement = asyncHandler(async (req, res) => {
  // Teachers may not blast the whole school or address staff-only notices
  if (req.user.role === 'teacher' && req.body.audience !== 'Students') {
    throw ApiError.forbidden('Teachers can only publish announcements to students.')
  }

  const settings = await Settings.findOne({ key: 'global' }).lean()

  const { title, body, audience, publishDate, pinned } = req.body
  const item = await Announcement.create({
    title,
    body,
    audience,
    publishDate,
    pinned,
    // Teachers always post under their own name
    author: (req.user.role === 'admin' && req.body.author) || (req.user.role === 'admin' ? settings?.school?.name || 'Administration' : req.user.name),
    createdBy: req.user._id,
  })

  res.status(201).json({ success: true, message: 'Announcement published.', data: item })
})

// PUT /api/announcements/:id
export const updateAnnouncement = asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id)
  if (!item) throw ApiError.notFound('That announcement no longer exists.')

  if (req.user.role === 'teacher' && String(item.createdBy) !== String(req.user._id)) {
    throw ApiError.forbidden('You can only edit announcements you published.')
  }
  // Same rule as creating: a teacher's notice can only ever go to students
  if (req.user.role === 'teacher' && req.body.audience && req.body.audience !== 'Students') {
    throw ApiError.forbidden('Teachers can only publish announcements to students.')
  }

  // Only the editable fields: never createdBy or author from the request
  for (const key of ['title', 'body', 'audience', 'publishDate', 'pinned']) {
    if (req.body[key] !== undefined) item[key] = req.body[key]
  }
  await item.save()

  res.json({ success: true, message: 'Announcement updated.', data: item })
})

// DELETE /api/announcements/:id
export const deleteAnnouncement = asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id)
  if (!item) throw ApiError.notFound('That announcement no longer exists.')

  if (req.user.role === 'teacher' && String(item.createdBy) !== String(req.user._id)) {
    throw ApiError.forbidden('You can only delete announcements you published.')
  }

  await item.deleteOne()
  res.json({ success: true, message: 'Announcement removed.' })
})
