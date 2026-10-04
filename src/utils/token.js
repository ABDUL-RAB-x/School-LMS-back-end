import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

// Access token: short-lived, names the session it belongs to
export function signAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: String(user._id), sid: String(sessionId), tv: user.tokenVersion ?? 0, role: user.role },
    env.jwtSecret,
    { expiresIn: env.accessTokenTtl },
  )
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret)
}
