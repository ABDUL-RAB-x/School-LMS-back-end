import mongoose from 'mongoose'
import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { paginate, searchFilter } from '../utils/paginate.js'
import { Attendance, ClassRoom, Fee, Result, Student, Subject } from '../models/index.js'
import User from '../models/User.js'

const POPULATE = { path: 'classRoom', select: 'name section room' }

// Next sequential id: STU-1001, STU-1002, …
async function nextStudentId() {
  const last = await Student.findOne({ studentId: /^STU-/ }).sort('-studentId').select('studentId').lean()
  const n = last ? Number.parseInt(last.studentId.split('-')[1], 10) + 1 : 1001
  return `STU-${n}`
}

// Adds live attendance % and fee status to each student
async function decorate(students) {
  const ids = students.map((s) => s._id)
  if (!ids.length) return students

  const [attendance, fees] = await Promise.all([
    Attendance.aggregate([
      { $unwind: '$records' },
      { $match: { 'records.student': { $in: ids } } },
      {
        $group: {
          _id: '$records.student',
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ['$records.status', 'present'] }, 1, 0] } },
        },
      },
    ]),
    Fee.aggregate([
      { $match: { student: { $in: ids } } },
      {
        $group: {
          _id: '$student',
          overdue: { $sum: { $cond: [{ $eq: ['$status', 'Overdue'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
        },
      },
    ]),
  ])

  const attMap = new Map(attendance.map((a) => [String(a._id), Math.round((a.present / a.total) * 100)]))
  const feeMap = new Map(
    fees.map((f) => [String(f._id), f.overdue > 0 ? 'Overdue' : f.pending > 0 ? 'Pending' : 'Paid']),
  )

  return students.map((s) => ({
    ...s,
    attendance: attMap.get(String(s._id)) ?? null,
    feeStatus: feeMap.get(String(s._id)) ?? 'Paid',
  }))
}

// GET /api/students
export const listStudents = asyncHandler(async (req, res) => {
  const { search, classRoom, className, section, status, page, limit } = req.query

  const filter = {}
  if (status) filter.status = status
  if (classRoom) filter.classRoom = classRoom

  // Allow filtering by human-readable grade/section as the UI does
  if (className || section) {
    const rooms = await ClassRoom.find({
      ...(className ? { name: className } : {}),
      ...(section ? { section } : {}),
    })
      .select('_id')
      .lean()
    filter.classRoom = { $in: rooms.map((r) => r._id) }
  }

  const search$ = searchFilter(search, ['name', 'email', 'studentId', 'guardian.name'])
  const finalFilter = search$ ? { $and: [filter, search$] } : filter

  const result = await paginate(Student, finalFilter, {
    page,
    limit: limit || 10,
    sort: 'studentId',
    populate: POPULATE,
  })

  res.json({ success: true, data: await decorate(result.items), pagination: result.pagination })
})

// GET /api/students/:id: accepts a Mongo _id or a STU-#### code
export const getStudent = asyncHandler(async (req, res) => {
  const { id } = req.params
  const query = mongoose.isValidObjectId(id) ? { _id: id } : { studentId: id.toUpperCase() }

  const student = await Student.findOne(query).populate(POPULATE).lean()
  if (!student) throw ApiError.notFound(`No student matches ${id}.`)

  const [decorated] = await decorate([student])

  const [subjects, results, recentAttendance] = await Promise.all([
    Subject.find({ grades: student.classRoom?.name }).select('code name leadTeacher').populate('leadTeacher', 'name').lean(),
    Result.find({ student: student._id })
      .populate({ path: 'exam', select: 'name date subject', populate: { path: 'subject', select: 'name' } })
      .sort('-createdAt')
      .limit(10)
      .lean(),
    Attendance.find({ 'records.student': student._id }).sort('-date').limit(6).select('date records').lean(),
  ])

  const attendanceLog = recentAttendance.map((a) => ({
    date: a.date,
    status: a.records.find((r) => String(r.student) === String(student._id))?.status ?? 'present',
  }))

  res.json({ success: true, data: { ...decorated, subjects, results, attendanceLog } })
})

// POST /api/students
export const createStudent = asyncHandler(async (req, res) => {
  const body = { ...req.body }
  delete body.user // linked below, never from the request
  body.studentId = body.studentId || (await nextStudentId())

  const room = await ClassRoom.findById(body.classRoom)
  if (!room) throw ApiError.badRequest('That class does not exist.', { fields: { classRoom: 'Select a valid class.' } })

  const seatsTaken = await Student.countDocuments({ classRoom: room._id, status: 'Active' })
  if (seatsTaken >= room.capacity) {
    throw ApiError.conflict(`${room.name} · ${room.section} is full (${room.capacity} seats).`)
  }

  const student = await Student.create(body)

  // Create the matching login account so the student can use the portal
  if (body.password) {
    const user = await User.create({
      name: student.name,
      email: student.email,
      password: body.password,
      role: 'student',
      profileModel: 'Student',
      profile: student._id,
      mustChangePassword: true, // the admin chose it, so the student replaces it at first sign-in
    })
    student.user = user._id
    await student.save()
  }

  res.status(201).json({
    success: true,
    message: `${student.name} added to the roll.`,
    data: await Student.findById(student._id).populate(POPULATE).lean(),
  })
})

// PUT /api/students/:id
export const updateStudent = asyncHandler(async (req, res) => {
  const body = { ...req.body }
  delete body.studentId // immutable
  delete body.password
  delete body.user

  const student = await Student.findByIdAndUpdate(req.params.id, body, {
    new: true,
    runValidators: true,
  }).populate(POPULATE)

  if (!student) throw ApiError.notFound('That student no longer exists.')

  // Keep the login account's name/email in step with the profile
  if (student.user) {
    await User.findByIdAndUpdate(student.user, { name: student.name, email: student.email })
  }

  res.json({ success: true, message: 'Student details updated.', data: student })
})

// DELETE /api/students/:id
export const deleteStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id)
  if (!student) throw ApiError.notFound('That student no longer exists.')

  await Promise.all([
    Result.deleteMany({ student: student._id }),
    Fee.deleteMany({ student: student._id }),
    Attendance.updateMany({}, { $pull: { records: { student: student._id } } }),
    student.user ? User.findByIdAndDelete(student.user) : Promise.resolve(),
  ])
  await student.deleteOne()

  res.json({ success: true, message: `${student.name} removed from the roll.` })
})
