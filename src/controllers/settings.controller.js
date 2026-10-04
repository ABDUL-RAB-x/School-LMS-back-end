import asyncHandler from '../utils/asyncHandler.js'
import { Settings } from '../models/index.js'

// There is exactly one settings document; create it on first read
async function getOrCreate() {
  let doc = await Settings.findOne({ key: 'global' })
  if (!doc) doc = await Settings.create({ key: 'global' })
  return doc
}

// GET /api/settings
export const getSettings = asyncHandler(async (_req, res) => {
  const settings = await getOrCreate()
  res.json({ success: true, data: settings })
})

// PUT /api/settings
export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreate()

  // Merge section by section so a partial update never wipes the rest
  for (const section of ['school', 'academic', 'security', 'preferences']) {
    if (req.body[section]) {
      settings[section] = { ...settings[section].toObject(), ...req.body[section] }
    }
  }

  await settings.save()
  res.json({ success: true, message: 'Settings saved.', data: settings })
})
