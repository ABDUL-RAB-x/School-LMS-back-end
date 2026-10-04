import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { ClassRoom, DAYS, Timetable } from '../models/index.js'

const POPULATE = [
  { path: 'classRoom', select: 'name section room' },
  { path: 'slots.subject', select: 'name code' },
  { path: 'slots.teacher', select: 'name staffId' },
]

// Reshapes flat slots into { Monday: [...], Tuesday: [...] } for the grid UI
function toGrid(timetable) {
  const grid = Object.fromEntries(DAYS.map((d) => [d, []]))
  timetable.slots
    .slice()
    .sort((a, b) => a.period - b.period)
    .forEach((s) => {
      if (!grid[s.day]) return
      grid[s.day].push({
        period: s.period,
        time: `${s.startTime} – ${s.endTime}`,
        subject: s.isFree ? s.freeLabel || 'Study Hall' : s.subject?.name ?? '—',
        teacher: s.isFree ? '—' : s.teacher?.name ?? '—',
        room: s.isFree ? '—' : s.room,
        free: s.isFree,
      })
    })
  return grid
}

// GET /api/timetable?classRoom=...
export const getTimetable = asyncHandler(async (req, res) => {
  const { classRoom } = req.query
  if (!classRoom) throw ApiError.badRequest('classRoom is required.')

  const timetable = await Timetable.findOne({ classRoom }).populate(POPULATE).lean()
  if (!timetable) {
    const room = await ClassRoom.findById(classRoom).lean()
    if (!room) throw ApiError.notFound('That class no longer exists.')
    return res.json({
      success: true,
      message: 'No timetable has been generated for this class yet.',
      data: { classRoom: room, grid: Object.fromEntries(DAYS.map((d) => [d, []])), slots: [] },
    })
  }

  return res.json({ success: true, data: { ...timetable, grid: toGrid(timetable) } })
})

// PUT /api/timetable/:classRoomId: replace the whole week for one class
export const saveTimetable = asyncHandler(async (req, res) => {
  const { classRoomId } = req.params
  const { session } = req.body
  // An empty select arrives as "": store it as "nobody"
  const slots = req.body.slots.map((s) => ({ ...s, subject: s.subject || null, teacher: s.teacher || null }))

  const room = await ClassRoom.findById(classRoomId)
  if (!room) throw ApiError.notFound('That class no longer exists.')

  // Reject two subjects in the same day+period for this class
  const seen = new Set()
  for (const s of slots) {
    const key = `${s.day}-${s.period}`
    if (seen.has(key)) throw ApiError.conflict(`Two entries clash on ${s.day}, period ${s.period}.`)
    seen.add(key)
  }

  // Reject a teacher being booked in two classes at the same time
  const existing = await Timetable.findOne({ classRoom: room._id }).lean()
  const key = (s) => `${s.day}|${s.period}|${s.teacher ?? ''}`
  const unchanged = new Set((existing?.slots ?? []).filter((s) => !s.isFree && s.teacher).map(key))
  const busy = slots.filter((s) => !s.isFree && s.teacher && !unchanged.has(key(s)))
  if (busy.length) {
    const others = await Timetable.find({
      classRoom: { $ne: room._id },
      slots: {
        $elemMatch: {
          $or: busy.map((s) => ({ day: s.day, period: s.period, teacher: s.teacher })),
        },
      },
    })
      .populate('classRoom', 'name section')
      .populate('slots.teacher', 'name')
      .lean()

    for (const s of busy) {
      for (const other of others) {
        const hit = other.slots.find(
          (o) => o.day === s.day && o.period === s.period && String(o.teacher?._id ?? o.teacher) === String(s.teacher),
        )
        if (hit) {
          throw ApiError.conflict(
            `${hit.teacher?.name ?? 'That teacher'} already teaches ${other.classRoom.name} · ${other.classRoom.section} on ${s.day}, period ${s.period}. Pick another teacher or period.`,
          )
        }
      }
    }
  }

  const timetable = await Timetable.findOneAndUpdate(
    { classRoom: room._id },
    { classRoom: room._id, session: session || room.session, slots },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).populate(POPULATE)

  const lean = timetable.toObject()

  res.json({
    success: true,
    message: `Timetable saved for ${room.name} · ${room.section}.`,
    data: { ...lean, grid: toGrid(lean) },
  })
})

// GET /api/timetable/me: the signed-in student's or teacher's own week
export const myTimetable = asyncHandler(async (req, res) => {
  if (req.user.role === 'student') {
    const classRoom = req.profile.classRoom._id ?? req.profile.classRoom
    const timetable = await Timetable.findOne({ classRoom }).populate(POPULATE).lean()
    return res.json({
      success: true,
      data: timetable
        ? { ...timetable, grid: toGrid(timetable) }
        : { grid: Object.fromEntries(DAYS.map((d) => [d, []])), slots: [] },
    })
  }

  // Teacher: collapse their own slots across every class into one week
  const timetables = await Timetable.find({ 'slots.teacher': req.profile._id }).populate(POPULATE).lean()

  const grid = Object.fromEntries(DAYS.map((d) => [d, []]))
  timetables.forEach((t) => {
    t.slots
      .filter((s) => String(s.teacher?._id ?? s.teacher) === String(req.profile._id))
      .forEach((s) => {
        grid[s.day]?.push({
          period: s.period,
          time: `${s.startTime} – ${s.endTime}`,
          subject: s.subject?.name ?? '—',
          classRoom: `${t.classRoom.name} · ${t.classRoom.section}`,
          room: s.room,
          free: false,
        })
      })
  })
  DAYS.forEach((d) => grid[d].sort((a, b) => a.period - b.period))

  return res.json({ success: true, data: { grid } })
})
