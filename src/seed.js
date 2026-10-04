// Seeds a working sample dataset
//   npm run seed            # wipes and reseeds the configured database
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from './config/db.js'
import User from './models/User.js'
import {
  Announcement,
  Assignment,
  Attendance,
  ClassRoom,
  DAYS,
  Exam,
  Fee,
  Result,
  Settings,
  Student,
  Subject,
  Teacher,
  Timetable,
} from './models/index.js'
import { gradeFor } from './controllers/exam.controller.js'

const PERIODS = [
  { period: 1, startTime: '08:00', endTime: '08:45' },
  { period: 2, startTime: '08:50', endTime: '09:35' },
  { period: 3, startTime: '09:40', endTime: '10:25' },
  { period: 4, startTime: '10:45', endTime: '11:30' },
  { period: 5, startTime: '11:35', endTime: '12:20' },
  { period: 6, startTime: '13:00', endTime: '13:45' },
]

const FIRST = ['Maya', 'Liam', 'Zara', 'Noah', 'Aisha', 'Ethan', 'Leila', 'Omar', 'Ivy', 'Kai', 'Nora', 'Jonah', 'Mira', 'Adam', 'Sofia', 'Elias', 'Hana', 'Yusuf', 'Clara', 'Ruben', 'Tara', 'Idris', 'Naomi', 'Felix']
const LAST = ['Rahman', 'Okonkwo', 'Haddad', 'Lindqvist', 'Bergman', 'Farouk', 'Novak', 'Iqbal', 'Moreau', 'Tanaka', 'Silva', 'Adeyemi']

const seeded = (i, mod) => (i * 7919 + 104729) % mod
const daysAgo = (n) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
const daysAhead = (n) => daysAgo(-n)

