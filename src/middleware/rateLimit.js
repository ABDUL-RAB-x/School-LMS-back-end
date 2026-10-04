import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { clientIp } from '../utils/audit.js'
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie } from '../utils/session.js'

const message = (msg) => ({
  success: false,
  message: msg,
})

const hash = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 24)

// Behind a hosting proxy many visitors can share one IP, so limits key on more than the address.
const byEmail = (req) => `${clientIp(req)}|${String(req.body?.email || '').toLowerCase().trim()}`
const byCookie = (name) => (req) => {
  const token = readCookie(req, name)
  return token ? `s:${hash(token)}` : `ip:${clientIp(req)}`
}

const base = { standardHeaders: 'draft-7', legacyHeaders: false }

// Broad safety net for the whole API
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 600,
  keyGenerator: byCookie(ACCESS_COOKIE),
  message: message('Too many requests. Please slow down and try again shortly.'),
})

// Credential stuffing guard on POST /api/auth/login
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  // The automated suite signs in many times from one address on purpose
  limit: process.env.NODE_ENV === 'test' ? 200 : 10,
  skipSuccessfulRequests: true,
  keyGenerator: byEmail,
  message: message('Too many sign-in attempts. Try again in 15 minutes.'),
})

// Password-reset requests and submissions: slows down token guessing and email flooding
export const resetLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 8,
  keyGenerator: byEmail,
  message: message('Too many password reset attempts. Try again in 15 minutes.'),
})

// Session renewals: a page refresh costs one; a loop of them is not normal
export const refreshLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000,
  limit: 60,
  keyGenerator: byCookie(REFRESH_COOKIE),
  message: message('Too many session renewals. Please wait a moment.'),
})

// Backs the OTP screen's countdown; the per-user cooldown is enforced in the controller too
export const otpLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 200 : 12,
  keyGenerator: byEmail,
  message: message('Too many verification attempts. Please wait a few minutes.'),
})
