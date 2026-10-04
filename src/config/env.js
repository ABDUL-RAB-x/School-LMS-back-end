import dotenv from 'dotenv'

dotenv.config()

// Values pasted into a hosting dashboard often carry stray spaces or quotes
const read = (name) => {
  const v = process.env[name]
  if (v === undefined) return undefined
  return String(v).trim().replace(/^(['"])(.*)\1$/, '$2').trim() || undefined
}
// "https://site.app/" and "https://site.app" must compare equal
const urls = (v) => v.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean).join(',')

const bool = (v, fallback = false) => {
  if (v === undefined) return fallback
  return String(v).toLowerCase() === 'true'
}

const int = (v, fallback) => {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

const clientOrigin = urls(read('CLIENT_ORIGIN') || 'http://localhost:5273')

export const env = {
  // Vercel does not always pass NODE_ENV to functions, so a Vercel deployment is always production
  nodeEnv: process.env.VERCEL ? 'production' : read('NODE_ENV') || 'development',
  port: int(read('PORT'), 5051),
  clientOrigin,

  mongoUri: read('MONGODB_URI') || 'mongodb://127.0.0.1:27017/scholaris',

  jwtSecret: read('JWT_SECRET') || '',
  // Short-lived access token in an httpOnly cookie, renewed with a rotating refresh token
  accessTokenTtl: read('ACCESS_TOKEN_TTL') || '15m',
  refreshTtlDays: int(read('REFRESH_TTL_DAYS'), 1),
  rememberTtlDays: int(read('REMEMBER_TTL_DAYS'), 30),

  // Public address of the website, used in email links (password reset)
  appUrl: urls(read('APP_URL') || clientOrigin.split(',')[0]),

  lockout: {
    maxAttempts: int(read('LOGIN_MAX_ATTEMPTS'), 5),
    minutes: int(read('LOGIN_LOCK_MINUTES'), 15),
  },
  resetTtlMinutes: int(read('PASSWORD_RESET_TTL_MINUTES'), 30),
  // Email the account owner after every successful sign-in
  loginAlertEmail: bool(read('LOGIN_ALERT_EMAIL'), true),

  otp: {
    length: int(read('OTP_LENGTH'), 6),
    ttlMinutes: int(read('OTP_TTL_MINUTES'), 10),
    resendCooldownSeconds: int(read('OTP_RESEND_COOLDOWN_SECONDS'), 30),
    maxAttempts: int(read('OTP_MAX_ATTEMPTS'), 5),
  },

  smtp: {
    host: read('SMTP_HOST') || 'smtp.gmail.com',
    port: int(read('SMTP_PORT'), 465),
    secure: bool(read('SMTP_SECURE'), true),
    user: read('SMTP_USER') || '',
    // Google shows App Passwords as "xxxx xxxx xxxx xxxx"; the spaces are not part of it
    appPassword: (read('SMTP_APP_PASSWORD') || '').replace(/\s+/g, ''),
    fromName: read('MAIL_FROM_NAME') || 'Scholaris',
    fromAddress: read('MAIL_FROM_ADDRESS') || read('SMTP_USER') || '',
    previewOnly: bool(read('MAIL_PREVIEW_ONLY'), true),
  },
}

export const isProd = env.nodeEnv === 'production'

// Fail fast on missing secrets rather than issuing tokens signed with ''
export function assertEnv() {
  const problems = []

  if (!env.jwtSecret || env.jwtSecret === 'replace-me-with-a-long-random-string') {
    problems.push('JWT_SECRET is missing or still the placeholder value.')
  } else if (env.jwtSecret.length < 32) {
    problems.push('JWT_SECRET should be at least 32 characters.')
  }

  if (!env.mongoUri) problems.push('MONGODB_URI is missing.')

  if (isProd) {
    if (env.smtp.previewOnly) problems.push('MAIL_PREVIEW_ONLY must be false in production (it shows sign-in codes on screen).')
    if (!env.appUrl.startsWith('https://')) problems.push(`APP_URL must be an https:// address in production (got "${env.appUrl}").`)
  }

  if (!env.smtp.previewOnly) {
    if (!env.smtp.user) problems.push('SMTP_USER is required when MAIL_PREVIEW_ONLY is false.')
    if (!env.smtp.appPassword) {
      problems.push('SMTP_APP_PASSWORD is required when MAIL_PREVIEW_ONLY is false.')
    }
  }

  if (problems.length) {
    console.error('\nConfiguration problems:')
    problems.forEach((p) => console.error(`  • ${p}`))
    console.error('\nSee server/.env.example for the expected values.\n')
    process.exit(1)
  }
}
