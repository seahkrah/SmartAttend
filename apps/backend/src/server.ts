#!/usr/bin/env node

import http from 'http'
import express from 'express'
import dotenv from 'dotenv'
import { initializeDatabase, query } from './db/connection.js'
import { pendingMigrations } from './db/migrationStatus.js'
import { warmUp, engineInfo } from './biometrics/engine.js'
import { applyHttpSecurity } from './security/httpSecurity.js'
import { validateProductionConfig } from './config/validateEnv.js'
import authRoutes from './routes/auth.js'
import mfaRoutes from './routes/mfa.js'
import schoolAdminRoutes from './routes/schoolAdmin.js'
import schoolRoutes from './routes/school.js'
import corporateRoutes from './routes/corporate.js'
import attendanceRoutes from './routes/attendance.js'
import userRoutes from './routes/users.js'
import superadminRoutes from './routes/superadmin.js'
import incidentsRoutes from './routes/incidents.js'
import incidentAdminRoutes from './routes/incidentAdminRoutes.js'
import correctionsRoutes from './routes/corrections.js'
import metricsRoutes from './routes/metrics.js'
import simulationsRoutes from './routes/simulations.js'
import validationRoutes from './routes/validation.js'
// Present in src/index.ts but previously missing here, which is why every
// /api/faculty, /api/student, /api/admin, /api/face, /api/audit and /api/time
// request 404'd against the server that actually runs.
import tenantAdminRoutes from './routes/tenantAdmin.js'
import adminTenantRoutes from './routes/adminTenant.js'
import hrRoutes from './routes/hr.js'
// EMS leave: types, balances, requests, approvals, calendar.
import leaveRoutes from './routes/leave.js'
// EMS payroll: components, compensation, tax bands, periods, runs, payslips.
import payrollRoutes from './routes/payroll.js'
// EMS workforce: contracts, shift patterns, the roster, timesheets.
import workforceRoutes from './routes/workforce.js'
import attendanceSelfServiceRoutes from './routes/attendanceSelfService.js'
import facultyRoutes from './routes/faculty.js'
import facultyWorkflowRoutes from './routes/facultyWorkflow.js'
import studentRoutes from './routes/student.js'
// SMS academic core: years, terms, programmes, curriculum, student programmes.
import academicsRoutes from './routes/academics.js'
// SMS gradebook: schemes, assessments, marks, results, transcripts.
import gradebookRoutes from './routes/gradebook.js'
// SMS admissions: intakes, applicants, applications, decisions, enrolment.
import admissionsRoutes from './routes/admissions.js'
// SMS fees: structures, invoices, payments, statements, clearance.
import feesRoutes from './routes/fees.js'
// SMS guardians: the school's management of them, and their own portal.
import guardiansRoutes from './routes/guardians.js'
import guardianPortalRoutes from './routes/guardianPortal.js'
// Public "Request access" enquiries, read by the platform operator.
import accessRequestRoutes from './routes/accessRequests.js'
// Notification delivery: channels, templates, outbox, preferences, inbox.
import notificationRoutes from './routes/notifications.js'
// Document storage: upload, download, quota, access log.
import fileRoutes from './routes/files.js'
import { startDispatcher, stopDispatcher } from './notifications/service.js'
import { closeSmtpPools } from './notifications/providers/index.js'
import biometricsRoutes from './routes/biometrics.js'
import auditRoutes from './routes/audit.js'
import timeRoutes from './routes/time.js'
import {
  apiLatencyTrackingMiddleware,
  tenantIdExtractorMiddleware,
} from './middleware/latencyTrackingMiddleware.js'
import {
  errorToIncidentHandler,
  setupUncaughtHandlers,
} from './middleware/errorToIncidentMiddleware.js'

dotenv.config()
validateProductionConfig()

const PORT = parseInt(process.env.PORT || '5000')
const app = express()

console.log('[STARTUP] Initializing application...')

// Setup uncaught exception handlers
setupUncaughtHandlers()

// Middleware
applyHttpSecurity(app)
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// Tenant ID extraction (before latency tracking)
app.use(tenantIdExtractorMiddleware)

