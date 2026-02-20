import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useToastStore } from '../components/Toast';
import { TenantAdminLayout } from '../components/TenantAdminLayout';
import { getErrorMessage, showSuccess } from '../utils/errorHandler';
import { useConfirmDialog } from '../components/useConfirmDialog';

interface Schedule {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  faculty_id: string;
  faculty_name: string;
  room_id: string;
  building: string;
  room_number: string;
  day_of_week: number;
  days_of_week?: string;
  section: number;
  start_time: string;
  end_time: string;
}

interface Course {
  id: string;
  code: string;
  name: string;
}

interface Faculty {
  id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  full_name?: string;
}

interface Room {
  id: string;
  building: string;
  room_number: string;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format days_of_week string (e.g. "1,3") into display text (e.g. "Mon / Wed") */
const formatDays = (schedule: Schedule): string => {
  if (schedule.days_of_week) {
    return schedule.days_of_week
      .split(',')
      .map(d => DAYS_OF_WEEK[parseInt(d.trim())])
      .join(' / ');
  }
  return DAYS_OF_WEEK[schedule.day_of_week] || 'N/A';
};

/** Parse days_of_week string into number array */
const parseDays = (schedule: Schedule): number[] => {
  if (schedule.days_of_week) {
    return schedule.days_of_week.split(',').map(d => parseInt(d.trim()));
  }
  return [schedule.day_of_week];
};

const SchoolAdminSchedulesPage: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleDayFormat, setScheduleDayFormat] = useState(1);
  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  // Form state
  const [formData, setFormData] = useState({
    courseId: '',
    facultyId: '',
    roomId: '',
    daysOfWeek: [] as number[],
    startTime: '',
    endTime: ''
  });

  useEffect(() => {
    fetchSchedules();
    fetchCourses();
    fetchFaculty();
    fetchRooms();
    fetchDayFormat();
  }, []);

  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/schedules', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSchedules(response.data.schedules);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const fetchCourses = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/courses', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCourses(response.data.courses);
    } catch (error: any) {
      console.error('Failed to load courses:', error);
    }
  };

  const fetchFaculty = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/faculty', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFaculty(response.data.faculty);
    } catch (error: any) {
      console.error('Failed to load faculty:', error);
    }
  };

  const fetchRooms = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/rooms', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRooms(response.data.rooms);
    } catch (error: any) {
      console.error('Failed to load rooms:', error);
    }
  };

  const fetchDayFormat = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const fmt = response.data.settings?.schedule_day_format;
      if (fmt) setScheduleDayFormat(parseInt(fmt));
    } catch (error: any) {
      console.error('Failed to load day format setting:', error);
    }
  };

  const toggleDay = (dayIndex: number) => {
    setFormData(prev => {
      const current = [...prev.daysOfWeek];
      const idx = current.indexOf(dayIndex);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else if (current.length < scheduleDayFormat) {
        current.push(dayIndex);
        current.sort((a, b) => a - b);
      }
      return { ...prev, daysOfWeek: current };
    });
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.daysOfWeek.length === 0) {
      addToast({ type: 'error', title: 'Error', message: `Please select ${scheduleDayFormat} day(s)` });
      return;
    }
    if (formData.daysOfWeek.length !== scheduleDayFormat) {
      addToast({ type: 'error', title: 'Error', message: `Please select exactly ${scheduleDayFormat} day(s). Currently selected: ${formData.daysOfWeek.length}` });
      return;
    }
    try {
      const token = localStorage.getItem('accessToken');
      await axios.post('/api/auth/admin/school/schedules', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess(`Schedule created for ${formData.daysOfWeek.length} day(s)`);
      setShowAddModal(false);
      resetForm();
      fetchSchedules();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    }
  };

  const handleUpdateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule) return;
    
    try {
      const token = localStorage.getItem('accessToken');
      await axios.patch(`/api/auth/admin/school/schedules/${editingSchedule.id}`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess('Schedule updated successfully');
      setEditingSchedule(null);
      resetForm();
      fetchSchedules();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    }
  };

  const resetForm = () => {
    setFormData({
      courseId: '',
      facultyId: '',
      roomId: '',
      daysOfWeek: [],
      startTime: '',
      endTime: ''
    });
  };

  const openEditModal = (schedule: Schedule) => {
    setFormData({
      courseId: schedule.course_id,
      facultyId: schedule.faculty_id,
      roomId: schedule.room_id,
      daysOfWeek: parseDays(schedule),
      startTime: schedule.start_time,
      endTime: schedule.end_time
    });
    setEditingSchedule(schedule);
  };

  const handleDeleteSchedule = async (schedule: Schedule) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete Schedule?',
      message: `Are you sure you want to delete the schedule for "${schedule.course_code}" on ${formatDays(schedule)}? This action cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`/api/auth/admin/school/schedules/${schedule.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      addToast({ type: 'success', title: 'Success', message: 'Schedule deleted successfully' });
      fetchSchedules();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: error.response?.data?.error || 'Failed to delete schedule' });
    }
  };

  const filteredSchedules = schedules.filter(schedule =>
    schedule.course_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    schedule.course_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    schedule.faculty_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    formatDays(schedule).toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <TenantAdminLayout currentPage="schedules" platform="school">
      <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule Management</h1>
          <p className="text-sm text-gray-600 mt-1">Manage class schedules</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span>+ Add Schedule</span>
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search schedules..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="text-gray-600">Loading schedules...</div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">#</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Course</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Faculty</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSchedules.map((schedule, index) => (
                  <tr key={schedule.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-medium">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{schedule.course_code}</div>
                      <div className="text-sm text-gray-500">{schedule.course_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {schedule.section}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {schedule.faculty_name || 'Not assigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {schedule.building} {schedule.room_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDays(schedule)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {schedule.start_time} - {schedule.end_time}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => openEditModal(schedule)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteSchedule(schedule)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredSchedules.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-center text-sm text-gray-500">
                      No schedules found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingSchedule) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">
                {editingSchedule ? 'Edit Schedule' : 'Add New Schedule'}
              </h2>
              
              <form onSubmit={editingSchedule ? handleUpdateSchedule : handleCreateSchedule}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Course *
                    </label>
                    <select
                      value={formData.courseId}
                      onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                      required
                      disabled={!!editingSchedule}
                    >
                      <option value="">Select course</option>
                      {courses.map(course => (
                        <option key={course.id} value={course.id}>
                          {course.code} - {course.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Faculty *
                    </label>
                    <select
                      value={formData.facultyId}
                      onChange={(e) => setFormData({ ...formData, facultyId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                      required
                      disabled={!!editingSchedule}
                    >
                      <option value="">Select faculty</option>
                      {faculty.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.full_name || `${f.first_name} ${f.middle_name ? f.middle_name + ' ' : ''}${f.last_name}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Room *
                    </label>
                    <select
                      value={formData.roomId}
                      onChange={(e) => setFormData({ ...formData, roomId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                      required
                    >
                      <option value="">Select room</option>
                      {rooms.map(room => (
                        <option key={room.id} value={room.id}>
                          {room.building} {room.room_number}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Days of Week * <span className="text-xs text-gray-400">(select {scheduleDayFormat})</span>
                    </label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {DAYS_OF_WEEK.map((day, index) => {
                        const isSelected = formData.daysOfWeek.includes(index);
                        const isDisabled = !isSelected && formData.daysOfWeek.length >= scheduleDayFormat;
                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() => !editingSchedule && toggleDay(index)}
                            disabled={editingSchedule ? true : isDisabled}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-600'
                                : isDisabled
                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
                            }`}
                          >
                            {DAYS_SHORT[index]}
                          </button>
                        );
                      })}
                    </div>
                    {formData.daysOfWeek.length > 0 && (
                      <p className="text-xs text-blue-600 mt-1">
                        Selected: {formData.daysOfWeek.map(d => DAYS_OF_WEEK[d]).join(', ')}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Time *
                    </label>
                    <input
                      type="time"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Time *
                    </label>
                    <input
                      type="time"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      setEditingSchedule(null);
                      resetForm();
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {editingSchedule ? 'Update' : 'Create'} Schedule
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      </div>
      <ConfirmDialog />
    </TenantAdminLayout>
  );
};

export default SchoolAdminSchedulesPage;
