/**
 * Per-tenant data keys: envelope encryption over the KMS.
 *
 * A tenant's data key for a purpose is created on first use, stored only
 * wrapped (table tenant_data_keys, migration 072), and unwrapped through the
 * KMS when needed, with a short in-memory cache so a burst of check-ins does
 * not mean a burst of KMS calls. Sealing uses the newest unretired version;
 * opening uses the version the ciphertext names.
 *
 * Bound to the tenant twice over: the rows sit under row-level security, and
 * a request bound to tenant A that asks for tenant B's key is refused here.
 */
import crypto from 'crypto'
import { query } from '../../db/connection.js'
import { currentDbContext } from '../../db/dbContext.js'
import { kmsFromEnv, KmsError, type Kms } from './index.js'

export interface TenantSealed {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
  dekVersion: number
}

const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 2000
// The in-flight unwrap is cached, not only its result, so forty templates
// opened at once for one class share one KMS call.
const cache = new Map<string, { key: Promise<Buffer>; at: number }>()

function requireKms(): Kms {
  const kms = kmsFromEnv()
  if (!kms) throw new KmsError('No KMS is configured (KMS_BACKEND); per-tenant data keys are unavailable')
  return kms
}

/** Whether per-tenant data keys can be used at all. */
export function tenantKeysConfigured(): boolean {
  try {
    return kmsFromEnv() !== null
  } catch {
    return false
  }
}

function assertTenant(tenantId: string) {
  const ctx = currentDbContext()
  if (ctx.mode === 'tenant' && ctx.tenantId !== tenantId) {
    throw new KmsError("Refusing another tenant's data key in this tenant's context")
  }
}

async function unwrapRow(tenantId: string, purpose: string, row: { version: number; kms: string; wrapped_key: string }) {
  const cacheKey = `${tenantId}:${purpose}:${row.version}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.key
  const key = requireKms().unwrap({ kms: row.kms, blob: row.wrapped_key }, { tenantId, purpose })
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(cacheKey, { key, at: Date.now() })
  // A failed unwrap is not remembered.
  key.catch(() => cache.delete(cacheKey))
  return key
}

async function createVersion(tenantId: string, purpose: string, version: number) {
  const kms = requireKms()
  const dataKey = crypto.randomBytes(32)
  const wrapped = await kms.wrap(dataKey, { tenantId, purpose })
  // ON CONFLICT: two requests creating the first key at once. The loser
  // reads the winner's.
  await query(
    `INSERT INTO tenant_data_keys (tenant_id, purpose, version, kms, wrapped_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, purpose, version) DO NOTHING`,
    [tenantId, purpose, version, wrapped.kms, wrapped.blob],
  )
}

/** The newest unretired data key, created if the tenant has none yet. */
export async function activeDataKey(tenantId: string, purpose: string): Promise<{ version: number; key: Buffer }> {
  assertTenant(tenantId)
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await query(
      `SELECT version, kms, wrapped_key FROM tenant_data_keys
        WHERE tenant_id = $1 AND purpose = $2 AND retired_at IS NULL
        ORDER BY version DESC LIMIT 1`,
      [tenantId, purpose],
    )
    if (r.rows.length) return { version: r.rows[0].version, key: await unwrapRow(tenantId, purpose, r.rows[0]) }
    await createVersion(tenantId, purpose, 1)
  }
  throw new KmsError('Could not create a data key')
}

/** A specific version, retired or not: what opens data it sealed. */
export async function dataKeyVersion(tenantId: string, purpose: string, version: number): Promise<Buffer> {
  assertTenant(tenantId)
  const r = await query(
    `SELECT version, kms, wrapped_key FROM tenant_data_keys WHERE tenant_id = $1 AND purpose = $2 AND version = $3`,
    [tenantId, purpose, version],
  )
  if (!r.rows.length) throw new KmsError(`No data key version ${version} for this tenant`)
  return unwrapRow(tenantId, purpose, r.rows[0])
}

/** Starts a new version. Older versions still open what they sealed until retired. */
export async function rotateDataKey(tenantId: string, purpose: string): Promise<number> {
  assertTenant(tenantId)
  const r = await query(
    `SELECT coalesce(max(version), 0) AS v FROM tenant_data_keys WHERE tenant_id = $1 AND purpose = $2`,
    [tenantId, purpose],
  )
  const next = Number(r.rows[0].v) + 1
  await createVersion(tenantId, purpose, next)
  return next
}

/** AES-256-GCM under the tenant's active data key; aad binds what it is about. */
export async function sealForTenant(tenantId: string, purpose: string, plaintext: Buffer, aad: string): Promise<TenantSealed> {
  const { version, key } = await activeDataKey(tenantId, purpose)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag(), dekVersion: version }
}

export async function openForTenant(tenantId: string, purpose: string, sealed: TenantSealed, aad: string): Promise<Buffer> {
  const key = await dataKeyVersion(tenantId, purpose, sealed.dekVersion)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.iv, { authTagLength: 16 })
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(sealed.authTag)
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()])
}

/** For tests: forget unwrapped keys. */
export function clearDataKeyCache(): void {
  cache.clear()
}
