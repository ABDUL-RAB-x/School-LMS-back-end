import crypto from 'node:crypto'
import asyncHandler from '../utils/asyncHandler.js'
import ApiError from '../utils/ApiError.js'
import { env } from '../config/env.js'
import {
  sendAccountLockedEmail,
  sendInBackground,
  sendLoginAlertEmail,
  sendOtpEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from '../config/mailer.js'
import { compareOtp, generateOtp, hashOtp, maskEmail, otpExpiry } from '../utils/otp.js'
import { audit, clientIp } from '../utils/audit.js'
import {
  clearAuthCookies,
  hashToken,
  readCookie,
  REFRESH_COOKIE,
  reissueAccessCookie,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  startSession,
} from '../utils/session.js'
import User from '../models/User.js'
import Session from '../models/Session.js'
import { Student, Teacher } from '../models/index.js'

const OTP_FIELDS = '+password +otpHash +otpExpiresAt +otpAttempts +otpLastSentAt +failedLoginAttempts +lockUntil'
const PORTAL_LABEL = { admin: 'Admin', teacher: 'Teacher', student: 'Student' }
const BAD_CREDENTIALS = 'Incorrect email or password. Please try again.'

// Generates, stores (hashed) and emails a fresh code
async function issueOtp(user) {
  const code = generateOtp()
  user.otpHash = await hashOtp(code)
  user.otpExpiresAt = otpExpiry()
  user.otpAttempts = 0
  user.otpLastSentAt = new Date()
  await user.save()

  const result = await sendOtpEmail({
    to: user.email,
    name: user.name.split(' ')[0],
    code,
    minutes: env.otp.ttlMinutes,
  })

  // Never returned once real SMTP is configured
  return result.preview ? code : null
}

// Loads the Student/Teacher profile attached to a login account
async function attachedProfile(user) {
  if (user.role === 'student') {
    return Student.findOne({ user: user._id }).populate('classRoom', 'name section room').lean()
  }
  if (user.role === 'teacher') {
    return Teacher.findOne({ user: user._id }).populate('subject', 'name code').lean()
  }
  return null
}

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  lastLoginAt: user.lastLoginAt,
  mustChangePassword: Boolean(user.mustChangePassword),
  isDemo: Boolean(user.isDemo),
})

const minutesLeft = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000))
const lockedMessage = (user) =>
  `This account is temporarily locked after too many unsuccessful attempts. Try again in ${minutesLeft(user.lockUntil)} minutes, or reset your password.`

// Counts a wrong password; locks the account once the limit is reached
async function recordFailedLogin(req, user) {
  // The demo password is public: locking it would only lock every visitor out
  if (user.isDemo) return
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1
  if (user.failedLoginAttempts >= env.lockout.maxAttempts) {
    user.failedLoginAttempts = 0
    user.lockUntil = new Date(Date.now() + env.lockout.minutes * 60000)
    await user.save()
    await audit(req, { event: 'account.locked', status: 'failure', user, detail: `${env.lockout.maxAttempts} failed sign-in attempts` })
    sendInBackground(
      () =>
        sendAccountLockedEmail({
          to: user.email,
          name: user.name.split(' ')[0],
          minutes: env.lockout.minutes,
          resetLink: `${env.appUrl}/forgot-password`,
        }),
      'account-locked email',
    )
    return
  }
  await user.save()
}

// POST /api/auth/login: step 1: credentials → OTP email
export const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select(OTP_FIELDS)

  if (user?.isLocked()) {
    await audit(req, { event: 'login.blocked', status: 'failure', user, detail: 'account locked' })
    throw new ApiError(423, lockedMessage(user))
  }

  // Same message either way: do not reveal which accounts exist
  if (!user || !(await user.comparePassword(password))) {
    if (user) await recordFailedLogin(req, user)
    await audit(req, { event: 'login.failure', status: 'failure', user: user ?? null, email, detail: user ? 'wrong password' : 'unknown email' })
    if (user?.isLocked()) throw new ApiError(423, lockedMessage(user))
    throw ApiError.unauthorized(BAD_CREDENTIALS)
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated. Contact the school office.')
  if (role && user.role !== role) {
    throw ApiError.forbidden(
      `This is not a ${PORTAL_LABEL[role]} account. Please use the ${PORTAL_LABEL[user.role]} sign-in page.`,
    )
  }

  user.failedLoginAttempts = 0
  user.lockUntil = null

  // Demo accounts have no real inbox, so there is no code step: sign straight in
  if (user.isDemo) {
    user.lastLoginAt = new Date()
    await user.save()
    const { accessToken } = await startSession(req, res, user, { remember: Boolean(req.body.remember) })
    const profile = await attachedProfile(user)
    await audit(req, { event: 'login.success', user, detail: 'demo account (no email code)' })
    return res.json({
      success: true,
      message: 'Signed in to the demo account.',
      data: {
        otpRequired: false,
        user: publicUser(user),
        profile,
        ...(env.nodeEnv === 'test' ? { token: accessToken } : {}),
      },
    })
  }

  const previewCode = await issueOtp(user)

  return res.json({
    success: true,
    message: `We sent a 6-digit code to ${maskEmail(user.email)}.`,
    data: {
      otpRequired: true,
      email: user.email,
      maskedEmail: maskEmail(user.email),
      expiresInMinutes: env.otp.ttlMinutes,
      resendInSeconds: env.otp.resendCooldownSeconds,
      ...(previewCode ? { previewCode } : {}),
    },
  })
})

