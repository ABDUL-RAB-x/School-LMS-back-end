import mongoose from 'mongoose'
import { env, isProd } from './env.js'

mongoose.set('strictQuery', true)

export async function connectDb() {
  const redacted = env.mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      autoIndex: !isProd,
    })
    console.log(`[db] connected → ${redacted}`)
  } catch (err) {
    console.error(`[db] connection failed → ${redacted}`)
    console.error(`     ${err.message}`)
    throw err
  }

  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'))
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'))

  return mongoose.connection
}

export async function disconnectDb() {
  await mongoose.connection.close()
}
