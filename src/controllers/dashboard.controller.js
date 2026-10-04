import asyncHandler from '../utils/asyncHandler.js'
import {
  Announcement,
  Assignment,
  Attendance,
  Exam,
  Fee,
  Result,
  Settings,
  Student,
  Subject,
  Teacher,
} from '../models/index.js'

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0
}

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
const monthLabel = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const classLabel = (room) => (room ? `${room.name} · ${room.section}` : '—')

// GET /api/dashboard/admin
export const adminDashboard = asyncHandler(async (_req, res) => {
  const today = new Date()
  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  const [students, teachers, subjects, registers, feeAgg, byGrade, admissions, announcements, calendar] =
    await Promise.all([
      Student.countDocuments({ status: 'Active' }),
      Teacher.countDocuments({ status: { $ne: 'Inactive' } }),
      Subject.countDocuments(),
      Attendance.find({ date: startOfDay }).select('records').lean(),
      Fee.aggregate([
        {
          $group: {
            _id: null,
            billed: { $sum: '$amount' },
            collected: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$amount', 0] } },
          },
        },
      ]),
      Student.aggregate([
        { $match: { status: 'Active' } },
        { $lookup: { from: 'classrooms', localField: 'classRoom', foreignField: '_id', as: 'room' } },
        { $unwind: '$room' },
        { $group: { _id: '$room.name', students: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Student.find().sort('-createdAt').limit(6).populate('classRoom', 'name section').select('studentId name createdAt status').lean(),
      Announcement.find().sort('-publishDate').limit(5).lean(),
      Exam.find({ date: { $gte: startOfDay } }).sort('date').limit(5).populate('subject', 'name').populate('classRoom', 'name section').lean(),
    ])

  const split = { present: 0, late: 0, absent: 0 }
  registers.forEach((r) => r.records.forEach((rec) => { split[rec.status] += 1 }))
  const marked = split.present + split.late + split.absent

  const fees = feeAgg[0] || { billed: 0, collected: 0 }

  res.json({
    success: true,
    data: {
      stats: [
        { id: 'students', label: 'Total Students', value: students.toLocaleString() },
        { id: 'teachers', label: 'Total Teachers', value: teachers.toLocaleString() },
        { id: 'courses', label: 'Active Courses', value: subjects.toLocaleString() },
        { id: 'attendance', label: 'Attendance Rate', value: marked ? `${pct(split.present, marked)}%` : '—' },
        { id: 'revenue', label: 'Fees Collected', value: `Rs ${fees.collected.toLocaleString('en-US')}` },
      ],
      attendanceSplit: [
        { name: 'Present', value: split.present, color: '#0F766E' },
        { name: 'Late', value: split.late, color: '#D97706' },
        { name: 'Absent', value: split.absent, color: '#DC2626' },
      ],
      // "Grade 9" before "Grade 10"
      gradeDistribution: byGrade
        .sort((a, b) => String(a._id).localeCompare(String(b._id), 'en', { numeric: true }))
        .map((g) => ({ grade: g._id, students: g.students })),
      revenue: { billed: fees.billed, collected: fees.collected, outstanding: fees.billed - fees.collected },
      recentAdmissions: admissions.map((s) => ({
        id: s.studentId,
        name: s.name,
        className: s.classRoom ? `${s.classRoom.name} · ${s.classRoom.section}` : '—',
        date: s.createdAt,
        status: s.status === 'Active' ? 'Enrolled' : 'Pending docs',
      })),
      announcements,
      calendar: calendar.map((e) => ({
        id: e._id,
        date: e.date,
        title: `${e.name} — ${e.subject?.name ?? ''}`.trim(),
        tag: 'Exam',
      })),
    },
  })
})

// GET /api/dashboard/analytics?months=3|6|12
export const adminAnalytics = asyncHandler(async (req, res) => {
  const months = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
  const keys = Array.from({ length: months }, (_, i) =>
    monthKey(new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1))),
  )

  const [settings, students, perStudent, perMonth, results, admissions, admittedBefore, fees, subjects] = await Promise.all([
    Settings.findOne({ key: 'global' }).lean(),
    Student.find({ status: 'Active' }).select('name studentId classRoom').populate('classRoom', 'name section').lean(),
    Attendance.aggregate([
      { $match: { date: { $gte: since } } },
      { $unwind: '$records' },
      {
        $group: {
          _id: '$records.student',
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ['$records.status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$records.status', 'absent'] }, 1, 0] } },
        },
      },
    ]),
    Attendance.aggregate([
      { $match: { date: { $gte: since } } },
      { $unwind: '$records' },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ['$records.status', 'present'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$records.status', 'late'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$records.status', 'absent'] }, 1, 0] } },
        },
      },
    ]),
    Result.aggregate([
      { $lookup: { from: 'exams', localField: 'exam', foreignField: '_id', as: 'exam' } },
      { $unwind: '$exam' },
      { $match: { 'exam.date': { $gte: since } } },
      { $project: { student: 1, subject: '$exam.subject', pct: { $multiply: [{ $divide: ['$marks', '$maxMarks'] }, 100] } } },
    ]),
    Student.aggregate([
      { $match: { admissionDate: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$admissionDate' } }, count: { $sum: 1 } } },
    ]),
    Student.countDocuments({ admissionDate: { $lt: since } }),
    Fee.find().select('student amount status dueDate method').populate({ path: 'student', select: 'classRoom', populate: { path: 'classRoom', select: 'name section' } }).lean(),
    Subject.find().select('name code').lean(),
  ])

  const minimum = settings?.academic?.minimumAttendance ?? 75
  const passMark = settings?.academic?.passingMarks ?? 40
  const byId = new Map(students.map((s) => [String(s._id), s]))
  const who = (id) => {
    const s = byId.get(String(id))
    return s ? { id: s._id, name: s.name, studentId: s.studentId, className: classLabel(s.classRoom) } : null
  }

  // Attendance
  const attTotals = perStudent.reduce((a, s) => ({ total: a.total + s.total, present: a.present + s.present }), { total: 0, present: 0 })
  const monthMap = new Map(perMonth.map((m) => [m._id, m]))
  const attendanceTrend = keys.map((k) => {
    const m = monthMap.get(k)
    return { month: monthLabel(k), rate: m ? pct(m.present, m.total) : null, present: m?.present ?? 0, late: m?.late ?? 0, absent: m?.absent ?? 0 }
  })
  // Fewer than 3 registers is too little to flag anyone
  const lowRows = perStudent
    .filter((s) => s.total >= 3 && byId.has(String(s._id)))
    .map((s) => ({ ...who(s._id), rate: pct(s.present, s.total), registers: s.total, absences: s.absent }))
    .filter((s) => s.rate < minimum)
    .sort((a, b) => a.rate - b.rate)

  // Results
  const perStudentScore = new Map()
  const perSubject = new Map()
  results.forEach((r) => {
    const st = perStudentScore.get(String(r.student)) || { sum: 0, count: 0 }
    st.sum += r.pct
    st.count += 1
    perStudentScore.set(String(r.student), st)
    const sb = perSubject.get(String(r.subject)) || { sum: 0, count: 0, passed: 0 }
    sb.sum += r.pct
    sb.count += 1
    if (r.pct >= passMark) sb.passed += 1
    perSubject.set(String(r.subject), sb)
  })
  const topStudents = [...perStudentScore.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, s]) => ({ ...who(id), average: Math.round(s.sum / s.count), exams: s.count }))
    .sort((a, b) => b.average - a.average || b.exams - a.exams)
    .slice(0, 10)
  const subjectPerformance = subjects
    .filter((s) => perSubject.has(String(s._id)))
    .map((s) => {
      const p = perSubject.get(String(s._id))
      return { subject: s.name, code: s.code, average: Math.round(p.sum / p.count), passRate: Math.round((p.passed / p.count) * 100), results: p.count }
    })
    .sort((a, b) => b.average - a.average)
  const allScores = results.length ? Math.round(results.reduce((t, r) => t + r.pct, 0) / results.length) : null

  // Admissions
  const admMap = new Map(admissions.map((a) => [a._id, a.count]))
  let running = admittedBefore
  const monthlyAdmissions = keys.map((k) => {
    const added = admMap.get(k) ?? 0
    running += added
    return { month: monthLabel(k), students: added, total: running }
  })

  // Fees
  const sum = (list) => list.reduce((t, f) => t + f.amount, 0)
  const paid = fees.filter((f) => f.status === 'Paid')
  const unpaid = fees.filter((f) => f.status !== 'Paid')
  const overdue = unpaid.filter((f) => new Date(f.dueDate) < now)
  const classFees = new Map()
  fees.forEach((f) => {
    const label = classLabel(f.student?.classRoom)
    const c = classFees.get(label) || { className: label, billed: 0, collected: 0, invoices: 0 }
    c.billed += f.amount
    c.invoices += 1
    if (f.status === 'Paid') c.collected += f.amount
    classFees.set(label, c)
  })
  const methods = new Map()
  paid.forEach((f) => {
    const m = methods.get(f.method) || { method: f.method === '—' ? 'Not recorded' : f.method, count: 0, amount: 0 }
    m.count += 1
    m.amount += f.amount
    methods.set(f.method, m)
  })
  const feeMonths = keys.map((k) => {
    const inMonth = fees.filter((f) => monthKey(new Date(f.dueDate)) === k)
    return { month: monthLabel(k), collected: sum(inMonth.filter((f) => f.status === 'Paid')), outstanding: sum(inMonth.filter((f) => f.status !== 'Paid')) }
  })

  res.json({
    success: true,
    data: {
      months,
      since,
      minimumAttendance: minimum,
      passingMarks: passMark,
      kpis: {
        attendanceRate: attTotals.total ? pct(attTotals.present, attTotals.total) : null,
        averageScore: allScores,
        collectionRate: sum(fees) ? pct(sum(paid), sum(fees)) : null,
        belowMinimum: lowRows.length,
        newAdmissions: monthlyAdmissions.reduce((t, m) => t + m.students, 0),
      },
      attendanceTrend,
      lowAttendance: lowRows.slice(0, 10),
      topStudents,
      subjectPerformance,
      monthlyAdmissions,
      fees: {
        billed: sum(fees),
        collected: sum(paid),
        outstanding: sum(unpaid),
        overdue: sum(overdue),
        invoices: fees.length,
        paidInvoices: paid.length,
        overdueInvoices: overdue.length,
        byClass: [...classFees.values()]
          .map((c) => ({ ...c, rate: pct(c.collected, c.billed) }))
          .sort((a, b) => a.className.localeCompare(b.className, 'en', { numeric: true })),
        byMethod: [...methods.values()].sort((a, b) => b.amount - a.amount),
        byMonth: feeMonths,
      },
    },
  })
})

