import mongoose from 'mongoose'
import ApiError from '../utils/ApiError.js'
import { isProd } from '../config/env.js'

export function notFound(req, _res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`))
}

// Translates driver/mongoose failures into clean, client-safe responses
function normalise(err) {
  if (err instanceof ApiError) return err

  if (err instanceof mongoose.Error.ValidationError) {
    const fields = {}
    Object.values(err.errors).forEach((e) => {
      fields[e.path] = e.message
    })
    return ApiError.badRequest('Some fields need attention.', { fields })
  }

  if (err instanceof mongoose.Error.CastError) {
    // A cast failure deep inside a list reports the whole item as the value: keep the message readable
    const value = typeof err.value === 'object' ? '' : `"${err.value}" `
    return ApiError.badRequest(`${value ? `${value}is not a valid` : 'One of the values sent is not a valid'} ${err.path}.`)
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).join(', ') || 'value'
    return ApiError.conflict(`A record with that ${field} already exists.`)
  }

  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON.')
  }

  return null
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalise(err)

  if (!known) {
    // Genuinely unexpected: log the whole thing, tell the client nothing useful
    console.error(`[error] ${req.method} ${req.originalUrl}`)
    console.error(err)
    return res.status(500).json({
      success: false,
      message: 'Something went wrong on our side.',
      ...(isProd ? {} : { stack: err.stack }),
    })
  }

  if (known.status >= 500) console.error(err)

  return res.status(known.status).json({
    success: false,
    message: known.message,
    ...(known.details || {}),
  })
}
