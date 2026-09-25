/**
 * /api/biometrics — face matching.
 *
 * The client sends camera images; the server finds the face, describes it and
 * decides. See src/biometrics/service.ts for who may do what, and
 * docs/features/face-matching.md for what the check does and does not prove.
 *
 *   GET    /settings                       whether it is on, and the threshold
 *   PUT    /settings                       administrator
 *   GET    /subjects?type=&search=         people and their status, administrators
 *   GET    /subjects/:type/:id             consent and enrolment status
 *   POST   /subjects/:type/:id/consent     record consent { basis }
 *   DELETE /subjects/:type/:id/consent     withdraw it (deletes the template)
 *   DELETE /subjects/:type/:id/template    delete the template, keep consent
 *   POST   /challenges                     { purpose, subjectType?, subjectId?, scheduleId? }
 *   POST   /enroll                         multipart: challengeId, frames[]
 *   POST   /verify                         multipart: challengeId, frames[]
 *   POST   /identify                       multipart: challengeId, frames[]
 *   GET    /events                         the log, administrators
 */
import { Router, Response, NextFunction } from 'express'
import multer from 'multer'
import { authenticateToken } from '../auth/middleware.js'
import { resolveTenantContext, requireTenant, type TenantRequest } from '../auth/tenantContextMiddleware.js'
import {
  BiometricError, deleteTemplate, enroll, getSettings, grantConsent, identifyInClass, issueChallenge,
  listEvents, listSubjects, saveSettings, subjectStatus, verify, withdrawConsent, type Subject, type SubjectType,
} from '../biometrics/service.js'
import { IMAGE_LIMITS } from '../biometrics/engine.js'
import { BiometricKeyError } from '../biometrics/templateCrypto.js'

const router = Router()
router.use(authenticateToken, resolveTenantContext, requireTenant)

// Images are held in memory for the length of the request and never written
// to disk or kept: only the encrypted descriptor survives an enrolment.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_LIMITS.maxBytes, files: 5, fields: 5, fieldSize: 1024 },
})

function ctxOf(req: TenantRequest) {
  return req.ctx as NonNullable<TenantRequest['ctx']> & { tenantId: string }
}

function fail(res: Response, e: unknown) {
  if (e instanceof BiometricError) {
    return res.status(e.status).json({ error: e.message, code: e.code })
  }
  if (e instanceof BiometricKeyError) {
    console.error('[BIOMETRICS] key problem:', e.message)
    return res.status(503).json({ error: 'Face matching is not available on this server', code: 'not_configured' })
  }
  if ((e as any)?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Each image must be at most 2 MB', code: 'too_large' })
  }
  if ((e as any)?.code === 'LIMIT_FILE_COUNT' || (e as any)?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Send between 2 and 5 images in a field named "frames"', code: 'bad_frames' })
  }
  console.error('[BIOMETRICS]', e)
  return res.status(500).json({ error: 'The face check could not be completed' })
}

function subjectOf(req: TenantRequest): Subject {
  const type = req.params.type as SubjectType
  if (type !== 'student' && type !== 'employee') {
    throw new BiometricError(404, 'not_found', 'No such person in this organisation')
  }
  return { type, id: String(req.params.id) }
}

/** multer errors arrive through next(err); turn them into the same answers. */
function frames(req: TenantRequest, res: Response, next: NextFunction) {
  upload.array('frames', 5)(req as any, res as any, (err: unknown) => (err ? fail(res, err) : next()))
}

function framesOf(req: TenantRequest): Buffer[] {
  const files = ((req as any).files ?? []) as Array<{ buffer: Buffer }>
  if (files.length < 2) throw new BiometricError(400, 'bad_frames', 'Send between 2 and 5 images in a field named "frames"')
  return files.map((f) => f.buffer)
}

router.get('/settings', async (req: TenantRequest, res: Response) => {
  try {
    return res.json({ settings: await getSettings(ctxOf(req).tenantId) })
  } catch (e) {
    return fail(res, e)
  }
})