// API latency tracking middleware
app.use(apiLatencyTrackingMiddleware)

// One line per request. In production it is JSON with the outcome and time,
// and never the query string (reset and activation tokens travel in bodies,
// but a query string is where a mistake would put one).
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[REQUEST] ${req.method} ${req.path}`)
    return next()
  }
  const started = Date.now()
  res.on('finish', () => {
    console.log(JSON.stringify({
      t: new Date().toISOString(), method: req.method, path: req.path,
      status: res.statusCode, ms: Date.now() - started,
    }))
  })
  next()
})

// Routes
app.use('/api/auth/mfa', mfaRoutes)
app.use('/api/auth', schoolAdminRoutes)
app.use('/api/auth', authRoutes)

// Tenant-scoped routers resolve their own context.
//
// These were previously mounted behind enforceTenantBoundaries, which read as
// though it guaranteed isolation and did not: it set tenantId from the JWT's
// platformId — the platform, shared by every institution — and nothing read
// the result. Worse, it ran at the mount point while these routers
// authenticated per route, so req.user was still undefined when it ran and it
// skipped silently.
//
// Each router now begins with authenticateToken + resolveTenantContext, which
// derives the tenant from the authenticated identity and the server's own
// membership records, and states what it requires (requireTenant,
// requirePlatform, requireRoles) at its own mount.
app.use('/api/school', schoolRoutes)
app.use('/api/corporate', corporateRoutes)
// Self-service and department views. Mounted first; the original attendance
// router keeps /sessions, /face and /mark-with-face, whose paths do not clash.
app.use('/api/attendance', attendanceSelfServiceRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/users', userRoutes)
app.use('/api/metrics', metricsRoutes)
app.use('/api/simulations', simulationsRoutes)

// Superadmin/control-plane routes remain system-scoped and already have their own guards.
app.use('/api/superadmin', superadminRoutes)
app.use('/api/v1/superadmin', superadminRoutes)
app.use('/api/incidents', incidentsRoutes)
app.use('/api/admin/incidents', incidentAdminRoutes)
app.use('/api/corrections', correctionsRoutes)
app.use('/api/validation', validationRoutes)

// Role portals and shared services. /api/admin is mounted after
// /api/admin/incidents above so the more specific path keeps priority.
// Tenant-scoped admin API (users, courses, approvals, analytics, export).
// Mounted before tenantAdminRoutes, whose paths are /school/* and /corporate/*
// and so do not overlap.
app.use('/api/admin', adminTenantRoutes)
// EMS — HR command centre. Platform-gated to corporate inside the router.
app.use('/api/hr', hrRoutes)
app.use('/api/leave', leaveRoutes)
app.use('/api/payroll', payrollRoutes)
app.use('/api/workforce', workforceRoutes)
app.use('/api/admin', tenantAdminRoutes)
// Attendance lifecycle (draft/submit/lock/export/bulk-edit/facial-match/qr).
// Mounted first; the original faculty router keeps its own paths.
app.use('/api/faculty', facultyWorkflowRoutes)
app.use('/api/faculty', facultyRoutes)
app.use('/api/student', studentRoutes)
app.use('/api/academics', academicsRoutes)
app.use('/api/gradebook', gradebookRoutes)
app.use('/api/admissions', admissionsRoutes)
app.use('/api/fees', feesRoutes)
app.use('/api/guardians', guardiansRoutes)
app.use('/api/guardian', guardianPortalRoutes)
app.use('/api/access-requests', accessRequestRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/files', fileRoutes)
app.use('/api/biometrics', biometricsRoutes)
app.use('/api/audit', auditRoutes)
app.use('/api/time', timeRoutes)

// Error handling middleware (MUST be last)
app.use(errorToIncidentHandler)

// Liveness: the process is up.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Readiness: the database answers and its schema is current. A load balancer
// or orchestrator should send traffic only while this is 200.
app.get('/api/health/ready', async (_req, res) => {
  try {
    await query('SELECT 1')
    const pending = await pendingMigrations()
    if (pending.length > 0) {
      return res.status(503).json({ status: 'migrations_pending', pending })
    }
    // Face matching is optional, so a face engine that cannot start degrades
    // the service rather than taking it out of rotation; it is reported here
    // so the fault is visible without waiting for someone to try a check-in.
    const face = engineInfo()
    return res.json({
      status: 'ready',
      components: {
        faceEngine: { state: face.state, backend: face.backend, error: face.error },
      },
    })
  } catch {
    return res.status(503).json({ status: 'database_unavailable' })
  }
})

async function startServer() {
  try {
    console.log('[STARTUP] Connecting to database...')
    console.log(`[STARTUP] Using port ${PORT}`)
    await initializeDatabase()
    console.log('[DB] ✓ Connected')

    const pending = await pendingMigrations()
    if (pending.length > 0) {
      console.warn(`[DB] WARNING: ${pending.length} migration(s) not applied (${pending[0]}${pending.length > 1 ? ' …' : ''}).`)
      console.warn('[DB] Run `npx tsx src/db/migrate.ts` in apps/backend. /api/health/ready answers 503 until then.')
    } else {
      console.log('[DB] ✓ Schema is current')
    }

    // Create HTTP server
    const server = http.createServer(app)

    console.log(`[SERVER] Attempting to bind to port ${PORT}...`)

    // Start listening on all interfaces to be accessible from Docker host
    const host = '0.0.0.0' // Listen on all network interfaces
    
    server.listen(PORT, host, () => {
      const addr = server.address()
      console.log(`[SERVER] ✅ LISTENING on port ${PORT}`)
      console.log(`[SERVER] Binding address:`, addr)
      console.log(`[SERVER] ✅ Access at http://localhost:${PORT}/api/health`)
      console.log('[SERVER] Ready to accept requests')

      // The outbox only moves if something drains it. Off unless
      // NOTIFICATION_DISPATCH is 'on', so a test run or a migration script
      // attached to a shared database does not start sending real mail as a
      // side effect of importing this file.
      // Load the face networks now rather than on the first face check, so a
      // missing native library is reported at start-up, and the first person
      // to check in is not the one who waits for the models to load.
      if (process.env.FACE_ENGINE_WARMUP !== 'off') {
        warmUp()
          .then(() => {
            const e = engineInfo()
            console.log(`[FACE] engine ready: backend=${e.backend}, TensorFlow ${e.nativeVersion ?? 'unknown'}`)
            if (e.backend !== 'tensorflow') {
              console.warn('[FACE] WARNING: not on the native TensorFlow backend; face checks will be very slow')
            }
          })
          .catch((e) => console.error('[FACE] engine unavailable; face matching will answer 503:', e.message))
      }

      if (startDispatcher()) {
        console.log('[SERVER] Notification dispatcher running')
      } else {
        console.log('[SERVER] Notification dispatcher off (set NOTIFICATION_DISPATCH=on)')
      }
    })

    server.on('listening', () => {
      console.log('[NETWORK] Server is listening')
      const addr = server.address()
      console.log(`[NETWORK] Bound to:`, addr)
    })

    server.on('error', (err: any) => {
      console.error('[SERVER_ERROR]', err.message)
      if (err.code === 'EADDRINUSE') {
        console.error(`[SERVER_ERROR] Port ${PORT} is already in use`)
      }
      process.exit(1)
    })

    // Verify after 1 second
    setTimeout(() => {
      const addr = server.address()
      if (addr) {
        console.log(`[VERIFY] ✓ Server confirmed listening on port ${(addr as any).port}`)
      } else {
        console.error('[VERIFY] ERROR: server.address() is null!')
      }
    }, 1000)

    // Graceful shutdown - ignore SIGINT to prevent interference from other processes
    // Only listen for SIGTERM
    process.on('SIGTERM', () => {
      console.log('[SHUTDOWN] SIGTERM received')
      // Stop claiming new messages, and close the pooled SMTP connections so
      // the relay sees a clean QUIT rather than a dropped socket.
      stopDispatcher()
      closeSmtpPools()
      server.close(() => process.exit(0))
    })

    // Keep process alive
    process.stdin.resume()
  } catch (error) {
    console.error('[FATAL]', error)
    process.exit(1)
  }
}

startServer()
