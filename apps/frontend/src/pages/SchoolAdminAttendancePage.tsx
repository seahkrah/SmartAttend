/**
 * School Admin Attendance Page
 *
 * Overview of attendance across all schedules.
 * Shows per-schedule stats: sessions taken, present/absent rates, last attendance date.
 */

import React, { useEffect, useState } from 'react';
import { axiosClient } from '../utils/axiosClient';
import { useToastStore } from '../components/Toast';

interface ScheduleAttendance {
  schedule_id: string;
  course_name: string;
  course_code: string;
  section: number | null;
  days_of_week: string;
  start_time: string;
  end_time: string;
  faculty_name: string | null;
  enrolled_count: string;
  sessions_taken: string;
  total_present: string;
  total_absent: string;
  total_late: string;
  last_attendance_date: string | null;
}

const SchoolAdminAttendancePage: React.FC = () => {
  const [data, setData] = useState<ScheduleAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get('/auth/admin/school/attendance/overview');
      setData(res.data);
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load attendance overview' });
    } finally {
      setLoading(false);
    }
  };

  const getAttendanceRate = (row: ScheduleAttendance) => {
    const total = parseInt(row.total_present) + parseInt(row.total_absent) + parseInt(row.total_late);
    if (total === 0) return null;
    return Math.round(((parseInt(row.total_present) + parseInt(row.total_late)) / total) * 100);
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-primary">Attendance Overview</h1>
          <p className="text-sm text-secondary mt-1">
            Monitor attendance across all class schedules
          </p>
        </div>

        {/* Summary Cards */}
        {data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border border-subtle p-4">
              <div className="text-2xl font-bold text-primary">{data.length}</div>
              <div className="text-sm text-muted">Total Schedules</div>
            </div>
            <div className="bg-card rounded-lg border border-subtle p-4">
              <div className="text-2xl font-bold text-green-600 dark:text-green-300">
                {data.reduce((sum, d) => sum + parseInt(d.total_present), 0)}
              </div>
              <div className="text-sm text-muted">Total Present Marks</div>
            </div>
            <div className="bg-card rounded-lg border border-subtle p-4">
              <div className="text-2xl font-bold text-red-600 dark:text-red-300">
                {data.reduce((sum, d) => sum + parseInt(d.total_absent), 0)}
              </div>
              <div className="text-sm text-muted">Total Absent Marks</div>
            </div>
            <div className="bg-card rounded-lg border border-subtle p-4">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-300">
                {data.reduce((sum, d) => sum + parseInt(d.sessions_taken), 0)}
              </div>
              <div className="text-sm text-muted">Sessions Recorded</div>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-muted">Loading...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-lg border border-subtle">
            <p className="text-lg text-muted">No attendance data yet</p>
            <p className="text-sm text-muted mt-1">Attendance will appear here once faculty start marking.</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-subtle overflow-hidden">
            <table className="w-full">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">Course</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">Faculty</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">Schedule</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase">Enrolled</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase">Sessions</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase">Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">Last Taken</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {data.map((row, idx) => {
                  const rate = getAttendanceRate(row);
                  return (
                    <tr key={row.schedule_id} className="hover:bg-sunken transition-colors">
                      <td className="px-4 py-3 text-sm text-muted">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-primary">
                          {row.course_name}
                          {row.section ? ` (Sec ${row.section})` : ''}
                        </div>
                        <div className="text-xs text-muted">{row.course_code}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary">
                        {row.faculty_name || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-secondary">{row.days_of_week || '—'}</div>
                        <div className="text-xs text-muted">
                          {row.start_time?.slice(0, 5)}–{row.end_time?.slice(0, 5)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-secondary">
                        {row.enrolled_count}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-secondary">
                        {row.sessions_taken}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {rate !== null ? (
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                              rate >= 80
                                ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300'
                                : rate >= 60
                                ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300'
                            }`}
                          >
                            {rate}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {row.last_attendance_date
                          ? new Date(row.last_attendance_date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default SchoolAdminAttendancePage;
