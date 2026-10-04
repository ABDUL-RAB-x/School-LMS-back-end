// Sets the password of ONE existing account, without touching anything else
//   npm run set-password -- --email=someone@example.com --password=NewPass1234
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'
import User from '../src/models/User.js'
import Session from '../src/models/Session.js'
import AuditLog from '../src/models/AuditLog.js'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const email = (arg('email') || '').toLowerCase().trim()
const password = arg('password') || ''
const allowWeak = process.argv.includes('--allow-weak')

const meetsPolicy = (p) => p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)

async function run() {
  if (!email || !password) throw new Error('Usage: npm run set-password -- --email=<email> --password=<password>')
  if (password.length < 8) throw new Error('Passwords must be at least 8 characters.')
  if (!meetsPolicy(password) && !allowWeak) {
    throw new Error('That password is weaker than the policy (10+ characters, uppercase, lowercase, number). Pass --allow-weak to set it anyway.')
  }

  const user = await User.findOne({ email }).select('+password +failedLoginAttempts +lockUntil')
  if (!user) throw new Error(`No account uses ${email}. Nothing was changed.`)

  user.password = password
  user.mustChangePassword = false
  user.failedLoginAttempts = 0
  user.lockUntil = null
  user.isActive = true
  user.tokenVersion = (user.tokenVersion || 0) + 1
  await user.save()
  await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date(), revokedReason: 'password set by script' })
  await AuditLog.create({ event: 'password.set_by_script', user: user._id, email: user.email, role: user.role, detail: allowWeak && !meetsPolicy(password) ? 'weak password allowed explicitly' : '' })

  return { user, weak: !meetsPolicy(password) }
}

connectDb()
  .then(run)
  .then(({ user, weak }) => {
    console.log(`\n  Password updated for ${user.email} (${user.role}). Existing sessions were signed out.`)
    if (weak) console.log('  Warning: this password does not meet the policy. Change it to a stronger one soon.')
    console.log()
    return disconnectDb()
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n[set-password] ${err.message}\n`)
    mongoose.connection.close().finally(() => process.exit(1))
  })
