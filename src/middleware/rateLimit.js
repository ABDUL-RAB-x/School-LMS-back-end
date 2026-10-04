import rateLimit from 'express-rate-limit'

const message = (msg) => ({
  success: false,
  message: msg,
})

// Broad safety net for the whole API
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many requests. Please slow down and try again shortly.'),
})

// Credential stuffing guard on POST /api/auth/login
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // The automated suite signs in many times from one address on purpose
  limit: process.env.NODE_ENV === 'test' ? 200 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: message('Too many sign-in attempts. Try again in 15 minutes.'),
})

// Password-reset requests and submissions: slows down token guessing and email flooding
export const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many password reset attempts. Try again in 15 minutes.'),
})

// Session renewals: a page refresh costs one; a loop of them is not normal
export const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many session renewals. Please wait a moment.'),
})

// Backs the OTP screen's countdown; the per-user cooldown is enforced in the controller too
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 200 : 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many verification attempts. Please wait a few minutes.'),
})
