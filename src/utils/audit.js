import AuditLog from '../models/AuditLog.js'

export function clientIp(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 64)
}

// Records an audit event
export async function audit(req, { event, status = 'success', user, email, role, resource = '', resourceId = '', detail = '' }) {
  const actor = user ?? req?.user ?? null
  try {
    await AuditLog.create({
      event,
      status,
      user: actor?._id ?? actor ?? null,
      email: email ?? actor?.email ?? '',
      role: role ?? actor?.role ?? '',
      resource,
      resourceId: resourceId ? String(resourceId) : '',
      detail: String(detail).slice(0, 500),
      ip: req ? clientIp(req) : '',
      userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 300) : '',
    })
  } catch (err) {
    console.error(`[audit] could not record ${event}: ${err.message}`)
  }
}

const SKIP_PREFIXES = ['/auth/']
const ACTIONS = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }

// Logs every successful data change made through the API (who, what
export function auditWrites(req, res, next) {
  const action = ACTIONS[req.method]
  if (!action || SKIP_PREFIXES.some((p) => req.path.startsWith(p))) return next()

  res.on('finish', () => {
    if (!req.user) return
    const segments = req.path.split('/').filter(Boolean) // e.g. ['students', '<id>', 'edit']
    const resource = segments[0] || 'unknown'
    const resourceId = /^[a-f0-9]{24}$/i.test(segments[1] || '') ? segments[1] : ''
    const sub = segments.slice(resourceId ? 2 : 1).join('.')
    audit(req, {
      event: `${resource}.${sub || action}`,
      status: res.statusCode < 400 ? 'success' : 'failure',
      resource,
      resourceId,
      detail: `${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode}`,
    })
  })
  return next()
}
