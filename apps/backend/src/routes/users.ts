import { Router } from 'express'

const router = Router()

// GET all users
router.get('/', (req, res) => {
  res.json({ message: 'Users fetched', data: [] })
})

// POST create user
router.post('/', (req, res) => {
  const { name, email, role, platform } = req.body
  res.json({ message: 'User created', data: { name, email, role, platform } })
})

// GET user by ID
router.get('/:userId', (req, res) => {
  const { userId } = req.params
  res.json({ message: `User ${userId}`, data: {} })
})


export default router
