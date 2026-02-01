#!/usr/bin/env node

import http from 'http'

const PORT = 5555

const server = http.createServer((req, res) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', port: PORT }))
})

console.log(`[STARTUP] Starting minimal HTTP server on port ${PORT}...`)

server.listen(PORT, 'localhost', () => {
  const addr = server.address()
  console.log(`[SERVER] Listening on:`, addr)
  console.log(`[SERVER] Try: curl http://127.0.0.1:${PORT}`)
})

server.on('error', (err) => {
  console.error('[ERROR]', err)
  process.exit(1)
})
