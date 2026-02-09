/**
 * Superadmin Service
 * 
 * Endpoints:
 * - System Diagnostics
 * - Tenant Management (create, suspend, restore)
 * - User Lockout Management
 * - Audit Trail
 */

import { axiosClient } from '../utils/axiosClient';

export interface SystemDiagnostics {
  database_health: {
    status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    response_time_ms: number;
    connections_active: number;
    transaction_queue: number;
  };
  cache_metrics: {
    hit_rate_percent: number;
    memory_used_mb: number;
    items_cached: number;
  };
  auth_metrics: {
    failed_auth_24h: number;
    active_sessions: number;
    locked_users: number;
  };
  storage_metrics: {
    used_percent: number;
    total_gb: number;
    used_gb: number;
  };
  uptime_seconds: number;
  last_backup_timestamp: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  type: 'SCHOOL' | 'CORPORATE';
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  users_count: number;
  created_at: string;
  suspended_at?: string;
}

export interface CreateTenantRequest {
  name: string;
  type: 'SCHOOL' | 'CORPORATE';
}

export interface LockedUserInfo {
  id: string;
  name: string;
  email: string;
  reason: string;
  locked_at: string;
  related_incident_id?: string;
}

export interface AuditLogEntry {
  id: string;
  superadmin_id: string;
  superadmin_name: string;
  action: string;
  target_type: string;
  target_id: string;
  status: 'SUCCESS' | 'FAILED';
  details: Record<string, any>;
  created_at: string;
  ip_address?: string;
}

class SuperadminService {
  /**
   * Get System Diagnostics
   */
  async getSystemDiagnostics(): Promise<SystemDiagnostics> {
    const response = await axiosClient.get<SystemDiagnostics>('/superadmin/diagnostics');
    return response.data;
  }

  /**
   * List All Tenants
   */
  async listTenants(): Promise<TenantInfo[]> {
    const response = await axiosClient.get<TenantInfo[]>('/superadmin/tenants');
    return response.data;
  }

  /**
   * Create Tenant
   */
  async createTenant(data: CreateTenantRequest): Promise<TenantInfo> {
    const response = await axiosClient.post<TenantInfo>('/superadmin/tenants', data);
    return response.data;
  }

  /**
   * Suspend Tenant
   */
  async suspendTenant(tenantId: string, reason: string): Promise<TenantInfo> {
    const response = await axiosClient.put<TenantInfo>(
      `/superadmin/tenants/${tenantId}/suspend`,
      { reason }
    );
    return response.data;
  }

  /**
   * Restore Tenant
   */
  async restoreTenant(tenantId: string): Promise<TenantInfo> {
    const response = await axiosClient.put<TenantInfo>(
      `/superadmin/tenants/${tenantId}/restore`
    );
    return response.data;
  }

  /**
   * Get Locked Users
   */
  async getLockedUsers(): Promise<LockedUserInfo[]> {
    const response = await axiosClient.get<LockedUserInfo[]>('/superadmin/locked-users');
    return response.data;
  }

  /**
   * Unlock User
   */
  async unlockUser(userId: string, reason: string): Promise<{ success: boolean }> {
    const response = await axiosClient.post('/superadmin/locked-users/unlock', {
      user_id: userId,
      reason
    });
    return response.data;
  }

  /**
   * Get Audit Trail
   */
  async getAuditTrail(
    limit = 100,
    offset = 0,
    filters?: { action?: string; target_type?: string; status?: string }
  ): Promise<{
    entries: AuditLogEntry[];
    total: number;
  }> {
    const response = await axiosClient.get('/superadmin/audit-trail', {
      params: { limit, offset, ...filters }
    });
    return response.data;
  }

  /**
   * Get Audit Entry Details
   */
  async getAuditEntry(entryId: string): Promise<AuditLogEntry> {
    const response = await axiosClient.get<AuditLogEntry>(`/superadmin/audit-trail/${entryId}`);
    return response.data;
  }

  /**
   * Override Incident (escalation)
   */
  async overrideIncident(incidentId: string, reason: string): Promise<{ success: boolean }> {
    const response = await axiosClient.post('/superadmin/incidents/override', {
      incident_id: incidentId,
      reason
    });
    return response.data;
  }

  /**
   * Export System Report
   */
  async exportSystemReport(format: 'PDF' | 'XLSX'): Promise<Blob> {
    const response = await axiosClient.get('/superadmin/export/system-report', {
      params: { format },
      responseType: 'blob'
    });
    return response.data;
  }
}

export default new SuperadminService();
