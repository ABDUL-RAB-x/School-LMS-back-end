import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { Attendance, ClassRoom, Student } from '../models/index.js'

// Normalises any date input to midnight UTC so one register per day/period is unique
function dayStart(value) {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('That date is not valid.')
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function tally(records = []) {
  const counts = { present: 0, late: 0, absent: 0 }
  records.forEach((r) => {
    counts[r.status] += 1
  })
  const total = records.length
  return { ...counts, total, rate: total ? Math.round((counts.present / total) * 1000) / 10 : 0 }
}

// POST /api/attendance: teacher submits a register
export const markAttendance = asyncHandler(async (req, res) => {
  const { classRoom, date, period, subject, records } = req.body

  const room = await ClassRoom.findById(classRoom)
  if (!room) throw ApiError.badRequest('That class does not exist.')

  // A teacher may only mark a class they are assigned to
  if (req.user.role === 'teacher') {
    const assigned = req.profile.classes.some((c) => String(c._id ?? c) === String(room._id))
    if (!assigned) throw ApiError.forbidden('You are not assigned to that class.')
  }

  const studentIds = records.map((r) => r.student)
  const valid = await Student.countDocuments({ _id: { $in: studentIds }, classRoom: room._id })
  if (valid !== studentIds.length) {
    throw ApiError.badRequest('The register contains students who are not in this class.')
  }

  const when = dayStart(date)

  // Re-submitting the same register overwrites it rather than erroring
  const register = await Attendance.findOneAndUpdate(
    { classRoom: room._id, date: when, period },
    {
      classRoom: room._id,
      date: when,
      period,
      subject: subject || null,
      markedBy: req.profile?._id ?? null,
      records,
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean()

  res.status(201).json({
    success: true,
    message: `Attendance saved for ${room.name} · ${room.section}.`,
    data: { ...register, summary: tally(register.records) },
  })
})

// GET /api/attendance/register: the roster + any marks already saved
export const getRegister = asyncHandler(async (req, res) => {
  const { classRoom, date, period = 1 } = req.query
  if (!classRoom) throw ApiError.badRequest('classRoom is required.')

  if (req.user.role === 'teacher' && !req.profile.classes.some((c) => String(c._id ?? c) === String(classRoom))) {
    throw ApiError.forbidden('You are not assigned to that class.')
  }

  const when = dayStart(date)

  const [students, existing] = await Promise.all([
    Student.find({ classRoom, status: 'Active' }).select('studentId name roll email').sort('roll').lean(),
    Attendance.findOne({ classRoom, date: when, period: Number(period) }).lean(),
  ])

  const marks = new Map((existing?.records || []).map((r) => [String(r.student), r]))

  res.json({
    success: true,
    data: {
      date: when,
      period: Number(period),
      alreadySubmitted: Boolean(existing),
      students: students.map((s) => ({
        ...s,
        status: marks.get(String(s._id))?.status ?? 'present',
        remark: marks.get(String(s._id))?.remark ?? '',
      })),
    },
  })
})

// GET /api/attendance/overview: admin, one row per class for a given date
export const attendanceOverview = asyncHandler(async (req, res) => {
  const when = dayStart(req.query.date)

  const [classes, registers] = await Promise.all([
    ClassRoom.find().populate('classTeacher', 'name').sort('name section').lean(),
    Attendance.find({ date: when }).lean(),
  ])

  const byClass = new Map()
  registers.forEach((r) => {
    const key = String(r.classRoom)
    const acc = byClass.get(key) || { present: 0, late: 0, absent: 0, total: 0 }
    r.records.forEach((rec) => {
      acc[rec.status] += 1
      acc.total += 1
    })
    byClass.set(key, acc)
  })

  const rows = await Promise.all(
    classes.map(async (c) => {
      const acc = byClass.get(String(c._id))
      const strength = await Student.countDocuments({ classRoom: c._id, status: 'Active' })
      return {
        id: c._id,
        className: `${c.name} · ${c.section}`,
        classTeacher: c.classTeacher?.name ?? '—',
        strength,
        present: acc?.present ?? 0,
        late: acc?.late ?? 0,
        absent: acc?.absent ?? 0,
        total: acc?.total ?? 0,
        rate: acc?.total ? Math.round((acc.present / acc.total) * 1000) / 10 : null,
        submitted: Boolean(acc),
      }
    }),
  )

  const school = rows.reduce(
    (a, r) => ({ present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent }),
    { present: 0, late: 0, absent: 0 },
  )
  const schoolTotal = school.present + school.late + school.absent

  res.json({
    success: true,
    data: {
      date: when,
      rows,
      split: [
        { name: 'Present', value: school.present, color: '#0F766E' },
        { name: 'Late', value: school.late, color: '#D97706' },
        { name: 'Absent', value: school.absent, color: '#DC2626' },
      ],
      rate: schoolTotal ? Math.round((school.present / schoolTotal) * 1000) / 10 : null,
    },
  })
})

// GET /api/attendance/me: the student panel's own record
export const myAttendance = asyncHandler(async (req, res) => {
  const studentId = req.profile._id

  const registers = await Attendance.find({ 'records.student': studentId })
    .populate('subject', 'name')
    .sort('-date')
    .lean()

  const log = registers.map((r) => {
    const mine = r.records.find((rec) => String(rec.student) === String(studentId))
    return {
      date: r.date,
      period: r.period,
      subject: r.subject?.name ?? '—',
      status: mine.status.charAt(0).toUpperCase() + mine.status.slice(1),
      remark: mine.remark || '—',
    }
  })

  // Group into months for the stacked chart
  const months = new Map()
  log.forEach((entry) => {
    const key = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const m = months.get(key) || { month: key.split(' ')[0], present: 0, late: 0, absent: 0 }
    m[entry.status.toLowerCase()] += 1
    months.set(key, m)
  })

  const totals = log.reduce(
    (a, e) => ({ ...a, [e.status.toLowerCase()]: a[e.status.toLowerCase()] + 1 }),
    { present: 0, late: 0, absent: 0 },
  )

  res.json({
    success: true,
    data: {
      log,
      months: [...months.values()].reverse(),
      totals,
      rate: log.length ? Math.round((totals.present / log.length) * 1000) / 10 : null,
    },
  })
})
