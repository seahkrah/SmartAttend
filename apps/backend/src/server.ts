#!/usr/bin/env node

import http from 'http'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { enforceTenantBoundaries } from './auth/tenantEnforcementMiddleware.js'
import { initializeDatabase } from './db/connection.js'
import authRoutes from './routes/auth.js'
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
import {
  apiLatencyTrackingMiddleware,
  tenantIdExtractorMiddleware,
} from './middleware/latencyTrackingMiddleware.js'
import {
  errorToIncidentHandler,
  setupUncaughtHandlers,
} from './middleware/errorToIncidentMiddleware.js'

dotenv.config()

const PORT = parseInt(process.env.PORT || '5000')
const app = express()

console.log('[STARTUP] Initializing application...')

// Setup uncaught exception handlers
setupUncaughtHandlers()

// Middleware
app.use(cors())
app.use(express.json())

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
app.use('/api/auth', authRoutes)

// Tenant-scoped routes: enforce tenant boundaries using authenticated context.
// This ensures all tenant-facing data access is automatically filtered by platform/tenant.
app.use('/api/school', enforceTenantBoundaries, schoolRoutes)
app.use('/api/corporate', enforceTenantBoundaries, corporateRoutes)
app.use('/api/attendance', enforceTenantBoundaries, attendanceRoutes)
app.use('/api/users', enforceTenantBoundaries, userRoutes)
app.use('/api/metrics', enforceTenantBoundaries, metricsRoutes)
app.use('/api/simulations', enforceTenantBoundaries, simulationsRoutes)

// Superadmin/control-plane routes remain system-scoped and already have their own guards.
app.use('/api/superadmin', superadminRoutes)
app.use('/api/v1/superadmin', superadminRoutes)
app.use('/api/incidents', incidentsRoutes)
app.use('/api/admin/incidents', incidentAdminRoutes)
app.use('/api/corrections', correctionsRoutes)
app.use('/api/validation', validationRoutes)

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
