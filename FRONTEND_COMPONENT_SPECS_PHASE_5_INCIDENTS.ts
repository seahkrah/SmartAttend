/**
 * PHASE 5: INCIDENT MANAGEMENT FRONTEND - COMPLETE COMPONENT SPECS
 * 
 * Integrates with backend endpoints:
 * - GET /api/admin/incidents
 * - GET /api/admin/incidents/:id
 * - GET /api/admin/incidents/stats
 * - POST /api/admin/incidents/:id/acknowledge
 * - POST /api/admin/incidents/:id/root-cause
 * - POST /api/admin/incidents/:id/resolve
 */

// ============================================================================
// COMPONENT 1: IncidentsList.tsx (Updated - Workflow Status)
// ============================================================================

import React from 'react';
import { AlertCircle, Clock, CheckCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import axios from 'axios';

interface Incident {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  error_type: string;
  status: 'REPORTED' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';
  created_at: string;
  ack_by_user_id?: string;
  ack_at?: string;
  rc_category?: string;
  resolved_at?: string;
  affected_users?: number;
  escalation_level?: number;
  is_overdue?: boolean;
}

interface IncidentsListProps {
  onSelectIncident: (id: string) => void;
  selectedIncidentId?: string;
}

export const IncidentsList: React.FC<IncidentsListProps> = ({ 
  onSelectIncident, 
  selectedIncidentId 
}) => {
  const [incidents, setIncidents] = React.useState<Incident[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'open' | 'overdue'>('all');

  React.useEffect(() => {
    fetchIncidents();
    // Poll every 30 seconds
    const interval = setInterval(fetchIncidents, 30000);
    return () => clearInterval(interval);
  }, [filter]);

  const fetchIncidents = async () => {
    try {
      const params: Record<string, string> = {};
      if (filter === 'open') params.status = 'REPORTED,ACKNOWLEDGED,INVESTIGATING';
      if (filter === 'overdue') params.overdue_only = 'true';

      const response = await axios.get('/api/admin/incidents', { params });
      setIncidents(response.data.incidents || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'REPORTED':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'ACKNOWLEDGED':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'INVESTIGATING':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'RESOLVED':
        return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'CLOSED':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'HIGH':
        return <AlertCircle className="w-5 h-5 text-orange-500" />;
      case 'MEDIUM':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      default:
        return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-slate-700">
        {['all', 'open', 'overdue'].map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab as any)}
            className={`px-4 py-2 font-medium transition-colors ${
              filter === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Incidents List */}
      <div className="space-y-2">
        {incidents.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No incidents found
          </div>
        ) : (
          incidents.map(incident => (
            <button
              key={incident.id}
              onClick={() => onSelectIncident(incident.id)}
              className={`w-full p-4 rounded-lg border transition-all text-left ${
                selectedIncidentId === incident.id
                  ? 'bg-blue-500/20 border-blue-500/50'
                  : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  {getSeverityIcon(incident.severity)}
                  <div className="flex-1">
                    <div className="font-medium text-white flex items-center gap-2">
                      {incident.error_type}
                      {incident.is_overdue && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                          OVERDUE
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-400">
                      {new Date(incident.created_at).toLocaleString()}
                    </div>
                    <div className="text-sm text-slate-500 mt-1">
                      {incident.affected_users} users affected
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs border ${getStatusColor(incident.status)}`}>
                    {incident.status}
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-500" />
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: IncidentDetailPanel.tsx (Enhanced - Full Workflow)
// ============================================================================

interface IncidentDetail extends Incident {
  error_message?: string;
  error_stack?: string;
  affected_users_list?: string[];
  ack_notes?: string;
  rc_summary?: string;
  rc_remediation?: string;
  resolved_impact?: string;
  lessons_learned?: string;
  follow_up_actions?: string;
}

interface IncidentDetailPanelProps {
  incidentId: string;
  onClose: () => void;
}

export const IncidentDetailPanel: React.FC<IncidentDetailPanelProps> = ({ incidentId, onClose }) => {
  const [incident, setIncident] = React.useState<IncidentDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Workflow modals
  const [showAckModal, setShowAckModal] = React.useState(false);
  const [showRCModal, setShowRCModal] = React.useState(false);
  const [showResolveModal, setShowResolveModal] = React.useState(false);

  // Form states
  const [ackNotes, setAckNotes] = React.useState('');
  const [rcCategory, setRCCategory] = React.useState('');
  const [rcSummary, setRcSummary] = React.useState('');
  const [rcRemediation, setRcRemediation] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    fetchIncidentDetail();
  }, [incidentId]);

  const fetchIncidentDetail = async () => {
    try {
      const response = await axios.get(`/api/admin/incidents/${incidentId}`);
      setIncident(response.data.incident);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident');
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async () => {
    try {
      setSubmitting(true);
      await axios.post(`/api/admin/incidents/${incidentId}/acknowledge`, {
        notes: ackNotes
      });
      setAckNotes('');
      setShowAckModal(false);
      fetchIncidentDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge incident');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordRootCause = async () => {
    try {
      setSubmitting(true);
      await axios.post(`/api/admin/incidents/${incidentId}/root-cause`, {
        category: rcCategory,
        summary: rcSummary,
        remediation_steps: rcRemediation
      });
      setRCCategory('');
      setRcSummary('');
      setRcRemediation('');
      setShowRCModal(false);
      fetchIncidentDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record root cause');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async () => {
    try {
      setSubmitting(true);
      await axios.post(`/api/admin/incidents/${incidentId}/resolve`, {
        impact_assessment: '',
        lessons_learned: '',
        follow_up_actions: ''
      });
      setShowResolveModal(false);
      fetchIncidentDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve incident');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="p-8 text-center text-slate-400">
        Incident not found
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{incident.error_type}</h2>
          <p className="text-slate-400 text-sm mt-1">
            ID: {incident.id}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Status Timeline */}
      <div className="space-y-3">
        <h3 className="font-semibold text-white">Lifecycle Timeline</h3>
        <div className="space-y-2">
          {[
            { step: 'REPORTED', time: incident.created_at, completed: true },
            { step: 'ACKNOWLEDGED', time: incident.ack_at, completed: !!incident.ack_at },
            { step: 'INVESTIGATING', time: null, completed: incident.status === 'INVESTIGATING' || !!incident.rc_category },
            { step: 'RESOLVED', time: incident.resolved_at, completed: !!incident.resolved_at },
            { step: 'CLOSED', time: null, completed: incident.status === 'CLOSED' }
          ].map((step, idx) => (
            <div key={step.step} className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${
                step.completed ? 'bg-green-500' : 'bg-slate-600'
              }`} />
              <div className="flex-1">
                <span className="font-medium text-white">{step.step}</span>
                {step.time && (
                  <span className="text-slate-400 text-sm ml-2">
                    {new Date(step.time).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-slate-400 text-sm">Severity</p>
          <p className="text-white font-medium">{incident.severity}</p>
        </div>
        <div>
          <p className="text-slate-400 text-sm">Status</p>
          <p className="text-white font-medium">{incident.status}</p>
        </div>
        <div>
          <p className="text-slate-400 text-sm">Affected Users</p>
          <p className="text-white font-medium">{incident.affected_users || 0}</p>
        </div>
        <div>
          <p className="text-slate-400 text-sm">Escalation Level</p>
          <p className="text-white font-medium">{incident.escalation_level || 0}</p>
        </div>
      </div>

      {/* Error Details */}
      {incident.error_message && (
        <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
          <p className="text-slate-400 text-sm mb-2">Error Message</p>
          <p className="text-white font-mono text-sm">{incident.error_message}</p>
        </div>
      )}

      {/* Workflow Actions */}
      <div className="space-y-3 pt-4 border-t border-slate-700">
        {incident.status === 'REPORTED' && (
          <button
            onClick={() => setShowAckModal(true)}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Acknowledge Incident
          </button>
        )}

        {incident.status === 'ACKNOWLEDGED' && (
          <button
            onClick={() => setShowRCModal(true)}
            className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            Record Root Cause
          </button>
        )}

        {incident.status === 'INVESTIGATING' && incident.rc_category && (
          <button
            onClick={() => setShowResolveModal(true)}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            Resolve Incident
          </button>
        )}
      </div>

      {/* ACK Modal */}
      {showAckModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-white mb-4">Acknowledge Incident</h3>
            <textarea
              value={ackNotes}
              onChange={e => setAckNotes(e.target.value)}
              placeholder="Add notes (optional)"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 mb-4"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAckModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAcknowledge}
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Confirming...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RC Modal */}
      {showRCModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full max-h-96 overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">Record Root Cause</h3>
            
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-sm text-slate-400">Category</label>
                <select
                  value={rcCategory}
                  onChange={e => setRCCategory(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="">Select category</option>
                  <option value="SYSTEM_DEFECT">System Defect</option>
                  <option value="CONFIG_ERROR">Configuration Error</option>
                  <option value="USER_ERROR">User Error</option>
                  <option value="EXTERNAL_SYSTEM">External System</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-slate-400">Summary</label>
                <textarea
                  value={rcSummary}
                  onChange={e => setRcSummary(e.target.value)}
                  placeholder="What went wrong?"
                  className="w-full mt-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm text-slate-400">Remediation Steps</label>
                <textarea
                  value={rcRemediation}
                  onChange={e => setRcRemediation(e.target.value)}
                  placeholder="How was it fixed?"
                  className="w-full mt-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowRCModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordRootCause}
                disabled={submitting || !rcCategory || !rcSummary}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Recording...' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 3: IncidentDashboard.tsx (New - Overview Stats)
// ============================================================================

interface IncidentStats {
  open_count: number;
  critical_count: number;
  overdue_1h_count: number;
  overdue_24h_count: number;
  avg_ack_time_minutes: number;
  avg_resolve_time_hours: number;
  escalations_today: number;
}

export const IncidentDashboard: React.FC = () => {
  const [stats, setStats] = React.useState<IncidentStats | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const response = await axios.get('/api/admin/incidents/stats');
      setStats(response.data.stats);
    } catch (err) {
      console.error('Failed to load stats', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !stats) {
    return <div>Loading...</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
        <p className="text-slate-400 text-sm">Open Incidents</p>
        <p className="text-2xl font-bold text-white mt-1">{stats.open_count}</p>
      </div>

      <div className="bg-red-500/10 p-4 rounded-lg border border-red-500/30">
        <p className="text-red-400 text-sm">Critical Issues</p>
        <p className="text-2xl font-bold text-red-400 mt-1">{stats.critical_count}</p>
      </div>

      <div className="bg-yellow-500/10 p-4 rounded-lg border border-yellow-500/30">
        <p className="text-yellow-400 text-sm">Overdue (1h)</p>
        <p className="text-2xl font-bold text-yellow-400 mt-1">{stats.overdue_1h_count}</p>
      </div>

      <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
        <p className="text-slate-400 text-sm">Avg ACK Time</p>
        <p className="text-2xl font-bold text-white mt-1">{stats.avg_ack_time_minutes}m</p>
      </div>
    </div>
  );
};

export default {
  IncidentsList,
  IncidentDetailPanel,
  IncidentDashboard
};
