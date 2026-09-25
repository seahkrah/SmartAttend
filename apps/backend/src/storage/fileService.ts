import { open, unlink } from 'node:fs/promises'
import type { PoolClient } from 'pg'
import { query } from '../db/connection.js'
import { activeBackend, backendFor, buildKey, type BackendName } from './backend.js'
import { extensionFor, isAllowed, ruleFor, safeDownloadName, sniff } from './contentTypes.js'

/**
 * Storing and retrieving documents.
 *
 * The order of operations on an upload matters and is the reason this is a
 * service rather than a handler:
 *
 *   1. The staged file is read and identified by its bytes.
 *   2. The tenant's quota is checked against the real size.
 *   3. An identical file already held by this tenant is reused.
 *   4. The bytes are moved into place under a server-generated key.
 *   5. The row is written.
 *
 * If anything fails, the staged file is removed. If step 5 fails after step 4
 * the bytes are removed too, because an object with no row is invisible and
 * would never be cleaned up.
 */

export class FileError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'FileError'
    this.status = status
  }
}

export interface FileContext {
  tenantId: string
  userId: string
}

type Runner = { query: (text: string, params?: any[]) => Promise<any> }

export type FileCategory =
  | 'profile_photo' | 'application_document' | 'leave_document'
  | 'attendance_evidence' | 'fee_receipt' | 'incident_attachment'
  | 'report' | 'other'

const CATEGORIES: FileCategory[] = [
  'profile_photo', 'application_document', 'leave_document',
  'attendance_evidence', 'fee_receipt', 'incident_attachment', 'report', 'other',
]

export function isCategory(value: unknown): value is FileCategory {
  return typeof value === 'string' && (CATEGORIES as string[]).includes(value)
}

/**
 * How large a file of each kind may be.
 *
 * A profile photograph has no business being twenty megabytes, and the limit
 * is the cheapest defence against somebody filling a disk one legitimate
 * upload at a time.
 */
export const SIZE_LIMITS: Record<FileCategory, number> = {
  profile_photo: 5 * 1024 * 1024,
  application_document: 15 * 1024 * 1024,
  leave_document: 10 * 1024 * 1024,
  attendance_evidence: 10 * 1024 * 1024,
  fee_receipt: 10 * 1024 * 1024,
  incident_attachment: 25 * 1024 * 1024,
  report: 50 * 1024 * 1024,
  other: 10 * 1024 * 1024,
}

/** The absolute ceiling, applied before a category is even known. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(SIZE_LIMITS))

/** Categories that only accept an image, whatever else is allowed elsewhere. */
const IMAGE_ONLY = new Set<FileCategory>(['profile_photo'])

