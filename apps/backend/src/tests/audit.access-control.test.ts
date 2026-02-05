/**
 * PHASE 10.2: AUDIT ACCESS CONTROL TESTS
 * 
 * Tests for role-based access control on audit logs
 */

import { describe, it, expect, beforeAll } from '@jest/globals'
import { createRequest, createResponse } from 'node-mocks-http'
import { 
  enforceAuditAccess,
  queryAuditLogsWithAccessControl,
  logAuditAccess
} from '../auth/auditAccessControl'

describe('Phase 10.2: Audit Access Control', () => {
  
  describe('enforceAuditAccess', () => {
    
    it('should allow superadmin to access GLOBAL scope', async () => {
      const req = createRequest({
        user: { userId: 'super-1', role: 'superadmin' },
        ip: '127.0.0.1'
      })

      const result = await enforceAuditAccess(req, 'GLOBAL')
      expect(result.allowed).toBe(true)
      expect(result.accessLogId).toBeTruthy()
    })

    it('should deny user access to GLOBAL scope', async () => {
      const req = createRequest({
        user: { userId: 'user-1', role: 'user' },
        ip: '127.0.0.1'
      })

      try {
        await enforceAuditAccess(req, 'GLOBAL')
        expect(true).toBe(false) // Should have thrown
      } catch (error: any) {
        expect(error.message).toContain('Access Denied')
      }
    })

    it('should allow tenant_admin to access TENANT scope', async () => {
      const req = createRequest({
        user: { userId: 'admin-1', role: 'tenant_admin', tenantId: 'tenant-1' },
        ip: '127.0.0.1'
      })

      const result = await enforceAuditAccess(req, 'TENANT')
      expect(result.allowed).toBe(true)
    })

    it('should deny tenant_admin access to GLOBAL scope', async () => {
      const req = createRequest({
        user: { userId: 'admin-1', role: 'tenant_admin', tenantId: 'tenant-1' },
        ip: '127.0.0.1'
      })

      try {
        await enforceAuditAccess(req, 'GLOBAL')
        expect(true).toBe(false) // Should have thrown
      } catch (error: any) {
        expect(error.message).toContain('Access Denied')
      }
    })

    it('should allow user to access USER scope only', async () => {
      const req = createRequest({
        user: { userId: 'user-1', role: 'user' },
        ip: '127.0.0.1'
      })

      const result = await enforceAuditAccess(req, 'USER')
      expect(result.allowed).toBe(true)
    })

    it('should deny user access to TENANT scope', async () => {
      const req = createRequest({
        user: { userId: 'user-1', role: 'user' },
        ip: '127.0.0.1'
      })

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
      const req = createRequest({
        user: { userId: 'user-1', role: 'user' },
        ip: '127.0.0.1'
      })

      // Query without scope restriction should work (defaults to USER)
      const results = await queryAuditLogsWithAccessControl(req, {
        limit: 10,
        offset: 0
      })

      expect(Array.isArray(results)).toBe(true)
    })

    it('should restrict regular user queries to USER scope logs', async () => {
      const req = createRequest({
        user: { userId: 'user-1', role: 'user' },
        ip: '127.0.0.1'
      })

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
      const req = createRequest({
        user: { userId: 'super-1', role: 'superadmin' },
        ip: '127.0.0.1'
      })

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
        actorId: 'user-1',
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
        actorId: 'user-1',
        actorRole: 'user',
        accessType: 'READ_AUDIT_LOGS_DENIED',
        scopeAccessed: 'GLOBAL',
        ipAddress: '127.0.0.1'
      })

      expect(accessLogId).toBeTruthy()
    })

  })

})
