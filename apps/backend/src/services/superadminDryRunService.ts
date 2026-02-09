/**
 * PHASE 6: Superadmin Dry-Run Service
 *
 * Generates previews of destructive operations before execution
 * Prevents accidents by showing what WILL happen
 */

import { Database } from '../connection';

export interface DryRunResult {
  operationType: string;
  affectedRowsCount: number;
  preview: Array<Record<string, any>>;
  estimatedImpact: string;
  warning?: string;
}

export class SuperadminDryRunService {
  constructor(private db: Database) {}

  /**
   * Generate dry-run preview for DELETE_ROLE operation
   * Shows which users will be affected
   */
  async dryRunDeleteRole(roleId: string): Promise<DryRunResult> {
    const client = await this.db.getClient();
    try {
      // Get affected users
      const result = await client.query(
        `SELECT id, email, username, display_name, school_year, section
         FROM users
         WHERE role_id = $1
         ORDER BY email
         LIMIT 100`,
        [roleId]
      );

      const affectedUser = await client.query(
        `SELECT COUNT(*) as count FROM users WHERE role_id = $1`,
        [roleId]
      );

      if (result.rows.length === 0) {
        return {
          operationType: 'DELETE_ROLE',
          affectedRowsCount: 0,
          preview: [],
          estimatedImpact: 'No users will be affected'
        };
      }

      const totalCount = parseInt(affectedUser.rows[0].count);
      const moreCount = totalCount - result.rows.length;

      return {
        operationType: 'DELETE_ROLE',
        affectedRowsCount: totalCount,
        preview: result.rows,
        estimatedImpact: `Will affect ${totalCount} user(s)`,
        warning: moreCount > 0 ? `(${moreCount} more not shown in preview)` : undefined
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generate dry-run preview for DELETE_USER_FROM_ROLE operation
   * Shows which specific users will be removed
   */
  async dryRunDeleteUsersFromRole(roleId: string, userIds: string[]): Promise<DryRunResult> {
    const client = await this.db.getClient();
    try {
      // Validate all users exist and have this role
      const result = await client.query(
        `SELECT id, email, username, display_name, school_year, section
         FROM users
         WHERE id = ANY($1::uuid[]) AND role_id = $2
         ORDER BY email`,
        [userIds, roleId]
      );

      if (result.rows.length === 0) {
        return {
          operationType: 'DELETE_USER_FROM_ROLE',
          affectedRowsCount: 0,
          preview: [],
          estimatedImpact: 'No users match criteria',
          warning: 'Operation will have no effect'
        };
      }

      // Check if any users weren't found or don't have this role
      const notFoundCount = userIds.length - result.rows.length;

      return {
        operationType: 'DELETE_USER_FROM_ROLE',
        affectedRowsCount: result.rows.length,
        preview: result.rows,
        estimatedImpact: `Will remove ${result.rows.length} user(s) from role`,
        warning: notFoundCount > 0 ? `(${notFoundCount} user IDs weren't found or don't have this role)` : undefined
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generate dry-run preview for UPDATE_PERMISSION operation
   * Shows which roles will be affected
   */
  async dryRunUpdatePermission(permissionId: string, roleId: string): Promise<DryRunResult> {
    const client = await this.db.getClient();
    try {
      // Find roles with this permission
      const rolesResult = await client.query(
        `SELECT DISTINCT role_id, COUNT(*) as user_count
         FROM users u
         JOIN role_permissions rp ON u.role_id = rp.role_id
         WHERE rp.permission_id = $1
         GROUP BY role_id`,
        [permissionId]
      );

      if (rolesResult.rows.length === 0) {
        return {
          operationType: 'UPDATE_PERMISSION',
          affectedRowsCount: 0,
          preview: [],
          estimatedImpact: 'No roles currently have this permission'
        };
      }

      const totalUsers = rolesResult.rows.reduce((sum, row) => sum + row.user_count, 0);

      return {
        operationType: 'UPDATE_PERMISSION',
        affectedRowsCount: totalUsers,
        preview: rolesResult.rows.map(row => ({
          role_id: row.role_id,
          user_count: row.user_count
        })),
        estimatedImpact: `Will affect ${totalUsers} user(s) across ${rolesResult.rows.length} role(s)`
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generate dry-run preview for DELETE_ATTENDANCE_RECORDS operation
   * Shows which attendance records will be deleted
   */
  async dryRunDeleteAttendanceRecords(
    startDate: Date,
    endDate: Date,
    filters?: { section?: string; year?: string }
  ): Promise<DryRunResult> {
    const client = await this.db.getClient();
    try {
      let query = `
        SELECT COUNT(*) as count, school_year, section
        FROM attendance_records ar
        WHERE ar.date >= $1 AND ar.date <= $2
      `;

      const params: any[] = [startDate, endDate];

      if (filters?.section) {
        query += ` AND ar.section = $3`;
        params.push(filters.section);
      }

      if (filters?.year) {
        query += ` AND ar.school_year = $${params.length + 1}`;
        params.push(filters.year);
      }

      query += ` GROUP BY ar.school_year, ar.section`;

      const result = await client.query(query, params);

      if (result.rows.length === 0) {
        return {
          operationType: 'DELETE_ATTENDANCE_RECORDS',
          affectedRowsCount: 0,
          preview: [],
          estimatedImpact: 'No records match criteria',
          warning: 'Operation will have no effect'
        };
      }

      const totalCount = result.rows.reduce((sum, row) => sum + row.count, 0);

      return {
        operationType: 'DELETE_ATTENDANCE_RECORDS',
        affectedRowsCount: totalCount,
        preview: result.rows,
        estimatedImpact: `Will delete ${totalCount} attendance record(s)`,
        warning: 'This is permanent and cannot be undone'
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generate dry-run preview for RESET_USER_MFA operation
   * Shows which users will lose MFA
   */
  async dryRunResetUserMFA(userIds: string[]): Promise<DryRunResult> {
    const client = await this.db.getClient();
    try {
      const result = await client.query(
        `SELECT id, email, username, display_name, mfa_enabled, mfa_enabled_at
         FROM users
         WHERE id = ANY($1::uuid[]) AND mfa_enabled = true
         ORDER BY email`,
        [userIds]
      );

      if (result.rows.length === 0) {
        return {
          operationType: 'RESET_USER_MFA',
          affectedRowsCount: 0,
          preview: [],
          estimatedImpact: 'No users have MFA enabled',
          warning: 'Operation will have no effect'
        };
      }

      return {
        operationType: 'RESET_USER_MFA',
        affectedRowsCount: result.rows.length,
        preview: result.rows,
        estimatedImpact: `Will disable MFA for ${result.rows.length} user(s)`,
        warning: 'Users will need to set up MFA again'
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generic dry-run for arbitrary operation
   * Validates parameters before execution
   */
  async validateOperationParams(
    operationType: string,
    params: Record<string, any>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    switch (operationType) {
      case 'DELETE_ROLE':
        if (!params.roleId) errors.push('Missing roleId');
        break;

      case 'DELETE_USER_FROM_ROLE':
        if (!params.roleId) errors.push('Missing roleId');
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          errors.push('Missing or invalid userIds array');
        }
        break;

      case 'UPDATE_PERMISSION':
        if (!params.permissionId) errors.push('Missing permissionId');
        if (!params.roleId) errors.push('Missing roleId');
        break;

      case 'DELETE_ATTENDANCE_RECORDS':
        if (!params.startDate) errors.push('Missing startDate');
        if (!params.endDate) errors.push('Missing endDate');
        if (new Date(params.startDate) > new Date(params.endDate)) {
          errors.push('startDate must be before endDate');
        }
        break;

      case 'RESET_USER_MFA':
        if (!params.userIds || !Array.isArray(params.userIds) || params.userIds.length === 0) {
          errors.push('Missing or invalid userIds array');
        }
        break;

      default:
        errors.push(`Unknown operation type: ${operationType}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Safety check: prevent operations that affect too many rows
   * (configurable threshold)
   */
  async checkOperationScale(
    operationType: string,
    affectedRowsCount: number,
    threshold: number = 1000
  ): Promise<{ safe: boolean; warning?: string }> {
    if (affectedRowsCount > threshold) {
      return {
        safe: false,
        warning: `Operation will affect ${affectedRowsCount} rows (threshold: ${threshold}). Requires secondary approval.`
      };
    }

    return { safe: true };
  }
}
