/**
 * Object keys are tenant-first, and are checked again on every read: a row
 * that names another tenant's object is refused, not served.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildKey, keyBelongsTo } from './backend.js'
import { FileError, openForDownload, type StoredFileRow } from './fileService.js'
import { withTenant } from '../db/dbContext.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('object keys', () => {
  it('start with the tenant', () => {
    const key = buildKey(A, 'student_photo', 'png')
    expect(key.startsWith(`${A}/student_photo/`)).toBe(true)
    expect(keyBelongsTo(key, A)).toBe(true)
    expect(keyBelongsTo(key, B)).toBe(false)
  })

  it('refuse lookalikes and traversal', () => {
    expect(keyBelongsTo(`${A}x/other/aa/bb/f.png`, A)).toBe(false)
    expect(keyBelongsTo(`${A}/../${B}/other/aa/bb/f.png`, A)).toBe(false)
    expect(keyBelongsTo(`${A}//other/f.png`, A)).toBe(false)
    expect(keyBelongsTo(`${B}/other/aa/bb/f.png`, A)).toBe(false)
    expect(keyBelongsTo(`${A}/other/aa/bb/f.png`, '')).toBe(false)
  })
})

describe('openForDownload', () => {
  const row = (tenant: string, keyTenant: string): StoredFileRow =>
    ({
      id: '33333333-3333-4333-8333-333333333333',
      tenant_id: tenant,
      backend: 'local',
      storage_key: `${keyTenant}/other/aa/bb/aabbccddeeff00112233445566778899.pdf`,
      original_name: 'f.pdf',
      content_type: 'application/pdf',
      byte_size: 10,
      checksum_sha256: 'x',
    }) as StoredFileRow

  it("refuses a row whose object is another tenant's", async () => {
    const err = await withTenant({ tenantId: A }, () => openForDownload(row(A, B), false)).catch((e) => e)
    expect(err).toBeInstanceOf(FileError)
    expect(err.status).toBe(404)
  })

  it("refuses another tenant's file in this tenant's context", async () => {
    const err = await withTenant({ tenantId: A }, () => openForDownload(row(B, B), false)).catch((e) => e)
    expect(err).toBeInstanceOf(FileError)
    expect(err.status).toBe(404)
  })

  it("lets this tenant's file through to the backend", async () => {
    // The bytes are absent, so the backend's answer (410) shows the key check passed.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = await withTenant({ tenantId: A }, () => openForDownload(row(A, A), false)).catch((e) => e)
    expect(err?.status).toBe(410)
  })
})
