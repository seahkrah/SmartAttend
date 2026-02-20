import React, { useState, useEffect } from 'react'
import { Edit2, Trash2, Lock, Unlock, Plus, X } from 'lucide-react'
import { apiClient } from '../services/api'
import SuperadminLayout from '../components/SuperadminLayout'

interface Tenant {
  id: string
  name: string
  code: string
  email: string
  is_active: boolean
  user_count: number
  type: 'school' | 'corporate'
}

const SuperadminTenantsPage: React.FC = () => {
  const [schools, setSchools] = useState<Tenant[]>([])
  const [corporates, setCorporates] = useState<Tenant[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', code: '', email: '', type: 'school' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTenants()
  }, [])

  const loadTenants = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/superadmin/entities')
      
      if (response.data) {
        setSchools(response.data.schools?.map((s: any) => ({ ...s, type: 'school' })) || [])
        setCorporates(response.data.corporates?.map((c: any) => ({ ...c, type: 'corporate' })) || [])
      }
    } catch (error) {
      console.error('Error loading tenants:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await apiClient.post('/superadmin/tenants', formData)
      setFormData({ name: '', code: '', email: '', type: 'school' })
      setShowForm(false)
      await loadTenants()
    } catch (error) {
      console.error('Error adding tenant:', error)
    }
  }

  const handleDeleteTenant = async (id: string) => {
    try {
      await apiClient.delete(`/superadmin/tenants/${id}`)
      await loadTenants()
    } catch (error) {
      console.error('Error deleting tenant:', error)
    }
  }

  const handleToggleTenant = async (id: string, currentStatus: boolean) => {
    try {
      await apiClient.patch(`/superadmin/tenants/${id}`, { is_active: !currentStatus })
      await loadTenants()
    } catch (error) {
      console.error('Error updating tenant:', error)
    }
  }

  const TenantRow = ({ tenant, onEdit, onToggle, onDelete }: { 
    tenant: Tenant
    onEdit: (id: string) => void
    onToggle: (id: string, status: boolean) => void
    onDelete: (id: string) => void
  }) => (
    <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <h4 className="font-bold text-white">{tenant.name}</h4>
          <p className="text-sm text-slate-400">{tenant.code}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
          tenant.is_active
            ? 'bg-green-500/20 text-green-400'
            : 'bg-red-500/20 text-red-400'
        }`}>
          {tenant.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="text-sm text-slate-300 mb-4 space-y-1">
        <p>📧 {tenant.email}</p>
        <p>👥 {tenant.user_count} users</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onEdit(tenant.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm text-slate-300 hover:text-white"
          title="Edit tenant"
        >
          <Edit2 className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={() => onToggle(tenant.id, tenant.is_active)}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
            tenant.is_active
              ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
          }`}
          title={tenant.is_active ? 'Lock tenant' : 'Unlock tenant'}
        >
          {tenant.is_active ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          {tenant.is_active ? 'Lock' : 'Unlock'}
        </button>
        <button
          onClick={() => onDelete(tenant.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm"
          title="Delete tenant"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <SuperadminLayout currentPage="management">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading tenants...</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="management">
      <div className="space-y-6">
        {/* Add Tenant Button */}
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg transition-all shadow-lg"
        >
          {showForm ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {showForm ? 'Cancel' : 'Add New Tenant'}
        </button>

        {/* Add Tenant Form */}
        {showForm && (
          <form
            onSubmit={handleAddTenant}
            className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 space-y-4"
          >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Tenant Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                    placeholder="Enter tenant name"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Tenant Code</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                    placeholder="Enter tenant code"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                    placeholder="Enter email"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'school' | 'corporate' })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 outline-none"
                  >
                    <option value="school">School</option>
                    <option value="corporate">Corporate</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                >
                  Add Tenant
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

        {/* Schools Section */}
        <div>
          <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-1 h-8 bg-green-500 rounded-full" />
            Schools ({schools.length})
          </h3>
          {schools.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schools.map((tenant) => (
                <TenantRow
                  key={tenant.id}
                  tenant={tenant}
                  onEdit={(id) => console.log('Edit:', id)}
                  onToggle={handleToggleTenant}
                  onDelete={handleDeleteTenant}
                />
              ))}
            </div>
          ) : (
            <div className="p-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-700">
              <p className="text-slate-400">No schools found</p>
            </div>
          )}
        </div>

        {/* Corporates Section */}
        <div>
          <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-1 h-8 bg-indigo-500 rounded-full" />
            Corporates ({corporates.length})
          </h3>
          {corporates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {corporates.map((tenant) => (
                <TenantRow
                  key={tenant.id}
                  tenant={tenant}
                  onEdit={(id) => console.log('Edit:', id)}
                  onToggle={handleToggleTenant}
                  onDelete={handleDeleteTenant}
                />
              ))}
            </div>
          ) : (
            <div className="p-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-700">
              <p className="text-slate-400">No corporates found</p>
            </div>
          )}
        </div>
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminTenantsPage
