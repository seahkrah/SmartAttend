/**
 * PHASE 9: HR / INSTITUTION ANALYTICS PANEL
 * 
 * QUESTION: Can HR/Institutional admin monitor attendance comprehensively and take action?
 * 
 * Operational Surface:
 * - Organization-wide attendance dashboard
 * - Drill-down by department/team
 * - Identify attendance problem areas (at-risk individuals)
 * - Send notifications to non-compliant employees/students
 * - Workforce/student body analytics
 * - Pattern detection (chronic absenteeism)
 * - Generate compliance reports
 * - Export for payroll/academic records
 */

import React from 'react';
import {
  BarChart3, Users, TrendingDown, AlertTriangle, Send, Download,
  Filter, Search, Eye, Mail, Phone, Calendar, Activity, FileText,
  ChevronRight, Radio, TrendingUp, MessageSquare, ArrowRight,
  CheckCircle2
} from 'lucide-react';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AttendanceOverview {
  total_members: number;
  above_80_percent: number;
  sixty_to_80_percent: number;
  below_60_percent: number;
  average_attendance: number;
  at_risk_count: number;
  chronic_absentees: number;
}

interface MemberAttendanceSummary {
  id: string;
  name: string;
  role: 'EMPLOYEE' | 'STUDENT';
  email: string;
  department?: string;
  attendance_percentage: number;
  status: 'EXCELLENT' | 'GOOD' | 'AT_RISK' | 'CRITICAL';
  sessions_attended: number;
  sessions_total: number;
  recent_absences: number;
  last_absence_date?: string;
  notification_sent: boolean;
  notes?: string;
}

interface DepartmentMetrics {
  name: string;
  total_members: number;
  average_attendance: number;
  at_risk_count: number;
  attendance_trend: number; // % change from last period
}

interface NotificationCampaign {
  id: string;
  name: string;
  target_group: string;
  criteria: string;
  created_at: string;
  sent_count: number;
  recipients: string[];
  message_template: string;
  status: 'DRAFT' | 'SCHEDULED' | 'SENT';
}

interface AttendancePattern {
  member_id: string;
  member_name: string;
  pattern: 'CHRONIC_ABSENTEE' | 'MONDAY_ABSENTEE' | 'FRIDAY_ABSENTEE' | 'PATTERNS_IRREGULAR' | 'NONE';
  confidence: number;
  absences_in_period: number;
  last_absence_date?: string;
}

// ============================================================================
// COMPONENT 1: AttendanceOverviewCards.tsx
// ============================================================================

interface AttendanceOverviewCardsProps {
  overview: AttendanceOverview;
}

