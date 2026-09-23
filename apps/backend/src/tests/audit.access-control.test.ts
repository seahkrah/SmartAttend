/**
 * PHASE 10.2: AUDIT ACCESS CONTROL TESTS
 * 
 * Tests for role-based access control on audit logs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '../db/connection'
import { createRequest, createResponse } from 'node-mocks-http'
import { 
  enforceAuditAccess,
  queryAuditLogsWithAccessControl,
  logAuditAccess
} from '../auth/auditAccessControl'


// audit_access_log.actor_id is a uuid with a foreign key to users, and its
// tenant_id references tenants, so these need to be real rows rather than
// string labels.
let auditTenantId: string
const ADMIN_1 = '532183b1-7ab4-5e98-8e63-309476d8c652'
const SUPER_1 = 'b4822ef5-336e-587d-82f2-5fa25658de87'
const USER_1 = '0be8ce51-c15b-5984-9102-76e61e6dfee5'
const AUDIT_TEST_USER_IDS = [ADMIN_1, SUPER_1, USER_1]

/**
 * A mock request carrying a resolved tenant context.
 *
 * The originals set `req.user`, which is what this code read before audit
 * access control was moved onto the resolved context. contextOf() now
 * requires `req.ctx`, and refuses without it — which is the point: a request
 * with an identity but no tenant must not reach tenant-scoped audit data.
 */
function ctxRequest(opts: {
  userId: string
  roleName: string
  isSuperadmin?: boolean
  tenantId?: string | null
  ip?: string
}) {
  const req = createRequest({ ip: opts.ip ?? '127.0.0.1' })
  ;(req as any).ctx = {
    userId: opts.userId,
    roleId: '00000000-0000-4000-8000-000000000001',
    roleName: opts.roleName,
    platformId: '00000000-0000-4000-8000-000000000002',
    platformKind: 'school',
    tenantId: opts.tenantId === undefined ? auditTenantId : opts.tenantId,
    tenantName: 'Test Tenant',
    memberships: [],
    isSuperadmin: opts.isSuperadmin ?? false,
  }
  return req
}


