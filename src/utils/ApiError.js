// Operational error carrying an HTTP status
export default class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isOperational = true
    if (details) this.details = details
    Error.captureStackTrace(this, this.constructor)
  }

  static badRequest(msg = 'Bad request', details) {
    return new ApiError(400, msg, details)
  }
  static unauthorized(msg = 'Not authenticated') {
    return new ApiError(401, msg)
  }
  static forbidden(msg = 'You do not have access to this resource') {
    return new ApiError(403, msg)
  }
  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg)
  }
  static conflict(msg = 'Resource already exists') {
    return new ApiError(409, msg)
  }
  static tooMany(msg = 'Too many requests', details) {
    return new ApiError(429, msg, details)
  }
}
