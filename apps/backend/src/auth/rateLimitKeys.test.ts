/**
 * The destructive-action limiter keeps a budget per tenant: one person acting
 * in two tenants cannot be limited in one by what they did in the other, and
 * no key is shared across tenants.
 */
import { describe, expect, it } from 'vitest'
import httpMocks from 'node-mocks-http'
import { rateLimitMiddleware } from './rateLimitMiddleware.js'

const config = { windowSeconds: 60, maxRequests: 1, destructiveActions: ['DESTROY'] }

function call(mw: ReturnType<typeof rateLimitMiddleware>, tenantId: string, userId: string) {
  const req = httpMocks.createRequest({ body: { actionType: 'DESTROY' } }) as any
  req.user = { userId }
  req.ctx = { tenantId }
  const res = httpMocks.createResponse()
  let passed = false
  mw(req, res, () => {
    passed = true
  })
  return passed ? 'next' : res.statusCode
}

describe('rateLimitMiddleware keys', () => {
  it('are separate per tenant for the same person', () => {
    const mw = rateLimitMiddleware(undefined, config)
    const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(call(mw, 'tenant-a', user)).toBe('next')
    expect(call(mw, 'tenant-a', user)).toBe(429)
    expect(call(mw, 'tenant-b', user)).toBe('next')
  })
})
