import mongoose from 'mongoose'

// Append-only record of security and administrative events
const auditLogSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true }, // e.g. login.success, student.update
    status: { type: String, enum: ['success', 'failure'], default: 'success', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, default: '', lowercase: true, index: true },
    role: { type: String, default: '' },
    resource: { type: String, default: '' },
    resourceId: { type: String, default: '' },
    detail: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

auditLogSchema.index({ createdAt: -1 })

const AuditLog = mongoose.model('AuditLog', auditLogSchema)
export default AuditLog
