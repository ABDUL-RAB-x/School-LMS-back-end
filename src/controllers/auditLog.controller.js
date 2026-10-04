import asyncHandler from '../utils/asyncHandler.js'
import AuditLog from '../models/AuditLog.js'
import { paginate } from '../utils/paginate.js'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// GET /api/audit-logs: admin only, newest first, server-side paging
export const listAuditLogs = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1
  const limit = Number(req.query.limit) || 25
  const filter = {}

  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search).trim()), 'i')
    filter.$or = [{ email: rx }, { event: rx }, { detail: rx }]
  }
  if (req.query.event) filter.event = new RegExp(`^${escapeRegex(String(req.query.event))}`)
  if (req.query.status) filter.status = req.query.status
  if (req.query.from || req.query.to) {
    filter.createdAt = {}
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from)
    if (req.query.to) {
      const end = new Date(req.query.to)
      end.setUTCHours(23, 59, 59, 999)
      filter.createdAt.$lte = end
    }
  }

  const result = await paginate(AuditLog, filter, { page, limit, sort: '-createdAt' })
  res.json({ success: true, data: result.items, pagination: result.pagination })
})
