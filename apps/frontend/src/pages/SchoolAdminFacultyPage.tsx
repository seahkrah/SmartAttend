import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useToastStore } from '../components/Toast';
import { TenantAdminLayout } from '../components/TenantAdminLayout';
import { getErrorMessage, showSuccess } from '../utils/errorHandler';

interface Faculty {
  id: string;
  user_id: string;
  faculty_id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  phone?: string;
  title?: string;
  address?: string;
  college?: string;
  department?: string;
  full_name: string;
  is_active: boolean;
  gender?: string;
}

const SchoolAdminFacultyPage: React.FC = () => {
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState<Faculty | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Faculty | null>(null);
  const { addToast } = useToastStore();

  // Form state
  const [formData, setFormData] = useState({
    facultyId: '',
    title: 'Mr.',
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    college: '',
    department: '',
    gender: ''
  });

  useEffect(() => {
    fetchFaculty();
  }, []);

  const fetchFaculty = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/school/faculty', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFaculty(response.data.faculty);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    // Validate required fields
    if (!formData.facultyId.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Faculty ID is required' });
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
      await axios.post('/api/auth/admin/school/faculty', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess('Faculty created successfully');
      setShowAddModal(false);
      resetForm();
      fetchFaculty();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFaculty) return;
    
    setSubmitting(true);
    
    // Validate required fields
    if (!formData.facultyId.trim()) {
      addToast({ type: 'error', title: 'Missing Field', message: 'Faculty ID is required' });
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
      await axios.patch(`/api/auth/admin/school/faculty/${editingFaculty.id}`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess('Faculty updated successfully');
      setEditingFaculty(null);
      resetForm();
      fetchFaculty();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      facultyId: '',
      title: 'Mr.',
      firstName: '',
      middleName: '',
      lastName: '',
      email: '',
      phone: '',
      address: '',
      college: '',
      department: '',
      gender: ''
    });
  };

  const openEditModal = (member: Faculty) => {
    setEditingFaculty(member);
    setFormData({
      facultyId: member.faculty_id || '',
      title: member.title || 'Mr.',
      firstName: member.first_name,
      middleName: member.middle_name || '',
      lastName: member.last_name,
      email: member.email,
      phone: member.phone || '',
      address: member.address || '',
      college: member.college || '',
      department: member.department || '',
      gender: member.gender || ''
    });
  };

  const handleSuspendFaculty = async (member: Faculty) => {
    try {
      const token = localStorage.getItem('accessToken');
      await axios.patch(`/api/auth/admin/school/faculty/${member.id}/suspend`, 
        { suspended: member.is_active },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showSuccess(member.is_active ? 'Faculty member suspended' : 'Faculty member reactivated');
      fetchFaculty();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    }
  };

  const handleDeleteFaculty = async (member: Faculty) => {
    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`/api/auth/admin/school/faculty/${member.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showSuccess('Faculty member deleted successfully');
      setConfirmDelete(null);
      fetchFaculty();
    } catch (error: any) {
      addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
    }
  };

  const filteredFaculty = faculty.filter(member =>
    member.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (member.faculty_id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (member.department || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (member.college || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <TenantAdminLayout currentPage="faculty" platform="school">
      <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Faculty Management</h1>
          <p className="text-sm text-gray-600 mt-1">Manage faculty members in your school</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span>+ Add Faculty</span>
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, faculty ID, email, college, or department..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder-gray-400"
        />
      </div>

      {/* Faculty List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">Loading faculty...</p>
        </div>
      ) : filteredFaculty.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-600 mb-4">
            {searchTerm ? 'No faculty members found matching your search.' : 'No faculty members yet.'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Add First Faculty Member
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">Faculty ID</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Name</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-52">Email</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-44">College</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Department</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Status</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredFaculty.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="px-3 py-4 text-sm font-medium text-gray-900 truncate max-w-[7rem]">{member.faculty_id || '-'}</td>
                  <td className="px-3 py-4 text-sm text-gray-900 truncate max-w-[12rem]">
                    {member.first_name} {member.middle_name ? member.middle_name + ' ' : ''}{member.last_name}
                  </td>
                  <td className="px-3 py-4 text-sm text-gray-600 truncate max-w-[13rem]">{member.email}</td>
                  <td className="px-3 py-4 text-sm text-gray-600 truncate max-w-[11rem]">{member.college || '-'}</td>
                  <td className="px-3 py-4 text-sm text-gray-600 truncate max-w-[10rem]">{member.department || '-'}</td>
                  <td className="px-3 py-4">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      member.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {member.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(member)}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleSuspendFaculty(member)}
                        className={`font-medium ${member.is_active ? 'text-yellow-600 hover:text-yellow-800' : 'text-green-600 hover:text-green-800'}`}
                      >
                        {member.is_active ? 'Suspend' : 'Activate'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(member)}
                        className="text-red-600 hover:text-red-800 font-medium"
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
      {(showAddModal || editingFaculty) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingFaculty ? 'Edit Faculty' : 'Add New Faculty'}</h2>
            <form onSubmit={editingFaculty ? handleUpdateFaculty : handleCreateFaculty}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Faculty ID *</label>
                  <input
                    type="text"
                    required
                    value={formData.facultyId}
                    onChange={(e) => setFormData({ ...formData, facultyId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    placeholder="e.g., F12345"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <select
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="Mr.">Mr.</option>
                    <option value="Mrs.">Mrs.</option>
                    <option value="Ms.">Ms.</option>
                    <option value="Dr.">Dr.</option>
                    <option value="Associate Prof.">Associate Prof.</option>
                    <option value="Assistant Prof.">Assistant Prof.</option>
                    <option value="Prof.">Prof.</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 font-medium appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Middle Name</label>
                  <input
                    type="text"
                    value={formData.middleName}
                    onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!!editingFaculty}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    placeholder="+1234567890"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    placeholder="e.g., 123 Main St, City, State"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">College *</label>
                  <input
                    type="text"
                    value={formData.college}
                    onChange={(e) => setFormData({ ...formData, college: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    placeholder="e.g., College of Engineering"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    placeholder="e.g., Computer Science"
                    required
                  />
                </div>
              </div>
              {!editingFaculty && (
                <p className="text-sm text-gray-500 mt-4 bg-blue-50 p-3 rounded">
                  ℹ️ A user account will be automatically created. Faculty will set password on first login.
                </p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingFaculty(null);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {editingFaculty ? 'Updating...' : 'Creating...'}
                    </span>
                  ) : (
                    editingFaculty ? 'Update Faculty' : 'Create Faculty'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Delete</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete <strong>{confirmDelete.first_name} {confirmDelete.last_name}</strong>? 
              This will permanently remove their faculty record and user account. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteFaculty(confirmDelete)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete Faculty
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </TenantAdminLayout>
  );
};

export default SchoolAdminFacultyPage;
