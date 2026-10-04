// Vercel entry point: every request is routed here (see vercel.json).
// The database connection is opened once per warm instance and reused.
import app from '../src/app.js'
import { assertEnv } from '../src/config/env.js'
import { connectDb } from '../src/config/db.js'

assertEnv()

let connecting = null

export default async function handler(req, res) {
  try {
    connecting ??= connectDb()
    await connecting
  } catch (err) {
    connecting = null // let the next request try again
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ success: false, message: 'The database is unavailable. Please try again shortly.' }))
  }
  return app(req, res)
}
