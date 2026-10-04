import mongoose from 'mongoose'

const { Schema, model } = mongoose
const ref = (name, opts = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...opts })

// Subject
const subjectSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    department: {
      type: String,
      enum: ['Sciences', 'Humanities', 'Technology', 'Arts'],
      required: true,
    },
    credits: { type: Number, default: 3, min: 1, max: 10 },
    leadTeacher: ref('Teacher', { default: null }),
    grades: [{ type: String }], // e.g. ['Grade 9', 'Grade 10']
    description: { type: String, default: '' },
  },
  { timestamps: true },
)

// ClassRoom (a grade + section)
const classRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // 'Grade 10'
    section: { type: String, required: true, uppercase: true, trim: true }, // 'A'
    classTeacher: ref('Teacher', { default: null }),
    room: { type: String, default: '' },
    capacity: { type: Number, default: 40, min: 1 },
    subjects: [ref('Subject')],
    session: { type: String, default: '2026 – 2027' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

classRoomSchema.index({ name: 1, section: 1, session: 1 }, { unique: true })
classRoomSchema.virtual('label').get(function label() {
  return `${this.name} · ${this.section}`
})

// Student
const studentSchema = new Schema(
  {
    studentId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    user: ref('User', { default: null }),
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    roll: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['Female', 'Male', 'Prefer not to say'], default: 'Prefer not to say' },
    dob: { type: Date, default: null },
    bloodGroup: { type: String, default: '' },
    classRoom: ref('ClassRoom', { required: true, index: true }),
    guardian: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, default: '' },
      relationship: { type: String, default: '' },
    },
    admissionDate: { type: Date, default: Date.now },
    address: { type: String, default: '' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
    notes: { type: String, default: '' },
    documents: [{ label: String, url: String, uploadedAt: Date }],
  },
  { timestamps: true },
)

studentSchema.index({ classRoom: 1, roll: 1 }, { unique: true })

// Teacher
const teacherSchema = new Schema(
  {
    staffId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    employeeId: { type: String, default: '' },
    user: ref('User', { default: null }),
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    subject: ref('Subject', { default: null }),
    department: {
      type: String,
      enum: ['Sciences', 'Humanities', 'Technology', 'Arts'],
      required: true,
    },
    qualification: { type: String, required: true, trim: true },
    experience: { type: Number, default: 0, min: 0 },
    joined: { type: Date, default: Date.now },
    address: { type: String, default: '' },
    classes: [ref('ClassRoom')],
    bio: { type: String, default: '' },
    status: { type: String, enum: ['Active', 'On Leave', 'Inactive'], default: 'Active', index: true },
  },
  { timestamps: true },
)

