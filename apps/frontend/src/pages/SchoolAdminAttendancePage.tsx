/**
 * School Admin Attendance Page
 *
 * Overview of attendance across all schedules.
 * Shows per-schedule stats: sessions taken, present/absent rates, last attendance date.
 */

import React, { useEffect, useState } from 'react';
import TenantAdminLayout from '../components/TenantAdminLayout';
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
    <TenantAdminLayout currentPage="attendance" platform="school">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance Overview</h1>
          <p className="text-sm text-gray-600 mt-1">
            Monitor attendance across all class schedules
          </p>
        </div>

        {/* Summary Cards */}
        {data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">{data.length}</div>
              <div className="text-sm text-gray-500">Total Schedules</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">
                {data.reduce((sum, d) => sum + parseInt(d.total_present), 0)}
              </div>
              <div className="text-sm text-gray-500">Total Present Marks</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-red-600">
                {data.reduce((sum, d) => sum + parseInt(d.total_absent), 0)}
              </div>
              <div className="text-sm text-gray-500">Total Absent Marks</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-2xl font-bold text-blue-600">
                {data.reduce((sum, d) => sum + parseInt(d.sessions_taken), 0)}
              </div>
              <div className="text-sm text-gray-500">Sessions Recorded</div>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-gray-500">Loading...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <p className="text-lg text-gray-500">No attendance data yet</p>
            <p className="text-sm text-gray-400 mt-1">Attendance will appear here once faculty start marking.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Course</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Faculty</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Schedule</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Enrolled</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Sessions</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Last Taken</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((row, idx) => {
                  const rate = getAttendanceRate(row);
                  return (
                    <tr key={row.schedule_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          {row.course_name}
                          {row.section ? ` (Sec ${row.section})` : ''}
                        </div>
                        <div className="text-xs text-gray-400">{row.course_code}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {row.faculty_name || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-600">{row.days_of_week || '—'}</div>
                        <div className="text-xs text-gray-400">
                          {row.start_time?.slice(0, 5)}–{row.end_time?.slice(0, 5)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600">
                        {row.enrolled_count}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-600">
                        {row.sessions_taken}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {rate !== null ? (
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                              rate >= 80
                                ? 'bg-green-100 text-green-700'
                                : rate >= 60
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {rate}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
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
    </TenantAdminLayout>
  );
};

export default SchoolAdminAttendancePage;
