/**
 * PHASE 6: Superadmin Operational Safety - Test Suite
 *
 * Comprehensive tests for:
 * - Session TTL enforcement (15 minutes)
 * - IP allowlisting
 * - Dry-run generation and validation
 * - MFA verification per-operation
 * - Immutable operation logging
 * - IP violation tracking
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Database } from '../db/connection';
import { SuperadminSafetyService } from '../services/superadminSafetyService';
import { SuperadminDryRunService } from '../services/superadminDryRunService';
import { SuperadminSessionManagementService } from '../services/superadminSessionManagementService';
import { v4 as uuidv4 } from 'uuid';

describe('PHASE 6: Superadmin Operational Safety', () => {
  let db: Database;
  let safetyService: SuperadminSafetyService;
  let dryRunService: SuperadminDryRunService;
  let sessionService: SuperadminSessionManagementService;

  let testSuperadminId: string;
  let testSessionId: string;

  beforeAll(async () => {
    db = new Database();
    safetyService = new SuperadminSafetyService(db);
    dryRunService = new SuperadminDryRunService(db);
    sessionService = new SuperadminSessionManagementService(db);

    // Create test superadmin user
    const client = await db.getClient();
    try {
      const result = await client.query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES ('superadmin-test-' || gen_random_uuid()::text, 'superadmin-test-' || gen_random_uuid()::text || '@test.local', 'hashed', 'superadmin')
         RETURNING id`
      );
      testSuperadminId = result.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    // Cleanup
    const client = await db.getClient();
    try {
      await client.query(`DELETE FROM users WHERE id = $1`, [testSuperadminId]);
    } finally {
      client.release();
    }
  });

  // ===== SESSION TTL ENFORCEMENT (5 Tests) =====
  describe('Session TTL Enforcement', () => {
    it('should create superadmin session with 15-minute TTL', async () => {
      const ipAddress = '192.168.1.100';
      const session = await sessionService.createSuperadminSession(testSuperadminId, ipAddress, true);

      expect(session).toBeDefined();
      expect(session.userId).toBe(testSuperadminId);
      expect(session.ipAddress).toBe(ipAddress);

      // Calculate TTL
      const ttlMs = session.expiresAt.getTime() - session.createdAt.getTime();
      const ttlMinutes = ttlMs / 60000;

      expect(ttlMinutes).toBeLessThanOrEqual(15.1); // Allow small clock drift
      expect(ttlMinutes).toBeGreaterThanOrEqual(14.9);

      testSessionId = session.id;
    });

    it('should verify valid session is not expired', async () => {
      const result = await sessionService.verifySuperadminSessionValid(testSessionId);
      expect(result.valid).toBe(true);
    });

    it('should reject session after TTL expires', async () => {
      const client = await db.getClient();
      try {
        // Make session expire in the past
        await client.query(
          `UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
          [testSessionId]
        );

        const result = await sessionService.verifySuperadminSessionValid(testSessionId);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('expired');
      } finally {
        client.release();
      }
    });

    it('should not allow session refresh for superadmin', async () => {
      const refreshAllowed = await sessionService.isRefreshAllowed();
      expect(refreshAllowed).toBe(false);
    });

    it('should calculate remaining session time correctly', async () => {
      // Create fresh session
      const newSession = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.1', true);

      const remaining = await sessionService.getSessionRemainingTime(newSession.id);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(900); // 15 minutes = 900 seconds
    });
  });

  // ===== IP ALLOWLISTING (5 Tests) =====
  describe('IP Allowlisting', () => {
    it('should add IP to allowlist', async () => {
      const entry = await safetyService.addIPAllowlist(
        testSuperadminId,
        '192.168.1.100',
        null,
        'Office Network',
        testSuperadminId
      );

      expect(entry).toBeDefined();
      expect(entry.ipAddress).toBe('192.168.1.100');
      expect(entry.label).toBe('Office Network');
      expect(entry.isActive).toBe(true);
    });

    it('should allow access from allowlisted IP', async () => {
      // Add IP to allowlist
      await safetyService.addIPAllowlist(
        testSuperadminId,
        '192.168.1.50',
        null,
        'Test IP',
        testSuperadminId
      );

      // Verify access allowed
      const result = await safetyService.verifySuperadminIP(testSuperadminId, '192.168.1.50');
      expect(result.allowed).toBe(true);
    });

    it('should deny access from non-allowlisted IP', async () => {
      const result = await safetyService.verifySuperadminIP(testSuperadminId, '203.0.113.42');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowlisted');
    });

    it('should record IP violation when access denied', async () => {
      const beforeViolations = await safetyService.getIPViolations(10);
      const beforeCount = beforeViolations.length;

      // Attempt access from non-allowlisted IP
      await safetyService.verifySuperadminIP(testSuperadminId, '203.0.113.99');

      const afterViolations = await safetyService.getIPViolations(10);
      expect(afterViolations.length).toBeGreaterThan(beforeCount);
    });

    it('should remove IP from allowlist', async () => {
      // Add then remove
      const entry = await safetyService.addIPAllowlist(
        testSuperadminId,
        '192.168.1.200',
        null,
        'Temporary IP',
        testSuperadminId
      );

      await safetyService.removeIPAllowlist(entry.id, testSuperadminId);

      const allowlist = await safetyService.getUserAllowlist(testSuperadminId);
      const found = allowlist.find(e => e.id === entry.id);
      expect(found?.isActive).toBe(false);
    });
  });

  // ===== DRY-RUN GENERATION (5 Tests) =====
  describe('Dry-Run Generation', () => {
    it('should validate operation parameters', async () => {
      const validation = await dryRunService.validateOperationParams(
        'DELETE_ROLE',
        { roleId: uuidv4() }
      );

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid operation parameters', async () => {
      const validation = await dryRunService.validateOperationParams(
        'DELETE_USER_FROM_ROLE',
        { roleId: uuidv4() } // Missing userIds
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should check operation scale safety', async () => {
      const check = await dryRunService.checkOperationScale('DELETE_USER_FROM_ROLE', 50, 1000);
      expect(check.safe).toBe(true);

      const checkLarge = await dryRunService.checkOperationScale('DELETE_USER_FROM_ROLE', 5000, 1000);
      expect(checkLarge.safe).toBe(false);
      expect(checkLarge.warning).toBeDefined();
    });

    it('should generate dry-run for DELETE_ROLE operation', async () => {
      // This will generate preview for a role (may be empty if none exist)
      const roleId = uuidv4();
      const dryRun = await dryRunService.dryRunDeleteRole(roleId);

      expect(dryRun).toBeDefined();
      expect(dryRun.operationType).toBe('DELETE_ROLE');
      expect(dryRun.affectedRowsCount).toBeGreaterThanOrEqual(0);
      expect(dryRun.preview).toBeInstanceOf(Array);
      expect(dryRun.estimatedImpact).toBeDefined();
    });

    it('should generate dry-run for RESET_USER_MFA operation', async () => {
      const dryRun = await dryRunService.dryRunResetUserMFA([uuidv4()]);

      expect(dryRun).toBeDefined();
      expect(dryRun.operationType).toBe('RESET_USER_MFA');
      expect(dryRun.estimatedImpact).toBeDefined();
    });
  });

  // ===== MFA VERIFICATION (5 Tests) =====
  describe('MFA Verification Per-Operation', () => {
    it('should require MFA for operation initially', async () => {
      // Create new session
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.50', false);

      const mfaReq = await sessionService.requireOperationMFA(session.id, 'DELETE_ROLE');
      expect(mfaReq.requiresMFA).toBe(true);
    });

    it('should record MFA verification', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.51', true);

      await safetyService.recordMFAVerification(
        session.id,
        testSuperadminId,
        'DELETE_ROLE',
        '10.0.0.51'
      );

      // Verify it's considered verified now
      const mfaReq = await sessionService.requireOperationMFA(session.id, 'DELETE_ROLE');
      expect(mfaReq.requiresMFA).toBe(false);
      expect(mfaReq.validUntil).toBeDefined();
    });

    it('should expire MFA verification after 5 minutes', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.52', true);

      await safetyService.recordMFAVerification(
        session.id,
        testSuperadminId,
        'DELETE_ROLE',
        '10.0.0.52'
      );

      // Manually expire the MFA verification
      const client = await db.getClient();
      try {
        await client.query(
          `UPDATE superadmin_mfa_verifications
           SET expires_at = NOW() - INTERVAL '1 minute'
           WHERE session_id = $1`,
          [session.id]
        );

        const mfaReq = await sessionService.requireOperationMFA(session.id, 'DELETE_ROLE');
        expect(mfaReq.requiresMFA).toBe(true);
      } finally {
        client.release();
      }
    });

    it('should track MFA verification in immutable table', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.53', true);

      await safetyService.recordMFAVerification(
        session.id,
        testSuperadminId,
        'UPDATE_PERMISSION',
        '10.0.0.53'
      );

      // Try to update the verification record (should fail due to immutability)
      const client = await db.getClient();
      try {
        await expect(
          client.query(
            `UPDATE superadmin_mfa_verifications SET operation_type = 'DELETE_ROLE' WHERE session_id = $1`,
            [session.id]
          )
        ).rejects.toThrow();
      } finally {
        client.release();
      }
    });
  });

  // ===== IMMUTABLE OPERATION LOGGING (4 Tests) =====
  describe('Immutable Operation Logging', () => {
    it('should record operation with checksum', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.60', true);

      const operation = await safetyService.recordOperation(
        session.id,
        testSuperadminId,
        'DELETE_ROLE',
        { roleId: 'test-role-id' },
        '10.0.0.60',
        true,
        new Date()
      );

      expect(operation).toBeDefined();
      expect(operation.checksum).toBeDefined();
      expect(operation.checksum.length).toBe(64); // SHA256 hex = 64 chars
      expect(operation.executionStatus).toBe('PENDING');
    });

    it('should verify checksum integrity', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.61', true);

      const operation = await safetyService.recordOperation(
        session.id,
        testSuperadminId,
        'DELETE_USER_FROM_ROLE',
        { roleId: 'role-1', userIds: ['user-1', 'user-2'] },
        '10.0.0.61',
        true,
        new Date()
      );

      const verification = await safetyService.verifyOperationChecksum(operation.id);
      expect(verification.valid).toBe(true);
    });

    it('should prevent modifications to immutable operation log', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.62', true);

      const operation = await safetyService.recordOperation(
        session.id,
        testSuperadminId,
        'RESET_USER_MFA',
        { userIds: ['user-1'] },
        '10.0.0.62',
        true,
        new Date()
      );

      // Try to update the operation (should fail)
      const client = await db.getClient();
      try {
        await expect(
          client.query(
            `UPDATE superadmin_operations SET notes = 'Modified' WHERE id = $1`,
            [operation.id]
          )
        ).rejects.toThrow('immutable');
      } finally {
        client.release();
      }
    });

    it('should prevent deletion of operation log', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.63', true);

      const operation = await safetyService.recordOperation(
        session.id,
        testSuperadminId,
        'DELETE_ROLE',
        { roleId: 'test-id' },
        '10.0.0.63',
        true,
        new Date()
      );

      // Try to delete the operation (should fail)
      const client = await db.getClient();
      try {
        await expect(
          client.query(
            `DELETE FROM superadmin_operations WHERE id = $1`,
            [operation.id]
          )
        ).rejects.toThrow('immutable');
      } finally {
        client.release();
      }
    });
  });

  // ===== OPERATION STATUS TRACKING (3 Tests) =====
  describe('Operation Status Tracking', () => {
    it('should mark operation as completed', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.70', true);

      const operation = await safetyService.recordOperation(
        session.id,
        testSuperadminId,
        'DELETE_ROLE',
        { roleId: 'role-to-delete' },
        '10.0.0.70',
        true,
        new Date()
      );

      await safetyService.markOperationCompleted(operation.id, 5);

      const retrieved = await safetyService.getOperationDetails(operation.id);
      expect(retrieved?.executionStatus).toBe('COMPLETED');
      expect(retrieved?.affectedRowsCount).toBe(5);
      expect(retrieved?.completedAt).toBeDefined();
    });

    it('should mark operation as failed', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.71', true);

      const operation = await safetyService.recordOperation(
        session.id,
        testSuperadminId,
        'DELETE_ROLE',
        { roleId: 'nonexistent-role' },
        '10.0.0.71',
        true,
        new Date()
      );

      await safetyService.markOperationFailed(operation.id, 'Role not found');

      const retrieved = await safetyService.getOperationDetails(operation.id);
      expect(retrieved?.executionStatus).toBe('FAILED');
      expect(retrieved?.notes).toBe('Role not found');
    });

    it('should retrieve user operations with pagination', async () => {
      const { operations, total } = await safetyService.getUserOperations(testSuperadminId, 10, 0);

      expect(operations).toBeInstanceOf(Array);
      expect(total).toBeGreaterThanOrEqual(0);
    });
  });

  // ===== SESSION INVALIDATION (2 Tests) =====
  describe('Session Invalidation', () => {
    it('should invalidate specific session', async () => {
      const session = await sessionService.createSuperadminSession(testSuperadminId, '10.0.0.80', true);

      await sessionService.invalidateSession(session.id);

      const result = await sessionService.verifySuperadminSessionValid(session.id);
      expect(result.valid).toBe(false);
    });

    it('should invalidate all user sessions on security incident', async () => {
      // Create a new superadmin for this test
      const client = await db.getClient();
      let testUserId: string;
      try {
        const result = await client.query(
          `INSERT INTO users (username, email, password_hash, role)
           VALUES ('superadmin-invalidate-test', 'superadmin-invalidate-test@test.local', 'hashed', 'superadmin')
           RETURNING id`
        );
        testUserId = result.rows[0].id;
      } finally {
        client.release();
      }

      // Create multiple sessions
      const session1 = await sessionService.createSuperadminSession(testUserId, '10.0.0.81', true);
      const session2 = await sessionService.createSuperadminSession(testUserId, '10.0.0.82', true);

      // Invalidate all sessions
      const invalidatedCount = await sessionService.invalidateUserSessions(testUserId);

      expect(invalidatedCount).toBeGreaterThanOrEqual(2);

      // Verify both are invalid
      const result1 = await sessionService.verifySuperadminSessionValid(session1.id);
      const result2 = await sessionService.verifySuperadminSessionValid(session2.id);
      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);

      // Cleanup
      const cleanupClient = await db.getClient();
      try {
        await cleanupClient.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
      } finally {
        cleanupClient.release();
      }
    });
  });
});
