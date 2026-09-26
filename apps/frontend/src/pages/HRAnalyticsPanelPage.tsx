/**
 * HR Analytics Panel Page
 * 
 * Monitoring-focused: Patterns, notifications, aggregate data
 * Shows: Overview cards, member attendance, patterns, campaigns
 */

import React, { useEffect } from 'react';
import { useHRStore } from '../store/hrStore';
import { ErrorAlert, EmptyState } from '../components/ErrorDisplay';
import { LoadingOverlay } from '../components/LoadingStates';
import { HIERARCHY, STATUS_COLORS } from '../utils/visualHierarchy';

export const HRAnalyticsPanelPage: React.FC = () => {
  const {
    overview,
    members,
    patterns,
    isLoading,
    error,
    clearError,
    fetchOverview,
    fetchMembers,
    fetchPatterns
  } = useHRStore();

  useEffect(() => {
    fetchOverview();
    fetchMembers();
    fetchPatterns();
  }, []);

  if (isLoading && !overview) {
    return <LoadingOverlay message="Loading analytics..." />;
  }

  return (
    <div className="min-h-screen bg-card p-6">
      {error && (
        <ErrorAlert
          title="Failed to load analytics"
          message={error}
          action={{ label: 'Retry', onClick: () => fetchOverview() }}
          onDismiss={clearError}
        />
      )}

      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className={HIERARCHY.PRIMARY.className}>Attendance Analytics</h1>
          <p className={HIERARCHY.SECONDARY.className}>
            Organization-wide attendance monitoring and insights
          </p>
        </div>

        {/* Overview Cards */}
        {overview && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-sunken border border-subtle rounded-lg p-6">
              <div className={HIERARCHY.SECONDARY.className}>Total Members</div>
              <div className="text-3xl font-bold mt-2">{overview.total_members}</div>
              <div className={HIERARCHY.TERTIARY.className}>
                {overview.above_80_percent} above 80%
              </div>
            </div>

            <div className={`rounded-lg p-6 border-2 ${STATUS_COLORS.EXCELLENT}`}>
              <div className={HIERARCHY.SECONDARY.className}>Overall Attendance</div>
              <div className="text-3xl font-bold mt-2">{overview.average_attendance}%</div>
            </div>

            <div className={`rounded-lg p-6 border-2 ${STATUS_COLORS.AT_RISK}`}>
              <div className={HIERARCHY.SECONDARY.className}>At Risk</div>
              <div className="text-3xl font-bold mt-2">{overview.at_risk_count}</div>
              <div className={HIERARCHY.TERTIARY.className}>Below 60%</div>
            </div>

            <div className={`rounded-lg p-6 border-2 ${STATUS_COLORS.CRITICAL}`}>
              <div className={HIERARCHY.SECONDARY.className}>Critical</div>
              <div className="text-3xl font-bold mt-2">{overview.chronic_absentees}</div>
              <div className={HIERARCHY.TERTIARY.className}>Chronic absentees</div>
            </div>
          </div>
        )}

        {/* Detected Patterns */}
        {patterns.length > 0 && (
          <div>
            <h2 className={HIERARCHY.PRIMARY.className}>Attendance Patterns Detected</h2>
            <div className="mt-4 space-y-3">
              {patterns.map((pattern, idx) => (
                <div
                  key={idx}
                  className="bg-sunken border border-subtle rounded-lg p-4"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className={HIERARCHY.PRIMARY.className}>
                        {pattern.member_name}
                      </div>
                      <div className={HIERARCHY.SECONDARY.className}>
                        {pattern.pattern.replace(/_/g, ' ').toLowerCase()} ·{' '}
                        {pattern.absences_in_period} absence(s)
                      </div>
                    </div>
                    <div className="text-sm font-semibold bg-blue-500/20 text-blue-700 dark:text-blue-300 px-3 py-1 rounded">
                      {pattern.confidence}% confidence
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {patterns.length === 0 && !isLoading && (
          <EmptyState
            title="No patterns detected"
            message="Attendance is tracking normally across the organization"
          />
        )}

        {/* Member List */}
        {members.length > 0 && (
          <div>
            <h2 className={HIERARCHY.PRIMARY.className}>Member Attendance Summary</h2>
            <div className="mt-4 space-y-2">
              {members.slice(0, 10).map((member) => (
                <div
                  key={member.id}
                  className="bg-sunken p-3 rounded border border-subtle flex justify-between items-center"
                >
                  <div>
                    <div className={HIERARCHY.PRIMARY.className}>{member.name}</div>
                    <div className={HIERARCHY.TERTIARY.className}>{member.email}</div>
                  </div>
                  <div className="text-lg font-semibold">{member.attendance_percentage}%</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HRAnalyticsPanelPage;
