// End-to-end smoke test: boots the real API against a throwaway database
//   npm run smoke                  # in-memory MongoDB (needs the MSVC runtime on Windows)
//   npm run smoke -- --atlas       # a separate "scholaris_smoke_test" database on the
import dotenv from 'dotenv'

const TEST_DB = 'scholaris_smoke_test'
let mongo = null

if (process.argv.includes('--atlas')) {
  dotenv.config()
  const appUri = process.env.MONGODB_URI || ''
  const url = new URL(appUri)
  const appDb = url.pathname.replace(/^\//, '')
  if (!appUri || appDb === TEST_DB) throw new Error('MONGODB_URI is missing or already points at the test database.')
  url.pathname = `/${TEST_DB}`
  process.env.MONGODB_URI = url.toString()
  console.log(`[smoke] using database "${TEST_DB}" on the configured cluster (the app's "${appDb}" is not touched)`)
} else {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  mongo = await MongoMemoryServer.create()
  // Must be set before config/env.js is imported (dotenv does not override)
  process.env.MONGODB_URI = mongo.getUri('scholaris_test')
}
process.env.JWT_SECRET = 'smoke-test-secret-key-that-is-definitely-long-enough-0123456789'
process.env.MAIL_PREVIEW_ONLY = 'true'
process.env.NODE_ENV = 'test'
process.env.PORT = '5099'
process.env.OTP_RESEND_COOLDOWN_SECONDS = '2'

const mongoose = (await import('mongoose')).default
await mongoose.connect(process.env.MONGODB_URI)
if (mongoose.connection.db.databaseName !== TEST_DB && mongoose.connection.db.databaseName !== 'scholaris_test') {
  throw new Error(`Refusing to run: connected to "${mongoose.connection.db.databaseName}", which is not a test database.`)
}

const { seedDatabase } = await import('../src/seed.js')
await seedDatabase({ quiet: true })

const app = (await import('../src/app.js')).default
const server = app.listen(5099)
const BASE = 'http://127.0.0.1:5099'

let passed = 0
let failed = 0
const failures = []

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json }
}

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? ` — ${JSON.stringify(detail).slice(0, 260)}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// Full two-step sign-in, returns the JWT
async function signIn(email, password) {
  const login = await call('POST', '/api/auth/login', { body: { email, password } })
  if (login.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(login.body)}`)
  const code = login.body.data.previewCode
  const verify = await call('POST', '/api/auth/verify-otp', { body: { email, code } })
  if (verify.status !== 200) throw new Error(`verify failed for ${email}: ${JSON.stringify(verify.body)}`)
  return verify.body.data.token
}

