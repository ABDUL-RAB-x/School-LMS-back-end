import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { paginate, searchFilter } from '../utils/paginate.js'
import { Assignment, Student } from '../models/index.js'

const teachesClass = (teacher, classRoomId) => teacher.classes.some((c) => String(c._id ?? c) === String(classRoomId))

const POPULATE = [
  { path: 'subject', select: 'name code' },
  { path: 'classRoom', select: 'name section' },
  { path: 'teacher', select: 'name staffId' },
]

// GET /api/assignments: teacher sees their own, admin sees all
export const listAssignments = asyncHandler(async (req, res) => {
  const { search, status, classRoom, subject, page, limit } = req.query

  const filter = {}
  if (status) filter.status = status
  if (classRoom) filter.classRoom = classRoom
  if (subject) filter.subject = subject
  if (req.user.role === 'teacher') filter.teacher = req.profile._id

  const search$ = searchFilter(search, ['title', 'description'])
  const result = await paginate(Assignment, search$ ? { $and: [filter, search$] } : filter, {
    page,
    limit: limit || 10,
    sort: '-assignedOn',
    populate: POPULATE,
  })

  const rosterCache = new Map()
  const items = await Promise.all(
    result.items.map(async (a) => {
      const key = String(a.classRoom?._id ?? a.classRoom)
      if (!rosterCache.has(key)) {
        rosterCache.set(key, await Student.countDocuments({ classRoom: key, status: 'Active' }))
      }
      return { ...a, submitted: a.submissions.length, total: rosterCache.get(key) }
    }),
  )

  res.json({ success: true, data: items, pagination: result.pagination })
})

// GET /api/assignments/:id
export const getAssignment = asyncHandler(async (req, res) => {
  const a = await Assignment.findById(req.params.id)
    .populate(POPULATE)
    .populate('submissions.student', 'name studentId roll')
    .lean()
  if (!a) throw ApiError.notFound('That assignment no longer exists.')

  if (req.user.role === 'student') {
    // A student may read assignments for their own class, and sees only their own submission
    if (String(a.classRoom._id) !== String(req.profile.classRoom._id ?? req.profile.classRoom)) {
      throw ApiError.forbidden('That assignment was not set for your class.')
    }
    const mine = a.submissions.filter((s) => String(s.student?._id ?? s.student) === String(req.profile._id))
    return res.json({ success: true, data: { ...a, submissions: mine } })
  }

  if (req.user.role === 'teacher' && String(a.teacher?._id ?? a.teacher) !== String(req.profile._id) && !teachesClass(req.profile, a.classRoom._id)) {
    throw ApiError.forbidden('That assignment belongs to another class.')
  }

  const total = await Student.countDocuments({ classRoom: a.classRoom._id, status: 'Active' })
  const graded = a.submissions.filter((s) => s.marks != null).length

  return res.json({
    success: true,
    data: { ...a, submitted: a.submissions.length, total, graded, pending: total - a.submissions.length },
  })
})

// POST /api/assignments
export const createAssignment = asyncHandler(async (req, res) => {
  const body = { ...req.body, teacher: req.profile?._id ?? req.body.teacher }
  delete body.submissions
  delete body.status
  if (!body.teacher) throw ApiError.badRequest('A teacher must be attached to the assignment.')
  if (req.user.role === 'teacher' && !teachesClass(req.profile, body.classRoom)) {
    throw ApiError.forbidden('You can only set assignments for classes you teach.', {
      fields: { classRoom: 'Choose one of your own classes.' },
    })
  }

  if (new Date(body.dueDate) < new Date(body.assignedOn || Date.now())) {
    throw ApiError.badRequest('The due date cannot be before the assigned date.', {
      fields: { dueDate: 'Pick a date on or after the assigned date.' },
    })
  }

  const assignment = await Assignment.create(body)
  res.status(201).json({
    success: true,
    message: 'Assignment published to the class.',
    data: await Assignment.findById(assignment._id).populate(POPULATE).lean(),
  })
})

// PUT /api/assignments/:id
export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id)
  if (!assignment) throw ApiError.notFound('That assignment no longer exists.')

  if (req.user.role === 'teacher' && String(assignment.teacher) !== String(req.profile._id)) {
    throw ApiError.forbidden('You can only edit your own assignments.')
  }

  const body = { ...req.body }
  delete body.submissions
  delete body.teacher

  if (req.user.role === 'teacher' && body.classRoom && !teachesClass(req.profile, body.classRoom)) {
    throw ApiError.forbidden('You can only set assignments for classes you teach.', {
      fields: { classRoom: 'Choose one of your own classes.' },
    })
  }

  Object.assign(assignment, body)
  await assignment.save()

  res.json({
    success: true,
    message: 'Assignment updated.',
    data: await Assignment.findById(assignment._id).populate(POPULATE).lean(),
  })
})

