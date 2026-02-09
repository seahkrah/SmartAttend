import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { initializeDatabase } from './db/connection.js'
import { config } from './config/environment.js'
import authRoutes from './routes/auth.js'
import schoolRoutes from './routes/school.js'
import corporateRoutes from './routes/corporate.js'
import attendanceRoutes from './routes/attendance.js'
import faceVerificationRoutes from './routes/faceVerification.js'
import userRoutes from './routes/users.js'
import auditRoutes from './routes/audit.js'
import timeRoutes from './routes/time.js'
import superadminOperationsRoutes from './routes/superadmin-operations.js'
import superadminSecurityRoutes from './routes/superadmin-security-hardening.js'
import { clockDriftDetectionMiddleware, attendanceClockDriftValidationMiddleware, auditClockDriftContextMiddleware, clockDriftWarningMiddleware } from './auth/clockDriftDetectionMiddleware.js'
import { enforceTenantBoundaries } from './auth/tenantEnforcementMiddleware.js'
import {
  enforceRoleRevalidation,
  enforceRoleChangeLogging,
  blockSilentRoleChanges,
  injectRoleValidationStatus
} from './auth/roleRevalidationMiddleware.js'

dotenv.config()

const app = express()
const PORT = config.backend.port

console.log('[INIT] Setting up middleware...')
app.use(cors())
console.log('[INIT] ✓ CORS middleware added')

app.use(express.json())
console.log('[INIT] ✓ JSON parser middleware added')

// PHASE 2, STEP 2.2: Clock drift detection middleware
// Applied globally to all requests for time authority enforcement
app.use(clockDriftDetectionMiddleware())
console.log('[INIT] ✓ Clock drift detection middleware added')

// Audit clock drift context middleware
app.use(auditClockDriftContextMiddleware())
console.log('[INIT] ✓ Audit clock drift context middleware added')

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`)
  next()
})
console.log('[INIT] ✓ Request logger middleware added')

// PHASE 4, STEP 4.1: Tenant boundary enforcement middleware
// Applied to all authenticated routes to enforce tenant isolation
app.use(enforceTenantBoundaries)
console.log('[INIT] ✓ Tenant boundary enforcement middleware added')

// PHASE 4, STEP 4.2: Role escalation detection middleware
// Applied to all routes for role change logging, anomaly detection, and revalidation enforcement
app.use(enforceRoleRevalidation)
console.log('[INIT] ✓ Role revalidation enforcement middleware added')
app.use(enforceRoleChangeLogging)
console.log('[INIT] ✓ Role change logging middleware added')
app.use(blockSilentRoleChanges)
console.log('[INIT] ✓ Silent role change prevention middleware added')
app.use(injectRoleValidationStatus)
console.log('[INIT] ✓ Role validation status injection middleware added')

console.log('[INIT] Mounting routes...')
app.use('/api/auth', authRoutes)
app.use('/api/school', schoolRoutes)
app.use('/api/corporate', corporateRoutes)
app.use('/api/time', timeRoutes)
app.use('/api/superadmin', superadminOperationsRoutes)
app.use('/api/superadmin', superadminSecurityRoutes)
console.log('[INIT] ✓ Superadmin bootstrap & operational routes mounted')
console.log('[INIT] ✓ Superadmin security hardening routes mounted')
console.log('[INIT] ✓ Time authority routes mounted')

// Attendance drift validation middleware (applied before attendance routes)
app.use('/api/attendance', attendanceClockDriftValidationMiddleware())
app.use('/api/attendance', attendanceRoutes)
console.log('[INIT] ✓ Attendance routes mounted with drift validation')

// Face verification routes (no additional drift validation needed)
app.use('/api/face', faceVerificationRoutes)
console.log('[INIT] ✓ Face verification routes mounted')

app.use('/api/users', userRoutes)
app.use('/api/audit', auditRoutes)
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
