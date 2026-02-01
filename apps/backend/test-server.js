import express from 'express'

const app = express()
const PORT = 3000

console.log('[TEST] Creating server...')
app.get('/health', (req, res) => {
  console.log('[TEST] Health endpoint hit')
  res.json({ status: 'ok' })
})

console.log('[TEST] Starting server...')
const server = app.listen(PORT, () => {
  console.log(`[TEST] Server running on port ${PORT}`)
  console.log('[TEST] Try: curl http://localhost:3000/health')
})

server.on('error', (err) => {
  console.error('[TEST] Server error:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[TEST] Unhandled rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[TEST] Uncaught exception:', err)
})
