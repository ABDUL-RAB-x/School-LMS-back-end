import mongoose from 'mongoose'

// One signed-in device
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshHash: { type: String, required: true, unique: true },
    previousHash: { type: String, default: null, index: true },
    remember: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
)

// MongoDB removes a session document a day after it expires
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 })

sessionSchema.methods.isUsable = function isUsable() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now()
}

const Session = mongoose.model('Session', sessionSchema)
export default Session