router.put('/settings', async (req: TenantRequest, res: Response) => {
  try {
    const { enabled, threshold } = req.body ?? {}
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be true or false' })
    }
    return res.json({ settings: await saveSettings(ctxOf(req), enabled, Number(threshold ?? 0.5)) })
  } catch (e) {
    return fail(res, e)
  }
})

router.get('/subjects', async (req: TenantRequest, res: Response) => {
  try {
    const type = String(req.query.type ?? '') as SubjectType
    if (type !== 'student' && type !== 'employee') {
      return res.status(400).json({ error: 'type must be student or employee' })
    }
    return res.json(await listSubjects(ctxOf(req), type, {
      search: req.query.search as string | undefined,
      limit: Number(req.query.limit),
      offset: Number(req.query.offset),
    }))
  } catch (e) {
    return fail(res, e)
  }
})

router.get('/subjects/:type/:id', async (req: TenantRequest, res: Response) => {
  try {
    return res.json(await subjectStatus(ctxOf(req), subjectOf(req)))
  } catch (e) {
    return fail(res, e)
  }
})

router.post('/subjects/:type/:id/consent', async (req: TenantRequest, res: Response) => {
  try {
    const consent = await grantConsent(ctxOf(req), subjectOf(req), req.body?.basis)
    return res.status(201).json({ consent: { grantedAt: consent.granted_at, basis: consent.basis } })
  } catch (e) {
    return fail(res, e)
  }
})

router.delete('/subjects/:type/:id/consent', async (req: TenantRequest, res: Response) => {
  try {
    await withdrawConsent(ctxOf(req), subjectOf(req), req.body?.reason)
    return res.json({ withdrawn: true, templateDeleted: true })
  } catch (e) {
    return fail(res, e)
  }
})

router.delete('/subjects/:type/:id/template', async (req: TenantRequest, res: Response) => {
  try {
    await deleteTemplate(ctxOf(req), subjectOf(req))
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, e)
  }
})

router.post('/challenges', async (req: TenantRequest, res: Response) => {
  try {
    const { purpose, subjectType, subjectId, scheduleId } = req.body ?? {}
    const subject = subjectType && subjectId ? { type: subjectType, id: String(subjectId) } as Subject : undefined
    if (subject && subject.type !== 'student' && subject.type !== 'employee') {
      return res.status(400).json({ error: 'subjectType must be student or employee' })
    }
    const ch = await issueChallenge(ctxOf(req), purpose, { subject, scheduleId })
    return res.status(201).json(ch)
  } catch (e) {
    return fail(res, e)
  }
})

router.post('/enroll', frames, async (req: TenantRequest, res: Response) => {
  try {
    const out = await enroll(ctxOf(req), req.body?.challengeId, framesOf(req))
    return res.status(201).json({ enrolled: true, ...out })
  } catch (e) {
    return fail(res, e)
  }
})

router.post('/verify', frames, async (req: TenantRequest, res: Response) => {
  try {
    return res.json({ matched: true, ...(await verify(ctxOf(req), req.body?.challengeId, framesOf(req))) })
  } catch (e) {
    return fail(res, e)
  }
})

router.post('/identify', frames, async (req: TenantRequest, res: Response) => {
  try {
    return res.json({ matched: true, ...(await identifyInClass(ctxOf(req), req.body?.challengeId, framesOf(req))) })
  } catch (e) {
    return fail(res, e)
  }
})

router.get('/events', async (req: TenantRequest, res: Response) => {
  try {
    const subject = req.query.subjectType && req.query.subjectId
      ? { type: String(req.query.subjectType) as SubjectType, id: String(req.query.subjectId) }
      : undefined
    return res.json({ events: await listEvents(ctxOf(req), { limit: Number(req.query.limit), subject }) })
  } catch (e) {
    return fail(res, e)
  }
})

export default router
