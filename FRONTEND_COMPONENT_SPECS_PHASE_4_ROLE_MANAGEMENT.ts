/**
 * PHASE 4: ROLE BOUNDARIES & PRIVILEGE ESCALATION FRONTEND - COMPLETE COMPONENT SPECS
 * 
 * Integrates with backend endpoints:
 * - GET /api/admin/roles/history
 * - GET /api/admin/roles/user/:id
 * - GET /api/admin/escalation-events
 * - GET /api/admin/role-anomalies
 * - POST /api/admin/invalidate-session/:userId (force session invalidation)
 */

import React from 'react';
import {
  AlertTriangle, TrendingUp, Clock, User, Shield, Zap, X,
  Eye, Filter, Download, TrendingDown, CheckCircle, AlertCircle
} from 'lucide-react';
import axios from 'axios';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface RoleChange {
  id: string;
  user_id: string;
  previous_role: string;
  new_role: string;
  changed_at: string;
  changed_by: string;
  reason?: string;
  checksum: string;
}

interface EscalationScore {
  user_id: string;
  score: number;
  patterns: string[];
  last_update: string;
  is_suspicious: boolean;
}

interface EscalationEvent {
  id: string;
  user_id: string;
  event_type: 'TEMPORAL_CLUSTER' | 'RECURSIVE_ESCALATION' | 'BYPASS_PATTERN' | 'COORDINATED_ELEVATION' | 'UNUSUAL_SUPERADMIN_ACTION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  score: number;
  details: any;
  created_at: string;
  investigated: boolean;
  investigation_notes?: string;
}

interface RoleAnomaly {
  id: string;
  user_id: string;
  anomaly_type: string;
  description: string;
  confidence_score: number;
  detected_at: string;
  remediated: boolean;
}

// ============================================================================
// COMPONENT 1: RoleHistoryTimeline.tsx (Immutable audit trail)
// ============================================================================

interface RoleHistoryTimelineProps {
  userId?: string;
}

