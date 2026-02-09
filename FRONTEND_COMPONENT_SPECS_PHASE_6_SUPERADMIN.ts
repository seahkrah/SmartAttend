/**
 * PHASE 6: SUPERADMIN OPERATION SAFETY FRONTEND - COMPLETE COMPONENT SPECS
 *
 * Integrates with backend endpoints:
 * - POST /api/superadmin/operations/dry-run
 * - POST /api/superadmin/operations/execute
 * - GET /api/superadmin/operations
 * - GET /api/superadmin/operations/:id
 * - GET /api/superadmin/ip-allowlist
 * - POST /api/superadmin/ip-allowlist/add
 * - DELETE /api/superadmin/ip-allowlist/:id
 * - GET /api/superadmin/violations
 */

import React from 'react';
import { AlertTriangle, Eye, EyeOff, Copy, Check, Trash2, Plus, Clock, Shield } from 'lucide-react';
import axios from 'axios';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type OperationType = 'DELETE_ROLE' | 'DELETE_USERS' | 'UPDATE_PERMISSION' | 'DELETE_ATTENDANCE' | 'RESET_MFA';

interface DryRunPreview {
  type: OperationType;
  affected_count: number;
  scale_percentage: number;
  description: string;
  preview_data?: any;
  estimated_impact: string;
}

interface SuperadminOperation {
  id: string;
  operation_type: OperationType;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  created_at: string;
  executed_at?: string;
  completed_at?: string;
  created_by_user_id: string;
  affected_count: number;
  error?: string;
  checksum: string;
  verified: boolean;
}

interface IPAllowlistEntry {
  id: string;
  ip_address: string;
  cidr_range?: string;
  description: string;
  added_at: string;
  added_by: string;
  last_used?: string;
}

interface IPViolation {
  id: string;
  attempted_ip: string;
  user_id: string;
  created_at: string;
  attempted_operation?: string;
}

// ============================================================================
// COMPONENT 1: OperationDryRunModal.tsx (Preview before execution)
// ============================================================================

