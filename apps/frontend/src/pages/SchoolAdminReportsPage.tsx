import React, { useState } from 'react';
import axios from 'axios';
import { useToastStore } from '../components/Toast';
import { TenantAdminLayout } from '../components/TenantAdminLayout';
import { getErrorMessage } from '../utils/errorHandler';

interface AttendanceRecord {
  id: string;
  attendance_date: string;
  status: string;
  first_name: string;
  last_name: string;
  student_id: string;
  course_name: string;
  course_code: string;
  faculty_name?: string;
  marked_at: string;
}

const SchoolAdminReportsPage: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const { addToast } = useToastStore();
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    scheduleId: '',
    facultyId: '',
    studentId: ''
  });

  const fetchReport = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.scheduleId) params.append('scheduleId', filters.scheduleId);
      if (filters.facultyId) params.append('facultyId', filters.facultyId);
      if (filters.studentId) params.append('studentId', filters.studentId);

      const response = await axios.get(`/api/auth/admin/school/reports/attendance?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecords(response.data.records);
      addToast({ type: 'success', title: 'Success', message: `Loaded ${response.data.totalRecords} records` });
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (records.length === 0) {
      addToast({ type: 'error', title: 'Error', message: 'No records to export' });
      return;
    }

    const headers = ['Date', 'Student ID', 'Student Name', 'Course', 'Status', 'Faculty', 'Marked At'];
    const rows = records.map(r => [
      r.attendance_date,
      r.student_id,
      `${r.first_name} ${r.last_name}`,
      `${r.course_code} - ${r.course_name}`,
      r.status,
      r.faculty_name || 'N/A',
      new Date(r.marked_at).toLocaleString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Success', message: 'Report exported successfully' });
  };

  return (
    <TenantAdminLayout currentPage="reports" platform="school">
      <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Attendance Reports & Analytics</h1>
        <p className="text-sm text-gray-600 mt-1">Generate and export attendance reports</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="font-semibold text-lg mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={fetchReport}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
            {records.length > 0 && (
              <button
                onClick={exportToCSV}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Export CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {records.length > 0 ? (
        <>
          <div className="mb-4 flex justify-between items-center">
            <p className="text-sm text-gray-600">Showing {records.length} records</p>
          </div>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Faculty</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marked At</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.attendance_date}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {record.first_name} {record.last_name}
                      <span className="block text-xs text-gray-500">{record.student_id}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {record.course_code}
                      <span className="block text-xs text-gray-500">{record.course_name}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        record.status === 'present' ? 'bg-green-100 text-green-800' :
                        record.status === 'absent' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {record.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{record.faculty_name || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(record.marked_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">📊</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Records Yet</h3>
          <p className="text-gray-500">Select filters and click "Generate Report" to view attendance data</p>
        </div>
      )}
      </div>
    </TenantAdminLayout>
  );
};

export default SchoolAdminReportsPage;
