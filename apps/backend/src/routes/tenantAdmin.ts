/**
 * Tenant Admin Routes
 * 
 * Endpoints for school and corporate admins to manage their entities
 */

import { Router, Request, Response } from 'express';
import { query } from '../db/connection.js';
import { authenticateToken } from '../auth/middleware.js';

const router = Router();

// Middleware to verify admin role and get their entity
async function getAdminEntity(req: Request, res: Response, platform: 'school' | 'corporate') {
  if (!req.user) {
    res.status(401).json({ error: 'User not authenticated' });
    return null;
  }

  // Verify user is admin
  const userResult = await query(
    `SELECT u.*, r.name as role_name, p.name as platform_name
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN platforms p ON u.platform_id = p.id
     WHERE u.id = $1`,
    [req.user.userId]
  );

  if (userResult.rows.length === 0) {
    res.status(401).json({ error: 'User not found' });
    return null;
  }

  const user = userResult.rows[0];

  if (user.role_name !== 'admin') {
    res.status(403).json({ error: 'Admin role required' });
    return null;
  }

  if (user.platform_name !== platform) {
    res.status(403).json({ error: `${platform} platform required` });
    return null;
  }

  // Get admin's entity
  let entityResult;
  if (platform === 'school') {
    entityResult = await query(
      `SELECT * FROM school_entities WHERE admin_user_id = $1`,
      [req.user.userId]
    );
  } else {
    entityResult = await query(
      `SELECT * FROM corporate_entities WHERE admin_user_id = $1`,
      [req.user.userId]
    );
  }

  if (entityResult.rows.length === 0) {
    res.status(403).json({ error: 'No entity assigned to this admin' });
    return null;
  }

  return {
    user,
    entity: entityResult.rows[0]
  };
}

// ===========================
// SCHOOL ADMIN ROUTES
// ===========================

// Get school admin dashboard stats
router.get('/school/stats', authenticateToken, async (req: Request, res: Response) => {
  console.log('[TENANT_ADMIN] GET /school/stats called');
  try {
    const adminData = await getAdminEntity(req, res, 'school');
    if (!adminData) return;

    const { entity } = adminData;

    // Get total users
    const usersResult = await query(
      `SELECT COUNT(*) as count
       FROM school_user_associations sua
       JOIN users u ON sua.user_id = u.id
       WHERE sua.school_entity_id = $1`,
      [entity.id]
    );

    // Get active users
    const activeUsersResult = await query(
      `SELECT COUNT(*) as count
       FROM school_user_associations sua
       JOIN users u ON sua.user_id = u.id
       WHERE sua.school_entity_id = $1 AND sua.status = 'active' AND u.is_active = true`,
      [entity.id]
    );

    // Get pending approvals
    const approvalsResult = await query(
      `SELECT COUNT(*) as count
       FROM user_registration_requests urr
       WHERE urr.entity_id = $1 AND urr.status = 'pending'`,
      [entity.id]
    );

    // Get attendance rate (last 30 days)
    const attendanceResult = await query(
      `SELECT 
        COUNT(CASE WHEN status IN ('present', 'late') THEN 1 END)::float / 
        NULLIF(COUNT(*)::float, 0) * 100 as rate
       FROM school_attendance
       WHERE created_at >= NOW() - INTERVAL '30 days'`,
      []
    );

    // Get recent activity
    const activityResult = await query(
      `SELECT 
        al.action,
        al.created_at,
        u.full_name as user_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.entity_type = 'school_entity' AND al.entity_id = $1
       ORDER BY al.created_at DESC
       LIMIT 10`,
      [entity.id]
    );

    return res.json({
      totalUsers: parseInt(usersResult.rows[0].count),
      activeUsers: parseInt(activeUsersResult.rows[0].count),
      pendingApprovals: parseInt(approvalsResult.rows[0].count),
      attendanceRate: parseFloat(attendanceResult.rows[0]?.rate || '0').toFixed(1),
      recentActivity: activityResult.rows.map(row => ({
        action: row.action,
        timestamp: row.created_at,
        userName: row.user_name
      })),
      entity: {
        id: entity.id,
        name: entity.name,
        code: entity.code
      }
    });
  } catch (error: any) {
    console.error('Get school stats error:', error);
    return res.status(500).json({ error: error.message || 'Failed to get stats' });
  }
});

