/**
 * Corporate Admin Departments Page
 * 
 * Full department management: list, add, edit, delete with employee counts
 */

import React, { useState, useEffect } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  FolderTree, Plus, Pencil, Trash2, X, Loader2, Users,
  Building2, UserCircle,
} from 'lucide-react'
import axios from 'axios'

interface Department {
  id: string
  name: string
  description: string | null
  head_name: string | null
  head_id: string | null
  employee_count: number
  created_at: string
}

interface DepartmentForm {
  name: string
  description: string
  head_id: string
}

interface EmployeeOption {
  id: string
  first_name: string
  last_name: string
  employee_code: string
}

const CorporateAdminDepartmentsPage: React.FC = () => {
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<DepartmentForm>({ name: '', description: '', head_id: '' })

  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }

  const fetchDepartments = async () => {
    try {
      setLoading(true)
      const res = await axios.get('/api/corporate/departments', { headers })
      setDepartments(res.data.departments || [])
    } catch (err) {
      console.error('Failed to load departments:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchEmployees = async () => {
    try {
      const res = await axios.get('/api/corporate/admin/employees', {
        headers, params: { status: 'active' },
      })
      setEmployees(res.data.employees || [])
    } catch (err) {
      console.error('Failed to load employees:', err)
    }
  }

  useEffect(() => {
    fetchDepartments()
    fetchEmployees()
  }, [])

  const openAddModal = () => {
    setEditingDept(null)
    setForm({ name: '', description: '', head_id: '' })
    setError('')
    setShowModal(true)
  }

  const openEditModal = (dept: Department) => {
    setEditingDept(dept)
    setForm({
      name: dept.name,
      description: dept.description || '',
      head_id: dept.head_id || '',
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Department name is required.')
      return
    }
    try {
      setSaving(true)
      setError('')
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        head_id: form.head_id || undefined,
      }
      if (editingDept) {
        await axios.put(`/api/corporate/departments/${editingDept.id}`, payload, { headers })
      } else {
        await axios.post('/api/corporate/departments', payload, { headers })
      }
      setShowModal(false)
      fetchDepartments()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save department')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (dept: Department) => {
    if (!confirm(`Delete department "${dept.name}"? This cannot be undone.`)) return
    try {
      await axios.delete(`/api/corporate/departments/${dept.id}`, { headers })
      fetchDepartments()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete department')
    }
  }

  const totalEmployees = departments.reduce((sum, d) => sum + d.employee_count, 0)

  return (
    <TenantAdminLayout currentPage="departments" platform="corporate">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Departments</h1>
            <p className="text-slate-400 mt-1">
              {departments.length} department(s) · {totalEmployees} total employees
            </p>
          </div>
          <button onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Add Department
          </button>
        </div>

        {/* Department Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : departments.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center">
            <FolderTree className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 text-lg">No departments yet</p>
            <p className="text-sm text-slate-500 mt-1">Create departments to organize your employees</p>
            <button onClick={openAddModal}
              className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
              <Plus className="w-4 h-4 inline mr-2" />Create Department
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => (
              <div key={dept.id}
                className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors group">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-teal-500/20 rounded-lg">
                    <Building2 className="w-5 h-5 text-teal-400" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEditModal(dept)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                      title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(dept)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors"
                      title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">{dept.name}</h3>
                {dept.description && (
                  <p className="text-sm text-slate-400 mb-3 line-clamp-2">{dept.description}</p>
                )}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-400">{dept.employee_count} employee(s)</span>
                  </div>
                  {dept.head_name && (
                    <div className="flex items-center gap-1.5">
                      <UserCircle className="w-4 h-4 text-slate-500" />
                      <span className="text-sm text-slate-400">{dept.head_name}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Department Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-xl font-semibold text-white">
                {editingDept ? 'Edit Department' : 'Add Department'}
              </h2>
              <button onClick={() => { setShowModal(false); setError('') }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm text-slate-400 mb-1">Department Name *</label>
                <input type="text" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g. Engineering"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <textarea value={form.description} rows={3}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  placeholder="Optional description..."
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Department Head</label>
                <select value={form.head_id}
                  onChange={(e) => setForm({ ...form, head_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500">
                  <option value="">No Head Assigned</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setError('') }}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Saving...' : editingDept ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </TenantAdminLayout>
  )
}

export default CorporateAdminDepartmentsPage
