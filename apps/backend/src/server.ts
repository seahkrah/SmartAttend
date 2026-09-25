#!/usr/bin/env node

import http from 'http'
import express from 'express'
import dotenv from 'dotenv'
import { initializeDatabase } from './db/connection.js'
import { applyHttpSecurity } from './security/httpSecurity.js'
import { validateProductionConfig } from './config/validateEnv.js'
import authRoutes from './routes/auth.js'
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

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  next();
});

// Routes
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
app.use('/api/notifications', notificationRoutes)
app.use('/api/files', fileRoutes)
app.use('/api/biometrics', biometricsRoutes)
app.use('/api/audit', auditRoutes)
app.use('/api/time', timeRoutes)

// Error handling middleware (MUST be last)
app.use(errorToIncidentHandler)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

async function startServer() {
  try {
    console.log('[STARTUP] Connecting to database...')
    console.log(`[STARTUP] Using port ${PORT}`)
    await initializeDatabase()
    console.log('[DB] ✓ Connected')

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
