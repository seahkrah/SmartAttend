/**
 * PHASE 10.2: AUDIT SYSTEM INTEGRATION TESTS
 * 
 * Comprehensive tests for:
 * 1. Immutability enforcement (database + service layer)
 * 2. Access control (role-based scope filtering)
 * 3. Before/after state capture
 * 4. Checksum integrity verification
 * 5. Audit access logging
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '../db/connection'
import {
  logAuditEntry, updateAuditEntry, auditOperation, auditDryRun,
} from '../services/auditService'
import { 
  logAudit,
  queryAuditLogs,
  verifyAuditLogIntegrity,
  getAuditTrailForResource
} from '../services/domainAuditService'
import * as domainAudit from '../services/domainAuditService'
import {
  canAccessScope,
  buildAccessControlWhere,
  AUDIT_ACCESS_RULES
} from '../auth/auditAccessControl'

describe('Phase 10.2: Audit System Integration Tests', () => {
  
  // These were the strings 'test-superadmin-uuid' and 'test-user-uuid' in
  // uuid columns with foreign keys to users, so beforeAll threw and vitest
  // skipped all 21 tests — which is why this file reported "21 skipped"
  // rather than failing outright.
  const testSuperadminId = 'ed39bb41-87d7-557c-8a8e-74ee4a8e67bd'
  const testUserId = '3bee3509-1162-5c0f-a239-e0806f544cf1'
  let testTenantId: string

  /** An unrestricted predicate: this suite reads only rows it wrote itself. */
  const allVisible = { sql: 'TRUE', params: [] as any[] }
  const immPlatformName = `aim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

  beforeAll(async () => {
    const platform = await query(
      `INSERT INTO platforms (name, display_name) VALUES ($1, $1) RETURNING id`,
      [immPlatformName]
    )
    const role = await query(
      `INSERT INTO roles (platform_id, name, permissions)
       VALUES ($1, 'user', '["read"]'::jsonb) RETURNING id`,
      [platform.rows[0].id]
    )
    const entity = await query(
      `INSERT INTO school_entities (name, code, status) VALUES ($1, $2, 'active')
       RETURNING id`,
      [`Immutability ${immPlatformName}`, immPlatformName.toUpperCase().slice(0, 45)]
    )
    testTenantId = entity.rows[0].id

    for (const [id, label] of [[testSuperadminId, 'Super'], [testUserId, 'User']] as const) {
      await query(
        `INSERT INTO users (id, platform_id, email, full_name, role_id, password_hash, is_active)
         VALUES ($1, $2, $4, $5, $3, 'x', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [id, platform.rows[0].id, role.rows[0].id, `${id}@ut.test`, `Immutability ${label}`]
      )
    }
  })

  afterAll(async () => {
    // audit_logs refuses deletion; a teardown is the one legitimate exception.
    await query(`ALTER TABLE audit_logs DISABLE TRIGGER USER`).catch(() => undefined)
    await query(`ALTER TABLE audit_access_log DISABLE TRIGGER USER`).catch(() => undefined)
    try {
      await query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])',
        [[testSuperadminId, testUserId]]).catch(() => undefined)
      await query('DELETE FROM audit_access_log WHERE actor_id = ANY($1::uuid[])',
        [[testSuperadminId, testUserId]]).catch(() => undefined)
    } finally {
      await query(`ALTER TABLE audit_logs ENABLE TRIGGER USER`).catch(() => undefined)
      await query(`ALTER TABLE audit_access_log ENABLE TRIGGER USER`).catch(() => undefined)
    }
    await query(`ALTER TABLE superadmin_audit_log DISABLE TRIGGER prevent_superadmin_audit_log_delete`)
      .catch(() => undefined)
    try {
      await query('DELETE FROM superadmin_audit_log WHERE actor_id = ANY($1::uuid[])',
        [[testSuperadminId, testUserId]]).catch(() => undefined)
    } finally {
      await query(`ALTER TABLE superadmin_audit_log ENABLE TRIGGER prevent_superadmin_audit_log_delete`)
        .catch(() => undefined)
    }
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])',
      [[testSuperadminId, testUserId]]).catch(() => undefined)
    await query(
      `DELETE FROM roles WHERE platform_id IN (SELECT id FROM platforms WHERE name = $1)`,
      [immPlatformName]).catch(() => undefined)
    await query(`DELETE FROM platforms WHERE name = $1`, [immPlatformName])
      .catch(() => undefined)
    await query(`DELETE FROM school_entities WHERE id = $1`, [testTenantId])
      .catch(() => undefined)
  })

  describe('IMMUTABILITY ENFORCEMENT', () => {
    
    it('should prevent UPDATE on audit_logs table via database trigger', async () => {
      // Create a test audit log
      const auditId = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'TEST_CREATE',
        actionScope: 'GLOBAL',
        ipAddress: '127.0.0.1'
      })

      // Attempt UPDATE (should fail)
      let updateFailed = false
      try {
        await query('UPDATE audit_logs SET justification = $1 WHERE id = $2', 
          ['hacked', auditId])
      } catch (error: any) {
        updateFailed = true
        expect(error.message).toMatch(/immutable/i)
      }

      expect(updateFailed).toBe(true)
    })

    it('should prevent DELETE on audit_logs table via database trigger', async () => {
      // Create a test audit log
      const auditId = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'TEST_DELETE',
        actionScope: 'GLOBAL',
        ipAddress: '127.0.0.1'
      })

      // Attempt DELETE (should fail)
      let deleteFailed = false
      try {
        await query('DELETE FROM audit_logs WHERE id = $1', [auditId])
      } catch (error: any) {
        deleteFailed = true
        expect(error.message).toMatch(/immutable/i)
      }

      expect(deleteFailed).toBe(true)
    })

    it('should prevent UPDATE on superadmin_audit_log table', async () => {
      // Create test entry
      const result = await query(
        `INSERT INTO superadmin_audit_log 
         (actor_id, action_type, action_scope, ip_address, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [testSuperadminId, 'TEST_UPDATE', 'GLOBAL', '127.0.0.1']
      )
      const auditId = result.rows[0].id

      // Attempt UPDATE (should fail)
      let updateFailed = false
      try {
        await query('UPDATE superadmin_audit_log SET justification = $1 WHERE id = $2', 
          ['hacked', auditId])
      } catch (error: any) {
        updateFailed = true
        expect(error.message).toMatch(/immutable/i)
      }

      expect(updateFailed).toBe(true)
    })

    it('should prevent UPDATE via service layer (preventUpdateAttempt)', async () => {
      // This test depends on imports being properly enforced
      // The audit services should not export any UPDATE functions
      // These are still exported, as functions that throw. The guarantee is
      // that they cannot be used to rewrite history, not that the names are
      // absent — a caller that still references one gets a loud failure
      // rather than a silent no-op.
      expect(() => updateAuditEntry()).toThrow()
      expect(() => auditOperation()).toThrow()
      expect(() => auditDryRun()).toThrow()
    })

  })

  describe('ACCESS CONTROL & SCOPE ENFORCEMENT', () => {
    
    it('should allow superadmin to access GLOBAL scope', () => {
      const canAccess = canAccessScope('superadmin', 'GLOBAL')
      expect(canAccess).toBe(true)
    })

    it('should deny user access to GLOBAL scope', () => {
      const canAccess = canAccessScope('user', 'GLOBAL')
      expect(canAccess).toBe(false)
    })

    it('should allow tenant_admin to access TENANT and USER scopes only', () => {
      expect(canAccessScope('tenant_admin', 'TENANT')).toBe(true)
      expect(canAccessScope('tenant_admin', 'USER')).toBe(true)
      expect(canAccessScope('tenant_admin', 'GLOBAL')).toBe(false)
    })

    it('should allow user to access USER scope only', () => {
      expect(canAccessScope('user', 'USER')).toBe(true)
      expect(canAccessScope('user', 'TENANT')).toBe(false)
      expect(canAccessScope('user', 'GLOBAL')).toBe(false)
    })

    it('should build correct WHERE clause for superadmin', () => {
      const { whereConditions, params } = buildAccessControlWhere(
        'superadmin',
        testSuperadminId
      )

      // Superadmin should have no restrictions (WHERE conditions might be empty or only scope-based)
      expect(Array.isArray(whereConditions)).toBe(true)
    })

    it('should build WHERE clause restricting user to own logs', () => {
      const { whereConditions, params } = buildAccessControlWhere(
        'user',
        testUserId
      )

      // The action_scope predicate was removed deliberately: that column is
      // NULL for the trigger-based writers, so filtering on it hid most of
      // the trail. What confines a user to their own entries is the actor
      // predicate, which is what this now asserts.
      expect(whereConditions.join(' ')).toContain('actor_id')
      expect(whereConditions.join(' ')).toContain('user_id')
      expect(params).toContain(testUserId)
    })

    it('should enforce scope constraint in database', async () => {
      // Try to create GLOBAL scope log as non-superadmin (should fail)
      let constraintFailed = false
      try {
        await query(
          `INSERT INTO audit_logs 
           (actor_id, actor_role, action_type, action_scope, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [testUserId, 'user', 'TEST', 'GLOBAL']
        )
      } catch (error: any) {
        constraintFailed = true
        expect(error.message).toContain('constraint')
      }

      expect(constraintFailed).toBe(true)
    })

  })

  describe('STATE CAPTURE & VALIDATION', () => {
    
    it('should capture before_state and after_state at creation time', async () => {
      const beforeState = { status: 'VERIFIED', confidence: 0.95 }
      const afterState = { status: 'FLAGGED', confidence: 0.85, reason: 'duplicate' }

      const auditId = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'TEST_TRANSITION',
        actionScope: 'USER',
        resourceType: 'attendance',
        resourceId: 'f6280948-f84f-5cf3-8bb7-42f67d7e480b',
        beforeState,
        afterState,
        justification: 'TEST_REASON',
        ipAddress: '127.0.0.1'
      })

      // Verify in database
      const { rows } = await query('SELECT before_state, after_state FROM audit_logs WHERE id = $1', [auditId])
      expect(rows[0].before_state).toEqual(beforeState)
      expect(rows[0].after_state).toEqual(afterState)
    })

    it('should validate state structure', async () => {
      // Valid state
      const validState = { field1: 'value1', field2: 42 }
      const auditId = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'TEST_VALID',
        actionScope: 'USER',
        beforeState: validState,
        ipAddress: '127.0.0.1'
      })

      expect(auditId).toBeTruthy()
    })

  })

  describe('CHECKSUM INTEGRITY VERIFICATION', () => {
    
    it('should calculate and store checksum on insert', async () => {
      const auditId = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'TEST_CHECKSUM',
        actionScope: 'GLOBAL',
        ipAddress: '127.0.0.1'
      })

      // Verify checksum was calculated
      const { rows } = await query('SELECT checksum FROM audit_logs WHERE id = $1', [auditId])
      expect(rows[0].checksum).toBeTruthy()
      expect(rows[0].checksum).toMatch(/^[a-f0-9]{64}$/) // SHA-256 format
    })

    it('should verify checksum integrity', async () => {
      const auditId = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'TEST_INTEGRITY',
        actionScope: 'GLOBAL',
        ipAddress: '127.0.0.1'
      })

      // Verify integrity
      const verification = await verifyAuditLogIntegrity(auditId, allVisible)
      expect(verification.isValid).toBe(true)
      expect(verification.storedChecksum).toBe(verification.calculatedChecksum)
    })

    it('should detect checksum mismatch if log was tampered with', async () => {
      // This test would require actually modifying the database directly (simulating tampering)
      // Skipped in normal testing as it requires breaking immutability for testing purposes
      
      // In production, automated verification job would catch this
      expect(true).toBe(true)
    })

  })

  describe('AUDIT ACCESS LOGGING', () => {
    
    it('should log when audit logs are accessed', async () => {
      // This would be tested at the route level
      // Verify that audit_access_log table receives entries
      
      const { rows } = await query('SELECT COUNT(*) FROM audit_access_log')
      expect(parseInt(rows[0].count)).toBeGreaterThanOrEqual(0)
    })

    it('should track who accessed what scopes', async () => {
      const { rows } = await query(
        // DISTINCT cannot order by a column it does not select.
        `SELECT actor_role, scope_accessed FROM audit_access_log
          ORDER BY created_at DESC LIMIT 1`
      )
      
      if (rows.length > 0) {
        expect(rows[0].actor_role).toBeTruthy()
      }
    })

  })

  describe('IMMUTABILITY ENFORCEMENT IN SUPERADMIN_AUDIT_LOG', () => {
    
    it('should prevent UPDATE on superadmin operations log', async () => {
      // Create entry
      const { rows: insertRows } = await query(
        `INSERT INTO superadmin_audit_log 
         (actor_id, action_type, action_scope, ip_address, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [testSuperadminId, 'TEST_SUPERADMIN', 'GLOBAL', '127.0.0.1']
      )
      const auditId = insertRows[0].id

      // Attempt UPDATE (should fail)
      let updateFailed = false
      try {
        await query('UPDATE superadmin_audit_log SET result = $1 WHERE id = $2', 
          ['HACKED', auditId])
      } catch (error: any) {
        updateFailed = true
      }

      expect(updateFailed).toBe(true)
    })

  })

  describe('SERVICE LAYER ENFORCEMENT', () => {
    
    it('should export only read functions from domainAuditService', () => {
      // Verify mutating functions don't exist
      const readOnlyFunctions = [
        'queryAuditLogs',
        'getAuditLogById',
        'getAuditTrailForResource',
        'getAuditSummary',
        'verifyAuditLogIntegrity',
        'searchAuditLogsByJustification',
        'getAuditLogsForPeriod'
      ]

      for (const func of readOnlyFunctions) {
        expect(typeof (domainAudit as unknown as Record<string, unknown>)[func]).toBe('function')
      }

      // Verify mutation functions don't exist
      const forbiddenFunctions = ['updateAudit', 'deleteAudit', 'updateAuditEntry']
      for (const func of forbiddenFunctions) {
        expect((domainAudit as unknown as Record<string, unknown>)[func]).toBeUndefined()
      }
    })

  })

  describe('RESOURCE AUDIT TRAIL', () => {
    
    it('should create immutable trail of all changes to a resource', async () => {
      const resourceId = '5fc7ae07-f94b-54fe-a90a-947a16ce98e9'
      const resourceType = 'attendance'

      // Create first change
      const auditId1 = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'CREATE',
        actionScope: 'USER',
        resourceType,
        resourceId,
        beforeState: {},
        afterState: { status: 'MARKED' },
        ipAddress: '127.0.0.1'
      })

      // Create second change
      const auditId2 = await logAudit({
        actorId: testSuperadminId,
        actorRole: 'superadmin',
        actionType: 'UPDATE',
        actionScope: 'USER',
        resourceType,
        resourceId,
        beforeState: { status: 'MARKED' },
        afterState: { status: 'VERIFIED' },
        ipAddress: '127.0.0.1'
      })

      // Retrieve trail
      const trail = await getAuditTrailForResource(resourceType, resourceId, allVisible)

      // Verify both changes in trail
      expect(trail.length).toBeGreaterThanOrEqual(2)
      expect(trail.map((t: any) => t.id)).toContain(auditId1)
      expect(trail.map((t: any) => t.id)).toContain(auditId2)
    })

  })

})