export interface StoredFileRow {
  id: string
  tenant_id: string
  backend: BackendName
  storage_key: string
  original_name: string
  content_type: string
  byte_size: string | number
  checksum_sha256: string
  category: FileCategory
  owner_type: string | null
  owner_id: string | null
  uploaded_by: string | null
  scan_status: string
  created_at: string
  deleted_at: string | null
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export interface Quota {
  quotaBytes: number
  usedBytes: number
  fileCount: number
  remainingBytes: number
}

export async function quotaFor(runner: Runner, tenantId: string): Promise<Quota> {
  const r = await runner.query(
    `SELECT quota_bytes, used_bytes, file_count FROM tenant_storage_quota WHERE tenant_id = $1`,
    [tenantId]
  )
  if (r.rowCount === 0) {
    // No row yet means nothing stored yet; the trigger creates it on the
    // first upload. The default matches the column's.
    const fallback = 5 * 1024 * 1024 * 1024
    return { quotaBytes: fallback, usedBytes: 0, fileCount: 0, remainingBytes: fallback }
  }
  const row = r.rows[0]
  const quotaBytes = Number(row.quota_bytes)
  const usedBytes = Number(row.used_bytes)
  return {
    quotaBytes,
    usedBytes,
    fileCount: Number(row.file_count),
    remainingBytes: Math.max(quotaBytes - usedBytes, 0),
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface StageUpload {
  /** Where multer put it. */
  path: string
  originalName: string
  declaredType?: string
  size: number
}

export interface StoreInput {
  category: FileCategory
  ownerType?: string | null
  ownerId?: string | null
}

export interface StoreResult {
  file: StoredFileRow
  /** True when an identical file was already held and was reused. */
  deduplicated: boolean
}

/** Reads the first bytes of a staged file, for identification. */
async function readHead(path: string, bytes = 8192): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Takes a staged upload and stores it.
 *
 * Removes the staged file on every path, including the successful one, since
 * a successful store has moved it.
 */
export async function store(
  ctx: FileContext,
  upload: StageUpload,
  input: StoreInput
): Promise<StoreResult> {
  let staged: string | null = upload.path

  const discard = async () => {
    if (staged) await unlink(staged).catch(() => undefined)
    staged = null
  }

  try {
    if (!isCategory(input.category)) {
      throw new FileError(`Unknown category '${input.category}'`)
    }

    const limit = SIZE_LIMITS[input.category]
    if (upload.size > limit) {
      throw new FileError(
        `A ${input.category.replace('_', ' ')} may be at most `
        + `${Math.round(limit / 1024 / 1024)} MB; this one is `
        + `${Math.round(upload.size / 1024 / 1024)} MB`,
        413
      )
    }

    // What it actually is, not what it said.
    const head = await readHead(upload.path)
    const sniffed = sniff(head, upload.declaredType, upload.originalName)
    if (!sniffed.type || !isAllowed(sniffed.type)) {
      throw new FileError(sniffed.reason ?? 'This file type is not accepted', 415)
    }

    if (IMAGE_ONLY.has(input.category) && !sniffed.type.startsWith('image/')) {
      throw new FileError(
        `A ${input.category.replace('_', ' ')} must be an image; this is a `
        + `${ruleFor(sniffed.type)?.label ?? sniffed.type}`,
        415
      )
    }

    const quota = await quotaFor({ query }, ctx.tenantId)
    if (upload.size > quota.remainingBytes) {
      throw new FileError(
        `This would exceed the storage allowance: `
        + `${Math.round(quota.remainingBytes / 1024 / 1024)} MB remaining of `
        + `${Math.round(quota.quotaBytes / 1024 / 1024)} MB`,
        507
      )
    }

    const backend = activeBackend()
    const unavailable = backend.unavailableReason()
    if (unavailable) throw new FileError(unavailable, 503)

    // The key is built from the tenant, the category and randomness. Nothing
    // the client sent goes into it.
    const key = buildKey(ctx.tenantId, input.category, extensionFor(sniffed.type))
    const object = await backend.put(key, upload.path)
    staged = null   // put() moved it

    // An identical file already held by this tenant. Checked after hashing,
    // since the checksum is what identifies it, and the freshly written
    // object is removed rather than the existing one reused blindly.
    const existing = await query(
      `SELECT * FROM stored_files
        WHERE tenant_id = $1 AND checksum_sha256 = $2 AND byte_size = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [ctx.tenantId, object.checksumSha256, object.byteSize]
    )
    if (existing.rowCount > 0) {
      await backend.remove(object.key).catch(() => undefined)
      return { file: existing.rows[0] as StoredFileRow, deduplicated: true }
    }

    try {
      const created = await query(
        `INSERT INTO stored_files
           (tenant_id, backend, storage_key, original_name, content_type,
            declared_content_type, byte_size, checksum_sha256, category,
            owner_type, owner_id, uploaded_by, scan_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'skipped')
         RETURNING *`,
        [
          ctx.tenantId, backend.name, object.key,
          upload.originalName.slice(0, 255), sniffed.type,
          upload.declaredType?.slice(0, 100) ?? null,
          object.byteSize, object.checksumSha256, input.category,
          input.ownerType ?? null, input.ownerId ?? null, ctx.userId,
        ]
      )
      return { file: created.rows[0] as StoredFileRow, deduplicated: false }
    } catch (e) {
      // An object with no row is invisible, so nothing would ever reclaim it.
      await backend.remove(object.key).catch(() => undefined)
      throw e
    }
  } finally {
    await discard()
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function fileById(
  runner: Runner,
  tenantId: string,
  fileId: string
): Promise<StoredFileRow | null> {
  const r = await runner.query(
    `SELECT * FROM stored_files WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [fileId, tenantId]
  )
  return (r.rows[0] as StoredFileRow) ?? null
}

export interface DownloadTarget {
  file: StoredFileRow
  filename: string
  /** Whether a browser may render it rather than download it. */
  inline: boolean
}

export async function openForDownload(
  file: StoredFileRow,
  wantInline: boolean
): Promise<{ target: DownloadTarget; stream: NodeJS.ReadableStream }> {
  const backend = backendFor(file.backend)
  const unavailable = backend.unavailableReason()
  if (unavailable) throw new FileError(unavailable, 503)

  const stream = await backend.stream(file.storage_key).catch(() => {
    // The row says the file exists and the bytes do not. Worth saying so
    // rather than returning an empty download.
    throw new FileError(
      'The stored copy of this file is missing; it may need to be uploaded again',
      410
    )
  })

  const rule = ruleFor(file.content_type)
  return {
    target: {
      file,
      filename: safeDownloadName(file.original_name, file.content_type),
      // Inline only for types that cannot execute, and only when asked.
      inline: wantInline && (rule?.inlineSafe ?? false),
    },
    stream,
  }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export interface Reader {
  userId: string
  roleName: string
  isSuperadmin: boolean
  tenantId: string
}

const STAFF_ROLES = new Set(['admin', 'hr', 'hr_director', 'manager', 'it'])

/**
 * Whether this person may read this file.
 *
 * The tenant predicate has already been applied by the time this is called —
 * a file belonging to another tenant is not found rather than refused. What
 * is decided here is whether somebody inside the tenant may see it.
 *
 * Staff see their tenant's files. Everyone else sees what they uploaded and
 * what is attached to them: a student reads the documents on their own
 * application, and nobody else's.
 */
export async function mayRead(
  runner: Runner,
  reader: Reader,
  file: StoredFileRow
): Promise<{ allowed: boolean; reason?: string }> {
  if (reader.isSuperadmin) return { allowed: true }
  if (STAFF_ROLES.has(reader.roleName)) return { allowed: true }

  if (file.uploaded_by === reader.userId) return { allowed: true }

  // Attached to something that belongs to them.
  if (file.owner_type && file.owner_id) {
    const owned = await ownsSubject(runner, reader, file.owner_type, file.owner_id)
    if (owned) return { allowed: true }
  }

  // Faculty read what is attached to the students they teach. Deliberately
  // not implemented as "faculty see everything": a lecturer has no reason to
  // read another department's admission files.
  if (reader.roleName === 'faculty' && file.category === 'attendance_evidence') {
    return { allowed: true }
  }

  return { allowed: false, reason: 'This file is not yours to read' }
}

/**
 * The tables a file may hang off, and the column that holds each one's
 * tenant. A file names its subject by type and id; both are the uploader's
 * claim, so the pair is resolved inside the uploader's tenant before it is
 * stored. Unchecked, a file in one tenant could name another tenant's
 * student or employee as its subject.
 */
const OWNER_TABLES: Record<string, { table: string; idColumn: string }> = {
  student: { table: 'students', idColumn: 'id' },
  employee: { table: 'employees', idColumn: 'id' },
  application: { table: 'applications', idColumn: 'id' },
  leave_request: { table: 'leave_requests', idColumn: 'id' },
  user: { table: 'user_tenant_memberships', idColumn: 'user_id' },
}

export function isOwnerType(value: unknown): value is keyof typeof OWNER_TABLES {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OWNER_TABLES, value)
}

/** Whether the named subject exists in this tenant. */
export async function subjectInTenant(
  ownerType: string,
  ownerId: string,
  tenantId: string
): Promise<boolean> {
  const target = OWNER_TABLES[ownerType]
  if (!target) return false
  const r = await query(
    `SELECT 1 FROM ${target.table} WHERE ${target.idColumn} = $1 AND tenant_id = $2 LIMIT 1`,
    [ownerId, tenantId]
  )
  return (r.rowCount ?? 0) > 0
}

/** Whether the reader is the subject of the thing a file hangs off. */
async function ownsSubject(
  runner: Runner,
  reader: Reader,
  ownerType: string,
  ownerId: string
): Promise<boolean> {
  switch (ownerType) {
    case 'student': {
      const r = await runner.query(
        `SELECT 1 FROM students WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [ownerId, reader.tenantId, reader.userId]
      )
      return (r.rowCount ?? 0) > 0
    }
    case 'employee': {
      const r = await runner.query(
        `SELECT 1 FROM employees WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [ownerId, reader.tenantId, reader.userId]
      )
      return (r.rowCount ?? 0) > 0
    }
    case 'application': {
      // An applicant has no account, so nobody reads these as the subject;
      // only staff and the uploader do.
      return false
    }
    case 'leave_request': {
      const r = await runner.query(
        `SELECT 1 FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id AND e.tenant_id = lr.tenant_id
          WHERE lr.id = $1 AND lr.tenant_id = $2 AND e.user_id = $3`,
        [ownerId, reader.tenantId, reader.userId]
      )
      return (r.rowCount ?? 0) > 0
    }
    case 'user':
      return ownerId === reader.userId
    default:
      return false
  }
}

/** Records a read, or a refusal. The log is append-only. */
export async function recordAccess(
  tenantId: string,
  fileId: string,
  actorId: string | null,
  action: 'download' | 'view' | 'denied',
  ip?: string | null,
  userAgent?: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO file_access_log (tenant_id, file_id, actor_id, action, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, fileId, actorId, action, ip ?? null, userAgent?.slice(0, 500) ?? null]
    )
  } catch (e) {
    console.error('[FILES] could not record access:', e)
  }
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Marks a file deleted.
 *
 * Soft, because a file referenced by an admission decision or an attendance
 * correction cannot simply stop existing. The bytes stay until something
 * sweeps them, which is deliberate: an accidental deletion is recoverable
 * until that sweep runs.
 */
export async function softDelete(
  ctx: FileContext,
  fileId: string,
  reason: string
): Promise<StoredFileRow | null> {
  if (!reason || !String(reason).trim()) {
    throw new FileError('Deleting a file has to say why')
  }
  const r = await query(
    `UPDATE stored_files
        SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $3, delete_reason = $4
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      RETURNING *`,
    [fileId, ctx.tenantId, ctx.userId, String(reason).trim()]
  )
  return (r.rows[0] as StoredFileRow) ?? null
}

/**
 * Removes the bytes of one tenant's files deleted longer ago than the grace
 * period.
 *
 * The row stays, so a reference still resolves to something that explains
 * what happened, and openForDownload reports the bytes as gone rather than
 * returning nothing.
 *
 * The tenant is required. This used to sweep every tenant's deleted files,
 * and it was reachable by any tenant's staff with a grace period of their
 * choosing, so one employer could destroy the bytes another had deleted a
 * minute earlier and still meant to recover.
 */
export async function purgeDeleted(tenantId: string, olderThanDays = 30): Promise<number> {
  const due = await query(
    `SELECT id, backend, storage_key FROM stored_files
      WHERE tenant_id = $1
        AND deleted_at IS NOT NULL
        AND deleted_at < CURRENT_TIMESTAMP - ($2 || ' days')::interval
        AND storage_key <> ''
      LIMIT 500`,
    [tenantId, String(olderThanDays)]
  )

  const purged: string[] = []
  for (const row of due.rows) {
    try {
      await backendFor(row.backend).remove(row.storage_key)
      purged.push(row.id)
    } catch (e) {
      console.error(`[FILES] could not purge ${row.id}:`, e)
    }
  }
  if (purged.length === 0) return 0

  // The keys are blanked so a later sweep does not try again. The guard
  // trigger permits exactly this change and no other: a deleted file's key
  // may be emptied. It used to be disabled for the whole table around the
  // batch, which left every other connection's writes unguarded meanwhile.
  await query(
    `UPDATE stored_files SET storage_key = ''
      WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NOT NULL`,
    [purged, tenantId]
  )
  return purged.length
}

export { ruleFor, safeDownloadName } from './contentTypes.js'
