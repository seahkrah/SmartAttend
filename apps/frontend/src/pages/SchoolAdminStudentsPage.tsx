import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { apiClient } from '../services/api';
import { InvitationDialog, type InvitationResult } from '../components/accounts/InvitationDialog';
import { useToastStore } from '../components/Toast';
import { getErrorMessage, showSuccess } from '../utils/errorHandler';

interface Student {
  id: string;
  user_id: string;
  student_id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  phone?: string;
  address?: string;
  college?: string;
  department?: string;
  status?: string;
  full_name: string;
  is_active: boolean;
  profile_photo_url?: string;
  gender?: string;
}

const SchoolAdminStudentsPage: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [invite, setInvite] = useState<{ userId: string; name: string; invitation: InvitationResult | null } | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Student | null>(null);
  const { addToast } = useToastStore();

  // Form state
  const [formData, setFormData] = useState({
    studentId: '',
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    college: '',
    department: '',
    status: 'freshman',
    gender: '',
    profilePhoto: '' as string
  });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/students', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStudents(response.data.students);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    // Validate required fields
    if (!formData.studentId.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Student ID is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.firstName.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'First Name is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.lastName.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Last Name is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.email.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Email is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.college.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'College is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.department.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Department is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.profilePhoto) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Student photo is required' });
      setSubmitting(false);
      return;
    }
    
    try {
      const res = await apiClient.post('/auth/admin/school/students', formData);
      setInvite({ userId: res.data.userId, name: `${formData.firstName} ${formData.lastName}`, invitation: res.data.invitation ?? null });
      setShowAddModal(false);
      resetForm();
      fetchStudents();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    
    setSubmitting(true);
    
    // Validate required fields
    if (!formData.studentId.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Student ID is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.firstName.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'First Name is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.lastName.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Last Name is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.email.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Email is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.college.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'College is required' });
      setSubmitting(false);
      return;
    }
    if (!formData.department.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Department is required' });
      setSubmitting(false);
      return;
    }
    
    try {
      const token = localStorage.getItem('accessToken');
      await axios.patch(`/api/auth/admin/school/students/${editingStudent.id}`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess('Student updated successfully');
      setEditingStudent(null);
      resetForm();
      fetchStudents();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      studentId: '',
      firstName: '',
      middleName: '',
      lastName: '',
      email: '',
      phone: '',
      address: '',
      college: '',
      department: '',
      status: 'freshman',
      gender: '',
      profilePhoto: ''
    });
    setPhotoPreview(null);
  };

  const handleSuspendStudent = async (student: Student) => {
    try {
      const token = localStorage.getItem('accessToken');
      const suspended = student.is_active; // if active, we suspend; if inactive, we reactivate
      await axios.patch(`/api/auth/admin/school/students/${student.id}/suspend`, { suspended }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess(suspended ? 'Student suspended' : 'Student reactivated');
      fetchStudents();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`/api/auth/admin/school/students/${student.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess('Student deleted successfully');
      setConfirmDelete(null);
      fetchStudents();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
      setConfirmDelete(null);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      addToast({ type: 'error', title: 'Invalid File', message: 'Please select an image file' });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      addToast({ type: 'error', title: 'File Too Large', message: 'Image must be less than 5MB' });
      return;
    }

    // Read and convert to base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setFormData({ ...formData, profilePhoto: base64 });
      setPhotoPreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const openEditModal = (student: Student) => {
    setFormData({
      studentId: student.student_id,
      firstName: student.first_name,
      middleName: student.middle_name || '',
      lastName: student.last_name,
      email: student.email,
      phone: student.phone || '',
      address: student.address || '',
      college: student.college || '',
      department: student.department || '',
      status: student.status || 'freshman',
      gender: student.gender || '',
      profilePhoto: ''
    });
    setPhotoPreview(student.profile_photo_url || null);
    setEditingStudent(student);
  };

  const filteredStudents = students.filter(student =>
    student.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.student_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      {invite && (
        <InvitationDialog
          personName={invite.name}
          invitation={invite.invitation}
          issue={async (handover) =>
            (await apiClient.post(`/auth/admin/school/users/${invite.userId}/invitation`, { handover })).data.invitation}
          onClose={() => setInvite(null)}
        />
      )}
      <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-primary">Student Management</h1>
          <p className="text-sm text-secondary mt-1">Manage students in your school</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span>+ Add Student</span>
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, student ID, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card text-primary placeholder:text-muted"
        />
      </div>

      {/* Student List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-secondary">Loading students...</p>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="bg-card rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">🎓</div>
          <h3 className="text-xl font-semibold text-secondary mb-2">No Students Found</h3>
          <p className="text-muted mb-4">
            {searchTerm ? 'Try a different search term' : 'Get started by adding your first student'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Add First Student
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-lg shadow overflow-x-auto">
          <table className="w-full divide-y divide-subtle table-fixed" style={{ minWidth: '900px' }}>
            <thead className="bg-sunken">
              <tr>
                <th className="w-[100px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Student ID</th>
                <th className="w-[180px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Name</th>
                <th className="w-[180px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Email</th>
                <th className="w-[160px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">College</th>
                <th className="w-[130px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Department</th>
                <th className="w-[80px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                <th className="w-[70px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Active</th>
                <th className="w-[160px] px-3 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-subtle">
              {filteredStudents.map((student) => (
                <tr key={student.id} className="hover:bg-sunken">
                  <td className="px-3 py-3 text-sm font-medium text-primary truncate" title={student.student_id}>{student.student_id}</td>
                  <td className="px-3 py-3 text-sm text-primary truncate" title={[student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')}>
                    {[student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')}
                  </td>
                  <td className="px-3 py-3 text-sm text-secondary truncate" title={student.email}>{student.email}</td>
                  <td className="px-3 py-3 text-sm text-secondary truncate" title={student.college || ''}>{student.college || '-'}</td>
                  <td className="px-3 py-3 text-sm text-secondary truncate" title={student.department || ''}>{student.department || '-'}</td>
                  <td className="px-3 py-3 text-sm text-secondary capitalize">{student.status || '-'}</td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      student.is_active ? 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300'
                    }`}>
                      {student.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(student)}
                        className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 rounded transition-colors"
                        title="Edit student"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleSuspendStudent(student)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          student.is_active
                            ? 'text-orange-600 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-500/15'
                            : 'text-green-600 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-500/15'
                        }`}
                        title={student.is_active ? 'Suspend student' : 'Reactivate student'}
                      >
                        {student.is_active ? 'Suspend' : 'Activate'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(student)}
                        className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15 rounded transition-colors"
                        title="Delete student"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingStudent) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingStudent ? 'Edit Student' : 'Add New Student'}</h2>
            <form onSubmit={editingStudent ? handleUpdateStudent : handleCreateStudent}>
              {/* Photo Upload Section */}
              <div className="mb-6 flex flex-col items-center">
                <div className="relative">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Student"
                      className="w-32 h-32 rounded-full object-cover border-4 border-subtle"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-full bg-sunken flex items-center justify-center border-4 border-subtle">
                      <span className="text-4xl text-muted">👤</span>
                    </div>
                  )}
                </div>
                <label className="mt-3 px-4 py-2 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/15 cursor-pointer text-sm font-medium">
                  {photoPreview ? 'Change Photo' : 'Upload Photo *'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                </label>
                <p className="text-xs text-muted mt-2">Max 5MB, JPG/PNG {!editingStudent && '(Required)'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Student ID *</label>
                  <input
                    type="text"
                    required
                    value={formData.studentId}
                    onChange={(e) => setFormData({ ...formData, studentId: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                    placeholder="e.g., S12345"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Middle Name</label>
                  <input
                    type="text"
                    value={formData.middleName}
                    onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card text-primary font-medium appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!!editingStudent}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-sunken text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                    placeholder="+1234567890"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-secondary mb-1">Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">College *</label>
                  <input
                    type="text"
                    value={formData.college}
                    onChange={(e) => setFormData({ ...formData, college: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                    placeholder="e.g., College of Engineering"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Department *</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                    placeholder="e.g., Computer Science"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1">Status *</label>
                  <select
                    required
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card text-primary font-medium appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="freshman">Freshman</option>
                    <option value="sophomore">Sophomore</option>
                    <option value="junior">Junior</option>
                    <option value="senior">Senior</option>
                  </select>
                </div>
              </div>
              {!editingStudent && (
                <p className="text-sm text-muted mt-4 bg-blue-50 dark:bg-blue-500/15 p-3 rounded">
                  ℹ️ A user account will be automatically created. Student will set password on first login.
                </p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingStudent(null);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 border border-subtle text-secondary rounded-lg hover:bg-sunken"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-raised disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {editingStudent ? 'Updating...' : 'Creating...'}
                    </span>
                  ) : (
                    editingStudent ? 'Update Student' : 'Create Student'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-primary mb-2">Delete Student</h3>
            <p className="text-sm text-secondary mb-4">
              Are you sure you want to delete <span className="font-semibold">{confirmDelete.first_name} {confirmDelete.last_name}</span> ({confirmDelete.student_id})?
              This action cannot be undone and will also remove their user account.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm font-medium text-secondary bg-sunken hover:bg-sunken rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteStudent(confirmDelete)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default SchoolAdminStudentsPage;
