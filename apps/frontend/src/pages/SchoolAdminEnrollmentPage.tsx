import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useToastStore } from '../components/Toast';
import { TenantAdminLayout } from '../components/TenantAdminLayout';
import { getErrorMessage, showSuccess } from '../utils/errorHandler';
import { useConfirmDialog } from '../components/useConfirmDialog';

interface Enrollment {
  id: string;
  student_id: string;
  schedule_id: string;
  status: string;
  enrolled_at: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  student_code: string;
  course_name: string;
  course_code: string;
  section: number;
  day_of_week: number;
  days_of_week?: string;
  start_time: string;
  end_time: string;
  building: string;
  room_number: string;
  faculty_name: string;
}

interface Student {
  id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  student_id: string;
}

interface Schedule {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  faculty_name: string;
  building: string;
  room_number: string;
  day_of_week: number;
  days_of_week?: string;
  section: number;
  start_time: string;
  end_time: string;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatDays = (daysOfWeek?: string, dayOfWeek?: number): string => {
  if (daysOfWeek) {
    return daysOfWeek
      .split(',')
      .map(d => DAYS_OF_WEEK[parseInt(d.trim())])
      .join(' / ');
  }
  if (dayOfWeek !== undefined) return DAYS_OF_WEEK[dayOfWeek] || 'N/A';
  return 'N/A';
};

const selectStyle = {
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")',
  backgroundPosition: 'right 0.5rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '1.5em 1.5em',
  paddingRight: '2.5rem',
};

const SchoolAdminEnrollmentPage: React.FC = () => {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSchedule, setFilterSchedule] = useState('');
  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  // Form state
  const [selectedSchedule, setSelectedSchedule] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = () => {
    fetchEnrollments();
    fetchStudents();
    fetchSchedules();
  };

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/enrollments', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setEnrollments(response.data.enrollments);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/students', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStudents(response.data.students);
    } catch (error: any) {
      console.error('Failed to load students:', error);
    }
  };

  const fetchSchedules = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/schedules', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSchedules(response.data.schedules);
    } catch (error: any) {
      console.error('Failed to load schedules:', error);
    }
  };

  const handleEnroll = async () => {
    if (!selectedSchedule || selectedStudents.length === 0) {
      addToast({ type: 'error', title: 'Error', message: 'Please select a section and at least one student' });
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const studentId of selectedStudents) {
      try {
        const token = localStorage.getItem('accessToken');
        await axios.post(
          '/api/auth/admin/school/enrollments',
          { studentId, scheduleId: selectedSchedule },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        successCount++;
      } catch (error: any) {
        errorCount++;
        const msg = error.response?.data?.error || 'Failed';
        // Only toast for duplicate / unique constraint
        if (msg.includes('duplicate') || msg.includes('unique')) {
          // skip silently—student already enrolled
        } else {
          addToast({ type: 'error', title: 'Error', message: msg });
        }
      }
    }

    if (successCount > 0) {
      showSuccess(`${successCount} student(s) enrolled successfully`);
    }
    if (errorCount > 0 && successCount === 0) {
      addToast({ type: 'error', title: 'Error', message: 'All selected students are already enrolled or an error occurred' });
    }

    setShowEnrollModal(false);
    setSelectedSchedule('');
    setSelectedStudents([]);
    setStudentSearch('');
    fetchEnrollments();
  };

  const handleUnenroll = async (enrollment: Enrollment) => {
    const studentName = `${enrollment.first_name} ${enrollment.last_name}`;
    const confirmed = await showConfirmDialog({
      title: 'Unenroll Student?',
      message: `Remove ${studentName} from ${enrollment.course_code} Section ${enrollment.section}?`,
      confirmText: 'Unenroll',
      danger: true,
    });
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`/api/auth/admin/school/enrollments/${enrollment.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      addToast({ type: 'success', title: 'Success', message: 'Student unenrolled successfully' });
      fetchEnrollments();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    }
  };

  // Students not yet enrolled in selected schedule
  const availableStudents = useMemo(() => {
    if (!selectedSchedule) return [];
    const enrolledStudentIds = new Set(
      enrollments
        .filter(e => e.schedule_id === selectedSchedule)
        .map(e => e.student_id)
    );
    return students.filter(s => !enrolledStudentIds.has(s.id));
  }, [selectedSchedule, students, enrollments]);

  const filteredAvailableStudents = useMemo(() => {
    if (!studentSearch) return availableStudents;
    const term = studentSearch.toLowerCase();
    return availableStudents.filter(
      s =>
        s.first_name.toLowerCase().includes(term) ||
        s.last_name.toLowerCase().includes(term) ||
        s.student_id.toLowerCase().includes(term) ||
        (s.middle_name && s.middle_name.toLowerCase().includes(term))
    );
  }, [availableStudents, studentSearch]);

  const toggleStudent = (studentId: string) => {
    setSelectedStudents(prev =>
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const selectAllVisible = () => {
    const visibleIds = filteredAvailableStudents.map(s => s.id);
    setSelectedStudents(prev => {
      const newSet = new Set([...prev, ...visibleIds]);
      return Array.from(newSet);
    });
  };

  const deselectAll = () => {
    setSelectedStudents([]);
  };

  // Group enrollments by schedule for display
  const filteredEnrollments = useMemo(() => {
    let result = enrollments;
    if (filterSchedule) {
      result = result.filter(e => e.schedule_id === filterSchedule);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        e =>
          e.first_name.toLowerCase().includes(term) ||
          e.last_name.toLowerCase().includes(term) ||
          e.student_code.toLowerCase().includes(term) ||
          e.course_code.toLowerCase().includes(term) ||
          e.course_name.toLowerCase().includes(term)
      );
    }
    return result;
  }, [enrollments, filterSchedule, searchTerm]);

  // Schedule labels for filter/select
  const scheduleLabel = (s: Schedule | { course_code: string; section: number; days_of_week?: string; day_of_week: number; start_time: string; end_time: string }) =>
    `${s.course_code} – Sec ${s.section} (${formatDays(s.days_of_week, s.day_of_week)}, ${s.start_time}–${s.end_time})`;

  // Count students per schedule
  const enrollmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    enrollments.forEach(e => {
      counts[e.schedule_id] = (counts[e.schedule_id] || 0) + 1;
    });
    return counts;
  }, [enrollments]);

  return (
    <TenantAdminLayout currentPage="enrollment" platform="school">
      <div className="p-6">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Enrollment</h1>
            <p className="text-sm text-gray-600 mt-1">Enroll students into course sections</p>
          </div>
          <button
            onClick={() => setShowEnrollModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <span>+ Enroll Students</span>
          </button>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Search by name, ID or course..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <select
            value={filterSchedule}
            onChange={e => setFilterSchedule(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
            style={selectStyle}
          >
            <option value="">All Sections</option>
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                {scheduleLabel(s)} ({enrollmentCounts[s.id] || 0} students)
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-gray-600">Loading enrollments...</div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">#</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Course</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day(s)</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredEnrollments.map((enrollment, index) => (
                    <tr key={enrollment.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-medium">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                        {enrollment.student_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {enrollment.first_name} {enrollment.middle_name ? enrollment.middle_name + ' ' : ''}{enrollment.last_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{enrollment.course_code}</div>
                        <div className="text-sm text-gray-500">{enrollment.course_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                        {enrollment.section}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDays(enrollment.days_of_week, enrollment.day_of_week)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {enrollment.start_time} – {enrollment.end_time}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                          enrollment.status === 'enrolled'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {enrollment.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => handleUnenroll(enrollment)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Unenroll
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredEnrollments.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-500">
                        {enrollments.length === 0
                          ? 'No students enrolled yet. Click "+ Enroll Students" to get started.'
                          : 'No enrollments match your search.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredEnrollments.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
                Showing {filteredEnrollments.length} enrollment(s)
              </div>
            )}
          </div>
        )}

        {/* Enroll Modal */}
        {showEnrollModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <h2 className="text-xl font-bold mb-4">Enroll Students</h2>

                {/* Step 1: Select Section */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Course Section *
                  </label>
                  <select
                    value={selectedSchedule}
                    onChange={e => {
                      setSelectedSchedule(e.target.value);
                      setSelectedStudents([]);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                    style={selectStyle}
                  >
                    <option value="">Choose a section...</option>
                    {schedules.map(s => (
                      <option key={s.id} value={s.id}>
                        {scheduleLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Step 2: Selected section info */}
                {selectedSchedule && (() => {
                  const sched = schedules.find(s => s.id === selectedSchedule);
                  if (!sched) return null;
                  return (
                    <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="text-sm font-medium text-blue-900">
                        {sched.course_code} – {sched.course_name}
                      </div>
                      <div className="text-xs text-blue-700 mt-1">
                        Section {sched.section} · {formatDays(sched.days_of_week, sched.day_of_week)} · {sched.start_time}–{sched.end_time}
                        {sched.building && ` · ${sched.building} ${sched.room_number}`}
                        {sched.faculty_name && ` · ${sched.faculty_name}`}
                      </div>
                      <div className="text-xs text-blue-600 mt-1">
                        Currently enrolled: {enrollmentCounts[sched.id] || 0} student(s)
                      </div>
                    </div>
                  );
                })()}

                {/* Step 3: Select Students */}
                {selectedSchedule && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Select Students ({selectedStudents.length} selected)
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={selectAllVisible}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          Select all visible
                        </button>
                        {selectedStudents.length > 0 && (
                          <button
                            type="button"
                            onClick={deselectAll}
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            Clear selection
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Search students by name or ID..."
                      value={studentSearch}
                      onChange={e => setStudentSearch(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2"
                    />
                    <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                      {filteredAvailableStudents.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500 text-center">
                          {availableStudents.length === 0
                            ? 'All students are already enrolled in this section.'
                            : 'No students match your search.'}
                        </div>
                      ) : (
                        filteredAvailableStudents.map(student => (
                          <label
                            key={student.id}
                            className={`flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${
                              selectedStudents.includes(student.id) ? 'bg-blue-50' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedStudents.includes(student.id)}
                              onChange={() => toggleStudent(student.id)}
                              className="mr-3 h-4 w-4 text-blue-600 rounded border-gray-300"
                            />
                            <div className="flex-1">
                              <span className="text-sm font-medium text-gray-900">
                                {student.first_name} {student.middle_name ? student.middle_name + ' ' : ''}{student.last_name}
                              </span>
                              <span className="text-xs text-gray-500 ml-2 font-mono">{student.student_id}</span>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEnrollModal(false);
                      setSelectedSchedule('');
                      setSelectedStudents([]);
                      setStudentSearch('');
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleEnroll}
                    disabled={!selectedSchedule || selectedStudents.length === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Enroll {selectedStudents.length > 0 ? `(${selectedStudents.length})` : ''} Student{selectedStudents.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </TenantAdminLayout>
  );
};

export default SchoolAdminEnrollmentPage;
