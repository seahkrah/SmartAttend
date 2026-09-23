import { Router, Response, NextFunction } from 'express'
import multer from 'multer'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  FileError,
  MAX_UPLOAD_BYTES,
  isCategory,
  fileById,
  mayRead,
  openForDownload,
  purgeDeleted,
  quotaFor,
  recordAccess,
  softDelete,
  store,
  type FileCategory,
} from '../storage/fileService.js'
import { ALLOWED } from '../storage/contentTypes.js'
import { getClientIp } from '../utils/getClientIp.js'

/**
 * Documents.
 *
 * Fourteen columns in this schema hold a file URL and nothing has ever been
 * behind any of them. This is the storage they were waiting for.
 *
 * The download route is the dangerous one, and the headers it sets are the
 * whole defence:
 *
 *   Content-Type is the sniffed type, never the uploader's claim.
 *   X-Content-Type-Options: nosniff stops a browser second-guessing it.
 *   Content-Disposition is attachment unless the type cannot execute, and the
 *     filename is rebuilt from the sniffed type so a .pdf that turned out to
 *     be a PNG does not download as a PDF.
 *   Content-Security-Policy: sandbox neutralises anything that slipped
 *     through, since a sandboxed document has no origin to act against.
 *
 * Together these mean a stored file cannot become script running on this
 * application's origin, which is the failure mode a document store has.
 */

const router = Router()

