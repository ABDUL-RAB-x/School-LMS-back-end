import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { paginate, searchFilter } from '../utils/paginate.js'
import { Exam, Result, Student } from '../models/index.js'

const POPULATE = [
  { path: 'classRoom', select: 'name section' },
  { path: 'subject', select: 'name code' },
]

const teachesClass = (teacher, classRoomId) => teacher.classes.some((c) => String(c._id ?? c) === String(classRoomId))

export function gradeFor(percent) {
  if (percent >= 90) return 'A+'
  if (percent >= 80) return 'A'
  if (percent >= 75) return 'A-'
  if (percent >= 70) return 'B+'
  if (percent >= 60) return 'B'
  if (percent >= 50) return 'C'
  if (percent >= 40) return 'D'
  return 'F'
}

// Exams

// GET /api/exams
export const listExams = asyncHandler(async (req, res) => {
  const { search, status, classRoom, subject, term, page, limit } = req.query

  const filter = {}
  if (status) filter.status = status
  if (classRoom) filter.classRoom = classRoom
  if (subject) filter.subject = subject
  if (term) filter.term = term

  // A teacher only sees exams for the classes they teach (narrowed further by ?classRoom)
  if (req.user.role === 'teacher') {
    const mine = req.profile.classes.map((c) => c._id ?? c)
    filter.classRoom = classRoom
      ? mine.some((id) => String(id) === String(classRoom)) ? classRoom : { $in: [] }
      : { $in: mine }
  }

  const search$ = searchFilter(search, ['name', 'term', 'room'])
  const result = await paginate(Exam, search$ ? { $and: [filter, search$] } : filter, {
    page,
    limit: limit || 10,
    sort: 'date',
    populate: POPULATE,
  })

  res.json({ success: true, data: result.items, pagination: result.pagination })
})

// POST /api/exams
export const createExam = asyncHandler(async (req, res) => {
  const exam = await Exam.create(req.body)
  res.status(201).json({
    success: true,
    message: 'Examination scheduled.',
    data: await Exam.findById(exam._id).populate(POPULATE).lean(),
  })
})

// PUT /api/exams/:id
export const updateExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate(POPULATE)
    .lean()
  if (!exam) throw ApiError.notFound('That examination no longer exists.')
  res.json({ success: true, message: 'Examination updated.', data: exam })
})

// DELETE /api/exams/:id
export const deleteExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id)
  if (!exam) throw ApiError.notFound('That examination no longer exists.')

  await Result.deleteMany({ exam: exam._id })
  await exam.deleteOne()

  res.json({ success: true, message: 'Examination removed.' })
})

// GET /api/exams/me: the student's schedule and completed papers
export const myExams = asyncHandler(async (req, res) => {
  const student = req.profile

  const exams = await Exam.find({
    classRoom: student.classRoom._id ?? student.classRoom,
    status: { $ne: 'Draft' },
  })
    .populate(POPULATE)
    .sort('date')
    .lean()

  const results = await Result.find({ student: student._id }).lean()
  const byExam = new Map(results.map((r) => [String(r.exam), r]))

  const data = exams.map((e) => {
    const r = byExam.get(String(e._id))
    const published = e.status === 'Results published' && r
    return {
      id: e._id,
      exam: e.name,
      subject: e.subject?.name ?? '—',
      date: e.date,
      time: e.time,
      room: e.room,
      maxMarks: e.maxMarks,
      status: published ? 'Completed' : 'Upcoming',
      marks: published ? r.marks : null,
      grade: published ? r.grade : null,
      percent: published ? Math.round((r.marks / r.maxMarks) * 100) : null,
    }
  })

  const completed = data.filter((d) => d.status === 'Completed')
  const average = completed.length
    ? Math.round(completed.reduce((s, d) => s + d.percent, 0) / completed.length)
    : null

  res.json({ success: true, data: { exams: data, average } })
})

// Results

