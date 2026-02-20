import React, { useState, useEffect } from 'react'
import { Plus, X, Mail, Building2, Trash2 } from 'lucide-react'
import { apiClient } from '../services/api'
import SuperadminLayout from '../components/SuperadminLayout'


interface TenantAdmin {
  id: string
  email: string
  fullName: string
  tenant_id: string
  tenant_name: string
  created_at: string
}

const SuperadminAdminsPage: React.FC = () => {
  const [admins, setAdmins] = useState<TenantAdmin[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    tenant_id: '',
  })
  const [loading, setLoading] = useState(true)
  const [tenants, setTenants] = useState<any[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  useEffect(() => {
    loadAdmins()
    loadTenants()
  }, [])

  const loadAdmins = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/superadmin/tenant-admins')
      setAdmins(response.data || [])
    } catch (error) {
      console.error('Error loading admins:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadTenants = async () => {
    try {
      const response = await apiClient.get('/superadmin/entities')
      const allTenants = [
        ...(response.data?.schools || []),
        ...(response.data?.corporates || []),
      ]
      setTenants(allTenants)
    } catch (error) {
      console.error('Error loading tenants:', error)
    }
  }

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    
    // Validate tenant selection
    if (!formData.tenant_id.trim()) {
      setFormError('Please select a tenant before creating an admin. A tenant admin must be assigned to manage a specific tenant.')
      return
    }

    if (formData.password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    
    try {
      await apiClient.post('/superadmin/tenant-admins', formData)
      setFormData({ email: '', password: '', fullName: '', tenant_id: '' })
      setShowForm(false)
      setFormError(null)
      await loadAdmins()
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to create admin'
      setFormError(msg)
    }
  }

  const handleDeleteAdmin = async (adminId: string) => {
    try {
      await apiClient.delete(`/superadmin/tenant-admins/${adminId}`)
      await loadAdmins()
    } catch (error: any) {
      console.error('Error deleting admin:', error)
    }
  }

  if (loading) {
    return (
      <SuperadminLayout currentPage="admins">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading admins...</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="admins">
      <div className="space-y-6">
        {/* Add Admin Button */}
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white rounded-lg transition-all shadow-lg"
        >
          {showForm ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {showForm ? 'Cancel' : 'Create Tenant Admin'}
        </button>

        {/* Add Admin Form */}
        {showForm && (
          <form
            onSubmit={handleAddAdmin}
            className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 space-y-4"
          >
              {formError && (
                <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-400 text-sm flex items-start gap-2">
                  <span className="text-red-400 shrink-0 mt-0.5">⚠️</span>
                  <span>{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-orange-500 outline-none"
                    placeholder="Enter full name"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-orange-500 outline-none"
                    placeholder="Enter email"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-orange-500 outline-none"
                    placeholder="Enter password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    <span className="text-orange-500">*</span> Assign to Tenant
                  </label>
                  <select
                    value={formData.tenant_id}
                    onChange={(e) => setFormData({ ...formData, tenant_id: e.target.value })}
                    className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white focus:outline-none transition-colors ${
                      formData.tenant_id 
                        ? 'border-orange-500 focus:border-orange-400' 
                        : 'border-slate-700 focus:border-slate-600'
                    }`}
                    required
                  >
                    <option value="">Select a tenant...</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-2">
                    ⓘ A tenant admin manages a specific tenant. Selection is mandatory.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium"
                >
                  Create Admin
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 border border-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

        {/* Admins Grid */}
        {admins.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {admins.map((admin) => (
              <div
                key={admin.id}
                className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h4 className="font-bold text-white text-lg">{admin.fullName}</h4>
                    <p className="text-sm text-slate-400 mt-1">Admin</p>
                  </div>
                  <button
                    onClick={() => handleDeleteAdmin(admin.id)}
                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-slate-500" />
                    <p className="text-slate-300 break-all">{admin.email}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <p className="text-slate-300">{admin.tenant_name}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-700">
                  <p className="text-xs text-slate-500">
                    Created {new Date(admin.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center rounded-xl bg-slate-800/30 border border-dashed border-slate-700">
            <p className="text-slate-400 text-lg">No tenant admins yet</p>
            <p className="text-slate-500 text-sm mt-2">Create one to manage tenant operations</p>
          </div>
        )}
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminAdminsPage
