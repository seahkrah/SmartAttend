/**
 * Corporate Admin Employees Page
 * 
 * Full employee management: list, search, filter, add, view details
 */

import React, { useState, useEffect, useCallback } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  Users, Search, Plus, UserX,
  X, Loader2,
} from 'lucide-react'
import axios from 'axios'

interface Employee {
  id: string
  employee_id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  designation: string | null
  date_of_joining: string | null
  is_currently_employed: boolean
  department_name: string | null
  department_id: string | null
  user_id: string | null
  user_email: string | null
}

interface Department {
  id: string
  name: string
}

interface AddEmployeeForm {
  firstName: string
  lastName: string
  email: string
  phone: string
  designation: string
  departmentId: string
  dateOfJoining: string
  employmentType: string
}

const CorporateAdminUsersPage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [showAddModal, setShowAddModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [form, setForm] = useState<AddEmployeeForm>({
    firstName: '', lastName: '', email: '', phone: '',
    designation: '', departmentId: '', dateOfJoining: '', employmentType: 'full_time',
  })

  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }

  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true)
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (deptFilter) params.departmentId = deptFilter
      if (statusFilter) params.status = statusFilter
      const res = await axios.get('/api/corporate/admin/employees', { headers, params })
      setEmployees(res.data.employees || [])
      setTotal(res.data.total || 0)
    } catch (err) {
      console.error('Failed to load employees:', err)
    } finally {
      setLoading(false)
    }
  }, [search, deptFilter, statusFilter])

  const fetchDepartments = async () => {
    try {
      const res = await axios.get('/api/corporate/departments', { headers })
      setDepartments(res.data.departments || [])
    } catch (err) {
      console.error('Failed to load departments:', err)
    }
  }

  useEffect(() => { fetchDepartments() }, [])
  useEffect(() => {
    const timer = setTimeout(() => fetchEmployees(), 300)
    return () => clearTimeout(timer)
  }, [fetchEmployees])

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.email) {
      setError('First name, last name, and email are required.')
      return
    }
    try {
      setSaving(true)
      setError('')
      const res = await axios.post('/api/corporate/admin/employees', {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        departmentId: form.departmentId || undefined,
        designation: form.designation || undefined,
        employmentType: form.employmentType || 'full_time',
        dateOfJoining: form.dateOfJoining || undefined,
      }, { headers })
      const password = res.data.defaultPassword
      setShowAddModal(false)
      setForm({ firstName: '', lastName: '', email: '', phone: '', designation: '', departmentId: '', dateOfJoining: '', employmentType: 'full_time' })
      if (password) {
        alert(`Employee created! Default password: ${password}\nThey will be prompted to change it on first login.`)
      }
      fetchEmployees()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add employee')
    } finally {
      setSaving(false)
    }
  }

  const handleTerminate = async (empId: string) => {
    if (!confirm('Are you sure you want to terminate this employee?')) return
    try {
      await axios.patch(`/api/corporate/admin/employees/${empId}/terminate`, {}, { headers })
      fetchEmployees()
    } catch (err) {
      console.error('Failed to terminate employee:', err)
    }
  }

  const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const colors: Record<string, string> = {
      active: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
      terminated: 'bg-red-500/20 text-red-400 border-red-500/30',
      on_leave: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    }
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${colors[status] || 'bg-slate-700 text-slate-300 border-slate-600'}`}>
        {status.replace('_', ' ')}
      </span>
    )
  }

  return (
    <TenantAdminLayout currentPage="employees" platform="corporate">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Employees</h1>
            <p className="text-slate-400 mt-1">{total} employee(s) in your organization</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Employee
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, email, or employee code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="terminated">Terminated</option>
            <option value="on_leave">On Leave</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center">
            <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 text-lg">No employees found</p>
            <p className="text-sm text-slate-500 mt-1">
              {search || deptFilter || statusFilter
                ? 'Try adjusting your search or filters'
                : 'Add your first employee to get started'}
            </p>
            {!search && !deptFilter && (
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4 inline mr-2" />Add Employee
              </button>
            )}
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Employee</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Code</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Department</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Designation</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Joined</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center">
                            <span className="text-indigo-400 text-sm font-medium">
                              {emp.first_name[0]}{emp.last_name[0]}
                            </span>
                          </div>
                          <div>
                            <p className="text-white font-medium">{emp.first_name} {emp.last_name}</p>
                            <p className="text-xs text-slate-500">{emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-slate-300 font-mono">{emp.employee_id}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-slate-300">{emp.department_name || '—'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-slate-300">{emp.designation || '—'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={emp.is_currently_employed ? 'active' : 'terminated'} />
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-slate-400">
                          {emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString() : '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {emp.is_currently_employed && (
                          <button
                            onClick={() => handleTerminate(emp.id)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                            title="Terminate Employee"
                          >
                            <UserX className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-xl font-semibold text-white">Add New Employee</h2>
              <button onClick={() => { setShowAddModal(false); setError('') }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddEmployee} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">First Name *</label>
                  <input
                    type="text" required value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Last Name *</label>
                  <input
                    type="text" required value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email *</label>
                <input
                  type="email" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Phone</label>
                  <input
                    type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Designation</label>
                  <input
                    type="text" value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Department</label>
                  <select
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">No Department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Employment Type</label>
                  <select
                    value={form.employmentType}
                    onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date of Joining</label>
                <input
                  type="date" value={form.dateOfJoining}
                  onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddModal(false); setError('') }}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Adding...' : 'Add Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </TenantAdminLayout>
  )
}

export default CorporateAdminUsersPage