// Staged to a temp directory and moved into place only once the bytes have
// been identified. Memory storage would mean a 50 MB upload held in the heap
// per concurrent request.
const STAGING = join(tmpdir(), 'jjelotech-uploads')
await mkdir(STAGING, { recursive: true }).catch(() => undefined)

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STAGING),
    // multer's own name, not the client's: nothing a caller sent reaches the
    // filesystem even in staging.
    filename: (_req, _file, cb) =>
      cb(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`),
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    // A multipart body with thousands of fields is a cheap way to burn CPU.
    fields: 12,
    parts: 16,
  },
})

router.use(authenticateToken, resolveTenantContext, requireTenant)

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const staff = requireRoles('admin', 'hr', 'hr_director', 'manager', 'it')

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof FileError) return res.status(e.status).json({ error: e.message })

  const err = e as { code?: string; message?: string }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `A file may be at most ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
    })
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Send exactly one file, in a field named "file"' })
  }
  if (err.code === '23505') return res.status(409).json({ error: 'That file already exists' })
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  console.error(`[FILES] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

/**
 * Loads the path's file, scoped to the tenant.
 *
 * A file belonging to another tenant is not found. That is the only answer
 * that does not confirm it exists.
 */
router.param('fileId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    if (!UUID.test(id)) return notFound(res, 'File')
    const row = await fileById({ query }, ctxOf(req).tenantId, id)
    if (!row) return notFound(res, 'File')
    ;(req as any).storedFile = row
    return next()
  } catch (e) {
    return fail(res, 'load that file', e)
  }
})

// ===========================================================================
// What may be uploaded
// ===========================================================================

/** So a client can tell somebody what is accepted before they try. */
router.get('/limits', async (req: TenantRequest, res: Response) => {
  try {
    const { SIZE_LIMITS } = await import('../storage/fileService.js')
    return res.json({
      accepted: ALLOWED.map((r) => ({
        contentType: r.type,
        extensions: r.extensions,
        label: r.label,
      })),
      // Said explicitly, because "why was my logo rejected" is the first
      // question an administrator asks.
      refused: [
        { extensions: ['svg', 'html', 'htm'],
          reason: 'These run script in a browser and cannot be served safely' },
        { extensions: ['zip', 'exe', 'sh', 'bat'],
          reason: 'Archives and executables are not accepted' },
      ],
      maxBytesByCategory: SIZE_LIMITS,
      quota: await quotaFor({ query }, ctxOf(req).tenantId),
    })
  } catch (e) {
    return fail(res, 'load upload limits', e)
  }
})

// ===========================================================================
// Upload
// ===========================================================================

router.post('/', upload.single('file'), async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const file = (req as any).file as
      { path: string; originalname: string; mimetype?: string; size: number } | undefined

    if (!file) {
      return res.status(400).json({ error: 'Send a file in a field named "file"' })
    }

    const category = (req.body ?? {}).category
    if (!isCategory(category)) {
      return res.status(400).json({
        error: 'A valid category is required',
        categories: [
          'profile_photo', 'application_document', 'leave_document',
          'attendance_evidence', 'fee_receipt', 'incident_attachment',
          'report', 'other',
        ],
      })
    }

    const ownerId = (req.body ?? {}).ownerId
    if (ownerId && !UUID.test(String(ownerId))) {
      return res.status(400).json({ error: 'ownerId must be an identifier' })
    }

    const result = await store(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      {
        path: file.path,
        originalName: file.originalname,
        declaredType: file.mimetype,
        size: file.size,
      },
      {
        category: category as FileCategory,
        ownerType: (req.body ?? {}).ownerType || null,
        ownerId: ownerId || null,
      }
    )

    return res.status(201).json({
      file: publicShape(result.file),
      deduplicated: result.deduplicated,
      downloadUrl: `/api/files/${result.file.id}/download`,
    })
  } catch (e) {
    return fail(res, 'store that file', e)
  }
})

/** What a caller sees. The storage key is never among it. */
function publicShape(file: any) {
  return {
    id: file.id,
    name: file.original_name,
    contentType: file.content_type,
    byteSize: Number(file.byte_size),
    category: file.category,
    ownerType: file.owner_type,
    ownerId: file.owner_id,
    uploadedBy: file.uploaded_by,
    scanStatus: file.scan_status,
    createdAt: file.created_at,
    downloadUrl: `/api/files/${file.id}/download`,
  }
}

// ===========================================================================
// Listing
// ===========================================================================

router.get('/', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const category = typeof req.query.category === 'string' ? req.query.category : null
    const ownerType = typeof req.query.ownerType === 'string' ? req.query.ownerType : null
    const ownerId = typeof req.query.ownerId === 'string' && UUID.test(req.query.ownerId)
      ? req.query.ownerId : null
    const limit = Math.min(Number(req.query.limit) || 100, 500)

    const isStaff = ctx.isSuperadmin
      || ['admin', 'hr', 'hr_director', 'manager', 'it'].includes(ctx.roleName)

    // Someone who is not staff sees what they uploaded. Anything else they
    // are entitled to, they reach through the thing it is attached to.
    const rows = await query(
      `SELECT f.*, u.full_name AS uploaded_by_name
         FROM stored_files f
         LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.tenant_id = $1
          AND f.deleted_at IS NULL
          AND ($2::boolean IS TRUE OR f.uploaded_by = $3)
          AND ($4::text IS NULL OR f.category = $4::text)
          AND ($5::text IS NULL OR f.owner_type = $5::text)
          AND ($6::uuid IS NULL OR f.owner_id = $6::uuid)
        ORDER BY f.created_at DESC
        LIMIT $7`,
      [ctx.tenantId, isStaff, ctx.userId, category, ownerType, ownerId, limit]
    )

    return res.json({
      files: rows.rows.map((r: any) => ({
        ...publicShape(r),
        uploadedByName: r.uploaded_by_name,
      })),
      quota: await quotaFor({ query }, ctx.tenantId),
    })
  } catch (e) {
    return fail(res, 'load files', e)
  }
})

router.get('/:fileId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const file = (req as any).storedFile

    const verdict = await mayRead({ query }, {
      userId: ctx.userId, roleName: ctx.roleName,
      isSuperadmin: ctx.isSuperadmin, tenantId: ctx.tenantId,
    }, file)
    if (!verdict.allowed) {
      await recordAccess(ctx.tenantId, file.id, ctx.userId, 'denied',
        getClientIp(req), req.get('user-agent'))
      return res.status(403).json({ error: verdict.reason })
    }

    return res.json({ file: publicShape(file) })
  } catch (e) {
    return fail(res, 'load that file', e)
  }
})

// ===========================================================================
// Download
// ===========================================================================

/**
 * Sends the bytes.
 *
 * Every header here is load-bearing. Changing any of them turns a document
 * store into a way to run script on this application's origin.
 */
router.get('/:fileId/download', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const file = (req as any).storedFile

    const verdict = await mayRead({ query }, {
      userId: ctx.userId, roleName: ctx.roleName,
      isSuperadmin: ctx.isSuperadmin, tenantId: ctx.tenantId,
    }, file)
    if (!verdict.allowed) {
      await recordAccess(ctx.tenantId, file.id, ctx.userId, 'denied',
        getClientIp(req), req.get('user-agent'))
      return res.status(403).json({ error: verdict.reason })
    }

    const wantInline = req.query.inline === 'true'
    const { target, stream } = await openForDownload(file, wantInline)

    // The sniffed type, never the uploader's claim.
    res.setHeader('Content-Type', file.content_type)
    res.setHeader('Content-Length', String(file.byte_size))
    // Stops a browser deciding for itself that this PNG is really HTML.
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // A sandboxed document has no origin to act against, so anything that
    // got past the sniffer still cannot reach cookies or the DOM of the app.
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
    res.setHeader('X-Frame-Options', 'DENY')
    // Stored documents are per-user; a shared cache must not hold them.
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader(
      'Content-Disposition',
      `${target.inline ? 'inline' : 'attachment'}; `
      + `filename="${target.filename}"; `
      + `filename*=UTF-8''${encodeURIComponent(target.filename)}`
    )

    await recordAccess(ctx.tenantId, file.id, ctx.userId,
      target.inline ? 'view' : 'download', getClientIp(req), req.get('user-agent'))

    stream.on('error', (e: Error) => {
      console.error(`[FILES] stream failed for ${file.id}:`, e)
      // Headers are already sent by this point, so the only honest thing left
      // is to cut the connection rather than append an error to the bytes.
      res.destroy()
    })
    return stream.pipe(res)
  } catch (e) {
    return fail(res, 'download that file', e)
  }
})

/** Who has read this file. Staff only: it names people. */
router.get('/:fileId/access-log', staff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const file = (req as any).storedFile
    const rows = await query(
      `SELECT a.action, a.ip_address, a.occurred_at, u.full_name AS actor_name
         FROM file_access_log a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.file_id = $1 AND a.tenant_id = $2
        ORDER BY a.occurred_at DESC
        LIMIT 200`,
      [file.id, ctx.tenantId]
    )
    return res.json({ access: rows.rows })
  } catch (e) {
    return fail(res, 'load the access log', e)
  }
})

// ===========================================================================
// Deletion
// ===========================================================================

router.delete('/:fileId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const file = (req as any).storedFile

    const isStaff = ctx.isSuperadmin
      || ['admin', 'hr', 'hr_director', 'manager', 'it'].includes(ctx.roleName)
    if (!isStaff && file.uploaded_by !== ctx.userId) {
      return res.status(403).json({ error: 'This file is not yours to delete' })
    }

    const reason = (req.body ?? {}).reason || 'Deleted by the uploader'
    const deleted = await softDelete(
      { tenantId: ctx.tenantId, userId: ctx.userId }, file.id, reason
    )
    if (!deleted) return notFound(res, 'File')

    return res.json({
      deleted: true,
      // Said plainly, because "deleted" meaning two different things is how
      // somebody concludes their data is gone when it is not, or vice versa.
      note: 'The record is kept so references to it still resolve; the stored '
        + 'copy is removed when deleted files are next swept.',
    })
  } catch (e) {
    return fail(res, 'delete that file', e)
  }
})

/** Removes the bytes of files deleted long enough ago. Administrators only. */
router.post('/purge', staff, async (req: TenantRequest, res: Response) => {
  try {
    const days = Number((req.body ?? {}).olderThanDays)
    const purged = await purgeDeleted(Number.isFinite(days) && days >= 0 ? days : 30)
    return res.json({ purged })
  } catch (e) {
    return fail(res, 'purge deleted files', e)
  }
})

export default router