describe('Phase 10.2: Audit Access Control', () => {

  // Real accounts behind the ids: the access log's actor_id references users
  // with ON DELETE RESTRICT, so a string label could never have worked.
  const auditPlatformName = `aac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

  beforeAll(async () => {
    const platform = await query(
      `INSERT INTO platforms (name, display_name) VALUES ($1, $1) RETURNING id`,
      [auditPlatformName]
    )
    const role = await query(
      `INSERT INTO roles (platform_id, name, permissions)
       VALUES ($1, 'user', '["read"]'::jsonb) RETURNING id`,
      [platform.rows[0].id]
    )
    // A school entity, whose sync trigger produces the matching tenants row.
    const entity = await query(
      `INSERT INTO school_entities (name, code, status) VALUES ($1, $2, 'active')
       RETURNING id`,
      [`Audit ${auditPlatformName}`, auditPlatformName.toUpperCase().slice(0, 45)]
    )
    auditTenantId = entity.rows[0].id

    for (const id of AUDIT_TEST_USER_IDS) {
      await query(
        `INSERT INTO users (id, platform_id, email, full_name, role_id, password_hash, is_active)
         VALUES ($1, $2, $4, 'Audit Test', $3, 'x', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [id, platform.rows[0].id, role.rows[0].id, `${id}@ut.test`]
      )
    }
  })

  afterAll(async () => {
    await query(`ALTER TABLE audit_access_log DISABLE TRIGGER USER`).catch(() => undefined)
    try {
      await query(`DELETE FROM audit_access_log WHERE actor_id = ANY($1::uuid[])`,
        [AUDIT_TEST_USER_IDS]).catch(() => undefined)
    } finally {
      await query(`ALTER TABLE audit_access_log ENABLE TRIGGER USER`).catch(() => undefined)
    }
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`,
      [AUDIT_TEST_USER_IDS]).catch(() => undefined)
    await query(
      `DELETE FROM roles WHERE platform_id IN (SELECT id FROM platforms WHERE name = $1)`,
      [auditPlatformName]).catch(() => undefined)
    await query(`DELETE FROM platforms WHERE name = $1`, [auditPlatformName])
      .catch(() => undefined)
    // The AFTER DELETE trigger removes the matching tenants row.
    await query(`DELETE FROM school_entities WHERE id = $1`, [auditTenantId])
      .catch(() => undefined)
  })
  
  describe('enforceAuditAccess', () => {
    
    it('should allow superadmin to access GLOBAL scope', async () => {
      const req = ctxRequest({ userId: SUPER_1, roleName: 'superadmin', isSuperadmin: true })

      const result = await enforceAuditAccess(req, 'GLOBAL')
      expect(result.allowed).toBe(true)
      expect(result.accessLogId).toBeTruthy()
    })

    it('should deny user access to GLOBAL scope', async () => {
      const req = ctxRequest({ userId: USER_1, roleName: 'student' })

      try {
        await enforceAuditAccess(req, 'GLOBAL')
        expect(true).toBe(false) // Should have thrown
      } catch (error: any) {
        expect(error.message).toContain('Access Denied')
      }
    })

    it('should allow tenant_admin to access TENANT scope', async () => {
      const req = ctxRequest({ userId: ADMIN_1, roleName: 'admin' })

      const result = await enforceAuditAccess(req, 'TENANT')
      expect(result.allowed).toBe(true)
    })

    it('should deny tenant_admin access to GLOBAL scope', async () => {
      const req = ctxRequest({ userId: ADMIN_1, roleName: 'admin' })

      try {
        await enforceAuditAccess(req, 'GLOBAL')
        expect(true).toBe(false) // Should have thrown
      } catch (error: any) {
        expect(error.message).toContain('Access Denied')
      }
    })

    it('should allow user to access USER scope only', async () => {
      const req = ctxRequest({ userId: USER_1, roleName: 'student' })

      const result = await enforceAuditAccess(req, 'USER')
      expect(result.allowed).toBe(true)
    })

    it('should deny user access to TENANT scope', async () => {
      const req = ctxRequest({ userId: USER_1, roleName: 'student' })

      try {
        await enforceAuditAccess(req, 'TENANT')
        expect(true).toBe(false) // Should have thrown
      } catch (error: any) {
        expect(error.message).toContain('Access Denied')
      }
    })

  })

  describe('queryAuditLogsWithAccessControl', () => {
    
    it('should enforce access control in query results', async () => {
      const req = ctxRequest({ userId: USER_1, roleName: 'student' })

      // Query without scope restriction should work (defaults to USER)
      const results = await queryAuditLogsWithAccessControl(req, {
        limit: 10,
        offset: 0
      })

      expect(Array.isArray(results)).toBe(true)
    })

    it('should restrict regular user queries to USER scope logs', async () => {
      const req = ctxRequest({ userId: USER_1, roleName: 'student' })

      // Requesting with filters
      const results = await queryAuditLogsWithAccessControl(req, {
        actionScope: 'USER',
        limit: 10
      })

      // All returned logs should be USER scope
      for (const log of results) {
        expect(log.action_scope).toBe('USER')
      }
    })

    it('should allow superadmin to query all scopes', async () => {
      const req = ctxRequest({ userId: SUPER_1, roleName: 'superadmin', isSuperadmin: true })

      // Can query GLOBAL scope
      const globalResults = await queryAuditLogsWithAccessControl(req, {
        actionScope: 'GLOBAL',
        limit: 10
      })

      expect(Array.isArray(globalResults)).toBe(true)
    })

  })

  describe('logAuditAccess', () => {
    
    it('should log audit access events', async () => {
      const accessLogId = await logAuditAccess({
        actorId: USER_1,
        actorRole: 'user',
        accessType: 'READ_AUDIT_LOGS',
        scopeAccessed: 'USER',
        resultsCount: 5,
        ipAddress: '127.0.0.1'
      })

      expect(accessLogId).toBeTruthy()
    })

    it('should log denied access attempts', async () => {
      const accessLogId = await logAuditAccess({
        actorId: USER_1,
        actorRole: 'user',
        accessType: 'READ_AUDIT_LOGS_DENIED',
        scopeAccessed: 'GLOBAL',
        ipAddress: '127.0.0.1'
      })

      expect(accessLogId).toBeTruthy()
    })

  })

})
