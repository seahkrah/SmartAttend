import express from 'express'
import cors from 'cors'

const app = express()

app.use(cors())
app.use(express.json())

// Test POST endpoint
app.post('/test', (req, res) => {
  console.log('[TEST] POST request received')
  res.json({ message: 'Test works' })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

const PORT = 5000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Listening on port ${PORT}`)
})
