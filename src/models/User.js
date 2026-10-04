import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export const ROLES = ['admin', 'teacher', 'student']

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // select:false so the hash never leaks through a stray .find()
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    isActive: { type: Boolean, default: true },
    // Public demo login: no email code, no lockout, and no deleting (see middleware/demo.js)
    isDemo: { type: Boolean, default: false },

    // Links the login account to its domain profile (Student or Teacher)
    profileModel: { type: String, enum: ['Student', 'Teacher', null], default: null },
    profile: { type: mongoose.Schema.Types.ObjectId, refPath: 'profileModel', default: null },

    // Email OTP (second factor)
    otpHash: { type: String, default: null, select: false },
    otpExpiresAt: { type: Date, default: null, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpLastSentAt: { type: Date, default: null, select: false },

    lastLoginAt: { type: Date, default: null },

    // Brute-force protection
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },

    // Password lifecycle
    passwordChangedAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null, select: false },

    // Bumped to invalidate every access token at once (logout everywhere, password change/reset)
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password
        delete ret.otpHash
        delete ret.otpExpiresAt
        delete ret.otpAttempts
        delete ret.otpLastSentAt
        delete ret.failedLoginAttempts
        delete ret.lockUntil
        delete ret.resetTokenHash
        delete ret.resetTokenExpiresAt
        delete ret.tokenVersion
        delete ret.__v
        return ret
      },
    },
  },
)

// Hash on create and on any password change: never store plaintext
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  if (!this.isNew) this.passwordChangedAt = new Date()
  return next()
})

userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now())
}

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password)
}

userSchema.methods.clearOtp = function clearOtp() {
  this.otpHash = null
  this.otpExpiresAt = null
  this.otpAttempts = 0
}

const User = mongoose.model('User', userSchema)
export default User