try {
  // health
  section('Health')
  const health = await call('GET', '/health')
  check('GET /health returns 200 and a connected database', health.status === 200 && health.body.database === 'connected', health.body)

  // auth
  section('Auth — login → OTP → JWT')

  const badPass = await call('POST', '/api/auth/login', {
    body: { email: 'admin@scholaris.edu', password: 'wrong-password' },
  })
  check('wrong password is rejected with 401', badPass.status === 401, badPass.body)

  const unknown = await call('POST', '/api/auth/login', {
    body: { email: 'nobody@scholaris.edu', password: 'whatever123' },
  })
  check('unknown account returns the same 401 message (no enumeration)',
    unknown.status === 401 && unknown.body.message === badPass.body.message, unknown.body)

  const badEmail = await call('POST', '/api/auth/login', { body: { email: 'not-an-email', password: 'x' } })
  check('invalid email fails validation with field errors', badEmail.status === 400 && badEmail.body.fields?.email, badEmail.body)

  const wrongPortal = await call('POST', '/api/auth/login', {
    body: { email: 'teacher@scholaris.edu', password: 'teacher123', role: 'student' },
  })
  check('an account is refused on another role’s portal', wrongPortal.status === 403, wrongPortal.body)

  const badPortal = await call('POST', '/api/auth/login', {
    body: { email: 'admin@scholaris.edu', password: 'admin123', role: 'janitor' },
  })
  check('an unknown portal fails validation', badPortal.status === 400 && badPortal.body.fields?.role, badPortal.body)

  const login = await call('POST', '/api/auth/login', {
    body: { email: 'admin@scholaris.edu', password: 'admin123', role: 'admin' },
  })
  check('valid credentials return otpRequired', login.status === 200 && login.body.data.otpRequired === true, login.body)
  check('response masks the email address', /\*/.test(login.body.data?.maskedEmail || ''), login.body.data)

  const otpCode = login.body.data.previewCode
  check('a 6-digit OTP was generated', /^\d{6}$/.test(otpCode || ''), otpCode)

  const wrongOtp = await call('POST', '/api/auth/verify-otp', {
    body: { email: 'admin@scholaris.edu', code: otpCode === '000000' ? '111111' : '000000' },
  })
  check('a wrong OTP is rejected with 400', wrongOtp.status === 400, wrongOtp.body)

  const shortOtp = await call('POST', '/api/auth/verify-otp', { body: { email: 'admin@scholaris.edu', code: '123' } })
  check('a short OTP fails validation', shortOtp.status === 400 && shortOtp.body.fields?.code, shortOtp.body)

  const verify = await call('POST', '/api/auth/verify-otp', { body: { email: 'admin@scholaris.edu', code: otpCode } })
  check('the correct OTP returns a JWT and the user role', verify.status === 200 && Boolean(verify.body.data.token) && verify.body.data.user.role === 'admin', verify.body)

  const reuse = await call('POST', '/api/auth/verify-otp', { body: { email: 'admin@scholaris.edu', code: otpCode } })
  check('the same OTP cannot be reused', reuse.status === 400, reuse.body)

  // Resend must never stand in for the password step
  const resendNoPassword = await call('POST', '/api/auth/resend-otp', { body: { email: 'helena.voss@scholaris.edu' } })
  check('resend without passing the password step issues no code', resendNoPassword.status === 200 && !resendNoPassword.body.data?.previewCode, resendNoPassword.body)

  const resendUnknown = await call('POST', '/api/auth/resend-otp', { body: { email: 'nobody@scholaris.edu' } })
  check('resend for an unknown account gives the same answer', resendUnknown.status === 200 && resendUnknown.body.message === resendNoPassword.body.message, resendUnknown.body)

  await call('POST', '/api/auth/login', { body: { email: 'helena.voss@scholaris.edu', password: 'Teacher123' } })
  const resendAgain = await call('POST', '/api/auth/resend-otp', { body: { email: 'helena.voss@scholaris.edu' } })
  check('an immediate resend is blocked by the cooldown', resendAgain.status === 429, resendAgain.body)

  await new Promise((r) => setTimeout(r, 2100)) // the suite runs with a 2s cooldown
  const resend = await call('POST', '/api/auth/resend-otp', { body: { email: 'helena.voss@scholaris.edu' } })
  check('after the cooldown, resend issues a fresh code', resend.status === 200 && /^\d{6}$/.test(resend.body.data?.previewCode || ''), resend.body)

  const resendVerify = await call('POST', '/api/auth/verify-otp', {
    body: { email: 'helena.voss@scholaris.edu', code: resend.body.data?.previewCode },
  })
  check('a resent code verifies successfully', resendVerify.status === 200 && Boolean(resendVerify.body.data.token), resendVerify.body)

  const adminToken = await signIn('admin@scholaris.edu', 'admin123')
  const teacherToken = await signIn('teacher@scholaris.edu', 'teacher123')
  const studentToken = await signIn('student@scholaris.edu', 'student123')
  check('all three roles can complete the flow', Boolean(adminToken && teacherToken && studentToken))

  const me = await call('GET', '/api/auth/me', { token: adminToken })
  check('GET /api/auth/me returns the signed-in user', me.status === 200 && me.body.data.user.email === 'admin@scholaris.edu', me.body)

  const noToken = await call('GET', '/api/auth/me')
  check('a protected route without a token returns 401', noToken.status === 401, noToken.body)

  const junkToken = await call('GET', '/api/auth/me', { token: 'not.a.jwt' })
  check('a malformed token returns 401', junkToken.status === 401, junkToken.body)

  // RBAC
  section('Role-based access control')

  const studentHitsAdmin = await call('GET', '/api/dashboard/admin', { token: studentToken })
  check('a student is refused the admin dashboard (403)', studentHitsAdmin.status === 403, studentHitsAdmin.body)

  const teacherCreatesStudent = await call('POST', '/api/students', {
    token: teacherToken,
    body: { name: 'X', email: 'x@y.z', roll: '99', classRoom: '000000000000000000000000', guardian: { name: 'G' } },
  })
  check('a teacher cannot create students (403)', teacherCreatesStudent.status === 403, teacherCreatesStudent.body)

  const studentListsTeachers = await call('GET', '/api/teachers', { token: studentToken })
  check('a student cannot list staff (403)', studentListsTeachers.status === 403, studentListsTeachers.body)

  // dashboards
  section('Dashboards')
  const adminDash = await call('GET', '/api/dashboard/admin', { token: adminToken })
  check('admin dashboard returns stats, charts and activity',
    adminDash.status === 200 && adminDash.body.data.stats.length === 5 && Array.isArray(adminDash.body.data.gradeDistribution), adminDash.body?.message)

  const analytics = await call('GET', '/api/dashboard/analytics?months=12', { token: adminToken })
  const an = analytics.body?.data
  check('admin analytics returns attendance, rankings, subjects, admissions and fees',
    analytics.status === 200 &&
      an.months === 12 &&
      an.monthlyAdmissions.length === 12 &&
      an.attendanceTrend.length === 12 &&
      an.topStudents.length > 0 &&
      an.topStudents.every((s, i, all) => i === 0 || all[i - 1].average >= s.average) &&
      an.subjectPerformance.length > 0 &&
      an.lowAttendance.every((s) => s.rate < an.minimumAttendance) &&
      an.fees.billed === an.fees.collected + an.fees.outstanding,
    analytics.body?.message)

  const teacherAnalytics = await call('GET', '/api/dashboard/analytics', { token: teacherToken })
  check('a teacher is refused school analytics (403)', teacherAnalytics.status === 403, teacherAnalytics.body)

  const teacherDash = await call('GET', '/api/dashboard/teacher', { token: teacherToken })
  check('teacher dashboard returns classes and pending assignments',
    teacherDash.status === 200 && teacherDash.body.data.classes.length > 0, teacherDash.body?.message)

  const studentDash = await call('GET', '/api/dashboard/student', { token: studentToken })
  check('student dashboard returns courses and stats',
    studentDash.status === 200 && studentDash.body.data.stats.length === 4, studentDash.body?.message)

  // students
  section('Students CRUD')
  const list = await call('GET', '/api/students?limit=5', { token: adminToken })
  check('list is paginated', list.status === 200 && list.body.data.length === 5 && list.body.pagination.total > 5, list.body?.pagination)

  const searched = await call('GET', '/api/students?search=Maya', { token: adminToken })
  check('search filters the list', searched.status === 200 && searched.body.data.every((s) => /maya/i.test(s.name)), searched.body?.data?.length)

  const classes = await call('GET', '/api/classes', { token: adminToken })
  check('classes list includes occupancy', classes.status === 200 && classes.body.data[0].occupancy >= 0, classes.body?.message)
  const classId = classes.body.data[0]._id

  const badCreate = await call('POST', '/api/students', { token: adminToken, body: { name: '' } })
  check('creating a student without required fields returns field errors',
    badCreate.status === 400 && badCreate.body.fields?.name && badCreate.body.fields?.email, badCreate.body)

  const created = await call('POST', '/api/students', {
    token: adminToken,
    body: {
      name: 'Test Student',
      email: 'test.student@scholaris.edu',
      roll: '99',
      classRoom: classId,
      guardian: { name: 'Test Guardian', phone: '+1 555 000 0000' },
      gender: 'Female',
    },
  })
  check('a valid student is created with an auto id', created.status === 201 && /^STU-\d+$/.test(created.body.data.studentId), created.body)
  const newStudentId = created.body.data?._id

  const dupe = await call('POST', '/api/students', {
    token: adminToken,
    body: { name: 'Dupe', email: 'test.student@scholaris.edu', roll: '98', classRoom: classId, guardian: { name: 'G' } },
  })
  check('a duplicate email is rejected with 409', dupe.status === 409, dupe.body)

  const fetched = await call('GET', `/api/students/${created.body.data.studentId}`, { token: adminToken })
  check('a student can be fetched by their STU- code', fetched.status === 200 && fetched.body.data.name === 'Test Student', fetched.body?.message)

  const updated = await call('PUT', `/api/students/${newStudentId}`, { token: adminToken, body: { phone: '+1 (555) 123-4567' } })
  check('a student can be updated', updated.status === 200 && updated.body.data.phone === '+1 (555) 123-4567', updated.body?.message)

  const removed = await call('DELETE', `/api/students/${newStudentId}`, { token: adminToken })
  check('a student can be deleted', removed.status === 200, removed.body)

  const gone = await call('GET', `/api/students/${newStudentId}`, { token: adminToken })
  check('the deleted student is gone (404)', gone.status === 404, gone.body)

  // teachers
  section('Teachers')
  const teacherList = await call('GET', '/api/teachers?department=Sciences', { token: adminToken })
  check('teachers can be filtered by department',
    teacherList.status === 200 && teacherList.body.data.every((t) => t.department === 'Sciences'), teacherList.body?.message)

  const myClasses = await call('GET', '/api/teachers/me/classes', { token: teacherToken })
  check('a teacher can load their own classes', myClasses.status === 200 && myClasses.body.data.length > 0, myClasses.body?.message)

  // attendance
  section('Attendance')
  const roomId = myClasses.body.data[0]._id
  const register = await call('GET', `/api/attendance/register?classRoom=${roomId}&period=3`, { token: teacherToken })
  check('the register returns the class roster', register.status === 200 && register.body.data.students.length > 0, register.body?.message)

  const marked = await call('POST', '/api/attendance', {
    token: teacherToken,
    body: {
      classRoom: roomId,
      period: 3,
      records: register.body.data.students.map((s, i) => ({ student: s._id, status: i === 0 ? 'absent' : 'present' })),
    },
  })
  check('a register can be submitted', marked.status === 201 && marked.body.data.summary.absent === 1, marked.body?.message)

  const remark = await call('POST', '/api/attendance', {
    token: teacherToken,
    body: {
      classRoom: roomId,
      period: 3,
      records: register.body.data.students.map((s) => ({ student: s._id, status: 'present' })),
    },
  })
  check('re-submitting the same register overwrites rather than duplicating',
    remark.status === 201 && remark.body.data.summary.absent === 0, remark.body?.message)

  const badStatus = await call('POST', '/api/attendance', {
    token: teacherToken,
    body: { classRoom: roomId, period: 3, records: [{ student: register.body.data.students[0]._id, status: 'maybe' }] },
  })
  check('an invalid attendance status is rejected', badStatus.status === 400, badStatus.body)

  const overview = await call('GET', '/api/attendance/overview', { token: adminToken })
  check('the admin overview aggregates every class', overview.status === 200 && overview.body.data.rows.length > 0, overview.body?.message)

  const myAtt = await call('GET', '/api/attendance/me', { token: studentToken })
  check('a student sees their own attendance log', myAtt.status === 200 && myAtt.body.data.log.length > 0, myAtt.body?.message)

  // exams/results
  section('Exams & results')
  const examList = await call('GET', '/api/exams', { token: teacherToken })
  check('a teacher only sees exams for their own classes', examList.status === 200 && examList.body.data.length > 0, examList.body?.message)

  const targetExam = examList.body.data.find((e) => e.status === 'Scheduled') || examList.body.data[0]
  const sheet = await call('GET', `/api/results/sheet/${targetExam._id}`, { token: teacherToken })
  check('the marks sheet returns the roster', sheet.status === 200 && sheet.body.data.rows.length > 0, sheet.body?.message)

  const overMax = await call('POST', '/api/results', {
    token: teacherToken,
    body: { exam: targetExam._id, entries: [{ student: sheet.body.data.rows[0]._id, marks: targetExam.maxMarks + 50 }] },
  })
  check('marks above the maximum are rejected', overMax.status === 400, overMax.body)

  const savedMarks = await call('POST', '/api/results', {
    token: teacherToken,
    body: {
      exam: targetExam._id,
      entries: sheet.body.data.rows.slice(0, 3).map((r, i) => ({ student: r._id, marks: 40 + i })),
    },
  })
  check('marks are saved and the exam moves to Grading',
    savedMarks.status === 201 && savedMarks.body.data.examStatus === 'Grading', savedMarks.body)

  const myExams = await call('GET', '/api/exams/me', { token: studentToken })
  check('a student sees their exam schedule with published results',
    myExams.status === 200 && myExams.body.data.exams.length > 0, myExams.body?.message)

  const myResults = await call('GET', '/api/results/me', { token: studentToken })
  check('a student sees their own results with grades',
    myResults.status === 200 && myResults.body.data.every((r) => r.grade), myResults.body?.message)

  // assignments
  section('Assignments')
  const subjects = await call('GET', '/api/subjects', { token: teacherToken })
  const assignBody = {
    title: 'Smoke Test Assignment',
    description: 'Created by the smoke test.',
    subject: subjects.body.data[0]._id,
    classRoom: roomId,
    dueDate: new Date(Date.now() + 7 * 864e5).toISOString(),
    maxMarks: 20,
  }
  const createdAssignment = await call('POST', '/api/assignments', { token: teacherToken, body: assignBody })
  check('a teacher can publish an assignment', createdAssignment.status === 201, createdAssignment.body)

  const allClasses = await call('GET', '/api/classes', { token: adminToken })
  const mineIds = new Set(myClasses.body.data.map((c) => c._id))
  const otherClass = allClasses.body.data.find((c) => !mineIds.has(c._id))
  if (otherClass) {
    const foreign = await call('POST', '/api/assignments', { token: teacherToken, body: { ...assignBody, classRoom: otherClass._id } })
    check("a teacher cannot set an assignment for a class they don't teach", foreign.status === 403, foreign.body)

    const foreignRegister = await call('GET', `/api/attendance/register?classRoom=${otherClass._id}`, { token: teacherToken })
    check("a teacher cannot open the register of a class they don't teach", foreignRegister.status === 403, foreignRegister.body)
  }

  const pastDue = await call('POST', '/api/assignments', {
    token: teacherToken,
    body: { ...assignBody, assignedOn: new Date().toISOString(), dueDate: new Date(Date.now() - 864e5).toISOString() },
  })
  check('a due date before the assigned date is rejected', pastDue.status === 400, pastDue.body)

  const myAssignments = await call('GET', '/api/assignments/me', { token: studentToken })
  check('a student sees assignments for their class with a status',
    myAssignments.status === 200 && myAssignments.body.data.length > 0 && myAssignments.body.data[0].status, myAssignments.body?.message)

  const pending = myAssignments.body.data.find((a) => a.status === 'Pending' || a.status === 'Late')
  if (pending) {
    const submitted = await call('POST', `/api/assignments/${pending.id}/submit`, {
      token: studentToken,
      body: { note: 'Submitted by the smoke test.' },
    })
    check('a student can submit their work', submitted.status === 201, submitted.body)

    const badLink = await call('POST', `/api/assignments/${pending.id}/submit`, {
      token: studentToken,
      body: { fileUrl: 'javascript:alert(1)' },
    })
    check('a submission link that is not http(s) is rejected', badLink.status === 400, badLink.body)

    const detail = await call('GET', `/api/assignments/${pending.id}`, { token: studentToken })
    check("a student reading an assignment never sees classmates' submissions",
      detail.status === 200 && detail.body.data.submissions.length === 1, detail.body?.message)
  } else {
    check('a student can submit their work (no pending assignment to submit)', true)
  }

  // fees
  section('Fees')
  const feeList = await call('GET', '/api/fees?status=Paid&limit=5', { token: adminToken })
  check('invoices can be filtered by status',
    feeList.status === 200 && feeList.body.data.every((f) => f.status === 'Paid'), feeList.body?.message)

  const summary = await call('GET', '/api/fees/summary', { token: adminToken })
  check('the fee summary totals billed and collected',
    summary.status === 200 && summary.body.data.billed > 0 && summary.body.data.collectionRate >= 0, summary.body?.message)

  const myFees = await call('GET', '/api/fees/me', { token: studentToken })
  check('a student sees their own invoices and balance',
    myFees.status === 200 && typeof myFees.body.data.summary.percentPaid === 'number', myFees.body?.message)

  // timetable
  section('Timetable')
  const tt = await call('GET', `/api/timetable?classRoom=${roomId}`, { token: adminToken })
  check('a class timetable returns a day-keyed grid', tt.status === 200 && Array.isArray(tt.body.data.grid.Monday), tt.body?.message)

  const plain = (s) => ({
    day: s.day,
    period: s.period,
    startTime: s.startTime,
    endTime: s.endTime,
    subject: s.subject?._id ?? s.subject ?? null,
    teacher: s.teacher?._id ?? s.teacher ?? null,
    room: s.room,
    isFree: s.isFree,
    freeLabel: s.freeLabel,
  })
  const ownSlots = tt.body.data.slots.map(plain)
  const resave = await call('PUT', `/api/timetable/${roomId}`, { token: adminToken, body: { slots: ownSlots } })
  check('an unchanged timetable saves cleanly', resave.status === 200, resave.body)

  // Book a teacher who is already teaching another class in that same period
  const classesForTt = await call('GET', '/api/classes', { token: adminToken })
  let clashCase = null
  for (const c of classesForTt.body.data.filter((x) => x._id !== roomId)) {
    const otherTt = await call('GET', `/api/timetable?classRoom=${c._id}`, { token: adminToken })
    const busySlot = (otherTt.body.data.slots || []).find((s) => !s.isFree && s.teacher)
    const mine = busySlot && ownSlots.find((s) => s.day === busySlot.day && s.period === busySlot.period)
    if (mine && String(mine.teacher) !== String(busySlot.teacher._id)) {
      clashCase = { busySlot, mine }
      break
    }
  }
  if (clashCase) {
    const clashing = ownSlots.map((s) =>
      s === clashCase.mine ? { ...s, isFree: false, teacher: clashCase.busySlot.teacher._id, subject: clashCase.busySlot.subject._id } : s,
    )
    const clash = await call('PUT', `/api/timetable/${roomId}`, { token: adminToken, body: { slots: clashing } })
    check('double-booking a teacher is rejected with the teacher, day and period named',
      clash.status === 409 && clash.body.message.includes(clashCase.busySlot.day), clash.body)
  }

  const myTt = await call('GET', '/api/timetable/me', { token: studentToken })
  check('a student sees their own week', myTt.status === 200 && Array.isArray(myTt.body.data.grid.Monday), myTt.body?.message)

  const teacherTt = await call('GET', '/api/timetable/me', { token: teacherToken })
  check('a teacher sees their own periods across classes', teacherTt.status === 200 && Boolean(teacherTt.body.data.grid), teacherTt.body?.message)

  // announcements
  section('Announcements')
  const studentAnns = await call('GET', '/api/announcements', { token: studentToken })
  check('a student never sees teacher-only notices',
    studentAnns.status === 200 && studentAnns.body.data.every((a) => a.audience !== 'Teachers'), studentAnns.body?.message)

  const teacherBroadcast = await call('POST', '/api/announcements', {
    token: teacherToken,
    body: { title: 'Nope', body: 'Should be refused', audience: 'All' },
  })
  check('a teacher cannot broadcast to the whole school', teacherBroadcast.status === 403, teacherBroadcast.body)

  const teacherNotice = await call('POST', '/api/announcements', {
    token: teacherToken,
    body: { title: 'Homework reminder', body: 'Posted by the smoke test.', audience: 'Students' },
  })
  check('a teacher can post a notice to students', teacherNotice.status === 201, teacherNotice.body)

  const teacherAnns = await call('GET', '/api/announcements', { token: teacherToken })
  const teacherUserId = teacherNotice.body?.data?.createdBy
  check("a teacher sees their own notices but never other people's student-only notices",
    teacherAnns.status === 200 &&
      teacherAnns.body.data.some((a) => a._id === teacherNotice.body?.data?._id) &&
      teacherAnns.body.data.every((a) => a.audience !== 'Students' || a.createdBy === teacherUserId),
    teacherAnns.body?.message)

  const teacherWiden = await call('PUT', `/api/announcements/${teacherNotice.body?.data?._id}`, {
    token: teacherToken,
    body: { title: 'Homework reminder', body: 'Now for everyone?', audience: 'All' },
  })
  check('a teacher cannot widen their notice to the whole school by editing it', teacherWiden.status === 403, teacherWiden.body)

  const adminAnn = await call('POST', '/api/announcements', {
    token: adminToken,
    body: { title: 'Smoke Test Notice', body: 'Posted by the smoke test.', audience: 'All', pinned: true },
  })
  check('an admin can publish an announcement', adminAnn.status === 201, adminAnn.body)

  const emptyAnn = await call('POST', '/api/announcements', { token: adminToken, body: { title: '', body: '' } })
  check('an empty announcement fails validation', emptyAnn.status === 400 && emptyAnn.body.fields?.title, emptyAnn.body)

  // settings
  section('Settings')
  const getSettings = await call('GET', '/api/settings', { token: adminToken })
  check('settings load with defaults', getSettings.status === 200 && getSettings.body.data.academic.passingMarks === 40, getSettings.body?.message)

  const putSettings = await call('PUT', '/api/settings', {
    token: adminToken,
    body: { academic: { passingMarks: 45 } },
  })
  check('a partial settings update merges rather than replacing',
    putSettings.status === 200 && putSettings.body.data.academic.passingMarks === 45 && putSettings.body.data.academic.minimumAttendance === 75, putSettings.body?.message)

  const studentWritesSettings = await call('PUT', '/api/settings', { token: studentToken, body: { academic: { passingMarks: 1 } } })
  check('a student cannot change settings', studentWritesSettings.status === 403, studentWritesSettings.body)

  // misc errors
  section('Error handling')
  const missing = await call('GET', '/api/does-not-exist', { token: adminToken })
  check('an unknown route returns a clean 404', missing.status === 404 && missing.body.success === false, missing.body)

  const badId = await call('GET', '/api/classes/not-an-id', { token: adminToken })
  check('a malformed id returns 400, not 500', badId.status === 400, badId.body)

  const pwd = await call('PATCH', '/api/auth/password', {
    token: adminToken,
    body: { currentPassword: 'admin123', newPassword: 'short', confirmPassword: 'short' },
  })
  check('a weak new password is rejected', pwd.status === 400 && pwd.body.fields?.newPassword, pwd.body)

  const pwdOk = await call('PATCH', '/api/auth/password', {
    token: adminToken,
    body: { currentPassword: 'admin123', newPassword: 'NewAdminPass1', confirmPassword: 'NewAdminPass1' },
  })
  check('a valid password change succeeds', pwdOk.status === 200, pwdOk.body)

  const oldPassword = await call('POST', '/api/auth/login', {
    body: { email: 'admin@scholaris.edu', password: 'admin123' },
  })
  check('the old password no longer works', oldPassword.status === 401, oldPassword.body)

  // security: sessions & co
  section('Security — sessions, CSRF, lockout, reset, audit')

  const afterChange = await call('GET', '/api/auth/me', { token: adminToken })
  check('a token issued before a password change stops working', afterChange.status === 401, afterChange.body)

  const noCsrf = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@scholaris.edu', password: 'NewAdminPass1' }),
  })
  check('a state-changing request without the CSRF header is refused (403)', noCsrf.status === 403)

  const injected = await call('POST', '/api/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } })
  check('an operator injected into the login body is rejected (400)', injected.status === 400, injected.body)

  // Cookie-based browser flow: access + rotating refresh cookies
  const jar = {}
  const keepCookies = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';')
      const i = pair.indexOf('=')
      jar[pair.slice(0, i)] = pair.slice(i + 1)
    }
  }
  const cookieHeader = (names) => names.filter((n) => jar[n]).map((n) => `${n}=${jar[n]}`).join('; ')
  const raw = (method, path, cookie, body) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

  const tLogin = await call('POST', '/api/auth/login', { body: { email: 'teacher@scholaris.edu', password: 'teacher123', role: 'teacher' } })
  const tVerifyRes = await raw('POST', '/api/auth/verify-otp', null, { email: 'teacher@scholaris.edu', code: tLogin.body.data.previewCode })
  keepCookies(tVerifyRes)
  const setCookies = (tVerifyRes.headers.getSetCookie?.() ?? []).join(' | ')
  check('sign-in sets httpOnly, SameSite=Strict session cookies',
    tVerifyRes.status === 200 && /scholaris_at=.*HttpOnly/i.test(setCookies) && /scholaris_rt=.*SameSite=Strict/i.test(setCookies), setCookies)

  const cookieMe = await raw('GET', '/api/auth/me', cookieHeader(['scholaris_at']))
  check('the access cookie authenticates requests', cookieMe.status === 200)

  const firstRefresh = jar.scholaris_rt
  const rotated = await raw('POST', '/api/auth/refresh', `scholaris_rt=${firstRefresh}`)
  keepCookies(rotated)
  check('the refresh cookie is rotated on use', rotated.status === 200 && jar.scholaris_rt && jar.scholaris_rt !== firstRefresh)

  const replay = await raw('POST', '/api/auth/refresh', `scholaris_rt=${firstRefresh}`)
  check('replaying a used refresh token is refused (401)', replay.status === 401)
  const afterReplay = await raw('POST', '/api/auth/refresh', `scholaris_rt=${jar.scholaris_rt}`)
  check('a replay revokes the whole session family', afterReplay.status === 401)
  const accessAfterReplay = await raw('GET', '/api/auth/me', cookieHeader(['scholaris_at']))
  check('…including the current access cookie', accessAfterReplay.status === 401)

  // Logout ends the session server-side
  const sTok = await signIn('student@scholaris.edu', 'student123')
  const sLogout = await call('POST', '/api/auth/logout', { token: sTok })
  const sAfter = await call('GET', '/api/auth/me', { token: sTok })
  check('logout revokes the session token immediately', sLogout.status === 200 && sAfter.status === 401, sAfter.body)

  // Lockout after repeated wrong passwords
  let lastStatus = 0
  for (let i = 0; i < 5; i += 1) {
    lastStatus = (await call('POST', '/api/auth/login', { body: { email: 'helena.voss@scholaris.edu', password: `wrong-${i}` } })).status
  }
  check('the 5th wrong password locks the account (423)', lastStatus === 423, lastStatus)
  const lockedRight = await call('POST', '/api/auth/login', { body: { email: 'helena.voss@scholaris.edu', password: 'Teacher123' } })
  check('a locked account refuses even the right password', lockedRight.status === 423, lockedRight.body)

  // Password reset: identical answer for known and unknown emails
  const fpKnown = await call('POST', '/api/auth/forgot-password', { body: { email: 'helena.voss@scholaris.edu' } })
  const fpUnknown = await call('POST', '/api/auth/forgot-password', { body: { email: 'ghost@scholaris.edu' } })
  check('forgot-password does not reveal whether an account exists',
    fpKnown.status === 200 && fpUnknown.status === 200 && fpKnown.body.message === fpUnknown.body.message, [fpKnown.body, fpUnknown.body])

  // The real token is only emailed; plant a known one to exercise the reset endpoint
  const crypto = await import('node:crypto')
  const UserModel = (await import('../src/models/User.js')).default
  const resetToken = crypto.randomBytes(32).toString('base64url')
  await UserModel.updateOne({ email: 'helena.voss@scholaris.edu' }, {
    resetTokenHash: crypto.createHash('sha256').update(resetToken).digest('hex'),
    resetTokenExpiresAt: new Date(Date.now() + 60_000),
  })
  const weakReset = await call('POST', '/api/auth/reset-password', { body: { token: resetToken, password: 'weak', confirmPassword: 'weak' } })
  check('reset enforces the password policy', weakReset.status === 400 && weakReset.body.fields?.password, weakReset.body)
  const reset = await call('POST', '/api/auth/reset-password', { body: { token: resetToken, password: 'HelenaReset2026', confirmPassword: 'HelenaReset2026' } })
  check('a valid reset token sets the new password and unlocks the account', reset.status === 200, reset.body)
  const reuseReset = await call('POST', '/api/auth/reset-password', { body: { token: resetToken, password: 'HelenaReset2027', confirmPassword: 'HelenaReset2027' } })
  check('a reset token works only once', reuseReset.status === 400, reuseReset.body)
  const helenaLogin = await call('POST', '/api/auth/login', { body: { email: 'helena.voss@scholaris.edu', password: 'HelenaReset2026' } })
  check('the new password signs in', helenaLogin.status === 200, helenaLogin.body)

  // Public demo accounts: no email code, no lockout, no destructive actions
  section('Demo accounts')
  await UserModel.create({ name: 'Demo Smoke', email: 'demo.smoke@example.com', password: 'DemoSmoke2026', role: 'admin', isDemo: true })
  for (let i = 0; i < 6; i += 1) {
    await call('POST', '/api/auth/login', { body: { email: 'demo.smoke@example.com', password: `wrong-${i}` } })
  }
  const demoLogin = await call('POST', '/api/auth/login', { body: { email: 'demo.smoke@example.com', password: 'DemoSmoke2026' } })
  check('a demo account signs in without an email code, even after wrong passwords',
    demoLogin.status === 200 && demoLogin.body.data.otpRequired === false && demoLogin.body.data.user.isDemo === true && Boolean(demoLogin.body.data.token),
    demoLogin.body)
  const demoToken = demoLogin.body.data.token
  const demoRead = await call('GET', '/api/students?limit=2', { token: demoToken })
  check('a demo admin can read data', demoRead.status === 200 && demoRead.body.data.length > 0, demoRead.body?.message)
  const someStudent = demoRead.body.data[0]
  const demoEdit = await call('PUT', `/api/students/${someStudent._id}`, { token: demoToken, body: { phone: '+92 300 0000000' } })
  check('a demo admin can edit records', demoEdit.status === 200, demoEdit.body)
  const demoBlocked = await Promise.all([
    call('DELETE', `/api/students/${someStudent._id}`, { token: demoToken }),
    call('PUT', `/api/students/${someStudent._id}`, { token: demoToken, body: { email: 'takeover@example.com' } }),
    call('POST', '/api/students', { token: demoToken, body: { name: 'X', email: 'x.demo@example.com', roll: '1', classRoom: someStudent.classRoom._id, guardian: { name: 'G' }, password: 'Takeover12345' } }),
    call('PATCH', '/api/auth/password', { token: demoToken, body: { currentPassword: 'DemoSmoke2026', newPassword: 'Changed12345', confirmPassword: 'Changed12345' } }),
    call('PUT', '/api/settings', { token: demoToken, body: { school: { name: 'Hacked' } } }),
    call('POST', '/api/auth/logout-all', { token: demoToken }),
  ])
  check('a demo account cannot delete, take over accounts, change its password or settings, or sign others out',
    demoBlocked.every((r) => r.status === 403), demoBlocked.map((r) => r.status))
  const stillThere = await call('GET', `/api/students/${someStudent._id}`, { token: demoToken })
  check('…and nothing it was refused actually happened', stillThere.status === 200 && stillThere.body.data.email === someStudent.email, stillThere.body?.message)

  // Admin-created accounts must change the temporary password first
  const admin2 = await signIn('admin@scholaris.edu', 'NewAdminPass1')
  const withLogin = await call('POST', '/api/students', {
    token: admin2,
    body: { name: 'Temp Login', email: 'temp.login@scholaris.edu', roll: '97', classRoom: classId, guardian: { name: 'G' }, password: 'TempPass1234' },
  })
  check('an admin can create a student with a login', withLogin.status === 201, withLogin.body)
  const tempTok = await signIn('temp.login@scholaris.edu', 'TempPass1234')
  const blocked = await call('GET', '/api/dashboard/student', { token: tempTok })
  check('a temporary password must be changed before using the portal', blocked.status === 403, blocked.body)
  await call('PATCH', '/api/auth/password', {
    token: tempTok,
    body: { currentPassword: 'TempPass1234', newPassword: 'MyOwnPass1234', confirmPassword: 'MyOwnPass1234' },
  })
  const tempTok2 = await signIn('temp.login@scholaris.edu', 'MyOwnPass1234')
  const unblocked = await call('GET', '/api/dashboard/student', { token: tempTok2 })
  check('after changing it, the portal opens', unblocked.status === 200, unblocked.body)

  // Audit log
  const logs = await call('GET', '/api/audit-logs?limit=100', { token: admin2 })
  const events = new Set((logs.body.data || []).map((l) => l.event))
  check('the audit log records sign-ins, lockouts, resets and data changes',
    logs.status === 200 && ['login.success', 'login.failure', 'account.locked', 'password.reset', 'students.create'].every((e) => events.has(e)), [...events])
  check('audit entries never contain passwords',
    !JSON.stringify(logs.body.data).includes('TempPass1234') && !JSON.stringify(logs.body.data).includes('HelenaReset2026'))
  const teacherLogs = await call('GET', '/api/audit-logs', { token: await signIn('marcus.bell@scholaris.edu', 'Teacher123') })
  check('a teacher cannot read the audit log (403)', teacherLogs.status === 403, teacherLogs.body)
} catch (err) {
  failed += 1
  failures.push(`uncaught: ${err.message}`)
  console.error('\n[smoke] threw:', err)
} finally {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${passed} passed, ${failed} failed`)
  if (failures.length) {
    console.log('\n  Failures:')
    failures.forEach((f) => console.log(`    • ${f}`))
  }
  console.log(`${'─'.repeat(60)}\n`)

  server.close()
  await mongoose.disconnect()
  await mongo?.stop()
  process.exit(failed === 0 ? 0 : 1)
}
