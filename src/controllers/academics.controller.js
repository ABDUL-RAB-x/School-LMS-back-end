import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { searchFilter } from '../utils/paginate.js'
import { ClassRoom, Exam, Student, Subject, Teacher, Timetable } from '../models/index.js'

// Classes & Sections

// GET /api/classes
export const listClasses = asyncHandler(async (req, res) => {
  const search$ = searchFilter(req.query.search, ['name', 'section', 'room'])
  const classes = await ClassRoom.find(search$ || {})
    .populate('classTeacher', 'name staffId')
    .populate('subjects', 'name code')
    .sort('name section')
    .lean()

  const counts = await Student.aggregate([
    { $match: { status: 'Active' } },
    { $group: { _id: '$classRoom', students: { $sum: 1 } } },
  ])
  const map = new Map(counts.map((c) => [String(c._id), c.students]))

  res.json({
    success: true,
    data: classes.map((c) => ({
      ...c,
      label: `${c.name} · ${c.section}`,
      students: map.get(String(c._id)) ?? 0,
      occupancy: Math.round(((map.get(String(c._id)) ?? 0) / c.capacity) * 100),
    })),
  })
})

// GET /api/classes/:id
export const getClass = asyncHandler(async (req, res) => {
  const room = await ClassRoom.findById(req.params.id)
    .populate('classTeacher', 'name staffId email')
    .populate('subjects', 'name code credits')
    .lean()
  if (!room) throw ApiError.notFound('That class no longer exists.')

  const students = await Student.find({ classRoom: room._id }).select('studentId name roll email status').sort('roll').lean()

  res.json({ success: true, data: { ...room, label: `${room.name} · ${room.section}`, students } })
})

// POST /api/classes
export const createClass = asyncHandler(async (req, res) => {
  const room = await ClassRoom.create(req.body)
  res.status(201).json({
    success: true,
    message: `${room.name} · ${room.section} created.`,
    data: await ClassRoom.findById(room._id).populate('classTeacher', 'name').lean(),
  })
})

// PUT /api/classes/:id
export const updateClass = asyncHandler(async (req, res) => {
  const room = await ClassRoom.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate('classTeacher', 'name')
    .lean()
  if (!room) throw ApiError.notFound('That class no longer exists.')
  res.json({ success: true, message: 'Class updated.', data: room })
})

// DELETE /api/classes/:id
export const deleteClass = asyncHandler(async (req, res) => {
  const room = await ClassRoom.findById(req.params.id)
  if (!room) throw ApiError.notFound('That class no longer exists.')

  const enrolled = await Student.countDocuments({ classRoom: room._id })
  if (enrolled > 0) {
    throw ApiError.conflict(`${enrolled} student(s) are still in this class. Move them first.`)
  }

  await Promise.all([
    Timetable.deleteOne({ classRoom: room._id }),
    Teacher.updateMany({ classes: room._id }, { $pull: { classes: room._id } }),
  ])
  await room.deleteOne()

  res.json({ success: true, message: `${room.name} · ${room.section} deleted.` })
})

// Subjects

// GET /api/subjects
export const listSubjects = asyncHandler(async (req, res) => {
  const { search, department } = req.query
  const filter = department ? { department } : {}
  const search$ = searchFilter(search, ['name', 'code'])

  const subjects = await Subject.find(search$ ? { $and: [filter, search$] } : filter)
    .populate('leadTeacher', 'name staffId')
    .sort('code')
    .lean()

  res.json({ success: true, data: subjects })
})

// POST /api/subjects
export const createSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.create(req.body)
  res.status(201).json({
    success: true,
    message: `${subject.name} added to the curriculum.`,
    data: await Subject.findById(subject._id).populate('leadTeacher', 'name').lean(),
  })
})

// PUT /api/subjects/:id
export const updateSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate('leadTeacher', 'name')
    .lean()
  if (!subject) throw ApiError.notFound('That subject no longer exists.')
  res.json({ success: true, message: 'Subject updated.', data: subject })
})

// DELETE /api/subjects/:id
export const deleteSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id)
  if (!subject) throw ApiError.notFound('That subject no longer exists.')

  const scheduled = await Exam.countDocuments({ subject: subject._id, status: { $ne: 'Results published' } })
  if (scheduled > 0) {
    throw ApiError.conflict(`${scheduled} examination(s) still reference this subject.`)
  }

  await Promise.all([
    ClassRoom.updateMany({ subjects: subject._id }, { $pull: { subjects: subject._id } }),
    Teacher.updateMany({ subject: subject._id }, { subject: null }),
  ])
  await subject.deleteOne()

  res.json({ success: true, message: `${subject.name} removed.` })
})
