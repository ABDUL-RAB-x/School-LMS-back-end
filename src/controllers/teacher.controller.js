import mongoose from 'mongoose'
import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { paginate, searchFilter } from '../utils/paginate.js'
import { Assignment, Attendance, ClassRoom, Student, Subject, Teacher, Timetable } from '../models/index.js'
import User from '../models/User.js'

const POPULATE = [
  { path: 'subject', select: 'name code' },
  { path: 'classes', select: 'name section room' },
]

async function nextStaffId() {
  const last = await Teacher.findOne({ staffId: /^TCH-/ }).sort('-staffId').select('staffId').lean()
  const n = last ? Number.parseInt(last.staffId.split('-')[1], 10) + 1 : 201
  return `TCH-${n}`
}

// GET /api/teachers
export const listTeachers = asyncHandler(async (req, res) => {
  const { search, department, status, subject, page, limit } = req.query

  const filter = {}
  if (department) filter.department = department
  if (status) filter.status = status
  if (subject) filter.subject = subject

  const search$ = searchFilter(search, ['name', 'email', 'staffId', 'qualification'])
  const finalFilter = search$ ? { $and: [filter, search$] } : filter

  const result = await paginate(Teacher, finalFilter, {
    page,
    limit: limit || 10,
    sort: 'staffId',
    populate: POPULATE,
  })

  res.json({ success: true, data: result.items, pagination: result.pagination })
})

// GET /api/teachers/:id
export const getTeacher = asyncHandler(async (req, res) => {
  const { id } = req.params
  const query = mongoose.isValidObjectId(id) ? { _id: id } : { staffId: id.toUpperCase() }

  const teacher = await Teacher.findOne(query).populate(POPULATE).lean()
  if (!teacher) throw ApiError.notFound(`No teacher matches ${id}.`)

  const [assignments, timetables] = await Promise.all([
    Assignment.find({ teacher: teacher._id }).select('title status dueDate classRoom').populate('classRoom', 'name section').lean(),
    Timetable.find({ 'slots.teacher': teacher._id })
      .populate('classRoom', 'name section')
      .populate('slots.subject', 'name')
      .lean(),
  ])

  // Flatten this teacher's own slots out of every class timetable
  const schedule = timetables.flatMap((t) =>
    t.slots
      .filter((s) => String(s.teacher) === String(teacher._id))
      .map((s) => ({
        day: s.day,
        period: s.period,
        time: `${s.startTime} – ${s.endTime}`,
        room: s.room,
        subject: s.subject?.name ?? '—',
        classRoom: t.classRoom ? `${t.classRoom.name} · ${t.classRoom.section}` : '—',
      })),
  )

  res.json({ success: true, data: { ...teacher, assignments, schedule } })
})

// POST /api/teachers
export const createTeacher = asyncHandler(async (req, res) => {
  const body = { ...req.body }
  delete body.user // linked below, never from the request
  body.staffId = body.staffId || (await nextStaffId())

  if (body.subject && !(await Subject.exists({ _id: body.subject }))) {
    throw ApiError.badRequest('That subject does not exist.', { fields: { subject: 'Select a valid subject.' } })
  }
  if (body.classes?.length) {
    const found = await ClassRoom.countDocuments({ _id: { $in: body.classes } })
    if (found !== body.classes.length) {
      throw ApiError.badRequest('One or more selected classes do not exist.', {
        fields: { classes: 'Select valid classes.' },
      })
    }
  }

  const teacher = await Teacher.create(body)

  if (body.password) {
    const user = await User.create({
      name: teacher.name,
      email: teacher.email,
      password: body.password,
      role: 'teacher',
      profileModel: 'Teacher',
      profile: teacher._id,
      mustChangePassword: true, // the admin chose it, so the teacher replaces it at first sign-in
    })
    teacher.user = user._id
    await teacher.save()
  }

  res.status(201).json({
    success: true,
    message: `${teacher.name} added to staff.`,
    data: await Teacher.findById(teacher._id).populate(POPULATE).lean(),
  })
})

// PUT /api/teachers/:id
export const updateTeacher = asyncHandler(async (req, res) => {
  const body = { ...req.body }
  delete body.staffId
  delete body.password
  delete body.user

  const teacher = await Teacher.findByIdAndUpdate(req.params.id, body, {
    new: true,
    runValidators: true,
  }).populate(POPULATE)

  if (!teacher) throw ApiError.notFound('That teacher no longer exists.')

  if (teacher.user) {
    await User.findByIdAndUpdate(teacher.user, { name: teacher.name, email: teacher.email })
  }

  res.json({ success: true, message: 'Teacher details updated.', data: teacher })
})

// DELETE /api/teachers/:id
export const deleteTeacher = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id)
  if (!teacher) throw ApiError.notFound('That teacher no longer exists.')

  const stillTeaching = await ClassRoom.countDocuments({ classTeacher: teacher._id })
  if (stillTeaching > 0) {
    throw ApiError.conflict(
      `${teacher.name} is the class teacher for ${stillTeaching} class(es). Reassign those first.`,
    )
  }

  await Promise.all([
    Timetable.updateMany({ 'slots.teacher': teacher._id }, { $set: { 'slots.$[s].teacher': null } }, {
      arrayFilters: [{ 's.teacher': teacher._id }],
    }),
    Subject.updateMany({ leadTeacher: teacher._id }, { leadTeacher: null }),
    teacher.user ? User.findByIdAndDelete(teacher.user) : Promise.resolve(),
  ])
  await teacher.deleteOne()

  res.json({ success: true, message: `${teacher.name} removed from staff.` })
})

// GET /api/teachers/me/classes: the teacher panel's "My Classes"
export const myClasses = asyncHandler(async (req, res) => {
  const teacher = req.profile

  const classes = await ClassRoom.find({ _id: { $in: teacher.classes } })
    .populate('classTeacher', 'name')
    .lean()

  const enriched = await Promise.all(
    classes.map(async (c) => {
      const [students, registers] = await Promise.all([
        Student.countDocuments({ classRoom: c._id, status: 'Active' }),
        Attendance.find({ classRoom: c._id }).select('records').lean(),
      ])

      let present = 0
      let total = 0
      registers.forEach((r) => {
        r.records.forEach((rec) => {
          total += 1
          if (rec.status === 'present') present += 1
        })
      })

      return {
        ...c,
        label: `${c.name} · ${c.section}`,
        students,
        attendance: total ? Math.round((present / total) * 100) : null,
      }
    }),
  )

  res.json({ success: true, data: enriched })
})
