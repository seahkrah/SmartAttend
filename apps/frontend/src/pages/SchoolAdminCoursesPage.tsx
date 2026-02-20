import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useToastStore } from '../components/Toast';
import { TenantAdminLayout } from '../components/TenantAdminLayout';
import { getErrorMessage, showSuccess } from '../utils/errorHandler';
import { useConfirmDialog } from '../components/useConfirmDialog';

interface Course {
  id: string;
  code: string;
  name: string;
  description?: string;
  credits?: number;
  department_name?: string;
}

const SchoolAdminCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    credits: ''
  });

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/courses', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCourses(response.data.courses);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('accessToken');
    
    try {
      if (editingCourse) {
        await axios.patch(`/api/auth/admin/school/courses/${editingCourse.id}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        addToast({ type: 'success', title: 'Success', message: 'Course updated successfully' });
      } else {
        await axios.post('/api/auth/admin/school/courses', formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        addToast({ type: 'success', title: 'Success', message: 'Course created successfully' });
      }
      setShowModal(false);
      setEditingCourse(null);
      resetForm();
      fetchCourses();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: error.response?.data?.error || 'Operation failed' });
    }
  };

  const resetForm = () => {
    setFormData({ code: '', name: '', description: '', credits: '' });
  };

  const openEditModal = (course: Course) => {
    setEditingCourse(course);
    setFormData({
      code: course.code,
      name: course.name,
      description: course.description || '',
      credits: course.credits?.toString() || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (course: Course) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete Course?',
      message: `Are you sure you want to delete course "${course.code} - ${course.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`/api/auth/admin/school/courses/${course.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      addToast({ type: 'success', title: 'Success', message: 'Course deleted successfully' });
      fetchCourses();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: error.response?.data?.error || 'Failed to delete course' });
    }
  };

  const filteredCourses = courses.filter(c =>
    c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <TenantAdminLayout currentPage="courses" platform="school">
      <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Course Management</h1>
          <p className="text-sm text-gray-600 mt-1">Manage courses offered at your school</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Add Course
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search courses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">📚</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Courses Found</h3>
          <p className="text-gray-500 mb-4">
            {searchTerm ? 'Try a different search term' : 'Add your first course to get started'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map((course) => (
            <div key={course.id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-lg text-gray-900">{course.code}</h3>
                  <p className="text-sm text-gray-600 mt-1">{course.name}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(course)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(course)}
                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {course.description && <p className="text-sm text-gray-500 mb-2">{course.description}</p>}
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{course.credits || 0} Credits</span>
                {course.department_name && <span className="text-xs bg-gray-100 px-2 py-1 rounded">{course.department_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">{editingCourse ? 'Edit Course' : 'Add New Course'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course Code</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Credits</label>
                    <input
                      type="number"
                      value={formData.credits}
                      onChange={(e) => setFormData({ ...formData, credits: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingCourse(null); resetForm(); }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingCourse ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    <ConfirmDialog />
    </TenantAdminLayout>
  );
};

export default SchoolAdminCoursesPage;
