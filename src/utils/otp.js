import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { env } from '../config/env.js'

// Cryptographically random numeric code, e.g. "042917"
export function generateOtp(length = env.otp.length) {
  const max = 10 ** length
  const code = crypto.randomInt(0, max)
  return String(code).padStart(length, '0')
}

export async function hashOtp(code) {
  return bcrypt.hash(code, 10)
}

export async function compareOtp(code, hash) {
  if (!hash) return false
  return bcrypt.compare(code, hash)
}

export function otpExpiry(minutes = env.otp.ttlMinutes) {
  return new Date(Date.now() + minutes * 60 * 1000)
}

// Masks an address for safe display: "da****or@scholaris.edu"
export function maskEmail(email = '') {
  const [name, domain] = email.split('@')
  if (!domain) return email
  if (name.length <= 4) return `${name[0]}***@${domain}`
  return `${name.slice(0, 2)}****${name.slice(-2)}@${domain}`
}
