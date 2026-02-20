import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { initializeDatabase } from './db/connection.js'
import { config } from './config/environment.js'
import authRoutes from './routes/auth.js'
import schoolRoutes from './routes/school.js'
import corporateRoutes from './routes/corporate.js'
import attendanceRoutes from './routes/attendance.js'
import faceVerificationRoutes from './routes/faceVerification.js'
import auditRoutes from './routes/audit.js'
import timeRoutes from './routes/time.js'
import superadminOperationsRoutes from './routes/superadmin-operations.js'
// import superadminSecurityRoutes from './routes/superadmin-security-hardening.js'  // Disabled: requires MFA session flow not yet in frontend
import superadminRoutes from './routes/superadmin.js'
import tenantAdminRoutes from './routes/tenantAdmin.js'
import facultyRoutes from './routes/faculty.js'
import studentRoutes from './routes/student.js'
import { clockDriftDetectionMiddleware, attendanceClockDriftValidationMiddleware, auditClockDriftContextMiddleware, clockDriftWarningMiddleware } from './auth/clockDriftDetectionMiddleware.js'
import { enforceTenantBoundaries } from './auth/tenantEnforcementMiddleware.js'
import { getUserFriendlyError, logError } from './utils/errorMessages.js'
import {
  enforceRoleRevalidation,
  enforceRoleChangeLogging,
  blockSilentRoleChanges,
  injectRoleValidationStatus
} from './auth/roleRevalidationMiddleware.js'

dotenv.config()

const app = express()
const PORT = config.backend.port

// ─── SECURITY MIDDLEWARE ───────────────────────────────────────────
// Helmet: sets security HTTP headers (X-Content-Type-Options, X-Frame-Options, etc.)
app.use(helmet())

// CORS: restrict to known origins
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000']

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error('CORS: Origin not allowed'), false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Trust proxy for correct client IP behind reverse proxies
app.set('trust proxy', true)

// Body parser with explicit size limit
app.use(express.json({ limit: '10mb' }))

// ─── RATE LIMITING ─────────────────────────────────────────────────
// Global rate limit: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
})
app.use(globalLimiter)

// Strict rate limit for auth endpoints: 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' }
})
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/login-superadmin', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth/register-with-role', authLimiter)

// PHASE 2, STEP 2.2: Clock drift detection middleware
app.use(clockDriftDetectionMiddleware())
app.use(auditClockDriftContextMiddleware())

// Request logging middleware (minimal in production)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.path}`)
    next()
  })
}

// PHASE 4, STEP 4.1: Tenant boundary enforcement middleware
app.use(enforceTenantBoundaries)

// PHASE 4, STEP 4.2: Role escalation detection middleware
app.use(enforceRoleRevalidation)
app.use(enforceRoleChangeLogging)
app.use(blockSilentRoleChanges)
app.use(injectRoleValidationStatus)

// ─── ROUTES ────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/admin', tenantAdminRoutes)
app.use('/api/school', schoolRoutes)
app.use('/api/faculty', facultyRoutes)
app.use('/api/student', studentRoutes)
app.use('/api/corporate', corporateRoutes)
app.use('/api/time', timeRoutes)
app.use('/api/superadmin', superadminRoutes)
app.use('/api/superadmin', superadminOperationsRoutes)
// app.use('/api/superadmin', superadminSecurityRoutes)  // Disabled: validateSuperadminSession blocks all requests (no MFA session UI)

// Attendance drift validation middleware (applied before attendance routes)
app.use('/api/attendance', attendanceClockDriftValidationMiddleware())
app.use('/api/attendance', attendanceRoutes)

// Face verification routes
app.use('/api/face', faceVerificationRoutes)

// REMOVED: /api/users stub routes (C3 - were unprotected, served no purpose)
app.use('/api/audit', auditRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running', database: 'connected' })
})

// Error handling middleware (sanitized - never expose internals to client)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Log full error internally
  if (process.env.NODE_ENV === 'development') {
    logError('Unhandled error', err)
  }
  
  // CORS errors
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'Cross-origin request blocked' })
  }
  
  // Send sanitized error to client
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' })
})

// Initialize server
async function start() {
  try {
    await initializeDatabase()
    
    const server = app.listen(PORT, 'localhost', () => {
      console.log(`Server running on http://localhost:${PORT}`)
    })
    
    server.on('error', (error: any) => {
      console.error('[SERVER_ERROR]', error.message)
      process.exit(1)
    })
    
    server.on('clientError', (_error: any) => {
      // Silently handle client errors (malformed requests, etc.)
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
start().catch((_err) => {
  console.error('[FATAL] Failed to start server')
  process.exit(1)
})
