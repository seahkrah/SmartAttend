/**
 * School Admin Users Page
 * 
 * User management page for school tenant admins
 * Lists all users in the school entity with actions
 */

import React, { useState, useEffect } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  Users,
  Search,
  Plus,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import axios from 'axios'

interface User {
  id: string
  email: string
  fullName: string
  phone?: string
  role: string
  isActive: boolean
  status: 'active' | 'suspended' | 'disabled'
  createdAt: string
  lastLogin?: string
}

interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

const SchoolAdminUsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRole, setFilterRole] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [newUserData, setNewUserData] = useState({
    email: '',
    fullName: '',
    password: '',
    role: 'faculty',
    phone: ''
  })
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    message: string
    onConfirm: () => void
    type: 'danger' | 'warning' | 'info'
  } | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  const showToast = (type: Toast['type'], message: string) => {
    const id = Date.now().toString()
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/auth/admin/school/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      setUsers(response.data.users || [])
    } catch (error) {
      console.error('Failed to fetch users:', error)
      showToast('error', 'Failed to fetch users')
      // Demo data
      setUsers([
        {
          id: '1',
          email: 'teacher1@school.edu',
          fullName: 'John Teacher',
          role: 'faculty',
          isActive: true,
          status: 'active',
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          email: 'student1@school.edu',
          fullName: 'Jane Student',
          role: 'student',
          isActive: true,
          status: 'active',
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleUserAction = async (userId: string, action: 'activate' | 'suspend' | 'disable' | 'delete') => {
    try {
      const token = localStorage.getItem('accessToken')
      
      if (action === 'delete') {
        await axios.delete(`/api/auth/admin/school/users/${userId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        setUsers((prev) => prev.filter((u) => u.id !== userId))
        showToast('success', 'User deleted successfully')
      } else {
        await axios.patch(
          `/api/auth/admin/school/users/${userId}`,
          { action },
          { headers: { Authorization: `Bearer ${token}` } }
        )
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  status: action === 'activate' ? 'active' : action === 'suspend' ? 'suspended' : 'disabled',
                  is_active: action === 'activate',
                }
              : u
          )
        )
        showToast('success', `User ${action}d successfully`)
      }
    } catch (error: any) {
      showToast('error', error.response?.data?.error || `Failed to ${action} user`)
    }
    setConfirmDialog(null)
  }

  const handleAddUser = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      await axios.post('/api/auth/admin/school/users', newUserData, {
        headers: { Authorization: `Bearer ${token}` },
      })
      showToast('success', 'User created successfully')
      setShowAddUserModal(false)
      setNewUserData({ email: '', fullName: '', password: '', role: 'faculty', phone: '' })
      fetchUsers()
    } catch (error: any) {
      console.error('Failed to create user:', error)
      showToast('error', error.response?.data?.error || 'Failed to create user')
    }
  }

  const handleEditUser = async () => {
    if (!editingUser) return
    try {
      const token = localStorage.getItem('accessToken')
      await axios.patch(`/api/auth/admin/school/users/${editingUser.id}`, {
        fullName: editingUser.fullName,
        phone: editingUser.phone,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      showToast('success', 'User updated successfully')
      setEditingUser(null)
      fetchUsers()
    } catch (error: any) {
      console.error('Failed to update user:', error)
      showToast('error', error.response?.data?.error || 'Failed to update user')
    }
  }

  const confirmAction = (userId: string, action: 'suspend' | 'disable' | 'delete', userName: string) => {
    const titles = {
      suspend: 'Suspend User',
      disable: 'Disable User',
      delete: 'Delete User',
    }
    const messages = {
      suspend: `Are you sure you want to suspend ${userName}? They will not be able to access the system until reactivated.`,
      disable: `Are you sure you want to disable ${userName}? They will be marked as inactive.`,
      delete: `Are you sure you want to permanently delete ${userName}? This action cannot be undone.`,
    }
    setConfirmDialog({
      open: true,
      title: titles[action],
      message: messages[action],
      type: action === 'delete' ? 'danger' : 'warning',
      onConfirm: () => handleUserAction(userId, action),
    })
  }

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.fullName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = filterRole === 'all' || user.role === filterRole
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus
    return matchesSearch && matchesRole && matchesStatus
  })

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      suspended: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      disabled: 'bg-red-500/20 text-red-400 border-red-500/30',
    }
    return styles[status as keyof typeof styles] || styles.active
  }

  return (
    <TenantAdminLayout currentPage="users" platform="school">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
              toast.type === 'success'
                ? 'bg-emerald-500 text-white'
                : toast.type === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-blue-500 text-white'
            }`}
          >
            {toast.type === 'success' && <Check className="w-5 h-5" />}
            {toast.type === 'error' && <X className="w-5 h-5" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Confirm Dialog */}
      {confirmDialog?.open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`p-2 rounded-lg ${
                  confirmDialog.type === 'danger' ? 'bg-red-500/20' : 'bg-amber-500/20'
                }`}
              >
                <AlertTriangle
                  className={`w-6 h-6 ${
                    confirmDialog.type === 'danger' ? 'text-red-400' : 'text-amber-400'
                  }`}
                />
              </div>
              <h3 className="text-lg font-semibold text-white">{confirmDialog.title}</h3>
            </div>
            <p className="text-slate-300 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  confirmDialog.type === 'danger'
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-amber-500 hover:bg-amber-600 text-white'
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Users</h1>
            <p className="text-slate-400 mt-1">Manage users in your school</p>
          </div>
          <button 
            onClick={() => setShowAddUserModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add User
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Roles</option>
            <option value="faculty">Faculty</option>
            <option value="student">Student</option>
            <option value="admin">Admin</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
          </select>
          <button
            onClick={fetchUsers}
            className="p-2 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Users Table */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    Loading users...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <Users className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                    <p>No users found</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                          <span className="text-blue-400 font-medium">
                            {user.fullName?.charAt(0).toUpperCase() || 'U'}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-white">{user.fullName}</p>
                          <p className="text-sm text-slate-400">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 bg-slate-700 text-slate-300 rounded-full text-sm capitalize">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-sm border capitalize ${getStatusBadge(
                          user.status
                        )}`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400 text-sm">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setEditingUser(user)}
                          className="px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors text-xs font-medium"
                          title="Edit user"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => confirmAction(user.id, 'suspend', user.fullName)}
                          className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded transition-colors text-xs font-medium"
                          title="Suspend user"
                        >
                          Suspend
                        </button>
                        <button
                          onClick={() => confirmAction(user.id, 'disable', user.fullName)}
                          className="px-2 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded transition-colors text-xs font-medium"
                          title="Disable user"
                        >
                          Disable
                        </button>
                        <button
                          onClick={() => confirmAction(user.id, 'delete', user.fullName)}
                          className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors text-xs font-medium"
                          title="Delete user"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-4">Add New User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={newUserData.fullName}
                  onChange={(e) => setNewUserData({ ...newUserData, fullName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="john@school.edu"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={newUserData.phone}
                  onChange={(e) => setNewUserData({ ...newUserData, phone: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="+1234567890"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Role
                </label>
                <select
                  value={newUserData.role}
                  onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="faculty">Faculty</option>
                  <option value="admin">Admin</option>
                  <option value="student">Student</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddUserModal(false)
                  setNewUserData({ email: '', fullName: '', password: '', role: 'faculty', phone: '' })
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddUser}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                Create User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-4">Edit User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={editingUser.fullName}
                  onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={editingUser.email}
                  disabled
                  className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-400 cursor-not-allowed"
                  placeholder="john@school.edu"
                />
                <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={editingUser.phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="+1234567890"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Role
                </label>
                <input
                  type="text"
                  value={editingUser.role.charAt(0).toUpperCase() + editingUser.role.slice(1)}
                  disabled
                  className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-400 cursor-not-allowed"
                />
                <p className="text-xs text-slate-500 mt-1">Role cannot be changed after creation</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditUser}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </TenantAdminLayout>
  )
}

export default SchoolAdminUsersPage
