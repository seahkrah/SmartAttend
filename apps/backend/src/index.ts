import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { initializeDatabase } from './db/connection.js'
import authRoutes from './routes/auth.js'
import schoolRoutes from './routes/school.js'
import corporateRoutes from './routes/corporate.js'
import attendanceRoutes from './routes/attendance.js'
import userRoutes from './routes/users.js'

dotenv.config()

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

console.log('[INIT] Setting up middleware...')
app.use(cors())
console.log('[INIT] ✓ CORS middleware added')

app.use(express.json())
console.log('[INIT] ✓ JSON parser middleware added')

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`)
  next()
})
console.log('[INIT] ✓ Request logger middleware added')

console.log('[INIT] Mounting routes...')
app.use('/api/auth', authRoutes)
app.use('/api/school', schoolRoutes)
app.use('/api/corporate', corporateRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/users', userRoutes)
console.log('[INIT] ✓ All routes mounted')

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running', database: 'connected' })
})

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[ERROR] Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error', message: err.message })
})

// Initialize server
async function start() {
  try {
    console.log('[INIT] Initializing database...')
    await initializeDatabase()
    console.log('[INIT] ✓ Database initialized')
    
    console.log(`[INIT] Starting server on port ${PORT}...`)
    const server = app.listen(PORT, 'localhost', () => {
      console.log(`✅ Server running on http://localhost:${PORT}`)
      console.log(`[READY] Server is ready to accept requests`)
    })
    
    server.on('error', (error: any) => {
      console.error('[SERVER_ERROR]', error)
      process.exit(1)
    })
    
    server.on('clientError', (error: any) => {
      console.error('[CLIENT_ERROR]', error)
    })
    
    // Keep the server running
    process.on('SIGTERM', () => {
      console.log('[SHUTDOWN] SIGTERM received')
      server.close(() => {
        console.log('[SHUTDOWN] Server closed')
        process.exit(0)
      })
    })
    
    process.on('SIGINT', () => {
      console.log('[SHUTDOWN] SIGINT received')
      server.close(() => {
        console.log('[SHUTDOWN] Server closed')
        process.exit(0)
      })
    })
  } catch (error) {
    console.error('[FATAL] Failed to start server:', error)
    process.exit(1)
  }
}

// Error handlers
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT_EXCEPTION]', error)
  process.exit(1)
})

console.log('[INIT] Starting application...')
start().catch((err) => {
  console.error('[FATAL] Uncaught error in start():', err)
  process.exit(1)
})
