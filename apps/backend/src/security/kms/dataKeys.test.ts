/**
 * Per-tenant data keys against a migrated database: a ciphertext sealed for
 * one tenant opens only for that tenant, rotation keeps old data readable,
 * and deleting a tenant's keys makes its data unreadable (crypto-shredding).
 * Needs DATABASE_URL; creates two throwaway tenants and removes them.
 */
import crypto from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.KMS_LOCAL_KEK = process.env.KMS_LOCAL_KEK || crypto.randomBytes(32).toString('hex')

const { query } = await import('../../db/connection.js')
const { runAsSystem, withTenant } = await import('../../db/dbContext.js')
const dk = await import('./dataKeys.js')

const A = crypto.randomUUID()
const B = crypto.randomUUID()
const PURPOSE = 'face_template'
const AAD = 'face-template:v1:test'

beforeAll(async () => {
  await runAsSystem('dataKeys.test: create two throwaway tenants', async () => {
    const p = await query(`SELECT id FROM platforms WHERE name = 'school'`)
    for (const [id, n] of [[A, 'A'], [B, 'B']]) {
      await query(`INSERT INTO tenants (id, platform_id, kind, name) VALUES ($1, $2, 'school', $3)`, [
        id,
        p.rows[0].id,
        `dataKeys test ${n} ${id.slice(0, 8)}`,
      ])
    }
  })
})

afterAll(async () => {
  await runAsSystem('dataKeys.test: remove the throwaway tenants', () =>
    query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[A, B]]),
  )
})

const asA = <T>(fn: () => Promise<T>) => withTenant({ tenantId: A }, fn)
const asB = <T>(fn: () => Promise<T>) => withTenant({ tenantId: B }, fn)

describe('per-tenant data keys', () => {
  it("seal and open within a tenant; another tenant cannot open it", async () => {
    const secret = Buffer.from('a face descriptor, or anything sensitive')
    const sealed = await asA(() => dk.sealForTenant(A, PURPOSE, secret, AAD))
    expect((await asA(() => dk.openForTenant(A, PURPOSE, sealed, AAD))).equals(secret)).toBe(true)

    // The same ciphertext presented as B's: B's own key (created on demand) does not open it.
    await asB(() => dk.activeDataKey(B, PURPOSE))
    dk.clearDataKeyCache()
    await expect(asB(() => dk.openForTenant(B, PURPOSE, sealed, AAD))).rejects.toThrow()
  })

  it('give each tenant a different key', async () => {
    const a = await asA(() => dk.activeDataKey(A, PURPOSE))
    const b = await asB(() => dk.activeDataKey(B, PURPOSE))
    expect(a.key.equals(b.key)).toBe(false)
  })

  it("refuse another tenant's key inside a tenant's context", async () => {
    await expect(asA(() => dk.activeDataKey(B, PURPOSE))).rejects.toThrow(/another tenant/)
  })

  it('rotate: new data seals under the new version, old data still opens', async () => {
    const before = await asA(() => dk.sealForTenant(A, PURPOSE, Buffer.from('old'), AAD))
    const v = await asA(() => dk.rotateDataKey(A, PURPOSE))
    const after = await asA(() => dk.sealForTenant(A, PURPOSE, Buffer.from('new'), AAD))
    expect(after.dekVersion).toBe(v)
    expect(before.dekVersion).toBeLessThan(v)
    expect((await asA(() => dk.openForTenant(A, PURPOSE, before, AAD))).toString()).toBe('old')
  })

  it('a stored data key cannot be rewritten', async () => {
    await expect(
      runAsSystem('dataKeys.test: try to rewrite a key', () =>
        query(`UPDATE tenant_data_keys SET wrapped_key = 'x' WHERE tenant_id = $1`, [A]),
      ),
    ).rejects.toThrow(/cannot be rewritten/)
  })

  it("a wrapped key moved to another tenant's row does not unwrap", async () => {
    // Copy A's wrapped key into B under a new version: the KMS context is B's, so it fails.
    await runAsSystem('dataKeys.test: plant a copied wrapped key', () =>
      query(
        `INSERT INTO tenant_data_keys (tenant_id, purpose, version, kms, wrapped_key)
         SELECT $2, purpose, 99, kms, wrapped_key FROM tenant_data_keys WHERE tenant_id = $1 AND purpose = $3 ORDER BY version LIMIT 1`,
        [A, B, PURPOSE],
      ),
    )
    dk.clearDataKeyCache()
    await expect(asB(() => dk.dataKeyVersion(B, PURPOSE, 99))).rejects.toThrow()
  })

  it("deleting a tenant's keys makes its data unreadable (crypto-shredding)", async () => {
    const sealed = await asA(() => dk.sealForTenant(A, PURPOSE, Buffer.from('erase me'), AAD))
    await runAsSystem('dataKeys.test: shred A', () => query(`DELETE FROM tenant_data_keys WHERE tenant_id = $1`, [A]))
    dk.clearDataKeyCache()
    await expect(asA(() => dk.openForTenant(A, PURPOSE, sealed, AAD))).rejects.toThrow(/No data key/)
  })
})
