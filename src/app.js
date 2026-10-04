import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import mongoose from 'mongoose'

import { env, isProd } from './config/env.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFound } from './middleware/error.js'
import { requireCsrfHeader } from './middleware/auth.js'
import sanitize from './middleware/sanitize.js'
import { auditWrites } from './utils/audit.js'
import routes from './routes/index.js'

const app = express()

app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(helmet())
app.use(
  cors({
    origin: env.clientOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '100kb' }))
app.use(sanitize)
// Never log the query string: reset tokens and search terms can sit there
morgan.token('path', (req) => req.originalUrl.split('?')[0])
app.use(morgan(isProd ? ':remote-addr :method :path :status :res[content-length] - :response-time ms' : ':method :path :status :response-time ms'))

app.get('/health', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting']
  res.json({
    success: true,
    service: 'scholaris-api',
    env: env.nodeEnv,
    database: states[mongoose.connection.readyState] ?? 'unknown',
    mail: env.smtp.previewOnly ? 'preview' : 'smtp',
    uptime: Math.round(process.uptime()),
  })
})

app.use('/api', apiLimiter, requireCsrfHeader, auditWrites, routes)

app.use(notFound)
app.use(errorHandler)

export default app
