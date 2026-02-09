/**
 * PHASE 6: Superadmin Operational Safety Service
 *
 * Core principle: Power must be slowed down
 *
 * Enforces:
 * 1. Session TTL (15 minutes maximum)
 * 2. IP allowlisting
 * 3. MFA verification per-operation
 * 4. Immutable operation logging with checksums
 * 5. Violation alerting
 */

import * as crypto from 'crypto';
import { Database } from '../connection';
import { v4 as uuidv4 } from 'uuid';

export interface SuperadminOperation {
  id: string;
  sessionId: string;
  userId: string;
  operationType: string;
  operationParams?: Record<string, any>;
  dryRunResult?: Record<string, any>;
  dryRunConfirmed: boolean;
  executionStatus: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
  affectedRowsCount?: number;
  ipAddress: string;
  mfaVerified: boolean;
  mfaVerifiedAt?: Date;
  performedAt: Date;
  completedAt?: Date;
  notes?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  checksum: string;
}

export interface IPAllowlistEntry {
  id: string;
  superadminUserId: string;
  ipAddress?: string;
  ipRange?: string;
  label: string;
  addedBy: string;
  addedAt: Date;
  removedBy?: string;
  removedAt?: Date;
  isActive: boolean;
}

export interface IPViolation {
  id: string;
  ipAddress: string;
  userId: string;
  attemptedOperation: string;
  deniedAt: Date;
  alertSent: boolean;
}

const SUPERADMIN_SESSION_TTL = 15 * 60 * 1000; // 15 minutes
const MFA_VERIFICATION_VALIDITY = 5 * 60 * 1000; // 5 minutes

export class SuperadminSafetyService {
  constructor(private db: Database) {}

