import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import { verifyToken } from '../utils/token.js'
import { ACCESS_COOKIE, readCookie } from '../utils/session.js'
import User from '../models/User.js'
import Session from '../models/Session.js'
import { Student, Teacher } from '../models/index.js'
import { demoRestriction } from './demo.js'

// Verifies the access token (httpOnly cookie
export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : readCookie(req, ACCESS_COOKIE)

  if (!token) throw ApiError.unauthorized('Sign in to continue.')

  let payload
  try {
    payload = verifyToken(token)
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Your session has expired. Please sign in again.' : 'Invalid session token.'
    throw ApiError.unauthorized(msg)
  }

  const user = await User.findById(payload.sub)
  if (!user) throw ApiError.unauthorized('This account no longer exists.')
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.')
  // Signed out everywhere, or the password changed since this token was issued
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) throw ApiError.unauthorized('Your session has ended. Please sign in again.')

  const live = await Session.exists({ _id: payload.sid, revokedAt: null, expiresAt: { $gt: new Date() } })
  if (!live) throw ApiError.unauthorized('Your session has ended. Please sign in again.')

  // An account flagged to set a new password can only do that (or sign out)
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.baseUrl + req.path)) {
    throw ApiError.forbidden('Please set a new password before continuing.')
  }

  if (user.isDemo) {
    const refusal = await demoRestriction(req)
    if (refusal) throw ApiError.forbidden(refusal)
  }

  req.user = user
  req.auth = { userId: String(user._id), role: user.role, sessionId: payload.sid }
  return next()
})

const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout', '/api/auth/logout-all'])

// CSRF defence in depth
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
export function requireCsrfHeader(req, _res, next) {
  if (SAFE.has(req.method) || (req.headers.authorization || '').startsWith('Bearer ')) return next()
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return next(ApiError.forbidden('Request blocked: missing security header. Reload the page and try again.'))
  }
  return next()
}

// Route guard: authorize('admin') or authorize('admin', 'teacher')
export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Sign in to continue.'))
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action is restricted to: ${roles.join(', ')}.`))
    }
    return next()
  }
}

// Resolves the Student/Teacher profile linked to the signed-in account and attaches it as req.profile
export const withProfile = asyncHandler(async (req, _res, next) => {
  if (req.user.role === 'student') {
    req.profile = await Student.findOne({ user: req.user._id }).populate('classRoom')
    if (!req.profile) throw ApiError.notFound('No student record is linked to this account.')
  } else if (req.user.role === 'teacher') {
    req.profile = await Teacher.findOne({ user: req.user._id }).populate('classes subject')
    if (!req.profile) throw ApiError.notFound('No teacher record is linked to this account.')
  }
  return next()
})