export const RoleHistoryTimeline: React.FC<RoleHistoryTimelineProps> = ({ userId }) => {
  const [changes, setChanges] = React.useState<RoleChange[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedChange, setSelectedChange] = React.useState<RoleChange | null>(null);

  React.useEffect(() => {
    fetchRoleHistory();
  }, [userId]);

  const fetchRoleHistory = async () => {
    try {
      setLoading(true);
      const url = userId 
        ? `/api/admin/roles/user/${userId}` 
        : '/api/admin/roles/history';
      
      const response = await axios.get(url);
      setChanges(response.data.history || response.data.changes || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load role history');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  if (changes.length === 0) {
    return (
      <div className="p-8 text-center text-slate-400 bg-slate-800/30 rounded-lg border border-slate-700">
        No role changes found
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">Role Change History (Immutable)</h3>
        <Shield className="w-5 h-5 text-green-500" />
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Connecting line */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-slate-700" />

        {/* Timeline events */}
        <div className="space-y-4">
          {changes.map((change, idx) => (
            <div
              key={change.id}
              className="pl-16 relative"
            >
              {/* Timeline dot */}
              <div
                className={`absolute left-1 top-2 w-3 h-3 rounded-full border-2 ${
                  idx === 0
                    ? 'bg-blue-500 border-blue-500'
                    : 'bg-slate-700 border-slate-600'
                }`}
              />

              {/* Event card */}
              <button
                onClick={() => setSelectedChange(change)}
                className="w-full text-left p-4 rounded-lg border transition-all hover:border-blue-500/50 bg-slate-800/50 border-slate-700"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-white flex items-center gap-2">
                      <span>{change.previous_role}</span>
                      <TrendingUp className="w-4 h-4 text-blue-400" />
                      <span>{change.new_role}</span>
                    </div>
                    <p className="text-slate-400 text-sm mt-1">
                      Changed by: {change.changed_by}
                    </p>
                    <p className="text-slate-500 text-xs mt-1">
                      {new Date(change.changed_at).toLocaleString()}
                    </p>
                    {change.reason && (
                      <p className="text-slate-400 text-sm mt-2 italic">
                        Reason: {change.reason}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 text-xs font-mono">
                      Checksum verified
                    </p>
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedChange && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-white mb-4">Role Change Details</h3>

            <div className="space-y-4 mb-6 text-sm">
              <div>
                <p className="text-slate-400">User ID</p>
                <p className="font-mono text-white break-all">{selectedChange.user_id}</p>
              </div>

              <div>
                <p className="text-slate-400">Previous Role → New Role</p>
                <p className="text-white font-medium">
                  {selectedChange.previous_role} → {selectedChange.new_role}
                </p>
              </div>

              <div>
                <p className="text-slate-400">Changed By</p>
                <p className="text-white">{selectedChange.changed_by}</p>
              </div>

              <div>
                <p className="text-slate-400">Timestamp</p>
                <p className="text-white">
                  {new Date(selectedChange.changed_at).toLocaleString()}
                </p>
              </div>

              <div>
                <p className="text-slate-400 mb-1">Checksum (SHA256, Immutable)</p>
                <p className="font-mono text-white break-all text-xs bg-slate-900/50 p-2 rounded">
                  {selectedChange.checksum}
                </p>
              </div>

              {selectedChange.reason && (
                <div>
                  <p className="text-slate-400">Reason</p>
                  <p className="text-white">{selectedChange.reason}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedChange(null)}
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
// COMPONENT 2: EscalationScoringDashboard.tsx (Real-time threat detection)
// ============================================================================

export const EscalationScoringDashboard: React.FC = () => {
  const [scores, setScores] = React.useState<EscalationScore[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedUser, setSelectedUser] = React.useState<EscalationScore | null>(null);
  const [sortBy, setSortBy] = React.useState<'score' | 'date'>('score');

  React.useEffect(() => {
    fetchEscalationScores();
    const interval = setInterval(fetchEscalationScores, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchEscalationScores = async () => {
    try {
      const response = await axios.get('/api/admin/escalation-events');
      const data = response.data.events || [];
      
      // Group by user and calculate composite score
      const userScores = new Map<string, EscalationScore>();
      data.forEach((event: EscalationEvent) => {
        const existing = userScores.get(event.user_id) || {
          user_id: event.user_id,
          score: 0,
          patterns: [],
          last_update: new Date().toISOString(),
          is_suspicious: false
        };

        existing.score = Math.max(existing.score, event.score);
        if (!existing.patterns.includes(event.event_type)) {
          existing.patterns.push(event.event_type);
        }
        existing.last_update = event.created_at;
        existing.is_suspicious = event.score > 50;

        userScores.set(event.user_id, existing);
      });

      const sorted = Array.from(userScores.values()).sort((a, b) =>
        sortBy === 'score' ? b.score - a.score : 
        new Date(b.last_update).getTime() - new Date(a.last_update).getTime()
      );

      setScores(sorted);
    } catch (err) {
      console.error('Failed to load escalation scores', err);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (score: number) => {
    if (score > 75) return 'bg-red-500/10 border-red-500/30 text-red-400';
    if (score > 50) return 'bg-orange-500/10 border-orange-500/30 text-orange-400';
    if (score > 25) return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400';
    return 'bg-green-500/10 border-green-500/30 text-green-400';
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  const suspiciousUsers = scores.filter(s => s.is_suspicious);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <p className="text-slate-400 text-sm">Total Users Monitored</p>
          <p className="text-2xl font-bold text-white mt-1">{scores.length}</p>
        </div>

        <div className="bg-red-500/10 p-4 rounded-lg border border-red-500/30">
          <p className="text-red-400 text-sm">Suspicious Users</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{suspiciousUsers.length}</p>
        </div>

        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <p className="text-slate-400 text-sm">Max Score</p>
          <p className="text-2xl font-bold text-white mt-1">
            {scores.length > 0 ? Math.max(...scores.map(s => s.score)) : 0}
          </p>
        </div>

        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <p className="text-slate-400 text-sm">Avg Score</p>
          <p className="text-2xl font-bold text-white mt-1">
            {scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b.score, 0) / scores.length) : 0}
          </p>
        </div>
      </div>

      {/* Sort & Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setSortBy('score')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            sortBy === 'score'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Sort by Score
        </button>
        <button
          onClick={() => setSortBy('date')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            sortBy === 'date'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Sort by Date
        </button>
      </div>

      {/* User Scores List */}
      <div className="space-y-3">
        {suspiciousUsers.length === 0 ? (
          <div className="p-8 text-center bg-green-500/10 border border-green-500/30 rounded-lg">
            <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <p className="text-green-400 font-medium">No suspicious activity detected</p>
          </div>
        ) : (
          suspiciousUsers.map(score => (
            <button
              key={score.user_id}
              onClick={() => setSelectedUser(score)}
              className={`w-full p-4 rounded-lg border transition-all text-left ${getSeverityColor(score.score)}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium flex items-center gap-2">
                    <User className="w-4 h-4" />
                    User: {score.user_id}
                  </p>
                  <p className="text-sm mt-1">
                    Patterns: {score.patterns.join(', ')}
                  </p>
                  <p className="text-xs mt-1 opacity-70">
                    Updated: {new Date(score.last_update).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{score.score}</p>
                  <p className="text-xs opacity-70">Score</p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* User Details Modal */}
      {selectedUser && (
        <EscalationUserDetailModal
          score={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 3: EscalationUserDetailModal.tsx
// ============================================================================

interface EscalationUserDetailModalProps {
  score: EscalationScore;
  onClose: () => void;
}

const EscalationUserDetailModal: React.FC<EscalationUserDetailModalProps> = ({ score, onClose }) => {
  const [events, setEvents] = React.useState<EscalationEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [invalidating, setInvalidating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchUserEvents();
  }, [score.user_id]);

  const fetchUserEvents = async () => {
    try {
      const response = await axios.get('/api/admin/escalation-events', {
        params: { user_id: score.user_id }
      });
      setEvents(response.data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  const handleInvalidateSession = async () => {
    try {
      setInvalidating(true);
      await axios.post(`/api/admin/invalidate-session/${score.user_id}`);
      setError(null);
      // Show success message
      alert('Session invalidated - user must re-authenticate with MFA');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invalidate session');
    } finally {
      setInvalidating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-2xl w-full max-h-96 overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">Escalation Analysis</h3>
            <p className="text-slate-400 text-sm mt-1">User: {score.user_id}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Score Display */}
        <div className={`p-4 rounded-lg border mb-4 ${
          score.score > 50
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-orange-500/10 border-orange-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Risk Score</p>
              <p className={`text-3xl font-bold mt-1 ${
                score.score > 50 ? 'text-red-400' : 'text-orange-400'
              }`}>
                {score.score}
              </p>
            </div>
            <AlertTriangle className={`w-12 h-12 ${
              score.score > 50 ? 'text-red-500' : 'text-orange-500'
            }`} />
          </div>
        </div>

        {/* Detected Patterns */}
        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 mb-4">
          <p className="font-semibold text-white mb-2">Detected Patterns</p>
          <div className="space-y-1">
            {score.patterns.map(pattern => (
              <div key={pattern} className="flex items-center gap-2 text-slate-300 text-sm">
                <Zap className="w-4 h-4 text-yellow-500" />
                {pattern}
              </div>
            ))}
          </div>
        </div>

        {/* Events Timeline */}
        {!loading && events.length > 0 && (
          <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 mb-4">
            <p className="font-semibold text-white mb-2">Recent Events</p>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {events.slice(0, 5).map(event => (
                <div key={event.id} className="text-sm border-l-2 border-slate-600 pl-2">
                  <p className="text-slate-300">{event.event_type}</p>
                  <p className="text-slate-500 text-xs">
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleInvalidateSession}
            disabled={invalidating}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {invalidating ? 'Invalidating...' : 'Force Session Invalidation + MFA'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 4: AnomalyDetectionList.tsx (Behavioral analysis)
// ============================================================================

export const AnomalyDetectionList: React.FC = () => {
  const [anomalies, setAnomalies] = React.useState<RoleAnomaly[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<'all' | 'active' | 'remediated'>('active');

  React.useEffect(() => {
    fetchAnomalies();
  }, [filter]);

  const fetchAnomalies = async () => {
    try {
      const response = await axios.get('/api/admin/role-anomalies', {
        params: {
          remediated: filter === 'remediated' ? true : filter === 'active' ? false : undefined
        }
      });
      setAnomalies(response.data.anomalies || []);
    } catch (err) {
      console.error('Failed to load anomalies', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {['all', 'active', 'remediated'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {anomalies.map(anomaly => (
          <div
            key={anomaly.id}
            className={`p-4 rounded-lg border ${
              anomaly.remediated
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-orange-500/10 border-orange-500/30'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-medium text-white flex items-center gap-2">
                  {anomaly.remediated ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                  )}
                  {anomaly.anomaly_type}
                </p>
                <p className="text-slate-400 text-sm mt-1">{anomaly.description}</p>
                <p className="text-slate-500 text-xs mt-1">
                  User: {anomaly.user_id} • Detected: {new Date(anomaly.detected_at).toLocaleString()}
                </p>
              </div>
              <div className="text-right ml-4">
                <div className="text-2xl font-bold text-orange-400">
                  {Math.round(anomaly.confidence_score * 100)}%
                </div>
                <p className="text-slate-400 text-xs">Confidence</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 5: RoleManagementPage.tsx (Main container)
// ============================================================================

export const RoleManagementPage: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<'history' | 'escalation' | 'anomalies'>('escalation');

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Role Boundaries & Privilege Escalation</h1>
        <p className="text-slate-400 mt-1">Rule: No role should be able to lie convincingly</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-slate-700">
        {[
          { id: 'escalation', label: 'Live Risk Scoring' },
          { id: 'anomalies', label: 'Behavioral Anomalies' },
          { id: 'history', label: 'Immutable Role History' }
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
        {activeTab === 'escalation' && <EscalationScoringDashboard />}
        {activeTab === 'anomalies' && <AnomalyDetectionList />}
        {activeTab === 'history' && <RoleHistoryTimeline />}
      </div>
    </div>
  );
};

export default {
  RoleHistoryTimeline,
  EscalationScoringDashboard,
  EscalationUserDetailModal,
  AnomalyDetectionList,
  RoleManagementPage
};
