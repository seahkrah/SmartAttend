/**
 * PHASE 9: ADMIN (TENANT) OPERATIONAL PANEL
 * 
 * QUESTION: Can the admin (school/corporate) manage their tenant correctly, safely, and without ambiguity?
 * 
 * Operational Surface:
 * - User management (create faculty/students/employees, bulk import)
 * - Course/Department management (assign faculty to courses)
 * - Attendance rules configuration
 * - Approval workflows (pending user accounts)
 * - Tenant analytics & reporting
 * - Role assignments & permissions
 */

import React from 'react';
import {
  Users, BookOpen, Settings, BarChart3, CheckCircle, AlertCircle,
  UserPlus, Upload, Search, Edit, Trash2, Eye, Lock, Unlock,
  Mail, Phone, Calendar, ChevronRight, Filter, Download, Plus,
  Clock, TrendingUp
} from 'lucide-react';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TenantUser {
  id: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'FACULTY' | 'STUDENT' | 'EMPLOYEE' | 'HR';
  status: 'ACTIVE' | 'PENDING_APPROVAL' | 'INACTIVE';
  created_at: string;
  department?: string;
  phone?: string;
}

interface Course {
  id: string;
  name: string;
  code: string;
  faculty_id?: string;
  faculty_name?: string;
  students_count: number;
  status: 'ACTIVE' | 'ARCHIVED';
  semester: string;
}

interface ApprovalQueue {
  id: string;
  user_id: string;
  username: string;
  email: string;
  role: string;
  requested_at: string;
  reason?: string;
}

interface TenantAnalytics {
  total_users: number;
  total_faculty: number;
  total_students: number;
  total_employees: number;
  total_courses: number;
  active_sessions: number;
  attendance_recorded_today: number;
  pending_approvals: number;
  storage_used_gb: number;
}

// ============================================================================
// COMPONENT 1: UserManagement.tsx
// ============================================================================

interface UserManagementProps {
  users: TenantUser[];
  loading: boolean;
  onCreateUser: (user: Partial<TenantUser>) => void;
  onDeleteUser: (userId: string) => void;
  onEditUser: (user: TenantUser) => void;
  onBulkImport: (file: File) => void;
}

