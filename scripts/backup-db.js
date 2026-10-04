// Read-only backup: writes every collection of the configured database to
//   npm run backup
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'

const { EJSON } = mongoose.mongo.BSON
const here = path.dirname(fileURLToPath(import.meta.url))

async function backup() {
  const db = mongoose.connection.db
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(here, '..', 'backups', `${db.databaseName}-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })

  const names = (await db.listCollections().toArray()).map((c) => c.name).sort()
  const counts = {}
  for (const name of names) {
    const docs = await db.collection(name).find({}).toArray()
    fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, { relaxed: false }, 2))
    counts[name] = docs.length
  }
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({ database: db.databaseName, takenAt: new Date(), counts }, null, 2))
  return { dir, counts }
}

connectDb()
  .then(backup)
  .then(({ dir, counts }) => {
    console.log(`\n  Backup written to ${dir}`)
    Object.entries(counts).forEach(([name, n]) => console.log(`    ${name.padEnd(16)} ${n}`))
    console.log()
    return disconnectDb()
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backup] failed:', err)
    mongoose.connection.close().finally(() => process.exit(1))
  })