// GET /api/results
export const listResults = asyncHandler(async (req, res) => {
  const { exam, classRoom, grade, search, page, limit } = req.query

  const filter = {}
  if (exam) filter.exam = exam
  if (grade) filter.grade = grade

  // A teacher only sees results for exams in the classes they teach
  if (req.user.role === 'teacher') {
    const mine = await Exam.find({ classRoom: { $in: req.profile.classes.map((c) => c._id ?? c) } }).select('_id').lean()
    const ids = mine.map((e) => String(e._id))
    filter.exam = exam ? (ids.includes(String(exam)) ? exam : { $in: [] }) : { $in: ids }
  }

  if (classRoom) {
    const students = await Student.find({ classRoom }).select('_id').lean()
    filter.student = { $in: students.map((s) => s._id) }
  }

  if (search) {
    const students = await Student.find(searchFilter(search, ['name', 'studentId'])).select('_id').lean()
    filter.student = filter.student
      ? { $in: students.map((s) => s._id).filter((id) => filter.student.$in.some((x) => String(x) === String(id))) }
      : { $in: students.map((s) => s._id) }
  }

  const result = await paginate(Result, filter, {
    page,
    limit: limit || 10,
    sort: '-createdAt',
    populate: [
      { path: 'student', select: 'name studentId classRoom', populate: { path: 'classRoom', select: 'name section' } },
      { path: 'exam', select: 'name term subject', populate: { path: 'subject', select: 'name' } },
    ],
  })

  res.json({ success: true, data: result.items, pagination: result.pagination })
})

// GET /api/results/sheet/:examId: the teacher's marks-entry sheet
export const marksSheet = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.examId).populate(POPULATE)
  if (!exam) throw ApiError.notFound('That examination no longer exists.')

  if (req.user.role === 'teacher' && !teachesClass(req.profile, exam.classRoom._id)) {
    throw ApiError.forbidden('You are not assigned to that class.')
  }

  const [students, results] = await Promise.all([
    Student.find({ classRoom: exam.classRoom._id, status: 'Active' }).select('studentId name roll').sort('roll').lean(),
    Result.find({ exam: exam._id }).lean(),
  ])

  const byStudent = new Map(results.map((r) => [String(r.student), r]))

  res.json({
    success: true,
    data: {
      exam,
      rows: students.map((s) => ({
        ...s,
        marks: byStudent.get(String(s._id))?.marks ?? null,
        grade: byStudent.get(String(s._id))?.grade ?? null,
      })),
    },
  })
})

// POST /api/results: bulk marks entry from the teacher panel
export const saveResults = asyncHandler(async (req, res) => {
  const { exam: examId, entries } = req.body

  const exam = await Exam.findById(examId)
  if (!exam) throw ApiError.badRequest('That examination does not exist.')

  if (req.user.role === 'teacher') {
    const assigned = req.profile.classes.some((c) => String(c._id ?? c) === String(exam.classRoom))
    if (!assigned) throw ApiError.forbidden('You are not assigned to that class.')
  }

  const over = entries.find((e) => e.marks > exam.maxMarks)
  if (over) throw ApiError.badRequest(`Marks cannot exceed the maximum of ${exam.maxMarks}.`)

  const ops = entries.map((e) => ({
    updateOne: {
      filter: { exam: exam._id, student: e.student },
      update: {
        $set: {
          exam: exam._id,
          student: e.student,
          marks: e.marks,
          maxMarks: exam.maxMarks,
          grade: gradeFor(Math.round((e.marks / exam.maxMarks) * 100)),
          remark: e.remark || '',
          enteredBy: req.profile?._id ?? null,
        },
      },
      upsert: true,
    },
  }))

  await Result.bulkWrite(ops)

  const entered = await Result.countDocuments({ exam: exam._id })
  const roster = await Student.countDocuments({ classRoom: exam.classRoom, status: 'Active' })
  exam.status = entered >= roster ? 'Results published' : 'Grading'
  await exam.save()

  res.status(201).json({
    success: true,
    message: `Marks saved for ${entries.length} student(s).`,
    data: { entered, roster, examStatus: exam.status },
  })
})

// GET /api/results/me
export const myResults = asyncHandler(async (req, res) => {
  const results = await Result.find({ student: req.profile._id })
    .populate({ path: 'exam', select: 'name term date subject', populate: { path: 'subject', select: 'name' } })
    .sort('-createdAt')
    .lean()

  res.json({
    success: true,
    data: results.map((r) => ({
      id: r._id,
      exam: r.exam?.name ?? '—',
      subject: r.exam?.subject?.name ?? '—',
      date: r.exam?.date,
      marks: r.marks,
      maxMarks: r.maxMarks,
      percent: Math.round((r.marks / r.maxMarks) * 100),
      grade: r.grade,
    })),
  })
})