export const UserManagement: React.FC<UserManagementProps> = ({
  users,
  loading,
  onCreateUser,
  onDeleteUser,
  onEditUser,
  onBulkImport
}) => {
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<string>('ALL');
  const [showUploadModal, setShowUploadModal] = React.useState(false);

  const [formData, setFormData] = React.useState({
    username: '',
    email: '',
    role: 'STUDENT' as const,
    department: ''
  });

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleCreateUser = () => {
    onCreateUser(formData);
    setFormData({ username: '', email: '', role: 'STUDENT', department: '' });
    setShowCreateModal(false);
  };

  const handleBulkImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      onBulkImport(e.target.files[0]);
      setShowUploadModal(false);
    }
  };

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Users className="w-6 h-6" />
          User Management ({users.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search username or email..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
          />
        </div>

        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
        >
          <option value="ALL">All Roles</option>
          <option value="FACULTY">Faculty</option>
          <option value="STUDENT">Student</option>
          <option value="EMPLOYEE">Employee</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>

      {/* User List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredUsers.map(user => (
          <div
            key={user.id}
            className={`p-3 rounded-lg border transition-colors ${
              user.status === 'PENDING_APPROVAL'
                ? 'bg-yellow-500/5 border-yellow-500/30'
                : 'bg-slate-700/50 border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-white">{user.username}</p>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    user.role === 'ADMIN'
                      ? 'bg-red-500/20 text-red-300'
                      : user.role === 'FACULTY'
                      ? 'bg-blue-500/20 text-blue-300'
                      : user.role === 'EMPLOYEE'
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'bg-slate-500/20 text-slate-300'
                  }`}>
                    {user.role}
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    user.status === 'ACTIVE'
                      ? 'bg-green-500/20 text-green-300'
                      : user.status === 'PENDING_APPROVAL'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-slate-500/20 text-slate-300'
                  }`}>
                    {user.status}
                  </span>
                </div>
                <p className="text-sm text-slate-400">{user.email}</p>
                {user.department && (
                  <p className="text-xs text-slate-500">{user.department}</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => onEditUser(user)}
                  className="p-2 hover:bg-slate-600 text-slate-400 hover:text-white rounded transition-colors"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete user "${user.username}"?`)) {
                      onDeleteUser(user.id);
                    }
                  }}
                  className="p-2 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Create New User</h3>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Role</label>
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="FACULTY">Faculty</option>
                  <option value="STUDENT">Student</option>
                  <option value="EMPLOYEE">Employee</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Department (Optional)</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={e => setFormData({ ...formData, department: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                  placeholder="e.g., Computer Science"
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
                onClick={handleCreateUser}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Bulk Import Users</h3>

            <div className="mb-4 p-4 bg-slate-700/50 border border-slate-600 rounded">
              <p className="text-sm text-slate-400 mb-2">CSV format required:</p>
              <code className="text-xs text-slate-300 block">
                username, email, role, department
              </code>
            </div>

            <input
              type="file"
              accept=".csv"
              onChange={handleBulkImport}
              className="w-full mb-4 py-2 px-3 bg-slate-700 border border-slate-600 rounded text-white file:mr-4 file:py-1 file:px-3 file:bg-blue-600 file:text-white file:rounded file:cursor-pointer"
            />

            <div className="flex gap-2">
              <button
                onClick={() => setShowUploadModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 2: CourseManagement.tsx
// ============================================================================

interface CourseManagementProps {
  courses: Course[];
  faculty: TenantUser[];
  loading: boolean;
  onCreateCourse: (course: Partial<Course>) => void;
  onAssignFaculty: (courseId: string, facultyId: string) => void;
}

export const CourseManagement: React.FC<CourseManagementProps> = ({
  courses,
  faculty,
  loading,
  onCreateCourse,
  onAssignFaculty
}) => {
  const [showModal, setShowModal] = React.useState(false);
  const [formData, setFormData] = React.useState({
    name: '',
    code: '',
    semester: 'Spring 2024'
  });

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          Course Management ({courses.length})
        </h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
        >
          <Plus className="w-4 h-4" />
          New Course
        </button>
      </div>

      {/* Course List */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {courses.map(course => (
          <div key={course.id} className="p-4 rounded-lg border bg-slate-700/50 border-slate-600">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-bold text-white">{course.name}</p>
                <p className="text-sm text-slate-400">{course.code} • {course.semester}</p>
                <p className="text-sm text-slate-400 mt-1">{course.students_count} students</p>
                {course.faculty_name ? (
                  <p className="text-sm text-green-400 mt-1">✓ Assigned to: {course.faculty_name}</p>
                ) : (
                  <p className="text-sm text-yellow-400 mt-1">⚠ No faculty assigned</p>
                )}
              </div>

              {!course.faculty_id && (
                <select
                  onChange={e => onAssignFaculty(course.id, e.target.value)}
                  className="px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                >
                  <option value="">Assign Faculty...</option>
                  {faculty.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.username}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Create New Course</h3>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Course Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Course Code</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., CS101"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Semester</label>
                <select
                  value={formData.semester}
                  onChange={e => setFormData({ ...formData, semester: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="Spring 2024">Spring 2024</option>
                  <option value="Fall 2024">Fall 2024</option>
                  <option value="Summer 2024">Summer 2024</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onCreateCourse(formData);
                  setShowModal(false);
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
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

// ============================================================================
// COMPONENT 3: ApprovalQueue.tsx
// ============================================================================

interface ApprovalQueueProps {
  queue: ApprovalQueue[];
  onApprove: (userId: string) => void;
  onReject: (userId: string) => void;
}

export const ApprovalQueue: React.FC<ApprovalQueueProps> = ({ queue, onApprove, onReject }) => {
  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <h2 className="text-xl font-bold text-white flex items-center gap-2">
        <CheckCircle className="w-6 h-6" />
        Pending Approvals ({queue.length})
      </h2>

      {queue.length === 0 ? (
        <div className="p-6 text-center text-slate-400">
          No pending approvals
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {queue.map(item => (
            <div key={item.id} className="p-4 rounded-lg border bg-yellow-500/5 border-yellow-500/30">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-bold text-white">{item.username}</p>
                  <p className="text-sm text-slate-400">{item.email}</p>
                  <p className="text-sm text-slate-400 mt-1">Role: {item.role}</p>
                  <p className="text-xs text-slate-500">
                    Requested: {new Date(item.requested_at).toLocaleString()}
                  </p>
                  {item.reason && (
                    <p className="text-sm text-slate-400 mt-2 italic">{item.reason}</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => onApprove(item.user_id)}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onReject(item.user_id)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                  >
                    Reject
                  </button>
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
// COMPONENT 4: TenantAnalyticsSummary.tsx
// ============================================================================

interface TenantAnalyticsSummaryProps {
  analytics: TenantAnalytics | null;
}

export const TenantAnalyticsSummary: React.FC<TenantAnalyticsSummaryProps> = ({ analytics }) => {
  if (!analytics) return <div>Loading...</div>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <StatCard label="Total Users" value={analytics.total_users} />
      <StatCard label="Faculty" value={analytics.total_faculty} type="info" />
      <StatCard label="Students" value={analytics.total_students} type="info" />
      <StatCard label="Employees" value={analytics.total_employees} type="info" />
      <StatCard label="Courses" value={analytics.total_courses} type="default" />
      <StatCard label="Active Sessions" value={analytics.active_sessions} type="success" />
      <StatCard label="Attendance Today" value={analytics.attendance_recorded_today} type="success" />
      <StatCard label="Pending Approvals" value={analytics.pending_approvals} type={analytics.pending_approvals > 0 ? 'warning' : 'default'} />
      <StatCard label="Storage Used" value={`${analytics.storage_used_gb}GB`} type="default" />
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: any; type?: 'default' | 'info' | 'success' | 'warning' }> = ({
  label,
  value,
  type = 'default'
}) => {
  const colorClass = type === 'success'
    ? 'bg-green-500/10 border-green-500/30'
    : type === 'warning'
    ? 'bg-yellow-500/10 border-yellow-500/30'
    : type === 'info'
    ? 'bg-blue-500/10 border-blue-500/30'
    : 'bg-slate-700/50 border-slate-600';

  return (
    <div className={`p-3 rounded-lg border ${colorClass}`}>
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="text-white font-bold mt-1 text-lg">{value}</p>
    </div>
  );
};

// ============================================================================
// MAIN PAGE: AdminTenantPanel.tsx
// ============================================================================

export const AdminTenantPanel: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'users' | 'courses' | 'approvals'>('overview');
  const [users, setUsers] = React.useState<TenantUser[]>([]);
  const [courses, setCourses] = React.useState<Course[]>([]);
  const [queue, setQueue] = React.useState<ApprovalQueue[]>([]);
  const [analytics, setAnalytics] = React.useState<TenantAnalytics | null>(null);

  React.useEffect(() => {
    // Load data on tab change
    // In real app: fetch from API
  }, [activeTab]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-8 h-8 text-blue-500" />
          <h1 className="text-3xl font-bold text-white">ADMIN TENANT PANEL</h1>
        </div>
        <p className="text-slate-400">
          User Management • Course Management • Approvals • Analytics
        </p>
      </div>

      {/* Quick Stats */}
      {activeTab === 'overview' && analytics && (
        <TenantAnalyticsSummary analytics={analytics} />
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-700">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'users', label: 'Users' },
          { id: 'courses', label: 'Courses' },
          { id: 'approvals', label: `Approvals (${queue.length})` }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && analytics && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TenantAnalyticsSummary analytics={analytics} />
          </div>
        )}
        {activeTab === 'users' && <UserManagement users={users} loading={false} onCreateUser={() => {}} onDeleteUser={() => {}} onEditUser={() => {}} onBulkImport={() => {}} />}
        {activeTab === 'courses' && <CourseManagement courses={courses} faculty={users.filter(u => u.role === 'FACULTY')} loading={false} onCreateCourse={() => {}} onAssignFaculty={() => {}} />}
        {activeTab === 'approvals' && <ApprovalQueue queue={queue} onApprove={() => {}} onReject={() => {}} />}
      </div>
    </div>
  );
};

export default AdminTenantPanel;
