// Creates, or resets, the three public demo logins on the database in .env
//   npm run seed:demo
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'
import User from '../src/models/User.js'
import { ClassRoom, Fee, Student, Subject, Teacher } from '../src/models/index.js'

// example.com is reserved and never receives mail: these are not real inboxes
const DEMO_ACCOUNTS = {
  admin: { name: 'Demo Admin', email: 'demo.admin@example.com', password: 'DemoAdmin2026' },
  teacher: { name: 'Demo Teacher', email: 'demo.teacher@example.com', password: 'DemoTeacher2026' },
  student: { name: 'Demo Student', email: 'demo.student@example.com', password: 'DemoStudent2026' },
}

const daysFromNow = (n) => new Date(Date.now() + n * 864e5)

async function upsertUser(role, { name, email, password }, profile) {
  let user = await User.findOne({ email }).select('+password +failedLoginAttempts +lockUntil')
  if (!user) user = new User({ email })
  Object.assign(user, {
    name,
    role,
    isDemo: true,
    isActive: true,
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockUntil: null,
    profileModel: profile ? (role === 'student' ? 'Student' : 'Teacher') : null,
    profile: profile?._id ?? null,
  })
  user.password = password // re-hashed by the model on every run, so this also resets it
  await user.save()
  return user
}

async function run() {
  const classes = await ClassRoom.find().sort('name section').lean()
  const subjects = await Subject.find().sort('name').lean()
  if (!classes.length || !subjects.length) {
    throw new Error('Create at least one class and one subject before adding demo accounts.')
  }

  // Admin
  await upsertUser('admin', DEMO_ACCOUNTS.admin)

  // Teacher: teaches up to two existing classes
  const t = DEMO_ACCOUNTS.teacher
  const subject = subjects[0]
  let teacher = await Teacher.findOne({ email: t.email })
  if (!teacher) {
    teacher = await Teacher.create({
      staffId: 'DEMO-T01',
      name: t.name,
      email: t.email,
      subject: subject._id,
      department: subject.department,
      qualification: 'M.Ed. (demo account)',
      experience: 5,
      classes: classes.slice(0, 2).map((c) => c._id),
      bio: 'Public demo account.',
    })
  }
  teacher.user = (await upsertUser('teacher', t, teacher))._id
  await teacher.save()

  // Student: in the first class with a free seat
  const s = DEMO_ACCOUNTS.student
  let student = await Student.findOne({ email: s.email })
  if (!student) {
    let room = null
    for (const c of classes) {
      if ((await Student.countDocuments({ classRoom: c._id, status: 'Active' })) < c.capacity) {
        room = c
        break
      }
    }
    if (!room) throw new Error('Every class is full — free a seat or raise a class capacity for the demo student.')
    student = await Student.create({
      studentId: 'STU-DEMO',
      name: s.name,
      email: s.email,
      roll: 'DEMO',
      classRoom: room._id,
      guardian: { name: 'Demo Guardian', relationship: 'Parent' },
      notes: 'Public demo account.',
    })
  }
  student.user = (await upsertUser('student', s, student))._id
  await student.save()

  // A paid and an unpaid invoice so the fee pages have something to show
  const invoices = [
    { invoiceNo: 'DEMO-INV-1', description: 'Tuition Fee', amount: 18000, dueDate: daysFromNow(-20), status: 'Paid', method: 'Bank transfer', paidAt: daysFromNow(-22) },
    { invoiceNo: 'DEMO-INV-2', description: 'Laboratory Fee', amount: 3500, dueDate: daysFromNow(15), status: 'Pending', method: '—', paidAt: null },
  ]
  for (const inv of invoices) {
    if (!(await Fee.exists({ invoiceNo: inv.invoiceNo }))) {
      await Fee.create({ ...inv, student: student._id, term: 'Term 1 · 2026' })
    }
  }

  const room = await ClassRoom.findById(student.classRoom).lean()
  return { teacherClasses: teacher.classes.length, studentClass: `${room.name} · ${room.section}` }
}

connectDb()
  .then(run)
  .then(({ teacherClasses, studentClass }) => {
    console.log('\n  Demo accounts are ready (no email code needed):\n')
    for (const [role, a] of Object.entries(DEMO_ACCOUNTS)) {
      console.log(`    ${role.padEnd(8)} ${a.email.padEnd(26)} ${a.password.padEnd(16)} → /${role}/login`)
    }
    console.log(`\n  Demo teacher teaches ${teacherClasses} class(es); demo student is in ${studentClass}.\n`)
    return disconnectDb()
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n[seed-demo] ${err.message}\n`)
    mongoose.connection.close().finally(() => process.exit(1))
  })
