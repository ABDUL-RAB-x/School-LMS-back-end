import dotenv from 'dotenv'

dotenv.config()

const bool = (v, fallback = false) => {
  if (v === undefined) return fallback
  return String(v).toLowerCase() === 'true'
}

const int = (v, fallback) => {
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

export const env = {
  // Vercel does not always pass NODE_ENV to functions, so a Vercel deployment is always production
  nodeEnv: process.env.VERCEL ? 'production' : process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 5051),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5273',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scholaris',

  jwtSecret: process.env.JWT_SECRET || '',
  // Short-lived access token in an httpOnly cookie, renewed with a rotating refresh token
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlDays: int(process.env.REFRESH_TTL_DAYS, 1),
  rememberTtlDays: int(process.env.REMEMBER_TTL_DAYS, 30),

  // Public address of the website, used in email links (password reset)
  appUrl: process.env.APP_URL || (process.env.CLIENT_ORIGIN || 'http://localhost:5273').split(',')[0].trim(),

  lockout: {
    maxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 5),
    minutes: int(process.env.LOGIN_LOCK_MINUTES, 15),
  },
  resetTtlMinutes: int(process.env.PASSWORD_RESET_TTL_MINUTES, 30),
  // Email the account owner after every successful sign-in
  loginAlertEmail: bool(process.env.LOGIN_ALERT_EMAIL, true),

  otp: {
    length: int(process.env.OTP_LENGTH, 6),
    ttlMinutes: int(process.env.OTP_TTL_MINUTES, 10),
    resendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 30),
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: int(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER || '',
    // Google shows App Passwords as "xxxx xxxx xxxx xxxx"; the spaces are not part of it
    appPassword: (process.env.SMTP_APP_PASSWORD || '').replace(/\s+/g, ''),
    fromName: process.env.MAIL_FROM_NAME || 'Scholaris',
    fromAddress: process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || '',
    previewOnly: bool(process.env.MAIL_PREVIEW_ONLY, true),
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
    if (!env.appUrl.startsWith('https://')) problems.push('APP_URL must be an https:// address in production.')
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