// GET /api/dashboard/teacher
export const teacherDashboard = asyncHandler(async (req, res) => {
  const teacher = req.profile
  const classIds = teacher.classes.map((c) => c._id ?? c)

  const today = new Date()
  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  const [students, assignments, registersToday, allRegisters, results] = await Promise.all([
    Student.countDocuments({ classRoom: { $in: classIds }, status: 'Active' }),
    Assignment.find({ teacher: teacher._id })
      .populate('classRoom', 'name section')
      .populate('subject', 'name')
      .sort('dueDate')
      .lean(),
    Attendance.find({ classRoom: { $in: classIds }, date: startOfDay }).select('records').lean(),
    Attendance.find({ classRoom: { $in: classIds } }).select('classRoom records').lean(),
    Result.find({ enteredBy: teacher._id }).select('marks maxMarks').lean(),
  ])

  const todaySplit = { present: 0, late: 0, absent: 0 }
  registersToday.forEach((r) => r.records.forEach((rec) => { todaySplit[rec.status] += 1 }))
  const todayMarked = todaySplit.present + todaySplit.late + todaySplit.absent

  const perClass = new Map()
  allRegisters.forEach((r) => {
    const key = String(r.classRoom)
    const acc = perClass.get(key) || { present: 0, total: 0 }
    r.records.forEach((rec) => {
      acc.total += 1
      if (rec.status === 'present') acc.present += 1
    })
    perClass.set(key, acc)
  })

  const rosterCounts = await Promise.all(
    classIds.map((id) => Student.countDocuments({ classRoom: id, status: 'Active' })),
  )

  const classes = teacher.classes.map((c, i) => {
    const acc = perClass.get(String(c._id ?? c))
    return {
      id: c._id ?? c,
      className: c.name ? `${c.name} · ${c.section}` : '—',
      room: c.room ?? '',
      students: rosterCounts[i],
      attendance: acc ? pct(acc.present, acc.total) : null,
    }
  })

  // Score bands across everything this teacher has marked
  const bands = { '90–100': 0, '80–89': 0, '70–79': 0, '60–69': 0, '< 60': 0 }
  results.forEach((r) => {
    const p = (r.marks / r.maxMarks) * 100
    if (p >= 90) bands['90–100'] += 1
    else if (p >= 80) bands['80–89'] += 1
    else if (p >= 70) bands['70–79'] += 1
    else if (p >= 60) bands['60–69'] += 1
    else bands['< 60'] += 1
  })

  const pending = assignments.filter((a) => a.status !== 'Graded')

  res.json({
    success: true,
    data: {
      stats: [
        { id: 'classes', label: 'My Classes', value: String(classIds.length) },
        { id: 'students', label: 'Total Students', value: String(students) },
        { id: 'pending', label: 'Pending Assignments', value: String(pending.length) },
        { id: 'attendance', label: 'Attendance Today', value: todayMarked ? `${pct(todaySplit.present, todayMarked)}%` : '—' },
      ],
      classes,
      assignments: pending.map((a) => ({
        id: a._id,
        title: a.title,
        className: a.classRoom ? `${a.classRoom.name} · ${a.classRoom.section}` : '—',
        subject: a.subject?.name ?? '—',
        due: a.dueDate,
        submitted: a.submissions.length,
        status: a.status,
      })),
      performance: Object.entries(bands).map(([band, students]) => ({ band, students })),
    },
  })
})

