// Local development database
//   npm run db
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(here, '..', '.devdb')
fs.mkdirSync(dbPath, { recursive: true })

const mongo = await MongoMemoryServer.create({
  instance: {
    port: 27017,
    ip: '127.0.0.1',
    dbName: 'scholaris',
    dbPath,
    storageEngine: 'wiredTiger', // persists to dbPath, unlike the default ephemeral engine
  },
})

console.log(`\n  Dev MongoDB running`)
console.log(`  → ${mongo.getUri('scholaris')}`)
console.log(`  → data directory: ${dbPath}`)
console.log(`\n  Leave this running. Ctrl+C to stop.\n`)

const stop = async () => {
  console.log('\n[db] stopping…')
  await mongo.stop()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
