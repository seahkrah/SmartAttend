/**
 * Key-encryption keys (KEKs), behind one interface.
 *
 * A KMS wraps and unwraps data keys; it never sees the data. Each wrap is
 * bound to a context (tenant and purpose), so a wrapped key copied into
 * another tenant's row does not unwrap there.
 *
 *   KMS_BACKEND=local          KMS_LOCAL_KEK (32 bytes, hex or base64) or
 *                              KMS_LOCAL_KEK_FILE: for development and
 *                              single-host deployments; the KEK must live
 *                              outside the database and its backups.
 *   KMS_BACKEND=vault-transit  VAULT_ADDR, VAULT_TOKEN, VAULT_TRANSIT_KEY
 *                              (HashiCorp Vault's transit engine, with
 *                              derived keys so the context binds the wrap).
 *
 * A cloud KMS (AWS, GCP, Azure) is another implementation of this interface;
 * it needs an account, which is owner action OA-8.
 */
import crypto from 'crypto'
import fs from 'fs'

export interface WrappedKey {
  /** Which KMS and key wrapped it, so a later reader knows where to ask. */
  kms: string
  /** Opaque to callers. */
  blob: string
}

export type KeyContext = { tenantId: string; purpose: string }

export interface Kms {
  readonly id: string
  wrap(dataKey: Buffer, context: KeyContext): Promise<WrappedKey>
  unwrap(wrapped: WrappedKey, context: KeyContext): Promise<Buffer>
}

export class KmsError extends Error {}

function contextBytes(context: KeyContext): Buffer {
  return Buffer.from(`dek:v1:${context.tenantId}:${context.purpose}`, 'utf8')
}

function parse32(raw: string, name: string): Buffer {
  const t = raw.trim()
  const buf = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64')
  if (buf.length !== 32) throw new KmsError(`${name} must be 32 bytes, as 64 hex characters or base64`)
  return buf
}

/** AES-256-GCM under a KEK held in memory, from the environment or a file. */
export class LocalKms implements Kms {
  readonly id: string
  constructor(private readonly kek: Buffer) {
    // A fingerprint, not the key: says which KEK wrapped a data key.
    this.id = `local:${crypto.createHash('sha256').update(kek).digest('hex').slice(0, 16)}`
  }

  async wrap(dataKey: Buffer, context: KeyContext): Promise<WrappedKey> {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.kek, iv, { authTagLength: 16 })
    cipher.setAAD(contextBytes(context))
    const ct = Buffer.concat([cipher.update(dataKey), cipher.final()])
    return { kms: this.id, blob: Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64') }
  }

  async unwrap(wrapped: WrappedKey, context: KeyContext): Promise<Buffer> {
    if (wrapped.kms !== this.id) throw new KmsError(`Data key was wrapped by ${wrapped.kms}, not by this KEK`)
    const raw = Buffer.from(wrapped.blob, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.kek, raw.subarray(0, 12), { authTagLength: 16 })
    decipher.setAAD(contextBytes(context))
    decipher.setAuthTag(raw.subarray(12, 28))
    try {
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
    } catch {
      throw new KmsError('Data key does not unwrap in this context')
    }
  }
}

/**
 * HashiCorp Vault transit. The transit key must be created with
 * `derived=true`, so the context is part of the key derivation and a
 * wrapped key only unwraps under the same tenant and purpose.
 */
export class VaultTransitKms implements Kms {
  readonly id: string
  constructor(
    private readonly addr: string,
    private readonly token: string,
    private readonly keyName: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.id = `vault-transit:${keyName}`
  }

  private async call(op: 'encrypt' | 'decrypt', body: Record<string, string>) {
    const res = await this.fetchImpl(`${this.addr.replace(/\/$/, '')}/v1/transit/${op}/${encodeURIComponent(this.keyName)}`, {
      method: 'POST',
      headers: { 'X-Vault-Token': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new KmsError(`Vault transit ${op} failed: ${res.status}`)
    return ((await res.json()) as { data: Record<string, string> }).data
  }

  async wrap(dataKey: Buffer, context: KeyContext): Promise<WrappedKey> {
    const data = await this.call('encrypt', {
      plaintext: dataKey.toString('base64'),
      context: contextBytes(context).toString('base64'),
    })
    return { kms: this.id, blob: data.ciphertext }
  }

  async unwrap(wrapped: WrappedKey, context: KeyContext): Promise<Buffer> {
    if (wrapped.kms !== this.id) throw new KmsError(`Data key was wrapped by ${wrapped.kms}, not by ${this.id}`)
    const data = await this.call('decrypt', {
      ciphertext: wrapped.blob,
      context: contextBytes(context).toString('base64'),
    })
    return Buffer.from(data.plaintext, 'base64')
  }
}

let configured: Kms | null | undefined

/** The configured KMS, or null when none is (per-tenant data keys are then off). */
export function kmsFromEnv(env: NodeJS.ProcessEnv = process.env): Kms | null {
  if (env === process.env && configured !== undefined) return configured
  let kms: Kms | null = null
  // `||`, not `??`: compose passes an unset KMS_BACKEND as an empty string.
  const backend = (env.KMS_BACKEND || (env.KMS_LOCAL_KEK || env.KMS_LOCAL_KEK_FILE ? 'local' : '')).toLowerCase()
  if (backend === 'local') {
    const raw = env.KMS_LOCAL_KEK ?? (env.KMS_LOCAL_KEK_FILE ? fs.readFileSync(env.KMS_LOCAL_KEK_FILE, 'utf8') : '')
    if (!raw) throw new KmsError('KMS_BACKEND=local needs KMS_LOCAL_KEK or KMS_LOCAL_KEK_FILE')
    kms = new LocalKms(parse32(raw, 'KMS_LOCAL_KEK'))
  } else if (backend === 'vault-transit') {
    if (!env.VAULT_ADDR || !env.VAULT_TOKEN || !env.VAULT_TRANSIT_KEY) {
      throw new KmsError('KMS_BACKEND=vault-transit needs VAULT_ADDR, VAULT_TOKEN and VAULT_TRANSIT_KEY')
    }
    kms = new VaultTransitKms(env.VAULT_ADDR, env.VAULT_TOKEN, env.VAULT_TRANSIT_KEY)
  } else if (backend) {
    throw new KmsError(`Unknown KMS_BACKEND "${backend}"`)
  }
  if (env === process.env) configured = kms
  return kms
}