// GET /api/dashboard/student
export const studentDashboard = asyncHandler(async (req, res) => {
  const student = req.profile
  const classRoom = student.classRoom._id ?? student.classRoom
  const now = new Date()

  const [registers, subjects, assignments, exams, results, fees, announcements] = await Promise.all([
    Attendance.find({ 'records.student': student._id }).select('records date').lean(),
    Subject.find({ grades: student.classRoom.name }).populate('leadTeacher', 'name').lean(),
    Assignment.find({ classRoom }).populate('subject', 'name').sort('dueDate').lean(),
    Exam.find({ classRoom, date: { $gte: now }, status: { $ne: 'Draft' } })
      .populate('subject', 'name')
      .sort('date')
      .limit(5)
      .lean(),
    Result.find({ student: student._id }).select('marks maxMarks').lean(),
    Fee.find({ student: student._id }).lean(),
    Announcement.find({ audience: { $in: ['All', 'Students'] } }).sort('-publishDate').limit(3).lean(),
  ])

  let present = 0
  registers.forEach((r) => {
    const mine = r.records.find((rec) => String(rec.student) === String(student._id))
    if (mine?.status === 'present') present += 1
  })
  const attendanceRate = registers.length ? pct(present, registers.length) : null

  const average = results.length
    ? Math.round(results.reduce((s, r) => s + (r.marks / r.maxMarks) * 100, 0) / results.length)
    : null

  const due = assignments.filter((a) => {
    const mine = a.submissions.find((s) => String(s.student) === String(student._id))
    return !mine && new Date(a.dueDate) >= now
  })

  const outstanding = fees.filter((f) => f.status !== 'Paid').reduce((s, f) => s + f.amount, 0)

  res.json({
    success: true,
    data: {
      stats: [
        { id: 'attendance', label: 'Attendance', value: attendanceRate != null ? `${attendanceRate}%` : '—' },
        { id: 'courses', label: 'Enrolled Courses', value: String(subjects.length) },
        { id: 'assignments', label: 'Due Assignments', value: String(due.length) },
        { id: 'average', label: 'Overall Average', value: average != null ? `${average}%` : '—' },
      ],
      courses: subjects.map((s) => ({
        id: s._id,
        subject: s.name,
        code: s.code,
        teacher: s.leadTeacher?.name ?? '—',
      })),
      dueAssignments: due.slice(0, 5).map((a) => ({
        id: a._id,
        title: a.title,
        subject: a.subject?.name ?? '—',
        due: a.dueDate,
      })),
      upcomingExams: exams.map((e) => ({
        id: e._id,
        exam: e.name,
        subject: e.subject?.name ?? '—',
        date: e.date,
        time: e.time,
        room: e.room,
      })),
      fees: { outstanding, invoices: fees.length },
      announcements,
    },
  })
})