  /**
   * Verify session is valid for superadmin operations
   * Requirements:
   * 1. Session exists
   * 2. Session TTL not expired (15 minutes)
   * 3. User is superadmin
   */
  async verifySuperadminSessionTTL(sessionId: string): Promise<{ valid: boolean; reason?: string }> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT s.id, s.user_id, s.created_at, u.role
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1 AND s.is_active = true`,
        [sessionId]
      );

      if (result.rows.length === 0) {
        return { valid: false, reason: 'Session not found' };
      }

      const session = result.rows[0];
      
      // Check if user is superadmin
      if (session.role !== 'superadmin') {
        return { valid: false, reason: 'User is not superadmin' };
      }

      // Check TTL (15 minutes maximum)
      const sessionAge = Date.now() - new Date(session.created_at).getTime();
      if (sessionAge > SUPERADMIN_SESSION_TTL) {
        return { valid: false, reason: 'Superadmin session expired (15 min TTL)' };
      }

      return { valid: true };
    } finally {
      client.release();
    }
  }

  /**
   * Verify IP address is allowlisted for superadmin user
   */
  async verifySuperadminIP(userId: string, ipAddress: string): Promise<{ allowed: boolean; reason?: string }> {
    const client = await this.db.getClient();
    try {
      // Query allowlisted IPs and ranges
      const result = await client.query(
        `SELECT ip_address, ip_range
         FROM superadmin_ip_allowlist
         WHERE superadmin_user_id = $1 AND is_active = true`,
        [userId]
      );

      if (result.rows.length === 0) {
        return { allowed: false, reason: 'No allowlisted IPs configured' };
      }

      // Check exact IP match
      const ipMatches = result.rows.some(row => row.ip_address && row.ip_address === ipAddress);
      if (ipMatches) {
        return { allowed: true };
      }

      // Check CIDR range match
      const rangeMatches = result.rows.some(row => {
        if (!row.ip_range) return false;
        try {
          // Use simple CIDR matching - in production, use a library like 'ip-cidr'
          const [network, prefix] = row.ip_range.split('/');
          const networkNum = this.ipToNumber(network);
          const inputNum = this.ipToNumber(ipAddress);
          const mask = -1 << (32 - parseInt(prefix));
          return (networkNum & mask) === (inputNum & mask);
        } catch {
          return false;
        }
      });

      if (rangeMatches) {
        return { allowed: true };
      }

      // IP not allowlisted - record violation
      await this.recordIPViolation(userId, ipAddress, 'Unknown operation');

      return { allowed: false, reason: 'IP address not allowlisted' };
    } finally {
      client.release();
    }
  }

  /**
   * Record IP violation for security alerts
   */
  private async recordIPViolation(userId: string, ipAddress: string, attemptedOperation: string): Promise<void> {
    const client = await this.db.getClient();
    try {
      await client.query(
        `INSERT INTO superadmin_ip_violations
         (ip_address, user_id, attempted_operation)
         VALUES ($1, $2, $3)`,
        [ipAddress, userId, attemptedOperation]
      );

      // In production, this would trigger an alert to on-call
      console.warn(`⚠️  SUPERADMIN IP VIOLATION: User ${userId} from ${ipAddress}`);
    } finally {
      client.release();
    }
  }

  /**
   * Verify MFA is current for this specific operation
   * MFA verification valid for 5 minutes
   */
  async verifyOperationMFA(sessionId: string, operationType: string): Promise<{ verified: boolean; reason?: string }> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT verified_at, expires_at
         FROM superadmin_mfa_verifications
         WHERE session_id = $1 AND operation_type = $2 AND verification_result = 'PASS'
         ORDER BY verified_at DESC
         LIMIT 1`,
        [sessionId, operationType]
      );

      if (result.rows.length === 0) {
        return { verified: false, reason: 'MFA verification required' };
      }

      const verification = result.rows[0];
      const now = new Date();

      // Check if still valid (within 5 minutes)
      if (verification.expires_at && new Date(verification.expires_at) < now) {
        return { verified: false, reason: 'MFA verification expired' };
      }

      return { verified: true };
    } finally {
      client.release();
    }
  }

  /**
   * Record MFA verification
   */
  async recordMFAVerification(
    sessionId: string,
    userId: string,
    operationType: string,
    ipAddress: string
  ): Promise<void> {
    const client = await this.db.getClient();
    try {
      // Verification valid for 5 minutes
      const expiresAt = new Date(Date.now() + MFA_VERIFICATION_VALIDITY);

      await client.query(
        `INSERT INTO superadmin_mfa_verifications
         (session_id, user_id, mfa_method, verification_result, operation_type, expires_at, ip_address)
         VALUES ($1, $2, 'TOTP', 'PASS', $3, $4, $5)`,
        [sessionId, userId, operationType, expiresAt, ipAddress]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Record a superadmin operation with immutable checksum
   */
  async recordOperation(
    sessionId: string,
    userId: string,
    operationType: string,
    operationParams: Record<string, any>,
    ipAddress: string,
    mfaVerified: boolean,
    mfaVerifiedAt: Date
  ): Promise<SuperadminOperation> {
    const client = await this.db.getClient();
    try {
      const operationId = uuidv4();
      const performedAt = new Date();

      // Calculate checksum: SHA256(user_id || operation_type || params || performed_at)
      const checksumInput = `${userId}||${operationType}||${JSON.stringify(operationParams)}||${performedAt.toISOString()}`;
      const checksum = crypto.createHash('sha256').update(checksumInput).digest('hex');

      const result = await client.query(
        `INSERT INTO superadmin_operations
         (id, session_id, user_id, operation_type, operation_params, execution_status,
          ip_address, mfa_verified, mfa_verified_at, performed_at, checksum)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $9, $10)
         RETURNING *`,
        [operationId, sessionId, userId, operationType, JSON.stringify(operationParams),
         ipAddress, mfaVerified, mfaVerifiedAt, performedAt, checksum]
      );

      return this.rowToOperation(result.rows[0]);
    } finally {
      client.release();
    }
  }

  /**
   * Update operation status after dry-run
   */
  async updateOperationDryRun(
    operationId: string,
    dryRunResult: Record<string, any>,
    affectedRowsCount: number
  ): Promise<void> {
    const client = await this.db.getClient();
    try {
      // Note: This will fail due to immutability trigger - that's intentional for audit trail
      // Instead, we create a new operation record with COMPLETED status
      // For now, we just update before the operation is locked
      await client.query(
        `UPDATE superadmin_operations
         SET dry_run_result = $1, affected_rows_count = $2
         WHERE id = $3 AND execution_status = 'PENDING'`,
        [JSON.stringify(dryRunResult), affectedRowsCount, operationId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Confirm dry-run and proceed with execution
   */
  async confirmDryRunAndExecute(operationId: string): Promise<void> {
    const client = await this.db.getClient();
    try {
      await client.query(
        `UPDATE superadmin_operations
         SET dry_run_confirmed = true, execution_status = 'EXECUTING'
         WHERE id = $1 AND execution_status = 'PENDING'`,
        [operationId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Mark operation as completed
   */
  async markOperationCompleted(operationId: string, affectedRowsCount: number): Promise<void> {
    const client = await this.db.getClient();
    try {
      await client.query(
        `UPDATE superadmin_operations
         SET execution_status = 'COMPLETED', affected_rows_count = $1, completed_at = NOW()
         WHERE id = $2`,
        [affectedRowsCount, operationId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Mark operation as failed with rollback
   */
  async markOperationFailed(operationId: string, errorMessage: string): Promise<void> {
    const client = await this.db.getClient();
    try {
      await client.query(
        `UPDATE superadmin_operations
         SET execution_status = 'FAILED', notes = $1, completed_at = NOW()
         WHERE id = $2`,
        [errorMessage, operationId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Verify operation checksum hasn't been tampered with
   */
  async verifyOperationChecksum(operationId: string): Promise<{ valid: boolean; reason?: string }> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT user_id, operation_type, operation_params, performed_at, checksum
         FROM superadmin_operations
         WHERE id = $1`,
        [operationId]
      );

      if (result.rows.length === 0) {
        return { valid: false, reason: 'Operation not found' };
      }

      const operation = result.rows[0];

      // Recalculate checksum
      const checksumInput = `${operation.user_id}||${operation.operation_type}||${JSON.stringify(operation.operation_params)}||${operation.performed_at.toISOString()}`;
      const calculatedChecksum = crypto.createHash('sha256').update(checksumInput).digest('hex');

      if (calculatedChecksum !== operation.checksum) {
        console.error(`🚨 AUDIT LOG TAMPER DETECTED: Operation ${operationId}`);
        return { valid: false, reason: 'Checksum mismatch - audit log may be tampered' };
      }

      return { valid: true };
    } finally {
      client.release();
    }
  }

  /**
   * Get operation details with full audit trail
   */
  async getOperationDetails(operationId: string): Promise<SuperadminOperation | null> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM superadmin_operations WHERE id = $1`,
        [operationId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.rowToOperation(result.rows[0]);
    } finally {
      client.release();
    }
  }

  /**
   * Get all operations for a user (paginated)
   */
  async getUserOperations(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ operations: SuperadminOperation[]; total: number }> {
    const client = await this.db.getClient();
    try {
      const countResult = await client.query(
        `SELECT COUNT(*) as count FROM superadmin_operations WHERE user_id = $1`,
        [userId]
      );

      const result = await client.query(
        `SELECT * FROM superadmin_operations
         WHERE user_id = $1
         ORDER BY performed_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      return {
        operations: result.rows.map(row => this.rowToOperation(row)),
        total: parseInt(countResult.rows[0].count)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get failed/rolled-back operations for audit investigation
   */
  async getFailedOperations(limit: number = 50): Promise<SuperadminOperation[]> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM superadmin_failed_operations
         ORDER BY performed_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => this.rowToOperation(row));
    } finally {
      client.release();
    }
  }

  /**
   * Get pending operations awaiting confirmation
   */
  async getPendingOperations(): Promise<SuperadminOperation[]> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM superadmin_pending_operations
         ORDER BY performed_at ASC`
      );

      return result.rows.map(row => this.rowToOperation(row));
    } finally {
      client.release();
    }
  }

  /**
   * Add IP to allowlist
   */
  async addIPAllowlist(
    superadminUserId: string,
    ip: string | null,
    ipRange: string | null,
    label: string,
    addedBy: string
  ): Promise<IPAllowlistEntry> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `INSERT INTO superadmin_ip_allowlist
         (superadmin_user_id, ip_address, ip_range, label, added_by, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [superadminUserId, ip, ipRange, label, addedBy]
      );

      return this.rowToIPAllowlist(result.rows[0]);
    } finally {
      client.release();
    }
  }

  /**
   * Remove IP from allowlist
   */
  async removeIPAllowlist(allowlistId: string, removedBy: string): Promise<void> {
    const client = await this.db.getClient();
    try {
      await client.query(
        `UPDATE superadmin_ip_allowlist
         SET is_active = false, removed_by = $1, removed_at = NOW()
         WHERE id = $2`,
        [removedBy, allowlistId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get allowlist entries for a superadmin user
   */
  async getUserAllowlist(userId: string): Promise<IPAllowlistEntry[]> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM superadmin_ip_allowlist
         WHERE superadmin_user_id = $1 AND is_active = true
         ORDER BY added_at DESC`,
        [userId]
      );

      return result.rows.map(row => this.rowToIPAllowlist(row));
    } finally {
      client.release();
    }
  }

  /**
   * Get IP violations for investigation
   */
  async getIPViolations(limit: number = 100): Promise<IPViolation[]> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM superadmin_ip_violations
         ORDER BY denied_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        ipAddress: row.ip_address,
        userId: row.user_id,
        attemptedOperation: row.attempted_operation,
        deniedAt: row.denied_at,
        alertSent: row.alert_sent
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Helper: Convert IP to number for CIDR matching
   */
  private ipToNumber(ip: string): number {
    const parts = ip.split('.');
    return (parseInt(parts[0]) << 24) + (parseInt(parts[1]) << 16) + 
           (parseInt(parts[2]) << 8) + parseInt(parts[3]);
  }

  /**
   * Helper: Map database row to SuperadminOperation
   */
  private rowToOperation(row: any): SuperadminOperation {
    return {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      operationType: row.operation_type,
      operationParams: row.operation_params,
      dryRunResult: row.dry_run_result,
      dryRunConfirmed: row.dry_run_confirmed,
      executionStatus: row.execution_status,
      affectedRowsCount: row.affected_rows_count,
      ipAddress: row.ip_address,
      mfaVerified: row.mfa_verified,
      mfaVerifiedAt: row.mfa_verified_at,
      performedAt: row.performed_at,
      completedAt: row.completed_at,
      notes: row.notes,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      checksum: row.checksum
    };
  }

  /**
   * Helper: Map database row to IPAllowlistEntry
   */
  private rowToIPAllowlist(row: any): IPAllowlistEntry {
    return {
      id: row.id,
      superadminUserId: row.superadmin_user_id,
      ipAddress: row.ip_address,
      ipRange: row.ip_range,
      label: row.label,
      addedBy: row.added_by,
      addedAt: row.added_at,
      removedBy: row.removed_by,
      removedAt: row.removed_at,
      isActive: row.is_active
    };
  }
}