// DELETE /api/assignments/:id
export const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id)
  if (!assignment) throw ApiError.notFound('That assignment no longer exists.')

  if (req.user.role === 'teacher' && String(assignment.teacher) !== String(req.profile._id)) {
    throw ApiError.forbidden('You can only delete your own assignments.')
  }

  await assignment.deleteOne()
  res.json({ success: true, message: 'Assignment deleted.' })
})

// GET /api/assignments/me: the student's list with their own submission state
export const myAssignments = asyncHandler(async (req, res) => {
  const student = req.profile

  const assignments = await Assignment.find({ classRoom: student.classRoom._id ?? student.classRoom })
    .populate(POPULATE)
    .sort('-assignedOn')
    .lean()

  const now = Date.now()

  res.json({
    success: true,
    data: assignments.map((a) => {
      const mine = a.submissions.find((s) => String(s.student) === String(student._id))
      let status = 'Pending'
      if (mine?.marks != null) status = 'Graded'
      else if (mine) status = 'Submitted'
      else if (new Date(a.dueDate).getTime() < now) status = 'Late'

      return {
        id: a._id,
        title: a.title,
        description: a.description,
        subject: a.subject?.name ?? '—',
        teacher: a.teacher?.name ?? '—',
        assignedOn: a.assignedOn,
        due: a.dueDate,
        maxMarks: a.maxMarks,
        submissionType: a.submissionType,
        status,
        marks: mine?.marks != null ? `${mine.marks}/${a.maxMarks}` : null,
        feedback: mine?.feedback || '',
        submittedAt: mine?.submittedAt ?? null,
      }
    }),
  })
})

// POST /api/assignments/:id/submit: student hands in work
export const submitAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id)
  if (!assignment) throw ApiError.notFound('That assignment no longer exists.')

  const student = req.profile
  if (String(assignment.classRoom) !== String(student.classRoom._id ?? student.classRoom)) {
    throw ApiError.forbidden('That assignment was not set for your class.')
  }

  const existing = assignment.submissions.find((s) => String(s.student) === String(student._id))
  if (existing?.marks != null) {
    throw ApiError.conflict('This assignment has already been marked and cannot be resubmitted.')
  }

  const note = String(req.body.note || '').trim().slice(0, 2000)
  const fileUrl = String(req.body.fileUrl || '').trim()
  // The link is shown to the teacher as a clickable anchor: only plain web links
  if (fileUrl && !/^https?:\/\/[^\s]+$/i.test(fileUrl)) {
    throw ApiError.badRequest('The link to your work must start with http:// or https://.', {
      fields: { fileUrl: 'Enter a full link starting with https://' },
    })
  }
  if (!note && !fileUrl) {
    throw ApiError.badRequest('Add a link to your work or a note before submitting.')
  }

  const late = Date.now() > new Date(assignment.dueDate).getTime()
  const payload = {
    student: student._id,
    submittedAt: new Date(),
    note,
    fileUrl: fileUrl.slice(0, 1000),
    late,
  }

  if (existing) Object.assign(existing, payload)
  else assignment.submissions.push(payload)

  await assignment.save()

  res.status(201).json({
    success: true,
    message: late ? 'Submitted — recorded as a late submission.' : 'Submitted.',
    data: { assignment: assignment._id, late, submittedAt: payload.submittedAt },
  })
})

// PATCH /api/assignments/:id/grade: teacher marks one submission
export const gradeSubmission = asyncHandler(async (req, res) => {
  const { student, marks, feedback } = req.body

  const assignment = await Assignment.findById(req.params.id)
  if (!assignment) throw ApiError.notFound('That assignment no longer exists.')

  if (req.user.role === 'teacher' && String(assignment.teacher) !== String(req.profile._id)) {
    throw ApiError.forbidden('You can only grade your own assignments.')
  }
  if (marks > assignment.maxMarks) {
    throw ApiError.badRequest(`Marks cannot exceed the maximum of ${assignment.maxMarks}.`)
  }

  const submission = assignment.submissions.find((s) => String(s.student) === String(student))
  if (!submission) throw ApiError.notFound('That student has not submitted this assignment.')

  submission.marks = marks
  submission.feedback = feedback || ''

  const roster = await Student.countDocuments({ classRoom: assignment.classRoom, status: 'Active' })
  const graded = assignment.submissions.filter((s) => s.marks != null).length
  assignment.status = graded >= roster ? 'Graded' : 'Grading'
  await assignment.save()

  res.json({ success: true, message: 'Submission graded.', data: { graded, roster, status: assignment.status } })
})
