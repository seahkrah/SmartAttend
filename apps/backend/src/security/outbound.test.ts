import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { checkOutboundUrl, isPrivateAddress, OutboundUrlError } from './outbound.js'
import { signature } from '../services/auditStream.js'

describe('isPrivateAddress', () => {
  it('refuses the addresses a webhook must never reach', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1',
      '::ffff:10.1.2.3']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })
  it('sees through every IPv6 form that carries an IPv4 address (audit phase 2, F3)', () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:a00:5', '0:0:0:0:0:ffff:127.0.0.1',
      '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::169.254.169.254', '64:ff9b:1::1', '2002:7f00:1::1',
      '2002:a9fe:a9fe::', '2001:0:4136:e378:8000:63bf:3fff:fdd2', 'not-an-address']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
  it('allows public ones', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '100.128.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})

describe('checkOutboundUrl', () => {
  const strict = { NODE_ENV: 'production' } as NodeJS.ProcessEnv
  it('needs HTTPS', async () => {
    await expect(checkOutboundUrl('http://8.8.8.8/hook', strict)).rejects.toThrow(OutboundUrlError)
    await expect(checkOutboundUrl('ftp://8.8.8.8/x', strict)).rejects.toThrow(/HTTPS/)
    await expect(checkOutboundUrl('not a url', strict)).rejects.toThrow(/full address/)
  })
  it('refuses private, loopback and metadata addresses, however written', async () => {
    for (const u of ['https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/x',
      'https://10.0.0.5:8443/x', 'https://localhost/x', 'https://[::ffff:127.0.0.1]:5000/api/health',
      'https://[::ffff:169.254.169.254]/', 'https://[64:ff9b::a9fe:a9fe]/', 'https://[2002:7f00:1::1]/']) {
      await expect(checkOutboundUrl(u, strict), u).rejects.toThrow(OutboundUrlError)
    }
  })
  it('refuses credentials in the address', async () => {
    await expect(checkOutboundUrl('https://user:pw@8.8.8.8/x', strict)).rejects.toThrow(/credentials/)
  })
  it('accepts a public HTTPS address', async () => {
    expect((await checkOutboundUrl('https://8.8.8.8/hook', strict)).toString()).toBe('https://8.8.8.8/hook')
  })
  it('lets local testing reach a local service only when told to', async () => {
    const local = { OUTBOUND_ALLOW_HTTP: 'true', OUTBOUND_ALLOW_PRIVATE: 'true' } as NodeJS.ProcessEnv
    expect((await checkOutboundUrl('http://127.0.0.1:9000/x', local)).host).toBe('127.0.0.1:9000')
  })
})

describe('signature', () => {
  it('is an HMAC of timestamp and body, which a collector can recompute', () => {
    const want = 'v1=' + crypto.createHmac('sha256', 's3cret').update('1700000000.{"a":1}').digest('hex')
    expect(signature('s3cret', 1700000000, '{"a":1}')).toBe(want)
    expect(signature('other', 1700000000, '{"a":1}')).not.toBe(want)
    expect(signature('s3cret', 1700000001, '{"a":1}')).not.toBe(want)
  })
})
