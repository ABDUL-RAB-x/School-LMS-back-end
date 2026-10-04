import { validationResult } from 'express-validator'
import ApiError from '../utils/ApiError.js'

// Runs a chain of express-validator rules
export default function validate(rules) {
  return async (req, _res, next) => {
    await Promise.all(rules.map((rule) => rule.run(req)))

    const result = validationResult(req)
    if (result.isEmpty()) return next()

    const fields = {}
    result.array({ onlyFirstError: true }).forEach((e) => {
      fields[e.path] = e.msg
    })

    return next(ApiError.badRequest('Some fields need attention.', { fields }))
  }
}