// Attendance: one document per class/date/period register
const attendanceSchema = new Schema(
  {
    classRoom: ref('ClassRoom', { required: true, index: true }),
    date: { type: Date, required: true, index: true },
    period: { type: Number, required: true, min: 1, max: 12 },
    subject: ref('Subject', { default: null }),
    markedBy: ref('Teacher', { default: null }),
    records: [
      {
        student: ref('Student', { required: true }),
        status: { type: String, enum: ['present', 'late', 'absent'], required: true },
        remark: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

attendanceSchema.index({ classRoom: 1, date: 1, period: 1 }, { unique: true })

attendanceSchema.virtual('summary').get(function summary() {
  const counts = { present: 0, late: 0, absent: 0 }
  this.records.forEach((r) => {
    counts[r.status] += 1
  })
  const total = this.records.length || 1
  return { ...counts, total: this.records.length, rate: Math.round((counts.present / total) * 1000) / 10 }
})

// Exam
const examSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    term: { type: String, default: 'Term 1' },
    classRoom: ref('ClassRoom', { required: true, index: true }),
    subject: ref('Subject', { required: true }),
    date: { type: Date, required: true },
    time: { type: String, default: '09:00' },
    room: { type: String, default: '' },
    maxMarks: { type: Number, default: 100, min: 1 },
    status: {
      type: String,
      enum: ['Draft', 'Scheduled', 'Grading', 'Results published'],
      default: 'Draft',
      index: true,
    },
  },
  { timestamps: true },
)

// Result
const resultSchema = new Schema(
  {
    exam: ref('Exam', { required: true, index: true }),
    student: ref('Student', { required: true, index: true }),
    marks: { type: Number, required: true, min: 0 },
    maxMarks: { type: Number, required: true, min: 1 },
    grade: { type: String, default: '' },
    remark: { type: String, default: '' },
    enteredBy: ref('Teacher', { default: null }),
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

resultSchema.index({ exam: 1, student: 1 }, { unique: true })
resultSchema.virtual('percent').get(function percent() {
  return Math.round((this.marks / this.maxMarks) * 100)
})

// Assignment (+ embedded submissions)
const assignmentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    subject: ref('Subject', { required: true }),
    classRoom: ref('ClassRoom', { required: true, index: true }),
    teacher: ref('Teacher', { required: true, index: true }),
    assignedOn: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    maxMarks: { type: Number, default: 20, min: 1 },
    submissionType: {
      type: String,
      enum: ['File upload', 'Written (in class)', 'Online quiz'],
      default: 'File upload',
    },
    status: { type: String, enum: ['Open', 'Grading', 'Graded'], default: 'Open', index: true },
    submissions: [
      {
        student: ref('Student', { required: true }),
        submittedAt: { type: Date, default: Date.now },
        note: { type: String, default: '' },
        fileUrl: { type: String, default: '' },
        late: { type: Boolean, default: false },
        marks: { type: Number, default: null },
        feedback: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true },
)

// Fee
const feeSchema = new Schema(
  {
    invoiceNo: { type: String, required: true, unique: true, uppercase: true, trim: true },
    student: ref('Student', { required: true, index: true }),
    term: { type: String, required: true },
    description: {
      type: String,
      enum: ['Tuition Fee', 'Laboratory Fee', 'Transport Fee', 'Examination Fee', 'Other'],
      default: 'Tuition Fee',
    },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['Paid', 'Pending', 'Overdue'], default: 'Pending', index: true },
    method: { type: String, enum: ['Card', 'Bank transfer', 'Cash', '—'], default: '—' },
    paidAt: { type: Date, default: null },
    remindersSent: { type: Number, default: 0 },
    lastReminderAt: { type: Date, default: null },
  },
  { timestamps: true },
)

// Timetable: one document per class
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

const timetableSchema = new Schema(
  {
    classRoom: ref('ClassRoom', { required: true, unique: true, index: true }),
    session: { type: String, default: '2026 – 2027' },
    slots: [
      {
        day: { type: String, enum: DAYS, required: true },
        period: { type: Number, required: true, min: 1, max: 12 },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
        subject: ref('Subject', { default: null }),
        teacher: ref('Teacher', { default: null }),
        room: { type: String, default: '' },
        isFree: { type: Boolean, default: false },
        freeLabel: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true },
)

// Announcement
const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    audience: { type: String, enum: ['All', 'Students', 'Teachers'], default: 'All', index: true },
    author: { type: String, required: true },
    createdBy: ref('User', { default: null }),
    publishDate: { type: Date, default: Date.now, index: true },
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// Settings: single document
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'global', unique: true },
    school: {
      name: { type: String, default: 'Scholaris International School' },
      email: { type: String, default: 'office@scholaris.edu' },
      phone: { type: String, default: '' },
      website: { type: String, default: '' },
      registrationNumber: { type: String, default: '' },
      address: { type: String, default: '' },
      logoUrl: { type: String, default: '' },
      primaryColor: { type: String, default: '#0F766E' },
    },
    academic: {
      session: { type: String, default: '2026 – 2027' },
      term: { type: String, default: 'Term 1' },
      sessionStart: { type: Date, default: null },
      sessionEnd: { type: Date, default: null },
      passingMarks: { type: Number, default: 40 },
      minimumAttendance: { type: Number, default: 75 },
      periodsPerDay: { type: Number, default: 6 },
      workingDays: { type: Number, default: 5 },
      autoPublishResults: { type: Boolean, default: false },
      lowAttendanceAlerts: { type: Boolean, default: true },
      feeReminders: { type: Boolean, default: true },
      weeklySummaryEmail: { type: Boolean, default: false },
    },
    security: {
      otpEnabled: { type: Boolean, default: true },
      rememberTrustedDevices: { type: Boolean, default: true },
      forcePasswordRotation: { type: Boolean, default: false },
      lockAfterFailures: { type: Boolean, default: true },
      otpLength: { type: Number, default: 6 },
      otpValidityMinutes: { type: Number, default: 10 },
      resendCooldownSeconds: { type: Number, default: 30 },
    },
    preferences: {
      timezone: { type: String, default: 'UTC+05:00 · Pakistan' },
      dateFormat: { type: String, default: 'DD MMM YYYY' },
      currency: { type: String, default: 'PKR (Rs)' },
      language: { type: String, default: 'English' },
    },
  },
  { timestamps: true },
)

export const Subject = model('Subject', subjectSchema)
export const ClassRoom = model('ClassRoom', classRoomSchema)
export const Student = model('Student', studentSchema)
export const Teacher = model('Teacher', teacherSchema)
export const Attendance = model('Attendance', attendanceSchema)
export const Exam = model('Exam', examSchema)
export const Result = model('Result', resultSchema)
export const Assignment = model('Assignment', assignmentSchema)
export const Fee = model('Fee', feeSchema)
export const Timetable = model('Timetable', timetableSchema)
export const Announcement = model('Announcement', announcementSchema)
export const Settings = model('Settings', settingsSchema)

export { default as User, ROLES } from './User.js'
