import crypto from 'node:crypto'
import { env, isProd } from '../config/env.js'
import Session from '../models/Session.js'
import { signAccessToken } from './token.js'
import { clientIp } from './audit.js'

export const ACCESS_COOKIE = 'scholaris_at'
export const REFRESH_COOKIE = 'scholaris_rt'

const DAY = 24 * 60 * 60 * 1000
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// Minimal cookie parser: avoids a dependency for two cookies
export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

// httpOnly: unreadable by page scripts (XSS can't steal them)
const baseCookie = { httpOnly: true, secure: isProd, sameSite: 'strict' }

function setAuthCookies(res, { accessToken, refreshToken, session }) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie, path: '/' })
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie,
    path: '/api/auth',
    // "Keep me signed in" → persistent cookie; otherwise it ends with the browser
    ...(session.remember ? { expires: session.expiresAt } : {}),
  })
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie, path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie, path: '/api/auth' })
}

// Starts a new signed-in session after a successful OTP check
export async function startSession(req, res, user, { remember = false } = {}) {
  const refreshToken = crypto.randomBytes(48).toString('base64url')
  const days = remember ? env.rememberTtlDays : env.refreshTtlDays
  const session = await Session.create({
    user: user._id,
    refreshHash: sha256(refreshToken),
    remember,
    expiresAt: new Date(Date.now() + days * DAY),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  })
  const accessToken = signAccessToken(user, session._id)
  setAuthCookies(res, { accessToken, refreshToken, session })
  return { session, accessToken }
}

// Swaps a refresh token for a new pair
export async function rotateSession(req, res, loadUser) {
  const presented = readCookie(req, REFRESH_COOKIE)
  if (!presented) return { error: 'missing' }
  const hash = sha256(presented)

  const session = await Session.findOne({ refreshHash: hash })
  if (!session) {
    const replayed = await Session.findOne({ previousHash: hash })
    if (replayed) {
      await revokeAllSessions(replayed.user, 'refresh token reuse detected')
      return { error: 'reuse', userId: replayed.user }
    }
    return { error: 'unknown' }
  }
  if (!session.isUsable()) return { error: 'expired' }

  const user = await loadUser(session.user)
  if (!user || !user.isActive) {
    await revokeSession(session._id, 'account unavailable')
    return { error: 'inactive' }
  }

  const refreshToken = crypto.randomBytes(48).toString('base64url')
  session.previousHash = session.refreshHash
  session.refreshHash = sha256(refreshToken)
  session.lastUsedAt = new Date()
  await session.save()

  const accessToken = signAccessToken(user, session._id)
  setAuthCookies(res, { accessToken, refreshToken, session })
  return { user, session }
}

export async function revokeSession(sessionId, reason = 'signed out') {
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason })
}

export async function revokeAllSessions(userId, reason, { except } = {}) {
  const filter = { user: userId, revokedAt: null, ...(except ? { _id: { $ne: except } } : {}) }
  await Session.updateMany(filter, { revokedAt: new Date(), revokedReason: reason })
}

// Re-issues the access cookie for the current session (after a tokenVersion bump)
export function reissueAccessCookie(res, user, sessionId) {
  res.cookie(ACCESS_COOKIE, signAccessToken(user, sessionId), { ...baseCookie, path: '/' })
}

export const hashToken = sha256
