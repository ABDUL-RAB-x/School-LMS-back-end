import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { paginate, searchFilter } from '../utils/paginate.js'
import { sendFeeReminderEmail } from '../config/mailer.js'
import { Fee, Student } from '../models/index.js'

const POPULATE = {
  path: 'student',
  select: 'name studentId email classRoom',
  populate: { path: 'classRoom', select: 'name section' },
}

async function nextInvoiceNo() {
  const last = await Fee.findOne({ invoiceNo: /^INV-/ }).sort('-invoiceNo').select('invoiceNo').lean()
  const n = last ? Number.parseInt(last.invoiceNo.split('-')[1], 10) + 1 : 2200
  return `INV-${n}`
}

// Anything unpaid past its due date is overdue: computed, never stale
async function refreshOverdue() {
  await Fee.updateMany({ status: 'Pending', dueDate: { $lt: new Date() } }, { status: 'Overdue' })
}

// GET /api/fees
export const listFees = asyncHandler(async (req, res) => {
  await refreshOverdue()

  const { search, status, classRoom, term, page, limit } = req.query
  const clauses = []

  if (status) clauses.push({ status })
  if (term) clauses.push({ term })

  if (classRoom) {
    const ids = await Student.find({ classRoom }).select('_id').lean()
    clauses.push({ student: { $in: ids.map((s) => s._id) } })
  }

  // Search matches either the invoice number or the student's name / ID
  if (search) {
    const matched = await Student.find(searchFilter(search, ['name', 'studentId'])).select('_id').lean()
    clauses.push({
      $or: [searchFilter(search, ['invoiceNo']), { student: { $in: matched.map((s) => s._id) } }],
    })
  }

  const result = await paginate(Fee, clauses.length ? { $and: clauses } : {}, {
    page,
    limit: limit || 10,
    sort: '-createdAt',
    populate: POPULATE,
  })

  res.json({ success: true, data: result.items, pagination: result.pagination })
})

// GET /api/fees/summary
export const feeSummary = asyncHandler(async (_req, res) => {
  await refreshOverdue()

  const [agg] = await Fee.aggregate([
    {
      $group: {
        _id: null,
        billed: { $sum: '$amount' },
        collected: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$amount', 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, '$amount', 0] } },
        overdue: { $sum: { $cond: [{ $eq: ['$status', 'Overdue'] }, '$amount', 0] } },
        invoices: { $sum: 1 },
        overdueCount: { $sum: { $cond: [{ $eq: ['$status', 'Overdue'] }, 1, 0] } },
      },
    },
  ])

  const monthly = await Fee.aggregate([
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$dueDate' } },
        collected: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$amount', 0] } },
        outstanding: { $sum: { $cond: [{ $ne: ['$status', 'Paid'] }, '$amount', 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 12 },
  ])

  const base = agg || { billed: 0, collected: 0, pending: 0, overdue: 0, invoices: 0, overdueCount: 0 }

  res.json({
    success: true,
    data: {
      ...base,
      outstanding: base.pending + base.overdue,
      collectionRate: base.billed ? Math.round((base.collected / base.billed) * 1000) / 10 : 0,
      trend: monthly.map((m) => ({
        month: new Date(`${m._id}-01`).toLocaleDateString('en-US', { month: 'short' }),
        collected: Math.round(m.collected / 1000),
        outstanding: Math.round(m.outstanding / 1000),
      })),
    },
  })
})

// POST /api/fees
export const createFee = asyncHandler(async (req, res) => {
  const body = { ...req.body }
  body.invoiceNo = body.invoiceNo || (await nextInvoiceNo())

  if (!(await Student.exists({ _id: body.student }))) {
    throw ApiError.badRequest('That student does not exist.', { fields: { student: 'Select a valid student.' } })
  }

  const fee = await Fee.create(body)
  res.status(201).json({
    success: true,
    message: `Invoice ${fee.invoiceNo} created.`,
    data: await Fee.findById(fee._id).populate(POPULATE).lean(),
  })
})

// PUT /api/fees/:id
export const updateFee = asyncHandler(async (req, res) => {
  const body = { ...req.body }
  delete body.invoiceNo

  if (body.status === 'Paid' && !body.paidAt) body.paidAt = new Date()
  if (body.status && body.status !== 'Paid') body.paidAt = null

  const fee = await Fee.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true })
    .populate(POPULATE)
    .lean()
  if (!fee) throw ApiError.notFound('That invoice no longer exists.')

  res.json({ success: true, message: 'Invoice updated.', data: fee })
})

// DELETE /api/fees/:id
export const deleteFee = asyncHandler(async (req, res) => {
  const fee = await Fee.findByIdAndDelete(req.params.id)
  if (!fee) throw ApiError.notFound('That invoice no longer exists.')
  res.json({ success: true, message: `Invoice ${fee.invoiceNo} deleted.` })
})

// POST /api/fees/:id/remind
export const sendReminder = asyncHandler(async (req, res) => {
  const fee = await Fee.findById(req.params.id).populate('student', 'name email')
  if (!fee) throw ApiError.notFound('That invoice no longer exists.')
  if (fee.status === 'Paid') throw ApiError.badRequest('That invoice is already paid.')

  if (fee.lastReminderAt && Date.now() - fee.lastReminderAt.getTime() < 24 * 60 * 60 * 1000) {
    throw ApiError.tooMany('A reminder for this invoice was already sent in the last 24 hours.')
  }

  await sendFeeReminderEmail({
    to: fee.student.email,
    name: fee.student.name.split(' ')[0],
    invoiceNo: fee.invoiceNo,
    amount: fee.amount.toLocaleString('en-US'),
    dueDate: fee.dueDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
  })

  fee.remindersSent += 1
  fee.lastReminderAt = new Date()
  await fee.save()

  res.json({ success: true, message: `Reminder sent for ${fee.invoiceNo}.` })
})

// GET /api/fees/me
export const myFees = asyncHandler(async (req, res) => {
  await refreshOverdue()

  const fees = await Fee.find({ student: req.profile._id }).sort('-dueDate').lean()

  const billed = fees.reduce((s, f) => s + f.amount, 0)
  const paid = fees.filter((f) => f.status === 'Paid').reduce((s, f) => s + f.amount, 0)
  const overdue = fees.filter((f) => f.status === 'Overdue').reduce((s, f) => s + f.amount, 0)

  res.json({
    success: true,
    data: {
      invoices: fees,
      summary: {
        billed,
        paid,
        outstanding: billed - paid,
        overdue,
        percentPaid: billed ? Math.round((paid / billed) * 100) : 0,
      },
    },
  })
})
