import app from './app.js'
import { assertEnv, env } from './config/env.js'
import { connectDb, disconnectDb } from './config/db.js'
import { verifyMailer } from './config/mailer.js'

assertEnv()

async function start() {
  await connectDb()
  await verifyMailer()

  const server = app.listen(env.port, () => {
    console.log(`\n  Scholaris API ready`)
    console.log(`  → http://localhost:${env.port}`)
    console.log(`  → health: http://localhost:${env.port}/health`)
    console.log(`  → CORS origin: ${env.clientOrigin}\n`)
  })

  const shutdown = async (signal) => {
    console.log(`\n[${signal}] shutting down…`)
    server.close(async () => {
      await disconnectDb()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 8000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('unhandledRejection', (err) => {
    console.error('[fatal] unhandled rejection:', err)
    shutdown('unhandledRejection')
  })
}

start().catch((err) => {
  console.error('[fatal] failed to start:', err.message)
  process.exit(1)
})
