// Adds the admin / teacher / student login accounts used by the three sign-in
//   npm run seed:logins                # create missing accounts
//   npm run seed:logins -- --rotate    # also give existing ones a new password
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'
import User from '../src/models/User.js'
import { Student, Teacher } from '../src/models/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CREDENTIALS_FILE = path.join(here, '..', 'CREDENTIALS.local.txt')
const rotate = process.argv.includes('--rotate')

const LOGINS = [
  { role: 'admin', name: 'Ayesha Karim', email: 'admin@scholaris.edu', portal: '/admin/login' },
  { role: 'teacher', email: 'teacher@scholaris.edu', portal: '/teacher/login', Profile: Teacher, profileModel: 'Teacher' },
  { role: 'student', email: 'student@scholaris.edu', portal: '/student/login', Profile: Student, profileModel: 'Student' },
]

// 16 random characters that always satisfy the password policy
function temporaryPassword() {
  for (;;) {
    const candidate = crypto.randomBytes(12).toString('base64url').slice(0, 16)
    if (/[a-z]/.test(candidate) && /[A-Z]/.test(candidate) && /\d/.test(candidate)) return candidate
  }
}

async function seedLogins() {
  const rows = []

  for (const l of LOGINS) {
    const existing = await User.findOne({ email: l.email })
    if (existing) {
      if (!rotate) {
        rows.push({ ...l, result: `already exists (${existing.role}) — unchanged` })
        continue
      }
      const password = temporaryPassword()
      existing.password = password
      existing.mustChangePassword = true
      existing.tokenVersion = (existing.tokenVersion || 0) + 1 // signs out any open session
      await existing.save()
      rows.push({ ...l, password, result: 'password rotated; must be changed at next sign-in' })
      continue
    }

    let profile = null
    if (l.Profile) {
      profile = await l.Profile.findOne({ email: l.email })
      if (!profile) {
        rows.push({ ...l, result: `skipped — no ${l.profileModel} profile with this email` })
        continue
      }
    }

    const password = temporaryPassword()
    const user = await User.create({
      name: l.name || profile.name,
      email: l.email,
      password,
      role: l.role,
      profileModel: l.profileModel || null,
      profile: profile?._id ?? null,
      mustChangePassword: true,
    })

    if (profile) {
      profile.user = user._id
      await profile.save()
    }
    rows.push({ ...l, password, result: profile ? `created, linked to ${profile.name}` : 'created' })
  }

  return rows
}

connectDb()
  .then(seedLogins)
  .then((rows) => {
    const withPasswords = rows.filter((r) => r.password)
    if (withPasswords.length) {
      const lines = [
        `# Scholaris temporary passwords — written ${new Date().toISOString()}`,
        '# Each must be changed at first sign-in. Delete this file once they are handed over.',
        '',
        ...withPasswords.map((r) => `${r.role.padEnd(8)} ${r.email.padEnd(24)} ${r.password}   (${r.portal})`),
        '',
      ]
      fs.writeFileSync(CREDENTIALS_FILE, lines.join('\n'), { mode: 0o600 })
    }

    console.log('\n  Sign-in accounts:')
    rows.forEach((r) => console.log(`    ${r.role.padEnd(8)} ${r.email.padEnd(24)} ${r.portal.padEnd(15)} ${r.result}`))
    if (withPasswords.length) console.log(`\n  Temporary passwords written to ${CREDENTIALS_FILE}`)
    console.log()
    return disconnectDb()
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:logins] failed:', err)
    mongoose.connection.close().finally(() => process.exit(1))
  })
