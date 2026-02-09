/**
 * PHASE 9: SUPERADMIN OPERATIONAL CONSOLE
 * 
 * QUESTION: Can the superadmin operate the entire system safely and without ambiguity?
 * 
 * Operational Surface:
 * - System health diagnostics
 * - Tenant management (create/suspend/restore)
 * - User lockout/restore (incident response)
 * - Incident override & escalation management
 * - Audit trail (all operations logged)
 * - Phase 6 operations (dry-run, execute, IP allowlist)
 */

import React from 'react';
import {
  Shield, AlertTriangle, Users, Zap, BarChart3, Lock, Unlock,
  ChevronRight, Search, Plus, Eye, Edit, Trash2, Clock, CheckCircle,
  AlertCircle, Radio, Download, RefreshCw, X
} from 'lucide-react';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type TenantType = 'SCHOOL' | 'CORPORATE';

interface Tenant {
  id: string;
  name: string;
  type: TenantType;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  users_count: number;
  created_at: string;
  last_activity: string;
  storage_used_bytes: number;
  data_retention_days: number;
}

interface SystemDiagnostic {
  db_health: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  db_response_ms: number;
  cache_hit_rate: number;
  pending_incidents: number;
  overdue_incidents: number;
  active_sessions: number;
  failed_auth_24h: number;
  storage_used_percent: number;
  uptime_hours: number;
  last_backup: string;
  last_check: string;
}

interface LockedUser {
  id: string;
  username: string;
  tenant_id: string;
  locked_reason: string;
  locked_at: string;
  locked_by_admin: string;
  attempted_incident_id?: string;
}

interface SystemAuditEntry {
  id: string;
  action: 'TENANT_CREATE' | 'TENANT_SUSPEND' | 'USER_LOCKOUT' | 'INCIDENT_OVERRIDE' | 'OPERATION_DRY_RUN' | 'OPERATION_EXECUTE';
  actor_id: string;
  target_id: string;
  description: string;
  created_at: string;
  status: 'SUCCESS' | 'FAILED';
  details: any;
}

// ============================================================================
// COMPONENT 1: SystemHealthPanel.tsx
// ============================================================================

interface SystemHealthPanelProps {
  diagnostic: SystemDiagnostic | null;
  loading: boolean;
  onRefresh: () => void;
}