export const AttendanceOverviewCards: React.FC<AttendanceOverviewCardsProps> = ({ overview }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard
        label="Total Members"
        value={overview.total_members}
        icon={Users}
        color="bg-blue-500/10 border-blue-500/30"
      />

      <StatCard
        label="Excellent (>80%)"
        value={overview.above_80_percent}
        icon={CheckCircle2}
        color="bg-green-500/10 border-green-500/30"
      />

      <StatCard
        label="Good (60-80%)"
        value={overview.sixty_to_80_percent}
        icon={Activity}
        color="bg-yellow-500/10 border-yellow-500/30"
      />

      <StatCard
        label="At Risk (<60%)"
        value={overview.below_60_percent}
        icon={AlertTriangle}
        color="bg-red-500/10 border-red-500/30"
      />

      <StatCard
        label="Org Average"
        value={`${overview.average_attendance}%`}
        icon={BarChart3}
        color="bg-purple-500/10 border-purple-500/30"
      />

      <StatCard
        label="Critical Issues"
        value={overview.chronic_absentees}
        icon={TrendingDown}
        color="bg-red-500/10 border-red-500/30"
      />
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: any;
  icon: any;
  color: string;
}> = ({ label, value, icon: Icon, color }) => {
  return (
    <div className={`p-3 rounded-lg border ${color}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-xs">{label}</p>
          <p className="text-white font-bold text-lg mt-1">{value}</p>
        </div>
        <Icon className="w-5 h-5 opacity-40" />
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: MemberAttendanceTable.tsx
// ============================================================================

interface MemberAttendanceTableProps {
  members: MemberAttendanceSummary[];
  loading: boolean;
  onSelectMember: (memberId: string) => void;
  onSendNotification: (memberId: string) => void;
}

export const MemberAttendanceTable: React.FC<MemberAttendanceTableProps> = ({
  members,
  loading,
  onSelectMember,
  onSendNotification
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('ALL');

  const filteredMembers = members.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EXCELLENT':
        return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'GOOD':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'AT_RISK':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'CRITICAL':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5" />
          Attendance Details
        </h3>

        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10 pr-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 text-sm"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
          >
            <option value="ALL">All Status</option>
            <option value="EXCELLENT">Excellent</option>
            <option value="GOOD">Good</option>
            <option value="AT_RISK">At Risk</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-3 text-slate-400 font-semibold">Name</th>
              <th className="text-left py-3 px-3 text-slate-400 font-semibold">Email</th>
              <th className="text-left py-3 px-3 text-slate-400 font-semibold">Department</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Attendance</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Status</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Recent</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map(member => (
              <tr key={member.id} className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors">
                <td className="py-3 px-3 text-white font-medium">
                  <button
                    onClick={() => onSelectMember(member.id)}
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {member.name}
                  </button>
                </td>
                <td className="py-3 px-3 text-slate-300 text-xs">{member.email}</td>
                <td className="py-3 px-3 text-slate-400">{member.department || '-'}</td>
                <td className="text-center py-3 px-3">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    member.attendance_percentage >= 80
                      ? 'bg-green-500/20 text-green-300'
                      : member.attendance_percentage >= 60
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}>
                    {member.attendance_percentage}%
                  </span>
                </td>
                <td className="text-center py-3 px-3">
                  <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(member.status)}`}>
                    {member.status}
                  </span>
                </td>
                <td className="text-center py-3 px-3 text-slate-400 text-xs">
                  {member.recent_absences} days
                </td>
                <td className="text-center py-3 px-3">
                  {member.status === 'AT_RISK' || member.status === 'CRITICAL' ? (
                    <button
                      onClick={() => onSendNotification(member.id)}
                      disabled={member.notification_sent}
                      className="flex items-center justify-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Mail className="w-3 h-3" />
                      {member.notification_sent ? 'Sent' : 'Notify'}
                    </button>
                  ) : (
                    <span className="text-slate-500 text-xs">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredMembers.length === 0 && (
        <div className="p-8 text-center text-slate-400">
          No members found matching filters
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 3: PatternDetection.tsx
// ============================================================================

interface PatternDetectionProps {
  patterns: AttendancePattern[];
}

export const PatternDetection: React.FC<PatternDetectionProps> = ({ patterns }) => {
  const getPatternDescription = (pattern: string) => {
    switch (pattern) {
      case 'CHRONIC_ABSENTEE':
        return 'Consistently low attendance across all time periods';
      case 'MONDAY_ABSENTEE':
        return 'Pattern: Frequently absent on Mondays';
      case 'FRIDAY_ABSENTEE':
        return 'Pattern: Frequently absent on Fridays';
      case 'PATTERNS_IRREGULAR':
        return 'Irregular absences, possible underlying issue';
      default:
        return 'No patterns detected';
    }
  };

  const atRiskPatterns = patterns.filter(p => p.pattern !== 'NONE');

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" />
        Detected Patterns ({atRiskPatterns.length})
      </h3>

      {atRiskPatterns.length === 0 ? (
        <div className="p-6 text-center text-slate-400">
          No concerning patterns detected
        </div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {atRiskPatterns.map(pattern => (
            <div
              key={pattern.member_id}
              className="p-4 rounded-lg border bg-orange-500/5 border-orange-500/30"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-white">{pattern.member_name}</p>
                  <p className="text-sm text-slate-400 mt-1">
                    {getPatternDescription(pattern.pattern)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    {pattern.absences_in_period} absences in last 30 days
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-bold text-orange-400">
                    {Math.round(pattern.confidence * 100)}%
                  </div>
                  <p className="text-xs text-slate-400">Confidence</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 4: NotificationManager.tsx
// ============================================================================

interface NotificationManagerProps {
  campaigns: NotificationCampaign[];
  onCreateCampaign: (campaign: any) => void;
  onSendCampaign: (campaignId: string) => void;
}

export const NotificationManager: React.FC<NotificationManagerProps> = ({
  campaigns,
  onCreateCampaign,
  onSendCampaign
}) => {
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: '',
    criteria: 'ATTENDANCE_BELOW_60',
    message_template: ''
  });

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Notification Campaigns
        </h3>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {/* Campaigns List */}
      <div className="space-y-3 max-h-64 overflow-y-auto">
        {campaigns.map(campaign => (
          <div key={campaign.id} className="p-4 rounded-lg border bg-slate-700/50 border-slate-600">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-white">{campaign.name}</p>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    campaign.status === 'DRAFT'
                      ? 'bg-slate-500/20 text-slate-300'
                      : campaign.status === 'SCHEDULED'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-green-500/20 text-green-300'
                  }`}>
                    {campaign.status}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1">{campaign.criteria}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {campaign.recipients.length} recipients{campaign.status === 'SENT' ? ` • Sent: ${campaign.sent_count}` : ''}
                </p>
              </div>

              {campaign.status === 'DRAFT' && (
                <button
                  onClick={() => onSendCampaign(campaign.id)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Create Notification Campaign</h3>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Campaign Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Target Criteria</label>
                <select
                  value={formData.criteria}
                  onChange={e => setFormData({ ...formData, criteria: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="ATTENDANCE_BELOW_60">Attendance Below 60%</option>
                  <option value="CHRONIC_ABSENTEE">Chronic Absentees</option>
                  <option value="MONDAY_PATTERN">Monday Absentees</option>
                  <option value="NO_ACTIVITY_30DAYS">No Activity (30 days)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Message Template</label>
                <textarea
                  value={formData.message_template}
                  onChange={e => setFormData({ ...formData, message_template: e.target.value })}
                  placeholder="We've noticed your attendance is below acceptable levels..."
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                  rows={4}
                />
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
                onClick={() => {
                  onCreateCampaign(formData);
                  setShowCreateModal(false);
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                disabled={!formData.name || !formData.message_template}
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

const Plus = AlertTriangle; // Placeholder

// ============================================================================
// MAIN PAGE: HRAnalyticsPanel.tsx
// ============================================================================

export const HRAnalyticsPanel: React.FC = () => {
  const [overview, setOverview] = React.useState<AttendanceOverview | null>(null);
  const [members, setMembers] = React.useState<MemberAttendanceSummary[]>([]);
  const [patterns, setPatterns] = React.useState<AttendancePattern[]>([]);
  const [campaigns, setCampaigns] = React.useState<NotificationCampaign[]>([]);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'details' | 'patterns'>('overview');

  React.useEffect(() => {
    // Load mock data
    setOverview({
      total_members: 250,
      above_80_percent: 180,
      sixty_to_80_percent: 50,
      below_60_percent: 20,
      average_attendance: 82.3,
      at_risk_count: 20,
      chronic_absentees: 5
    });

    setMembers([
      {
        id: '1',
        name: 'Alice Johnson',
        role: 'EMPLOYEE',
        email: 'alice@example.com',
        department: 'Engineering',
        attendance_percentage: 95,
        status: 'EXCELLENT',
        sessions_attended: 38,
        sessions_total: 40,
        recent_absences: 0,
        notification_sent: false
      },
      {
        id: '2',
        name: 'Bob Smith',
        role: 'EMPLOYEE',
        email: 'bob@example.com',
        department: 'Sales',
        attendance_percentage: 45,
        status: 'CRITICAL',
        sessions_attended: 18,
        sessions_total: 40,
        recent_absences: 8,
        notification_sent: true
      }
    ]);

    setPatterns([
      {
        member_id: '2',
        member_name: 'Bob Smith',
        pattern: 'CHRONIC_ABSENTEE',
        confidence: 0.92,
        absences_in_period: 18,
        last_absence_date: new Date().toISOString()
      }
    ]);

    setCampaigns([
      {
        id: '1',
        name: 'Below 60% Attendance',
        target_group: 'ATTENDANCE_BELOW_60',
        criteria: 'attendance < 60%',
        created_at: new Date().toISOString(),
        sent_count: 0,
        recipients: [],
        message_template: 'Warning message about attendance',
        status: 'DRAFT'
      }
    ]);
  }, []);

  if (!overview) return <div>Loading...</div>;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-8 h-8 text-purple-500" />
          <h1 className="text-3xl font-bold text-white">HR ANALYTICS</h1>
        </div>
        <p className="text-slate-400">
          Organization-wide attendance monitoring • Pattern detection • Notifications
        </p>
      </div>

      {/* Overview Cards */}
      <AttendanceOverviewCards overview={overview} />

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-700">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'details', label: 'Member Details' },
          { id: 'patterns', label: 'Pattern Detection' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-white border-b-2 border-purple-500'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <NotificationManager campaigns={campaigns} onCreateCampaign={() => {}} onSendCampaign={() => {}} />
          </div>
        )}

        {activeTab === 'details' && (
          <MemberAttendanceTable
            members={members}
            loading={false}
            onSelectMember={() => {}}
            onSendNotification={() => {}}
          />
        )}

        {activeTab === 'patterns' && (
          <PatternDetection patterns={patterns} />
        )}
      </div>
    </div>
  );
};

export default HRAnalyticsPanel;
