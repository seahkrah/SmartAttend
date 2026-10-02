/**
 * The KMS backends wrap a data key so it only unwraps for the tenant and
 * purpose it was wrapped for, and only under the KEK that wrapped it.
 */
import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { KmsError, LocalKms, VaultTransitKms, kmsFromEnv } from './index.js'

const A = { tenantId: '11111111-1111-4111-8111-111111111111', purpose: 'face_template' }
const B = { tenantId: '22222222-2222-4222-8222-222222222222', purpose: 'face_template' }

describe('LocalKms', () => {
  const kms = new LocalKms(crypto.randomBytes(32))
  const dataKey = crypto.randomBytes(32)

  it('round-trips a data key in its own context', async () => {
    const wrapped = await kms.wrap(dataKey, A)
    expect((await kms.unwrap(wrapped, A)).equals(dataKey)).toBe(true)
  })

  it("does not unwrap in another tenant's context", async () => {
    const wrapped = await kms.wrap(dataKey, A)
    await expect(kms.unwrap(wrapped, B)).rejects.toThrow(KmsError)
  })

  it('does not unwrap for another purpose', async () => {
    const wrapped = await kms.wrap(dataKey, A)
    await expect(kms.unwrap(wrapped, { ...A, purpose: 'document' })).rejects.toThrow(KmsError)
  })

  it('does not unwrap under another KEK', async () => {
    const wrapped = await kms.wrap(dataKey, A)
    await expect(new LocalKms(crypto.randomBytes(32)).unwrap(wrapped, A)).rejects.toThrow(KmsError)
  })

  it('identifies its KEK by fingerprint, never by the key', () => {
    expect(kms.id).toMatch(/^local:[0-9a-f]{16}$/)
  })
})

describe('VaultTransitKms', () => {
  // A stand-in for Vault's transit engine with a derived key: a ciphertext
  // decrypts only under the context it was encrypted with.
  const store = new Map<string, { plaintext: string; context: string }>()
  const fakeFetch = (async (url: string, init: RequestInit) => {
    if ((init.headers as Record<string, string>)['X-Vault-Token'] !== 'token') return new Response('', { status: 403 })
    const body = JSON.parse(String(init.body))
    if (String(url).includes('/encrypt/')) {
      const ciphertext = `vault:v1:${crypto.randomBytes(8).toString('hex')}`
      store.set(ciphertext, { plaintext: body.plaintext, context: body.context })
      return Response.json({ data: { ciphertext } })
    }
    const entry = store.get(body.ciphertext)
    if (!entry || entry.context !== body.context) return new Response('', { status: 400 })
    return Response.json({ data: { plaintext: entry.plaintext } })
  }) as unknown as typeof fetch

  const kms = new VaultTransitKms('https://vault.example', 'token', 'jjelotech', fakeFetch)
  const dataKey = crypto.randomBytes(32)

  it('round-trips through transit with the context', async () => {
    const wrapped = await kms.wrap(dataKey, A)
    expect(wrapped.kms).toBe('vault-transit:jjelotech')
    expect((await kms.unwrap(wrapped, A)).equals(dataKey)).toBe(true)
  })

  it("does not unwrap in another tenant's context", async () => {
    const wrapped = await kms.wrap(dataKey, A)
    await expect(kms.unwrap(wrapped, B)).rejects.toThrow(KmsError)
  })

  it('reports a refused token', async () => {
    const bad = new VaultTransitKms('https://vault.example', 'wrong', 'jjelotech', fakeFetch)
    await expect(bad.wrap(dataKey, A)).rejects.toThrow(/403/)
  })
})

describe('kmsFromEnv', () => {
  it('is off when nothing is configured', () => {
    expect(kmsFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
  })
  it('refuses a short KEK', () => {
    expect(() => kmsFromEnv({ KMS_LOCAL_KEK: 'abcd' } as NodeJS.ProcessEnv)).toThrow(KmsError)
  })
  it('refuses an incomplete Vault configuration', () => {
    expect(() => kmsFromEnv({ KMS_BACKEND: 'vault-transit', VAULT_ADDR: 'x' } as NodeJS.ProcessEnv)).toThrow(KmsError)
  })
  it('treats an empty KMS_BACKEND (as compose passes it) as unset', () => {
    const kek = crypto.randomBytes(32).toString('hex')
    expect(kmsFromEnv({ KMS_BACKEND: '', KMS_LOCAL_KEK: kek } as NodeJS.ProcessEnv)).toBeInstanceOf(LocalKms)
    expect(kmsFromEnv({ KMS_BACKEND: '', KMS_LOCAL_KEK: '' } as NodeJS.ProcessEnv)).toBeNull()
  })
  it('builds a local KMS from a hex KEK', () => {
    expect(kmsFromEnv({ KMS_LOCAL_KEK: crypto.randomBytes(32).toString('hex') } as NodeJS.ProcessEnv)).toBeInstanceOf(LocalKms)
  })
})
