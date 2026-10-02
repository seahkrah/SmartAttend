/**
 * Face templates at rest.
 *
 * A template is sealed with AES-256-GCM under a key held in the environment,
 * never in the database, so a copy of the database alone does not yield
 * anyone's face descriptor. GCM authenticates as well as encrypts: a template
 * altered in the database fails to open rather than matching someone else.
 * The tenant, subject and model are bound in as associated data, so a
 * ciphertext moved to another person's row fails to open too.
 *
 * Keys are versioned. BIOMETRIC_TEMPLATE_KEY is the current key (version from
 * BIOMETRIC_TEMPLATE_KEY_VERSION, default 1); BIOMETRIC_TEMPLATE_KEY_PREVIOUS
 * with BIOMETRIC_TEMPLATE_KEY_PREVIOUS_VERSION lets templates sealed under the
 * last key still open during a rotation.
 */
import crypto from 'crypto'
import { openForTenant, sealForTenant, tenantKeysConfigured } from '../security/kms/dataKeys.js'

export class BiometricKeyError extends Error {}

interface Key { version: number; key: Buffer }

function parseKey(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const buf = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64')
  if (buf.length !== 32) {
    throw new BiometricKeyError(`${name} must be 32 bytes, as 64 hex characters or base64`)
  }
  return buf
}

function keys(): { current: Key | null; previous: Key | null } {
  const current = parseKey(process.env.BIOMETRIC_TEMPLATE_KEY, 'BIOMETRIC_TEMPLATE_KEY')
  const previous = parseKey(process.env.BIOMETRIC_TEMPLATE_KEY_PREVIOUS, 'BIOMETRIC_TEMPLATE_KEY_PREVIOUS')
  return {
    current: current ? { version: Number(process.env.BIOMETRIC_TEMPLATE_KEY_VERSION ?? 1), key: current } : null,
    previous: previous
      ? { version: Number(process.env.BIOMETRIC_TEMPLATE_KEY_PREVIOUS_VERSION ?? 0), key: previous }
      : null,
  }
}

/** Whether templates can be sealed at all. Without a key, face matching is off. */
export function templateKeyConfigured(): boolean {
  try {
    return keys().current !== null
  } catch {
    return false
  }
}

export interface Sealed {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
  keyVersion: number
}

export function sealTemplate(descriptor: Float32Array, context: string): Sealed {
  const { current } = keys()
  if (!current) throw new BiometricKeyError('BIOMETRIC_TEMPLATE_KEY is not configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const plain = Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: current.version }
}

export function openTemplate(sealed: Sealed, context: string): Float32Array {
  const { current, previous } = keys()
  const key = [current, previous].find((k) => k && k.version === sealed.keyVersion)
  if (!key) throw new BiometricKeyError(`No key for template key version ${sealed.keyVersion}`)
  // Pinned tag length: Node otherwise accepts a truncated (forgeable) tag.
  const decipher = crypto.createDecipheriv('aes-256-gcm', key.key, sealed.iv, { authTagLength: 16 })
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(sealed.authTag)
  const plain = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()])
  return new Float32Array(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength))
}

/** What a template is bound to. Changing any part makes it unopenable. */
export function templateContext(tenantId: string, subjectType: string, subjectId: string, model: string): string {
  return `face-template:v1:${tenantId}:${subjectType}:${subjectId}:${model}`
}

// ── Per-tenant data keys (migration 072) ───────────────────────────────────
// When a KMS is configured, new templates are sealed under the tenant's own
// data key: a template copied into another tenant's row fails twice over,
// on the bound context and on the key. Templates sealed before that, under
// BIOMETRIC_TEMPLATE_KEY, keep opening: dekVersion null says which scheme.

export interface StoredTemplate extends Sealed {
  dekVersion: number | null
}

const PURPOSE = 'face_template'

export async function sealTemplateForStorage(tenantId: string, descriptor: Float32Array, context: string): Promise<StoredTemplate> {
  if (!tenantKeysConfigured()) return { ...sealTemplate(descriptor, context), dekVersion: null }
  const plain = Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength)
  const s = await sealForTenant(tenantId, PURPOSE, plain, context)
  return { ciphertext: s.ciphertext, iv: s.iv, authTag: s.authTag, keyVersion: 0, dekVersion: s.dekVersion }
}

export async function openStoredTemplate(tenantId: string, stored: StoredTemplate, context: string): Promise<Float32Array> {
  if (stored.dekVersion === null || stored.dekVersion === undefined) return openTemplate(stored, context)
  const plain = await openForTenant(
    tenantId,
    PURPOSE,
    { ciphertext: stored.ciphertext, iv: stored.iv, authTag: stored.authTag, dekVersion: stored.dekVersion },
    context,
  )
  return new Float32Array(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength))
}
