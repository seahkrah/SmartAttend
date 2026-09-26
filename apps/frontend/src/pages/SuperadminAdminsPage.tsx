import React, { useState, useEffect } from 'react'
import { Plus, X, Mail, Building2, Trash2 } from 'lucide-react'
import { apiClient } from '../services/api'
import { InvitationDialog, type InvitationResult } from '../components/accounts/InvitationDialog'

/**
 * Tenant administrators, as the platform operator sees them.
 *
 * This page used to read a list shape the API has never returned, list
 * tenants from fields that do not exist, and post `tenant_id` where the API
 * reads `tenantId`, so it showed nothing and could create no one. It also
 * asked the operator to choose the administrator's password; administrators
 * now choose their own from an invitation.
 */
interface TenantAdmin {
  id: string
  email: string
  full_name: string
  tenant_id: string | null
  tenant_name: string | null
  platform_kind: string | null
  is_active: boolean
  last_login: string | null
  awaiting_setup: boolean
  created_at: string
}

interface Entity {
  id: string
  name: string
  kind: 'school' | 'corporate'
  is_active: boolean
}

const EMPTY = { email: '', fullName: '', tenantId: '' }

const SuperadminAdminsPage: React.FC = () => {
  const [admins, setAdmins] = useState<TenantAdmin[]>([])
  const [tenants, setTenants] = useState<Entity[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState<{ id: string; name: string; invitation: InvitationResult | null } | null>(null)

  const loadAdmins = async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const response = await apiClient.get('/superadmin/tenant-admins')
      setAdmins(response.data?.admins ?? [])
    } catch (error: any) {
      setLoadError(error?.response?.data?.error ?? 'Could not load administrators')
    } finally {
      setLoading(false)
    }
  }

  const loadTenants = async () => {
    try {
      const response = await apiClient.get('/superadmin/entities')
      setTenants(response.data?.entities ?? [])
    } catch {
      setTenants([])
    }
  }

  useEffect(() => {
    loadAdmins()
    loadTenants()
  }, [])

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!formData.tenantId) {
      setFormError('Choose the tenant this administrator will manage.')
      return
    }
    try {
      setSaving(true)
      const res = await apiClient.post('/superadmin/tenant-admins', formData)
      setInvite({ id: res.data.admin.id, name: formData.fullName, invitation: res.data.invitation ?? null })
      setFormData(EMPTY)
      setShowForm(false)
      await loadAdmins()
    } catch (error: any) {
      setFormError(error.response?.data?.error || 'Failed to create the administrator')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAdmin = async (admin: TenantAdmin) => {
    if (!confirm(`Remove ${admin.full_name} as an administrator of ${admin.tenant_name ?? 'their tenant'}?`)) return
    try {
      await apiClient.delete(`/superadmin/tenant-admins/${admin.id}`)
      await loadAdmins()
    } catch (error: any) {
      alert(error?.response?.data?.error ?? 'Could not remove that administrator')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-secondary">Loading administrators…</div>
  }

  return (
    <>
      {invite && (
        <InvitationDialog
          personName={invite.name}
          invitation={invite.invitation}
          issue={async (handover) =>
            (await apiClient.post(`/superadmin/tenant-admins/${invite.id}/invitation`, { handover })).data.invitation}
          onClose={() => { setInvite(null); loadAdmins() }}
        />
      )}
      <div className="space-y-6">
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white rounded-lg transition-all shadow-lg"
        >
          {showForm ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {showForm ? 'Cancel' : 'Appoint Tenant Admin'}
        </button>

        {loadError && (
          <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-sm">{loadError}</div>
        )}

        {showForm && (
          <form onSubmit={handleAddAdmin} className="p-6 rounded-xl bg-sunken border border-subtle space-y-4">
            {formError && (
              <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-sm">{formError}</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-secondary mb-2">Full name</span>
                <input type="text" value={formData.fullName} required
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-4 py-2 bg-card border border-subtle rounded-lg text-primary focus:border-orange-500 outline-none" />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-secondary mb-2">Email</span>
                <input type="email" value={formData.email} required
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 bg-card border border-subtle rounded-lg text-primary focus:border-orange-500 outline-none" />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-secondary mb-2">Tenant</span>
                <select value={formData.tenantId} required
                  onChange={(e) => setFormData({ ...formData, tenantId: e.target.value })}
                  className="w-full px-4 py-2 bg-card border border-subtle rounded-lg text-primary focus:border-orange-500 outline-none">
                  <option value="">Choose a tenant…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.kind === 'school' ? 'School' : 'Company'})</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-secondary">
              The administrator is invited to choose their own password. If the tenant has no email set up yet,
              you can hand them a one-time setup link instead.
            </p>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg font-medium">
              {saving ? 'Appointing…' : 'Appoint administrator'}
            </button>
          </form>
        )}

        {admins.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {admins.map((admin) => (
              <div key={`${admin.id}-${admin.tenant_id}`} className="p-6 rounded-xl bg-sunken border border-subtle">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h4 className="font-bold text-primary text-lg">{admin.full_name}</h4>
                    <p className="text-sm text-secondary mt-1">
                      {admin.awaiting_setup ? 'Invited — awaiting setup' : admin.is_active ? 'Administrator' : 'Deactivated'}
                    </p>
                  </div>
                  <button onClick={() => handleDeleteAdmin(admin)} aria-label={`Remove ${admin.full_name}`}
                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2 mb-4 text-sm">
                  <p className="flex items-center gap-2 text-secondary break-all"><Mail className="w-4 h-4 text-muted" />{admin.email}</p>
                  <p className="flex items-center gap-2 text-secondary"><Building2 className="w-4 h-4 text-muted" />{admin.tenant_name ?? 'No tenant'}</p>
                </div>
                <div className="pt-4 border-t border-subtle flex items-center justify-between">
                  <p className="text-xs text-muted">
                    {admin.last_login ? `Last signed in ${new Date(admin.last_login).toLocaleDateString()}` : `Appointed ${new Date(admin.created_at).toLocaleDateString()}`}
                  </p>
                  {admin.awaiting_setup && (
                    <button onClick={() => setInvite({ id: admin.id, name: admin.full_name, invitation: null })}
                      className="text-xs text-sky-700 dark:text-sky-300 hover:text-sky-700 dark:hover:text-sky-200">Invite again</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center rounded-xl bg-sunken border border-dashed border-subtle">
            <p className="text-secondary text-lg">No tenant administrators yet</p>
          </div>
        )}
      </div>
    </>
  )
}

export default SuperadminAdminsPage
