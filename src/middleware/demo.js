import { Student, Teacher } from '../models/index.js'

// What a public demo account may not do
export async function demoRestriction(req) {
  const path = req.baseUrl + req.path
  const { method } = req

  if (method === 'DELETE') return 'Demo accounts cannot delete records.'
  if (method === 'PATCH' && path === '/api/auth/password') return 'The demo account password cannot be changed.'
  if (method === 'POST' && path === '/api/auth/logout-all') return 'Demo accounts cannot sign out other devices.'
  if (method === 'PUT' && path === '/api/settings') return 'Demo accounts cannot change school settings.'
  if (method === 'POST' && /^\/api\/fees\/[^/]+\/remind$/.test(path)) return 'Demo accounts cannot email fee reminders.'

  // Creating a login (a password) or moving an account to another email address
  const people = path.match(/^\/api\/(students|teachers)(?:\/([^/]+))?$/)
  if (people) {
    if (method === 'POST' && req.body?.password) return 'Demo accounts cannot create login accounts.'
    if (method === 'PUT' && people[2] && req.body?.email) {
      const Model = people[1] === 'students' ? Student : Teacher
      const current = await Model.findById(people[2]).select('email').lean().catch(() => null)
      if (current && current.email !== String(req.body.email).toLowerCase().trim()) {
        return 'Demo accounts cannot change email addresses.'
      }
    }
  }

  return null
}
