import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import http from 'http'
import type { AddressInfo } from 'net'
import { breachedPassword } from './breachedPassword.js'

// A stand-in for the range service: it knows one breached password, pads its
// answers, and records every path it is asked for.
const BREACHED = 'correct horse battery staple'
const sha = crypto.createHash('sha1').update(BREACHED).digest('hex').toUpperCase()
// A password whose own suffix the service returns only as padding (count 0).
const PADDED = 'a phrase that only appears as padding'
const padSha = crypto.createHash('sha1').update(PADDED).digest('hex').toUpperCase()
const asked: string[] = []
let server: http.Server
let url = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    asked.push(req.url ?? '')
    if (req.url === '/broken/' + sha.slice(0, 5)) {
      res.writeHead(503).end()
      return
    }
    const prefix = (req.url ?? '').split('/').pop()
    const lines = ['0000000000000000000000000000000000A:0', '1111111111111111111111111111111111B:12']
    if (prefix === sha.slice(0, 5)) lines.push(`${sha.slice(5)}:4242`)
    if (prefix === padSha.slice(0, 5)) lines.push(`${padSha.slice(5)}:0`)
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(lines.join('\r\n'))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const env = (over: Record<string, string>) => ({ NODE_ENV: 'test', PASSWORD_BREACH_CHECK: 'range', PASSWORD_BREACH_RANGE_URL: url, ...over })

describe('breachedPassword', () => {
  it('finds a breached password and how often it was seen', async () => {
    expect(await breachedPassword(BREACHED, env({}))).toEqual({ breached: true, count: 4242, checked: true })
  })
  it('passes one the service does not know', async () => {
    expect(await breachedPassword('a fresh and unremarkable phrase 7', env({}))).toEqual({ breached: false, checked: true })
  })
  it('sends only the first five characters of the hash', async () => {
    asked.length = 0
    await breachedPassword(BREACHED, env({}))
    expect(asked).toEqual(['/' + sha.slice(0, 5)])
    expect(asked[0]).not.toContain(sha.slice(5))
  })
  it('ignores padding entries with a count of zero', async () => {
    expect(await breachedPassword(PADDED, env({}))).toEqual({ breached: false, checked: true })
  })
  it('judges by the bundled list alone when the service fails', async () => {
    expect(await breachedPassword(BREACHED, env({ PASSWORD_BREACH_RANGE_URL: url + 'broken/' })))
      .toEqual({ breached: false, checked: false })
    expect(await breachedPassword(BREACHED, env({ PASSWORD_BREACH_RANGE_URL: 'http://127.0.0.1:1/' })))
      .toEqual({ breached: false, checked: false })
  })
  it('is off unless asked for, outside production', async () => {
    asked.length = 0
    expect(await breachedPassword(BREACHED, { NODE_ENV: 'development', PASSWORD_BREACH_RANGE_URL: url }))
      .toEqual({ breached: false, checked: false })
    expect(asked).toEqual([])
  })
  it('can be turned off in production', async () => {
    expect(await breachedPassword(BREACHED, { NODE_ENV: 'production', PASSWORD_BREACH_CHECK: 'off' }))
      .toEqual({ breached: false, checked: false })
  })
})