export const SystemHealthPanel: React.FC<SystemHealthPanelProps> = ({
  diagnostic,
  loading,
  onRefresh
}) => {
  if (!diagnostic) return <div className="text-slate-400">Loading...</div>;

  const getHealthColor = (health: string) => {
    if (health === 'CRITICAL') return 'text-red-500 bg-red-500/10';
    if (health === 'WARNING') return 'text-yellow-500 bg-yellow-500/10';
    return 'text-green-500 bg-green-500/10';
  };

  const getHealthText = (health: string) => {
    if (health === 'CRITICAL') return 'CRITICAL - ACTION REQUIRED';
    if (health === 'WARNING') return 'WARNING - MONITOR';
    return 'HEALTHY';
  };

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-6 h-6" />
          System Diagnostics
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Health Status */}
      <div className={`p-4 rounded-lg border flex items-center justify-between ${
        getHealthColor(diagnostic.db_health)
      } border-current/30 bg-current/5`}>
        <div>
          <p className="font-bold">{getHealthText(diagnostic.db_health)}</p>
          <p className="text-sm opacity-75">Database</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm">{diagnostic.db_response_ms}ms</p>
          <p className="text-xs opacity-75">Response time</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
        <MetricCard label="Active Sessions" value={diagnostic.active_sessions} type="normal" />
        <MetricCard label="Pending Incidents" value={diagnostic.pending_incidents} type={diagnostic.pending_incidents > 0 ? 'warning' : 'normal'} />
        <MetricCard label="Overdue Issues" value={diagnostic.overdue_incidents} type={diagnostic.overdue_incidents > 0 ? 'critical' : 'normal'} />
        <MetricCard label="Failed Auth (24h)" value={diagnostic.failed_auth_24h} type={diagnostic.failed_auth_24h > 10 ? 'warning' : 'normal'} />
        <MetricCard label="Cache Hit Rate" value={`${diagnostic.cache_hit_rate}%`} type="normal" />
        <MetricCard label="Storage Used" value={`${diagnostic.storage_used_percent}%`} type={diagnostic.storage_used_percent > 80 ? 'warning' : 'normal'} />
        <MetricCard label="Uptime" value={`${diagnostic.uptime_hours}h`} type="normal" />
        <MetricCard label="Last Backup" value={new Date(diagnostic.last_backup).toLocaleString()} type="normal" />
      </div>

      <p className="text-xs text-slate-500 text-right">
        Last checked: {new Date(diagnostic.last_check).toLocaleTimeString()}
      </p>
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: any; type: 'normal' | 'warning' | 'critical' }> = ({ label, value, type }) => {
  const colorClass = type === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                     type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30' :
                     'bg-slate-700/50 border-slate-600';

  return (
    <div className={`p-3 rounded border ${colorClass}`}>
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="text-white font-mono font-bold mt-1">{value}</p>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: TenantManagement.tsx
// ============================================================================

interface TenantManagementProps {
  tenants: Tenant[];
  loading: boolean;
  onCreateTenant: (name: string, type: TenantType) => void;
  onSuspendTenant: (tenantId: string) => void;
  onRestoreTenant: (tenantId: string) => void;
}

export const TenantManagement: React.FC<TenantManagementProps> = ({
  tenants,
  loading,
  onCreateTenant,
  onSuspendTenant,
  onRestoreTenant
}) => {
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newType, setNewType] = React.useState<TenantType>('SCHOOL');

  const handleCreate = async () => {
    onCreateTenant(newName, newType);
    setNewName('');
    setShowCreateModal(false);
  };

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Users className="w-6 h-6" />
          Tenant Management
        </h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Tenant
        </button>
      </div>

      {/* Tenant List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {tenants.length === 0 ? (
          <div className="p-6 text-center text-slate-400">
            No tenants created
          </div>
        ) : (
          tenants.map(tenant => (
            <div
              key={tenant.id}
              className={`p-4 rounded-lg border ${
                tenant.status === 'ACTIVE'
                  ? 'bg-slate-800/50 border-slate-700'
                  : tenant.status === 'SUSPENDED'
                  ? 'bg-yellow-500/5 border-yellow-500/30'
                  : 'bg-slate-900 border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-white">{tenant.name}</p>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      tenant.type === 'SCHOOL'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-purple-500/20 text-purple-300'
                    }`}>
                      {tenant.type}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      tenant.status === 'ACTIVE'
                        ? 'bg-green-500/20 text-green-300'
                        : tenant.status === 'SUSPENDED'
                        ? 'bg-yellow-500/20 text-yellow-300'
                        : 'bg-slate-500/20 text-slate-300'
                    }`}>
                      {tenant.status}
                    </span>
                  </div>
                  <div className="text-sm text-slate-400 mt-2">
                    <p>Users: {tenant.users_count} • Storage: {(tenant.storage_used_bytes / 1024 / 1024 / 1024).toFixed(2)}GB</p>
                    <p>Created: {new Date(tenant.created_at).toLocaleString()}</p>
                    <p>Last activity: {new Date(tenant.last_activity).toLocaleString()}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {tenant.status === 'ACTIVE' && (
                    <button
                      onClick={() => {
                        if (confirm(`Suspend tenant "${tenant.name}"?`)) {
                          onSuspendTenant(tenant.id);
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Suspend
                    </button>
                  )}

                  {tenant.status === 'SUSPENDED' && (
                    <button
                      onClick={() => {
                        if (confirm(`Restore tenant "${tenant.name}"?`)) {
                          onRestoreTenant(tenant.id);
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Restore
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Create New Tenant</h3>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Tenant Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g., Harvard University"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as TenantType)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="SCHOOL">School</option>
                  <option value="CORPORATE">Corporate</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 3: UserLockoutManagement.tsx
// ============================================================================

interface UserLockoutManagementProps {
  lockedUsers: LockedUser[];
  loading: boolean;
  onUnlock: (userId: string) => void;
}

export const UserLockoutManagement: React.FC<UserLockoutManagementProps> = ({
  lockedUsers,
  loading,
  onUnlock
}) => {
  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Lock className="w-6 h-6" />
          Locked Users (Security Incident Response)
        </h2>
        {lockedUsers.length > 0 && (
          <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-sm font-bold">
            {lockedUsers.length} locked
          </span>
        )}
      </div>

      {/* Locked Users List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {lockedUsers.length === 0 ? (
          <div className="p-6 text-center text-slate-400">
            No locked users
          </div>
        ) : (
          lockedUsers.map(user => (
            <div
              key={user.id}
              className="p-4 rounded-lg border bg-red-500/5 border-red-500/30"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-bold text-white">{user.username}</p>
                  <p className="text-sm text-slate-400">User ID: {user.id}</p>
                  <p className="text-sm text-red-400 mt-1">{user.locked_reason}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    Locked at: {new Date(user.locked_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    By: {user.locked_by_admin}
                  </p>
                  {user.attempted_incident_id && (
                    <p className="text-xs text-slate-500">
                      Incident: {user.attempted_incident_id}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => {
                    if (confirm(`Unlock user "${user.username}"? They will need to re-authenticate with MFA.`)) {
                      onUnlock(user.id);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm whitespace-nowrap"
                >
                  <Unlock className="w-4 h-4" />
                  Unlock
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 4: AuditTrail.tsx
// ============================================================================

interface AuditTrailProps {
  entries: SystemAuditEntry[];
  loading: boolean;
}

export const AuditTrail: React.FC<AuditTrailProps> = ({ entries, loading }) => {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const getActionColor = (action: string) => {
    if (action.includes('CREATE')) return 'text-green-400';
    if (action.includes('SUSPEND')) return 'text-yellow-400';
    if (action.includes('LOCKOUT')) return 'text-red-400';
    if (action.includes('OVERRIDE')) return 'text-orange-400';
    return 'text-blue-400';
  };

  const getStatusColor = (status: string) => {
    return status === 'SUCCESS'
      ? 'bg-green-500/10 text-green-300 border-green-500/30'
      : 'bg-red-500/10 text-red-300 border-red-500/30';
  };

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <h2 className="text-xl font-bold text-white flex items-center gap-2">
        <History className="w-6 h-6" />
        Superadmin Audit Trail
      </h2>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-6 text-center text-slate-400">
            No audit entries
          </div>
        ) : (
          entries.map(entry => (
            <div
              key={entry.id}
              className="border border-slate-700 rounded"
            >
              <button
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                className="w-full text-left p-3 hover:bg-slate-700/50 transition-colors flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-mono text-sm font-bold ${getActionColor(entry.action)}`}>
                      {entry.action}
                    </p>
                    <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(entry.status)}`}>
                      {entry.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{entry.description}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${
                  expandedId === entry.id ? 'rotate-90' : ''
                }`} />
              </button>

              {expandedId === entry.id && (
                <div className="p-4 bg-slate-900/50 border-t border-slate-700 text-sm">
                  <div className="space-y-2 font-mono text-slate-400">
                    <p><span className="text-slate-300">Actor:</span> {entry.actor_id}</p>
                    <p><span className="text-slate-300">Target:</span> {entry.target_id}</p>
                    <pre className="bg-black/50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const History = AlertTriangle; // Placeholder

// ============================================================================
// MAIN PAGE: SuperadminConsole.tsx
// ============================================================================

export const SuperadminConsole: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<'health' | 'tenants' | 'lockout' | 'audit'>('health');
  const [diagnostic, setDiagnostic] = React.useState<SystemDiagnostic | null>(null);
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [lockedUsers, setLockedUsers] = React.useState<LockedUser[]>([]);
  const [auditEntries, setAuditEntries] = React.useState<SystemAuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    loadAllData();
  }, [activeTab]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // In real app, fetch from API
      // await Promise.all([
      //   fetchDiagnostics(),
      //   fetchTenants(),
      //   fetchLockedUsers(),
      //   fetchAuditTrail()
      // ]);
      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-8 h-8 text-red-500" />
          <h1 className="text-3xl font-bold text-white">SUPERADMIN CONSOLE</h1>
        </div>
        <p className="text-slate-400">
          System Operation • Tenant Management • Incident Response • Audit Trail
        </p>
      </div>

      {/* Critical Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 font-bold text-lg">Critical Issues: 0</p>
          <p className="text-red-400/70 text-sm">System operational</p>
        </div>
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-400 font-bold text-lg">Warnings: 3</p>
          <p className="text-yellow-400/70 text-sm">Monitor storage usage</p>
        </div>
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-blue-400 font-bold text-lg">Locked Users: 2</p>
          <p className="text-blue-400/70 text-sm">Incident response pending</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-700">
        {[
          { id: 'health', label: 'System Health' },
          { id: 'tenants', label: 'Tenant Management' },
          { id: 'lockout', label: 'User Lockout' },
          { id: 'audit', label: 'Audit Trail' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'health' && <SystemHealthPanel diagnostic={diagnostic} loading={loading} onRefresh={loadAllData} />}
        {activeTab === 'tenants' && <TenantManagement tenants={tenants} loading={loading} onCreateTenant={() => {}} onSuspendTenant={() => {}} onRestoreTenant={() => {}} />}
        {activeTab === 'lockout' && <UserLockoutManagement lockedUsers={lockedUsers} loading={loading} onUnlock={() => {}} />}
        {activeTab === 'audit' && <AuditTrail entries={auditEntries} loading={loading} />}
      </div>
    </div>
  );
};

export default SuperadminConsole;
