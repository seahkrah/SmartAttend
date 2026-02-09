/**
 * PHASE 6: Superadmin Session Management Service
 *
 * Manages superadmin sessions with:
 * - 15-minute TTL (no refresh)
 * - Mandatory MFA verification
 * - Per-operation MFA challenges
 */

import { Database } from '../connection';
import { v4 as uuidv4 } from 'uuid';

export interface SuperadminSession {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string;
  mfaVerifiedAt?: Date;
  isActive: boolean;
}

const SUPERADMIN_SESSION_TTL = 15 * 60 * 1000; // 15 minutes
const SUPERADMIN_SESSION_REFRESH_ALLOWED = false;

export class SuperadminSessionManagementService {
  constructor(private db: Database) {}

  /**
   * Create a new superadmin session
   * - Only for authenticated superadmin users
   * - Only after MFA verification
   */
  async createSuperadminSession(
    userId: string,
    ipAddress: string,
    verifiedByMFA: boolean
  ): Promise<SuperadminSession> {
    const client = await this.db.getClient();
    try {
      // Verify user is superadmin
      const userResult = await client.query(
        `SELECT id, role FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0 || userResult.rows[0].role !== 'superadmin') {
        throw new Error('User is not superadmin');
      }

      // Create session with 15-minute TTL
      const sessionId = uuidv4();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + SUPERADMIN_SESSION_TTL);
      const mfaVerifiedAt = verifiedByMFA ? createdAt : null;

      const result = await client.query(
        `INSERT INTO sessions
         (id, user_id, created_at, expires_at, is_active, superadmin_session_start_at, superadmin_ip_address, superadmin_mfa_verified_at)
         VALUES ($1, $2, $3, $4, true, $3, $5, $6)
         RETURNING id, user_id, created_at, expires_at, is_active`,
        [sessionId, userId, createdAt, expiresAt, ipAddress, mfaVerifiedAt]
      );

      return {
        id: result.rows[0].id,
        userId: result.rows[0].user_id,
        createdAt: result.rows[0].created_at,
        expiresAt: result.rows[0].expires_at,
        ipAddress,
        mfaVerifiedAt: mfaVerifiedAt || undefined,
        isActive: result.rows[0].is_active
      };
    } finally {
      client.release();
    }
  }

  /**
   * Verify superadmin session is still valid
   * - TTL not expired
   * - Session is active
   * - User is still superadmin
   */
  async verifySuperadminSessionValid(sessionId: string): Promise<{ valid: boolean; reason?: string }> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.is_active, u.role
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [sessionId]
      );

      if (result.rows.length === 0) {
        return { valid: false, reason: 'Session not found' };
      }

      const session = result.rows[0];

      if (!session.is_active) {
        return { valid: false, reason: 'Session is not active' };
      }

      if (session.role !== 'superadmin') {
        return { valid: false, reason: 'User is not superadmin' };
      }

      // Check TTL expiration
      const now = new Date();
      if (new Date(session.expires_at) < now) {
        return { valid: false, reason: 'Superadmin session expired (15 minute TTL)' };
      }

      return { valid: true };
    } finally {
      client.release();
    }
  }

  /**
   * Get remaining session validity time in seconds
   */
  async getSessionRemainingTime(sessionId: string): Promise<number> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT expires_at FROM sessions WHERE id = $1 AND is_active = true`,
        [sessionId]
      );

      if (result.rows.length === 0) {
        return 0;
      }

      const expiresAt = new Date(result.rows[0].expires_at);
      const now = new Date();
      const remainingMs = expiresAt.getTime() - now.getTime();

      return Math.max(0, Math.floor(remainingMs / 1000));
    } finally {
      client.release();
    }
  }

  /**
   * Check if session requires MFA verification
   */
  async getSessionMFAStatus(sessionId: string): Promise<{ requiresMFA: boolean; lastVerifiedAt?: Date }> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT superadmin_mfa_verified_at FROM sessions WHERE id = $1`,
        [sessionId]
      );

      if (result.rows.length === 0) {
        return { requiresMFA: true };
      }

      const mfaVerifiedAt = result.rows[0].superadmin_mfa_verified_at;

      // Session created after MFA verification
      if (mfaVerifiedAt) {
        return {
          requiresMFA: false,
          lastVerifiedAt: mfaVerifiedAt
        };
      }

      return { requiresMFA: true };
    } finally {
      client.release();
    }
  }

  /**
   * Verify MFA is current for this specific operation
   * MFA verification expires after 5 minutes
   */
  async requireOperationMFA(
    sessionId: string,
    operationType: string
  ): Promise<{ requiresMFA: boolean; validUntil?: Date }> {
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
        return { requiresMFA: true };
      }

      const verification = result.rows[0];
      const now = new Date();

      // Check if still valid
      if (verification.expires_at && new Date(verification.expires_at) < now) {
        return { requiresMFA: true };
      }

      return {
        requiresMFA: false,
        validUntil: verification.expires_at
      };
    } finally {
      client.release();
    }
  }

  /**
   * Invalidate session immediately (used when TTL expires or security issue detected)
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const client = await this.db.getClient();
    try {
      await client.query(
        `UPDATE sessions SET is_active = false WHERE id = $1`,
        [sessionId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get all active superadmin sessions
   */
  async getActiveSuperadminSessions(): Promise<SuperadminSession[]> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.superadmin_ip_address as ip_address, s.superadmin_mfa_verified_at as mfa_verified_at, s.is_active
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE u.role = 'superadmin' AND s.is_active = true AND s.expires_at > NOW()
         ORDER BY s.created_at DESC`
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        ipAddress: row.ip_address,
        mfaVerifiedAt: row.mfa_verified_at,
        isActive: row.is_active
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Force invalidate all sessions for a specific user (security incident)
   */
  async invalidateUserSessions(userId: string): Promise<number> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `UPDATE sessions SET is_active = false WHERE user_id = $1 AND is_active = true
         RETURNING id`,
        [userId]
      );

      console.warn(`⚠️ INVALIDATED ${result.rows.length} session(s) for user ${userId}`);
      return result.rows.length;
    } finally {
      client.release();
    }
  }

  /**
   * Check if refresh is allowed (it's not for superadmin)
   */
  async isRefreshAllowed(): Promise<boolean> {
    return SUPERADMIN_SESSION_REFRESH_ALLOWED;
  }

  /**
   * Get session TTL configuration
   */
  getSessionTTLConfig(): { ttlMs: number; ttlMinutes: number } {
    return {
      ttlMs: SUPERADMIN_SESSION_TTL,
      ttlMinutes: SUPERADMIN_SESSION_TTL / 60000
    };
  }

  /**
   * Cleanup expired sessions (should run periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const client = await this.db.getClient();
    try {
      // Mark expired sessions as inactive
      const result = await client.query(
        `UPDATE sessions
         SET is_active = false
         WHERE expires_at < NOW() AND is_active = true
         RETURNING id`
      );

      if (result.rows.length > 0) {
        console.log(`🧹 Cleaned up ${result.rows.length} expired superadmin session(s)`);
      }

      return result.rows.length;
    } finally {
      client.release();
    }
  }
}
