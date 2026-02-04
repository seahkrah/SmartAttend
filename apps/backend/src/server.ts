#!/usr/bin/env node

import http from 'http'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { initializeDatabase } from './db/connection.js'
import authRoutes from './routes/auth.js'
import schoolRoutes from './routes/school.js'
import corporateRoutes from './routes/corporate.js'
import attendanceRoutes from './routes/attendance.js'
import userRoutes from './routes/users.js'
import superadminRoutes from './routes/superadmin.js'

dotenv.config()

const PORT = parseInt(process.env.PORT || '5000')
const app = express()

console.log('[STARTUP] Initializing application...')

// Middleware
app.use(cors())
app.use(express.json())

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/school', schoolRoutes)
app.use('/api/corporate', corporateRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/users', userRoutes)
app.use('/api/superadmin', superadminRoutes)
app.use('/api/v1/superadmin', superadminRoutes)

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

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