// POST /api/auth/verify-otp: step 2: code → session cookies
export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code, remember } = req.body

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select(OTP_FIELDS)
  if (!user || !user.otpHash) {
    throw ApiError.badRequest('No verification is pending for this account. Please sign in again.')
  }

  if (!user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now()) {
    user.clearOtp()
    await user.save()
    throw ApiError.badRequest('That code has expired. Request a new one.')
  }

  if (user.otpAttempts >= env.otp.maxAttempts) {
    user.clearOtp()
    await user.save()
    throw ApiError.tooMany('Too many incorrect codes. Request a new one.')
  }

  if (!(await compareOtp(code, user.otpHash))) {
    user.otpAttempts += 1
    await user.save()
    await audit(req, { event: 'otp.failure', status: 'failure', user })
    const left = Math.max(0, env.otp.maxAttempts - user.otpAttempts)
    throw ApiError.badRequest(
      left > 0 ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.` : 'That code is not correct.',
    )
  }

  // Single use: invalidate immediately on success
  user.clearOtp()
  user.lastLoginAt = new Date()
  await user.save()

  const { accessToken } = await startSession(req, res, user, { remember: Boolean(remember) })
  const profile = await attachedProfile(user)
  await audit(req, { event: 'login.success', user })
  if (env.loginAlertEmail) {
    sendInBackground(
      () =>
        sendLoginAlertEmail({
          to: user.email,
          name: user.name.split(' ')[0],
          when: user.lastLoginAt,
          ip: clientIp(req),
          userAgent: req.headers['user-agent'],
          resetLink: `${env.appUrl}/forgot-password`,
        }),
      'login-alert email',
    )
  }

  res.json({
    success: true,
    message: 'Verified.',
    data: {
      user: publicUser(user),
      profile,
      // Only the automated test suite reads the token from the body; browsers use the cookie
      ...(env.nodeEnv === 'test' ? { token: accessToken } : {}),
    },
  })
})

// POST /api/auth/resend-otp: cooldown-guarded
export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select(OTP_FIELDS)

  // Only an account that passed the password step has a code to resend
  if (!user || !user.otpHash) {
    return res.json({
      success: true,
      message: 'If that account exists, a new code is on its way.',
      data: { resendInSeconds: env.otp.resendCooldownSeconds },
    })
  }

  if (user.otpLastSentAt) {
    const elapsed = (Date.now() - user.otpLastSentAt.getTime()) / 1000
    const wait = Math.ceil(env.otp.resendCooldownSeconds - elapsed)
    if (wait > 0) {
      throw ApiError.tooMany(`Please wait ${wait}s before requesting another code.`, { retryAfter: wait })
    }
  }

  const previewCode = await issueOtp(user)

  return res.json({
    success: true,
    message: `A new code is on its way to ${maskEmail(user.email)}.`,
    data: {
      resendInSeconds: env.otp.resendCooldownSeconds,
      expiresInMinutes: env.otp.ttlMinutes,
      ...(previewCode ? { previewCode } : {}),
    },
  })
})

// POST /api/auth/refresh: rotate the refresh cookie, issue a new access one
export const refresh = asyncHandler(async (req, res) => {
  const result = await rotateSession(req, res, (id) => User.findById(id))
  if (result.error) {
    clearAuthCookies(res)
    if (result.error === 'reuse') {
      await audit(req, { event: 'session.reuse_detected', status: 'failure', user: result.userId, detail: 'all sessions revoked' })
    }
    throw ApiError.unauthorized('Your session has ended. Please sign in again.')
  }
  res.json({ success: true, data: { user: publicUser(result.user) } })
})

// GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  const profile = await attachedProfile(req.user)
  res.json({ success: true, data: { user: publicUser(req.user), profile } })
})

// PATCH /api/auth/password: change it while signed in
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body

  const user = await User.findById(req.user._id).select('+password')
  if (!(await user.comparePassword(currentPassword))) {
    await audit(req, { event: 'password.change', status: 'failure', detail: 'wrong current password' })
    throw ApiError.badRequest('Your current password is not correct.', {
      fields: { currentPassword: 'Your current password is not correct.' },
    })
  }
  if (await user.comparePassword(newPassword)) {
    throw ApiError.badRequest('Choose a password different from your current one.', {
      fields: { newPassword: 'Choose a password different from your current one.' },
    })
  }

  user.password = newPassword // hashed by the pre-save hook
  user.mustChangePassword = false
  user.tokenVersion = (user.tokenVersion || 0) + 1
  await user.save()

  // Keep this device signed in; sign out every other one
  await revokeAllSessions(user._id, 'password changed', { except: req.auth.sessionId })
  reissueAccessCookie(res, user, req.auth.sessionId)
  await audit(req, { event: 'password.change', user })
  sendInBackground(() => sendPasswordChangedEmail({ to: user.email, name: user.name.split(' ')[0] }), 'password-changed email')

  res.json({ success: true, message: 'Password updated. Other devices have been signed out.', data: { user: publicUser(user) } })
})

// POST /api/auth/forgot-password: always the same answer
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase().trim()
  const user = await User.findOne({ email }).select('+resetTokenHash +resetTokenExpiresAt')

  // Demo accounts have no inbox and a fixed password: nothing to reset
  if (user?.isActive && !user.isDemo) {
    const token = crypto.randomBytes(32).toString('base64url')
    user.resetTokenHash = hashToken(token)
    user.resetTokenExpiresAt = new Date(Date.now() + env.resetTtlMinutes * 60000)
    await user.save()
    await audit(req, { event: 'password.reset_requested', user })
    sendInBackground(
      () =>
        sendPasswordResetEmail({
          to: user.email,
          name: user.name.split(' ')[0],
          link: `${env.appUrl}/reset-password?token=${token}`,
          minutes: env.resetTtlMinutes,
        }),
      'password-reset email',
    )
  } else {
    await audit(req, { event: 'password.reset_requested', status: 'failure', email, detail: user ? 'inactive account' : 'unknown email' })
  }

  // Identical response whether or not the account exists
  res.json({
    success: true,
    message: 'If an account uses that email, a reset link is on its way. It expires in ' + env.resetTtlMinutes + ' minutes.',
  })
})

// POST /api/auth/reset-password: token from the email + new password
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body
  const user = await User.findOne({
    resetTokenHash: hashToken(token),
    resetTokenExpiresAt: { $gt: new Date() },
  }).select('+password +resetTokenHash +resetTokenExpiresAt +failedLoginAttempts +lockUntil')

  if (!user || !user.isActive) {
    throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.')
  }

  user.password = password
  user.resetTokenHash = null
  user.resetTokenExpiresAt = null
  user.failedLoginAttempts = 0
  user.lockUntil = null
  user.mustChangePassword = false
  user.tokenVersion = (user.tokenVersion || 0) + 1
  await user.save()

  await revokeAllSessions(user._id, 'password reset')
  await audit(req, { event: 'password.reset', user })
  sendInBackground(() => sendPasswordChangedEmail({ to: user.email, name: user.name.split(' ')[0] }), 'password-changed email')

  res.json({ success: true, message: 'Your password has been reset. Sign in with your new password.', data: { role: user.role } })
})

// POST /api/auth/logout: end this device's session
export const logout = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+otpHash +otpExpiresAt +otpAttempts')
  user.clearOtp()
  await user.save()
  await revokeSession(req.auth.sessionId, 'signed out')
  clearAuthCookies(res)
  await audit(req, { event: 'logout' })
  res.json({ success: true, message: 'Signed out.' })
})

// POST /api/auth/logout-all: end every session of this account
export const logoutAll = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } })
  await revokeAllSessions(req.user._id, 'signed out everywhere')
  clearAuthCookies(res)
  await audit(req, { event: 'logout.all' })
  res.json({ success: true, message: 'Signed out on every device.' })
})

// POST /api/auth/session-end: clear cookies without a valid access token
export const endSession = asyncHandler(async (req, res) => {
  const presented = readCookie(req, REFRESH_COOKIE)
  if (presented) {
    const session = await Session.findOne({ refreshHash: hashToken(presented) })
    if (session) await revokeSession(session._id, 'signed out')
  }
  clearAuthCookies(res)
  res.json({ success: true })
})