// Get school users
router.get('/school/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'school');
    if (!adminData) return;

    const { entity } = adminData;

    const usersResult = await query(
      `SELECT 
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.is_active,
        u.created_at,
        u.last_login,
        r.name as role,
        sua.status as association_status
       FROM school_user_associations sua
       JOIN users u ON sua.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE sua.school_entity_id = $1
       ORDER BY u.created_at DESC`,
      [entity.id]
    );

    return res.json({
      users: usersResult.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        isActive: row.is_active,
        status: row.association_status,
        createdAt: row.created_at,
        lastLogin: row.last_login
      }))
    });
  } catch (error: any) {
    console.error('Get school users error:', error);
    return res.status(500).json({ error: error.message || 'Failed to get users' });
  }
});

// Update school user
router.patch('/school/users/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'school');
    if (!adminData) return;

    const { entity } = adminData;
    const { userId } = req.params;
    const { action } = req.body; // 'activate', 'suspend', 'disable'

    // Verify user belongs to this entity
    const userCheck = await query(
      `SELECT * FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
      [userId, entity.id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in this entity' });
    }

    // Update based on action
    switch (action) {
      case 'activate':
        await query(
          `UPDATE school_user_associations SET status = 'active' WHERE user_id = $1 AND school_entity_id = $2`,
          [userId, entity.id]
        );
        await query(
          `UPDATE users SET is_active = true WHERE id = $1`,
          [userId]
        );
        break;
      case 'suspend':
        await query(
          `UPDATE school_user_associations SET status = 'suspended' WHERE user_id = $1 AND school_entity_id = $2`,
          [userId, entity.id]
        );
        break;
      case 'disable':
        await query(
          `UPDATE school_user_associations SET status = 'inactive' WHERE user_id = $1 AND school_entity_id = $2`,
          [userId, entity.id]
        );
        await query(
          `UPDATE users SET is_active = false WHERE id = $1`,
          [userId]
        );
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    return res.json({ message: 'User updated successfully' });
  } catch (error: any) {
    console.error('Update school user error:', error);
    return res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// Delete school user
router.delete('/school/users/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'school');
    if (!adminData) return;

    const { entity } = adminData;
    const { userId } = req.params;

    // Verify user belongs to this entity
    const userCheck = await query(
      `SELECT * FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
      [userId, entity.id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in this entity' });
    }

    // Delete association (or mark as deleted)
    await query(
      `DELETE FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
      [userId, entity.id]
    );

    return res.json({ message: 'User removed from entity successfully' });
  } catch (error: any) {
    console.error('Delete school user error:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

// ===========================
// CORPORATE ADMIN ROUTES
// ===========================

// Get corporate admin dashboard stats
router.get('/corporate/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'corporate');
    if (!adminData) return;

    const { entity } = adminData;

    // Get total users
    const usersResult = await query(
      `SELECT COUNT(*) as count
       FROM corporate_user_associations cua
       JOIN users u ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1`,
      [entity.id]
    );

    // Get active users
    const activeUsersResult = await query(
      `SELECT COUNT(*) as count
       FROM corporate_user_associations cua
       JOIN users u ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1 AND cua.status = 'active' AND u.is_active = true`,
      [entity.id]
    );

    // Get pending approvals
    const approvalsResult = await query(
      `SELECT COUNT(*) as count
       FROM user_registration_requests urr
       WHERE urr.entity_id = $1 AND urr.status = 'pending'`,
      [entity.id]
    );

    // Get check-in rate (last 30 days)
    const checkinResult = await query(
      `SELECT 
        COUNT(CASE WHEN status = 'checked_in' THEN 1 END)::float / 
        NULLIF(COUNT(*)::float, 0) * 100 as rate
       FROM corporate_checkins
       WHERE created_at >= NOW() - INTERVAL '30 days'`,
      []
    );

    // Get recent activity
    const activityResult = await query(
      `SELECT 
        al.action,
        al.created_at,
        u.full_name as user_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.entity_type = 'corporate_entity' AND al.entity_id = $1
       ORDER BY al.created_at DESC
       LIMIT 10`,
      [entity.id]
    );

    return res.json({
      totalUsers: parseInt(usersResult.rows[0].count),
      activeUsers: parseInt(activeUsersResult.rows[0].count),
      pendingApprovals: parseInt(approvalsResult.rows[0].count),
      checkinRate: parseFloat(checkinResult.rows[0]?.rate || '0').toFixed(1),
      recentActivity: activityResult.rows.map(row => ({
        action: row.action,
        timestamp: row.created_at,
        userName: row.user_name
      })),
      entity: {
        id: entity.id,
        name: entity.name,
        code: entity.code
      }
    });
  } catch (error: any) {
    console.error('Get corporate stats error:', error);
    return res.status(500).json({ error: error.message || 'Failed to get stats' });
  }
});

// Get corporate users
router.get('/corporate/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'corporate');
    if (!adminData) return;

    const { entity } = adminData;

    const usersResult = await query(
      `SELECT 
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.is_active,
        u.created_at,
        u.last_login,
        r.name as role,
        cua.status as association_status
       FROM corporate_user_associations cua
       JOIN users u ON cua.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE cua.corporate_entity_id = $1
       ORDER BY u.created_at DESC`,
      [entity.id]
    );

    return res.json({
      users: usersResult.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        isActive: row.is_active,
        status: row.association_status,
        createdAt: row.created_at,
        lastLogin: row.last_login
      }))
    });
  } catch (error: any) {
    console.error('Get corporate users error:', error);
    return res.status(500).json({ error: error.message || 'Failed to get users' });
  }
});

// Update corporate user
router.patch('/corporate/users/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'corporate');
    if (!adminData) return;

    const { entity } = adminData;
    const { userId } = req.params;
    const { action } = req.body;

    // Verify user belongs to this entity
    const userCheck = await query(
      `SELECT * FROM corporate_user_associations WHERE user_id = $1 AND corporate_entity_id = $2`,
      [userId, entity.id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in this entity' });
    }

    // Update based on action
    switch (action) {
      case 'activate':
        await query(
          `UPDATE corporate_user_associations SET status = 'active' WHERE user_id = $1 AND corporate_entity_id = $2`,
          [userId, entity.id]
        );
        await query(
          `UPDATE users SET is_active = true WHERE id = $1`,
          [userId]
        );
        break;
      case 'suspend':
        await query(
          `UPDATE corporate_user_associations SET status = 'suspended' WHERE user_id = $1 AND corporate_entity_id = $2`,
          [userId, entity.id]
        );
        break;
      case 'disable':
        await query(
          `UPDATE corporate_user_associations SET status = 'inactive' WHERE user_id = $1 AND corporate_entity_id = $2`,
          [userId, entity.id]
        );
        await query(
          `UPDATE users SET is_active = false WHERE id = $1`,
          [userId]
        );
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    return res.json({ message: 'User updated successfully' });
  } catch (error: any) {
    console.error('Update corporate user error:', error);
    return res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// Delete corporate user
router.delete('/corporate/users/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const adminData = await getAdminEntity(req, res, 'corporate');
    if (!adminData) return;

    const { entity } = adminData;
    const { userId } = req.params;

    // Verify user belongs to this entity
    const userCheck = await query(
      `SELECT * FROM corporate_user_associations WHERE user_id = $1 AND corporate_entity_id = $2`,
      [userId, entity.id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in this entity' });
    }

    // Delete association
    await query(
      `DELETE FROM corporate_user_associations WHERE user_id = $1 AND corporate_entity_id = $2`,
      [userId, entity.id]
    );

    return res.json({ message: 'User removed from entity successfully' });
  } catch (error: any) {
    console.error('Delete corporate user error:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

export default router;