export async function seedDatabase({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a)

  await Promise.all([
    User.deleteMany({}),
    Student.deleteMany({}),
    Teacher.deleteMany({}),
    ClassRoom.deleteMany({}),
    Subject.deleteMany({}),
    Attendance.deleteMany({}),
    Exam.deleteMany({}),
    Result.deleteMany({}),
    Assignment.deleteMany({}),
    Fee.deleteMany({}),
    Timetable.deleteMany({}),
    Announcement.deleteMany({}),
    Settings.deleteMany({}),
  ])
  log('[seed] cleared existing collections')

  await Settings.create({ key: 'global' })

  // Subjects
  const subjects = await Subject.create([
    { code: 'MATH-101', name: 'Mathematics', department: 'Sciences', credits: 4, grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
    { code: 'PHY-201', name: 'Physics', department: 'Sciences', credits: 4, grades: ['Grade 11', 'Grade 12'] },
    { code: 'CHM-201', name: 'Chemistry', department: 'Sciences', credits: 4, grades: ['Grade 10', 'Grade 11'] },
    { code: 'BIO-201', name: 'Biology', department: 'Sciences', credits: 3, grades: ['Grade 10', 'Grade 11'] },
    { code: 'ENG-101', name: 'English Literature', department: 'Humanities', credits: 3, grades: ['Grade 9', 'Grade 10'] },
    { code: 'HIS-101', name: 'World History', department: 'Humanities', credits: 2, grades: ['Grade 9', 'Grade 10'] },
    { code: 'CS-301', name: 'Computer Science', department: 'Technology', credits: 4, grades: ['Grade 11', 'Grade 12'] },
    { code: 'GEO-101', name: 'Geography', department: 'Humanities', credits: 2, grades: ['Grade 9'] },
  ])
  const subjectBy = Object.fromEntries(subjects.map((s) => [s.code, s]))
  log(`[seed] ${subjects.length} subjects`)

  // Classes
  const classes = await ClassRoom.create([
    { name: 'Grade 9', section: 'A', room: 'B-201', capacity: 40 },
    { name: 'Grade 9', section: 'B', room: 'B-202', capacity: 40 },
    { name: 'Grade 10', section: 'A', room: 'B-301', capacity: 40 },
    { name: 'Grade 10', section: 'B', room: 'B-302', capacity: 40 },
    { name: 'Grade 11', section: 'A', room: 'C-101', capacity: 35 },
    { name: 'Grade 12', section: 'A', room: 'C-201', capacity: 35 },
  ])
  log(`[seed] ${classes.length} classes`)

  // Admin account
  await User.create({
    name: 'Ayesha Karim',
    email: 'admin@scholaris.edu',
    password: 'admin123',
    role: 'admin',
  })

  // Teachers (+ their login accounts)
  const teacherSeed = [
    { name: 'Daniel Okafor', email: 'teacher@scholaris.edu', subject: 'MATH-101', department: 'Sciences', qualification: 'M.Sc. Applied Mathematics', experience: 9, classes: [2, 4, 5], password: 'teacher123' },
    { name: 'Helena Voss', email: 'helena.voss@scholaris.edu', subject: 'PHY-201', department: 'Sciences', qualification: 'Ph.D. Physics', experience: 12, classes: [4, 5] },
    { name: 'Marcus Bell', email: 'marcus.bell@scholaris.edu', subject: 'ENG-101', department: 'Humanities', qualification: 'M.A. English', experience: 6, classes: [0, 1] },
    { name: 'Priya Nair', email: 'priya.nair@scholaris.edu', subject: 'HIS-101', department: 'Humanities', qualification: 'M.A. History', experience: 8, classes: [1, 3] },
    { name: 'Rohan Mehta', email: 'rohan.mehta@scholaris.edu', subject: 'CHM-201', department: 'Sciences', qualification: 'M.Sc. Chemistry', experience: 5, classes: [3] },
    { name: 'Sara Lindqvist', email: 'sara.lindqvist@scholaris.edu', subject: 'BIO-201', department: 'Sciences', qualification: 'M.Sc. Biology', experience: 11, classes: [2, 3], status: 'On Leave' },
    { name: 'Amelia Frost', email: 'amelia.frost@scholaris.edu', subject: 'CS-301', department: 'Technology', qualification: 'M.S. Computer Science', experience: 7, classes: [5] },
    { name: 'Tomas Vega', email: 'tomas.vega@scholaris.edu', subject: 'GEO-101', department: 'Humanities', qualification: 'B.Ed. Geography', experience: 4, classes: [0] },
  ]

  const teachers = []
  for (const [i, t] of teacherSeed.entries()) {
    const teacher = await Teacher.create({
      staffId: `TCH-${201 + i}`,
      employeeId: `EMP-${2017 + i}-0${i + 1}`,
      name: t.name,
      email: t.email,
      phone: `+1 (555) ${200 + i * 37}-${1000 + i * 211}`,
      subject: subjectBy[t.subject]._id,
      department: t.department,
      qualification: t.qualification,
      experience: t.experience,
      joined: daysAgo(365 * (2 + (i % 5))),
      classes: t.classes.map((c) => classes[c]._id),
      status: t.status || 'Active',
      address: `${40 + i} Birchwood Lane, Springfield`,
    })

    const user = await User.create({
      name: t.name,
      email: t.email,
      password: t.password || 'Teacher123',
      role: 'teacher',
      profileModel: 'Teacher',
      profile: teacher._id,
    })
    teacher.user = user._id
    await teacher.save()
    teachers.push(teacher)
  }
  log(`[seed] ${teachers.length} teachers`)

  // Class teachers + subject leads
  const classTeacherIdx = [2, 3, 0, 5, 1, 6]
  for (const [i, room] of classes.entries()) {
    room.classTeacher = teachers[classTeacherIdx[i]]._id
    room.subjects = subjects.filter((s) => s.grades.includes(room.name)).map((s) => s._id)
    await room.save()
  }
  for (const [i, s] of subjects.entries()) {
    s.leadTeacher = teachers[i]._id
    await s.save()
  }

  // Students (+ one login account for the demo student)
  const students = []
  for (let i = 0; i < 42; i += 1) {
    const room = classes[seeded(i, classes.length)]
    const first = FIRST[i % FIRST.length]
    const last = LAST[seeded(i, LAST.length)]
    const isDemo = i === 0

    const student = await Student.create({
      studentId: `STU-${1001 + i}`,
      name: isDemo ? 'Maya Rahman' : `${first} ${last}`,
      email: isDemo ? 'student@scholaris.edu' : `${first.toLowerCase()}.${last.toLowerCase()}${i}@scholaris.edu`,
      phone: `+1 (555) ${300 + seeded(i, 600)}-${1000 + seeded(i, 8000)}`,
      roll: String(i + 1).padStart(2, '0'),
      gender: i % 2 === 0 ? 'Female' : 'Male',
      dob: daysAgo(365 * 16 + seeded(i, 700)),
      bloodGroup: ['O+', 'A+', 'B+', 'AB+'][seeded(i, 4)],
      classRoom: isDemo ? classes[2]._id : room._id,
      guardian: {
        name: `${LAST[seeded(i + 3, LAST.length)]} Family`,
        phone: `+1 (555) ${400 + seeded(i, 500)}-${2000 + seeded(i, 7000)}`,
        relationship: i % 2 ? 'Father' : 'Mother',
      },
      admissionDate: daysAgo(30 * (1 + seeded(i, 8))),
      address: `${100 + seeded(i, 800)} Maple Avenue, Springfield`,
      status: seeded(i, 15) === 0 ? 'Inactive' : 'Active',
    })

    if (isDemo) {
      const user = await User.create({
        name: student.name,
        email: student.email,
        password: 'student123',
        role: 'student',
        profileModel: 'Student',
        profile: student._id,
      })
      student.user = user._id
      await student.save()
    }

    students.push(student)
  }
  log(`[seed] ${students.length} students`)

  // Timetables No teacher is ever booked in two classes in the same period
  const booked = new Set()
  for (const [ci, room] of classes.entries()) {
    const roomSubjects = subjects.filter((s) => s.grades.includes(room.name))
    const slots = []
    DAYS.forEach((day, d) => {
      PERIODS.forEach((p, pi) => {
        if (p.period === 4 && d % 2 === 0) {
          slots.push({ day, ...p, isFree: true, freeLabel: 'Study Hall' })
          return
        }
        // Try subjects in rotation until one has a free teacher for this period
        let pick = null
        for (let k = 0; k < roomSubjects.length && !pick; k += 1) {
          const subject = roomSubjects[(d * 2 + pi + ci + k) % roomSubjects.length]
          const teacher = teachers.find((t) => String(t.subject) === String(subject._id))
          if (!teacher || !booked.has(`${day}|${p.period}|${teacher._id}`)) pick = { subject, teacher }
        }
        if (!pick) {
          slots.push({ day, ...p, isFree: true, freeLabel: 'Study Hall' })
          return
        }
        if (pick.teacher) booked.add(`${day}|${p.period}|${pick.teacher._id}`)
        slots.push({
          day,
          ...p,
          subject: pick.subject._id,
          teacher: pick.teacher?._id ?? null,
          room: room.room,
          isFree: false,
        })
      })
    })
    await Timetable.create({ classRoom: room._id, slots })
  }
  log(`[seed] ${classes.length} timetables`)

  // Attendance: last 20 school days
  let registers = 0
  for (const room of classes) {
    const roster = students.filter((s) => String(s.classRoom) === String(room._id) && s.status === 'Active')
    if (!roster.length) continue

    for (let d = 1; d <= 20; d += 1) {
      const date = daysAgo(d)
      if ([0, 6].includes(date.getUTCDay())) continue

      await Attendance.create({
        classRoom: room._id,
        date,
        period: 1,
        subject: room.subjects[0],
        markedBy: room.classTeacher,
        records: roster.map((s, i) => {
          const roll = seeded(i * d + d, 20)
          return {
            student: s._id,
            status: roll === 0 ? 'absent' : roll === 1 ? 'late' : 'present',
            remark: roll === 0 ? 'Informed leave' : '',
          }
        }),
      })
      registers += 1
    }
  }
  log(`[seed] ${registers} attendance registers`)

  // Exams & results
  const exams = []
  for (const [i, room] of classes.entries()) {
    const roomSubjects = subjects.filter((s) => s.grades.includes(room.name))

    exams.push(
      await Exam.create({
        name: 'Unit Test 2',
        term: 'Term 1',
        classRoom: room._id,
        subject: roomSubjects[0]._id,
        date: daysAgo(10 + i),
        time: '11:00',
        room: `Hall ${String.fromCharCode(65 + (i % 2))}`,
        maxMarks: 50,
        status: 'Results published',
      }),
      await Exam.create({
        name: 'Midterm Examination',
        term: 'Term 1',
        classRoom: room._id,
        subject: roomSubjects[Math.min(1, roomSubjects.length - 1)]._id,
        date: daysAhead(9 + i),
        time: '09:00',
        room: 'Hall A',
        maxMarks: 100,
        status: 'Scheduled',
      }),
    )
  }

  let results = 0
  for (const exam of exams.filter((e) => e.status === 'Results published')) {
    const roster = students.filter((s) => String(s.classRoom) === String(exam.classRoom) && s.status === 'Active')
    for (const [i, s] of roster.entries()) {
      const marks = Math.min(exam.maxMarks, 20 + seeded(i, exam.maxMarks - 18))
      await Result.create({
        exam: exam._id,
        student: s._id,
        marks,
        maxMarks: exam.maxMarks,
        grade: gradeFor(Math.round((marks / exam.maxMarks) * 100)),
        enteredBy: exam.classRoom ? classes.find((c) => String(c._id) === String(exam.classRoom))?.classTeacher : null,
      })
      results += 1
    }
  }
  log(`[seed] ${exams.length} exams, ${results} results`)

  // Assignments
  const assignmentSeed = [
    { title: 'Quadratic Equations — Worksheet 4', subject: 'MATH-101', cls: 2, due: 3, desc: 'Solve problems 1–24. Show full working for every step.' },
    { title: 'Newton’s Laws Lab Report', subject: 'PHY-201', cls: 4, due: -1, desc: 'Write up the friction experiment including error analysis.' },
    { title: 'Essay: Themes in Macbeth', subject: 'ENG-101', cls: 0, due: -4, desc: '1000 words on ambition and guilt. Cite at least three passages.' },
    { title: 'Recursion Practice Set', subject: 'CS-301', cls: 5, due: 6, desc: 'Implement five recursive functions and analyse their complexity.' },
    { title: 'Cell Structure Diagram', subject: 'BIO-201', cls: 3, due: 5, desc: 'Label an annotated diagram of a plant and an animal cell.' },
    { title: 'Map Work: River Systems', subject: 'GEO-101', cls: 0, due: 8, desc: 'Complete the atlas exercise on major river basins.' },
  ]

  for (const a of assignmentSeed) {
    const subject = subjectBy[a.subject]
    const teacher = teachers.find((t) => String(t.subject) === String(subject._id))
    const room = classes[a.cls]
    const roster = students.filter((s) => String(s.classRoom) === String(room._id) && s.status === 'Active')

    await Assignment.create({
      title: a.title,
      description: a.desc,
      subject: subject._id,
      classRoom: room._id,
      teacher: teacher._id,
      assignedOn: daysAgo(7),
      dueDate: daysAhead(a.due),
      maxMarks: 20,
      status: a.due < 0 ? 'Grading' : 'Open',
      submissions: roster.slice(0, Math.ceil(roster.length * 0.7)).map((s) => ({
        student: s._id,
        submittedAt: daysAgo(2),
        note: '',
        late: false,
      })),
    })
  }
  log(`[seed] ${assignmentSeed.length} assignments`)

  // Fees
  let invoices = 0
  for (const [i, s] of students.entries()) {
    const paid = seeded(i, 5) < 3
    await Fee.create({
      invoiceNo: `INV-${2200 + i}`,
      student: s._id,
      term: 'Term 1 · 2026',
      description: 'Tuition Fee',
      amount: [18000, 22500, 15000, 25000][seeded(i, 4)], // PKR
      dueDate: paid ? daysAgo(20) : daysAhead(14 + seeded(i, 10)),
      status: paid ? 'Paid' : 'Pending',
      method: paid ? ['Card', 'Bank transfer', 'Cash'][seeded(i, 3)] : '—',
      paidAt: paid ? daysAgo(22) : null,
    })
    invoices += 1

    if (i % 4 === 0) {
      await Fee.create({
        invoiceNo: `INV-${2400 + i}`,
        student: s._id,
        term: 'Term 3 · 2025',
        description: 'Laboratory Fee',
        amount: 3500,
        dueDate: daysAgo(90),
        status: 'Paid',
        method: 'Card',
        paidAt: daysAgo(92),
      })
      invoices += 1
    }
  }
  log(`[seed] ${invoices} invoices`)

  // Announcements
  await Announcement.create([
    { title: 'Annual Sports Day — 17 September', body: 'All students report to the main field by 08:00. House captains should collect kit from the sports office on Friday.', audience: 'All', author: 'Principal’s Office', pinned: true, publishDate: daysAgo(2) },
    { title: 'Midterm Examination Timetable Released', body: 'The Term 1 midterm schedule is now available under Exams. Please review your seating allocation carefully.', audience: 'Students', author: 'Examinations Board', pinned: true, publishDate: daysAgo(4) },
    { title: 'Staff Meeting — Thursday 15:30', body: 'Agenda: curriculum review, attendance policy update, and Term 1 assessment moderation.', audience: 'Teachers', author: 'Academic Coordinator', publishDate: daysAgo(5) },
    { title: 'Library Extended Hours', body: 'The library will remain open until 19:00 on weekdays during the examination period.', audience: 'All', author: 'Library', publishDate: daysAgo(7) },
    { title: 'Q3 Fee Deadline Reminder', body: 'Term 1 fees are due on 24 September. Late payments incur a 2% surcharge.', audience: 'Students', author: 'Accounts', publishDate: daysAgo(10) },
  ])
  log('[seed] 5 announcements')

  return {
    accounts: [
      { role: 'admin', email: 'admin@scholaris.edu', password: 'admin123', portal: '/admin/login' },
      { role: 'teacher', email: 'teacher@scholaris.edu', password: 'teacher123', portal: '/teacher/login' },
      { role: 'student', email: 'student@scholaris.edu', password: 'student123', portal: '/student/login' },
    ],
    counts: { subjects: subjects.length, classes: classes.length, teachers: teachers.length, students: students.length },
  }
}

// Run directly: npm run seed -- --wipe=<database name>
async function guardedSeed() {
  const conn = await connectDb()
  const dbName = conn.db.databaseName
  const wipeArg = process.argv.find((a) => a.startsWith('--wipe='))?.slice('--wipe='.length)

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production. The seed deletes every collection.')
  }
  if (wipeArg !== dbName) {
    throw new Error(
      `Refusing to seed: this deletes EVERY collection in "${dbName}".\n` +
        `  Back up first (npm run backup), then confirm with:  npm run seed -- --wipe=${dbName}\n` +
        '  To only add missing sign-in accounts, use:  npm run seed:logins',
    )
  }
  return seedDatabase()
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/src/seed.js')
if (invokedDirectly) {
  guardedSeed()
    .then((summary) => {
      console.log('\n  Seed complete. Sign in with:')
      summary.accounts.forEach((a) =>
        console.log(`    ${a.role.padEnd(8)} ${a.email.padEnd(24)} ${a.password.padEnd(11)} → ${a.portal}`),
      )
      console.log()
      return disconnectDb()
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n[seed] ${err.message}\n`)
      mongoose.connection.close().finally(() => process.exit(1))
    })
}