interface OperationDryRunModalProps {
  isOpen: boolean;
  operationType: OperationType;
  operationParams: any;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export const OperationDryRunModal: React.FC<OperationDryRunModalProps> = ({
  isOpen,
  operationType,
  operationParams,
  onConfirm,
  onCancel
}) => {
  const [preview, setPreview] = React.useState<DryRunPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [understood, setUnderstood] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      generateDryRun();
    }
  }, [isOpen, operationType, operationParams]);

  const generateDryRun = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await axios.post('/api/superadmin/operations/dry-run', {
        operation_type: operationType,
        params: operationParams
      });

      setPreview(response.data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    try {
      setConfirming(true);
      await onConfirm();
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute operation');
    } finally {
      setConfirming(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-2xl w-full max-h-96 overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-1" />
          <div>
            <h2 className="text-xl font-bold text-white">Operation Preview - DRY RUN</h2>
            <p className="text-slate-400 text-sm mt-1">
              Review the exact impact before execution. This cannot be undone.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-4 mb-6">
            <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
              <h3 className="font-semibold text-white mb-3">Operation Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Operation Type:</span>
                  <span className="text-white font-mono">{preview.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Affected Records:</span>
                  <span className="text-white font-mono">{preview.affected_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Scale:</span>
                  <span className={`font-mono ${
                    preview.scale_percentage > 50 ? 'text-red-400' : 'text-yellow-400'
                  }`}>
                    {preview.scale_percentage}% of data
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/50 p-4 rounded border border-red-500/30">
              <h3 className="font-semibold text-red-400 mb-2">Impact Assessment</h3>
              <p className="text-slate-300 text-sm">{preview.estimated_impact}</p>
            </div>

            {preview.preview_data && (
              <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
                <h3 className="font-semibold text-white mb-2">Preview Data</h3>
                <pre className="text-xs text-slate-400 overflow-x-auto bg-black/50 p-2 rounded">
                  {JSON.stringify(preview.preview_data, null, 2)}
                </pre>
              </div>
            )}

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={e => setUnderstood(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-yellow-300">
                  I understand this operation will affect {preview.affected_count} records 
                  and cannot be undone. I have verified the dry-run preview.
                </span>
              </label>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Cancel Operation
          </button>
          <button
            onClick={generateDryRun}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Refresh Preview
          </button>
          <button
            onClick={handleExecute}
            disabled={!understood || confirming || loading}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {confirming ? 'Executing...' : 'Execute Operation'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: IPAllowlistManager.tsx (Manage IP addresses)
// ============================================================================

export const IPAllowlistManager: React.FC = () => {
  const [entries, setEntries] = React.useState<IPAllowlistEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [newIP, setNewIP] = React.useState('');
  const [newCIDR, setNewCIDR] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchAllowlist();
  }, []);

  const fetchAllowlist = async () => {
    try {
      const response = await axios.get('/api/superadmin/ip-allowlist');
      setEntries(response.data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IP allowlist');
    } finally {
      setLoading(false);
    }
  };

  const handleAddIP = async () => {
    try {
      setSubmitting(true);
      setError(null);

      await axios.post('/api/superadmin/ip-allowlist/add', {
        ip_address: newIP,
        cidr_range: newCIDR,
        description: newDescription
      });

      setNewIP('');
      setNewCIDR('');
      setNewDescription('');
      setShowAddModal(false);
      fetchAllowlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add IP address');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveIP = async (id: string) => {
    if (!window.confirm('Remove this IP address from allowlist?')) return;

    try {
      await axios.delete(`/api/superadmin/ip-allowlist/${id}`);
      fetchAllowlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove IP address');
    }
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-white">IP Allowlist</h3>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add IP
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {entries.map(entry => (
          <div
            key={entry.id}
            className="flex items-center justify-between p-3 bg-slate-800/50 border border-slate-700 rounded"
          >
            <div className="flex-1">
              <p className="font-mono text-white">
                {entry.ip_address}
                {entry.cidr_range && (
                  <span className="text-slate-400 ml-2">
                    / {entry.cidr_range}
                  </span>
                )}
              </p>
              <p className="text-slate-400 text-sm">{entry.description}</p>
              {entry.last_used && (
                <p className="text-slate-500 text-xs mt-1">
                  Last used: {new Date(entry.last_used).toLocaleString()}
                </p>
              )}
            </div>
            <button
              onClick={() => handleRemoveIP(entry.id)}
              className="flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/10 rounded transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-white mb-4">Add IP Address</h3>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">IP Address</label>
                <input
                  type="text"
                  value={newIP}
                  onChange={e => setNewIP(e.target.value)}
                  placeholder="192.168.1.1"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">CIDR Range (optional)</label>
                <input
                  type="text"
                  value={newCIDR}
                  onChange={e => setNewCIDR(e.target.value)}
                  placeholder="24"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Office network"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddIP}
                disabled={submitting || !newIP}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 3: OperationHistoryTable.tsx (Audit log)
// ============================================================================

export const OperationHistoryTable: React.FC = () => {
  const [operations, setOperations] = React.useState<SuperadminOperation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedOp, setSelectedOp] = React.useState<SuperadminOperation | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchOperations();
    const interval = setInterval(fetchOperations, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchOperations = async () => {
    try {
      const response = await axios.get('/api/superadmin/operations');
      setOperations(response.data.operations || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'EXECUTING':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'COMPLETED':
        return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'FAILED':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'CANCELLED':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white">Operation History</h3>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-4 text-slate-400 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-slate-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-slate-400 font-semibold">Records</th>
              <th className="text-left py-3 px-4 text-slate-400 font-semibold">Created</th>
              <th className="text-left py-3 px-4 text-slate-400 font-semibold">Verified</th>
              <th className="text-left py-3 px-4 text-slate-400 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {operations.map(op => (
              <tr
                key={op.id}
                className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors"
              >
                <td className="py-3 px-4 font-mono text-white">{op.operation_type}</td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs border ${getStatusColor(op.status)}`}>
                    {op.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-white">{op.affected_count}</td>
                <td className="py-3 px-4 text-slate-400">
                  {new Date(op.created_at).toLocaleString()}
                </td>
                <td className="py-3 px-4">
                  {op.verified ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : (
                    <span className="text-yellow-400">Pending</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <button
                    onClick={() => setSelectedOp(op)}
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {selectedOp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-white mb-4">Operation Details</h3>

            <div className="space-y-3 mb-6 text-sm">
              <div>
                <p className="text-slate-400">ID</p>
                <p className="font-mono text-white break-all">{selectedOp.id}</p>
              </div>

              <div>
                <p className="text-slate-400">Type</p>
                <p className="text-white">{selectedOp.operation_type}</p>
              </div>

              <div>
                <p className="text-slate-400">Status</p>
                <span className={`inline-block px-3 py-1 rounded-full text-xs border ${getStatusColor(selectedOp.status)}`}>
                  {selectedOp.status}
                </span>
              </div>

              <div>
                <p className="text-slate-400">Records Affected</p>
                <p className="text-white">{selectedOp.affected_count}</p>
              </div>

              <div>
                <p className="text-slate-400">Checksum</p>
                <p className="font-mono text-white break-all text-xs">{selectedOp.checksum}</p>
              </div>

              {selectedOp.error && (
                <div className="bg-red-500/10 border border-red-500/30 p-3 rounded">
                  <p className="text-red-400 text-xs">{selectedOp.error}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedOp(null)}
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 4: IPViolationAlerts.tsx (Security monitoring)
// ============================================================================

export const IPViolationAlerts: React.FC = () => {
  const [violations, setViolations] = React.useState<IPViolation[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchViolations();
    const interval = setInterval(fetchViolations, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchViolations = async () => {
    try {
      const response = await axios.get('/api/superadmin/violations');
      setViolations(response.data.violations || []);
    } catch (err) {
      console.error('Failed to load violations', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  if (violations.length === 0) {
    return (
      <div className="p-6 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
        <Shield className="w-8 h-8 text-green-400 mx-auto mb-2" />
        <p className="text-green-400 font-medium">No IP violations detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white">Recent IP Violations</h3>

      <div className="space-y-2">
        {violations.slice(0, 10).map(violation => (
          <div
            key={violation.id}
            className="p-4 bg-red-500/10 border border-red-500/30 rounded"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-red-400 font-medium">
                  Access attempt from unauthorized IP
                </p>
                <p className="text-red-400/70 text-sm mt-1">
                  IP: {violation.attempted_ip}
                </p>
                <p className="text-slate-400 text-xs mt-2">
                  {new Date(violation.created_at).toLocaleString()}
                </p>
              </div>
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 5: SuperadminOperationsPage.tsx (Main container)
// ============================================================================

export const SuperadminOperationsPage: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<'operations' | 'ips' | 'violations'>('operations');

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Superadmin Operations</h1>
        <p className="text-slate-400 mt-1">Rule: Power must be slowed down</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-slate-700">
        {[
          { id: 'operations', label: 'Operation History' },
          { id: 'ips', label: 'IP Allowlist' },
          { id: 'violations', label: 'Security Violations' }
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
      <div className="bg-slate-800/30 p-6 rounded-lg border border-slate-700">
        {activeTab === 'operations' && <OperationHistoryTable />}
        {activeTab === 'ips' && <IPAllowlistManager />}
        {activeTab === 'violations' && <IPViolationAlerts />}
      </div>
    </div>
  );
};

export default {
  OperationDryRunModal,
  IPAllowlistManager,
  OperationHistoryTable,
  IPViolationAlerts,
  SuperadminOperationsPage
};
