import React, { useState, useEffect, useCallback } from 'react'
import { Trash2, Plus, X, Users, Mail, CheckCircle, AlertCircle, Building2, Edit3, PauseCircle, Ban, Play, Shield, AlertTriangle, Info, XCircle } from 'lucide-react'
import { apiClient } from '../services/api'
import SuperadminLayout from '../components/SuperadminLayout'

interface Entity {
  id: string
  name: string
  code: string
  email: string
  is_active: boolean
  user_count: number
  pending_approvals: number
}

interface Tenant {
  id: string
  name: string
  code: string
  email: string
  address?: string
  is_active: boolean
  status: 'active' | 'suspended' | 'disabled'
  user_count: number
  type: 'school' | 'corporate'
}

interface User {
  id: string
  email: string
  name?: string
  is_active: boolean
  is_suspended: boolean
  role: string
  entity_name: string
  created_at: string
}

interface Toast {
  id: number
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
}

interface ConfirmDialog {
  title: string
  message: string
  confirmLabel?: string
  confirmColor?: string
  onConfirm: () => void
}

// ===========================
// TOAST COMPONENT
// ===========================

const ToastContainer: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => (
  <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
    {toasts.map((toast) => (
      <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
    ))}
  </div>
)

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration || 5000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  const config = {
    success: { bg: 'bg-green-900/90 border-green-700', icon: <CheckCircle className="w-5 h-5 text-green-400 shrink-0" /> },
    error:   { bg: 'bg-red-900/90 border-red-700',     icon: <XCircle className="w-5 h-5 text-red-400 shrink-0" /> },
    warning: { bg: 'bg-yellow-900/90 border-yellow-700', icon: <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" /> },
    info:    { bg: 'bg-blue-900/90 border-blue-700',    icon: <Info className="w-5 h-5 text-blue-400 shrink-0" /> },
  }[toast.type]

  return (
    <div className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border ${config.bg} backdrop-blur-sm shadow-2xl`}
         style={{ animation: 'slideIn 0.3s ease-out' }}>
      {config.icon}
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">{toast.title}</p>
        {toast.message && <p className="text-slate-300 text-xs mt-0.5">{toast.message}</p>}
      </div>
      <button onClick={() => onDismiss(toast.id)} className="text-slate-400 hover:text-white shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ===========================
// CONFIRM DIALOG COMPONENT
// ===========================

const ConfirmDialogComponent: React.FC<{ dialog: ConfirmDialog; onCancel: () => void }> = ({ dialog, onCancel }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
    <div className="w-full max-w-md p-6 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl">
      <div className="flex items-start gap-3 mb-4">
        <AlertTriangle className="w-6 h-6 text-yellow-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-lg font-bold text-white">{dialog.title}</h3>
          <p className="text-slate-400 text-sm mt-1">{dialog.message}</p>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => { dialog.onConfirm(); onCancel(); }}
          className={`flex-1 px-4 py-2.5 rounded-lg text-white font-medium transition-colors ${dialog.confirmColor || 'bg-red-600 hover:bg-red-700'}`}
        >
          {dialog.confirmLabel || 'Confirm'}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 border border-slate-600 text-slate-300 hover:text-white rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)

// ===========================
// MAIN COMPONENT
// ===========================

const SuperadminManagementPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'entities' | 'tenants' | 'users'>('entities')
  
  // Entities state
  const [schools, setSchools] = useState<Entity[]>([])
  const [corporates, setCorporates] = useState<Entity[]>([])
  
  // Tenants state
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [showTenantForm, setShowTenantForm] = useState(false)
  const [tenantFormData, setTenantFormData] = useState({ name: '', email: '', type: 'school', address: '' })
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [editFormData, setEditFormData] = useState({ name: '', email: '', address: '' })
  
  // Users state
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [userFilter, setUserFilter] = useState<'all' | 'active' | 'disabled' | 'suspended'>('all')
  
  const [loading, setLoading] = useState(true)

  // Toast & confirmation dialog state
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)
  const [toastCounter, setToastCounter] = useState(0)

  const addToast = useCallback((type: Toast['type'], title: string, message?: string, duration?: number) => {
    setToastCounter(prev => {
      const id = prev + 1
      setToasts(t => [...t, { id, type, title, message, duration }])
      return id
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(t => t.filter(toast => toast.id !== id))
  }, [])

  const showConfirm = useCallback((opts: ConfirmDialog) => {
    setConfirmDialog(opts)
  }, [])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      await Promise.all([
        loadEntities(),
        loadTenants(),
        loadUsers()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadEntities = async () => {
    try {
      const response = await apiClient.get('/superadmin/entities')
      if (response.data) {
        setSchools(response.data.schools || [])
        setCorporates(response.data.corporates || [])
      }
    } catch (error: any) {
      console.error('Error loading entities:', error)
      addToast('error', 'Failed to load entities', error.response?.data?.error || error.message)
    }
  }

  const loadTenants = async () => {
    try {
      const response = await apiClient.get('/superadmin/entities')
      if (response.data) {
        const allTenants: Tenant[] = [
          ...(response.data.schools?.map((s: any) => ({ ...s, type: 'school' as const, status: s.status || (s.is_active ? 'active' : 'disabled'), user_count: Number(s.user_count) || 0 })) || []),
          ...(response.data.corporates?.map((c: any) => ({ ...c, type: 'corporate' as const, status: c.status || (c.is_active ? 'active' : 'disabled'), user_count: Number(c.user_count) || 0 })) || []),
        ]
        setTenants(allTenants)
      }
    } catch (error: any) {
      console.error('Error loading tenants:', error)
      addToast('error', 'Failed to load tenants', error.response?.data?.error || error.message)
    }
  }

  const loadUsers = async () => {
    try {
      const response = await apiClient.get('/superadmin/users')
      setAllUsers(response.data || [])
    } catch (error: any) {
      console.error('Error loading users:', error)
      setAllUsers([])
    }
  }

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await apiClient.post('/superadmin/tenants', tenantFormData)
      const newCode = response.data?.tenant?.code || ''
      setTenantFormData({ name: '', email: '', type: 'school', address: '' })
      setShowTenantForm(false)
      addToast('success', 'Tenant created successfully', `Code: ${newCode}`)
      await loadTenants()
      await loadEntities()
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to create tenant'
      addToast('error', 'Tenant creation failed', msg)
    }
  }

  const handleDeleteTenant = (id: string, name: string) => {
    showConfirm({
      title: 'Delete Tenant',
      message: `Are you sure you want to permanently delete "${name}"? This action cannot be undone. All associated data will be removed.`,
      confirmLabel: 'Delete Permanently',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      onConfirm: async () => {
        try {
          await apiClient.delete(`/superadmin/tenants/${id}`)
          addToast('success', 'Tenant deleted', `"${name}" has been permanently removed.`)
          await loadTenants()
          await loadEntities()
        } catch (error: any) {
          const msg = error.response?.data?.error || 'Failed to delete tenant'
          addToast('error', 'Delete failed', msg)
        }
      }
    })
  }

  const handleTenantAction = (id: string, action: 'activate' | 'suspend' | 'disable', name: string) => {
    const labels = {
      activate: { verb: 'Activate', past: 'activated', color: 'bg-green-600 hover:bg-green-700' },
      suspend:  { verb: 'Suspend',  past: 'suspended', color: 'bg-yellow-600 hover:bg-yellow-700' },
      disable:  { verb: 'Disable',  past: 'disabled',  color: 'bg-orange-600 hover:bg-orange-700' },
    }
    const label = labels[action]
    const descriptions = {
      activate: `This will restore full access for "${name}". All users will be able to log in and use the platform.`,
      suspend:  `This will temporarily restrict access for "${name}". Users will not be able to log in until the tenant is re-activated. This is reversible.`,
      disable:  `This will deactivate "${name}". All access will be blocked. The tenant will need to be manually re-activated by a superadmin.`,
    }
    showConfirm({
      title: `${label.verb} Tenant`,
      message: descriptions[action],
      confirmLabel: label.verb,
      confirmColor: label.color,
      onConfirm: async () => {
        try {
          await apiClient.patch(`/superadmin/tenants/${id}`, { action })
          addToast('success', `Tenant ${label.past}`, `"${name}" has been ${label.past}.`)
          await loadTenants()
          await loadEntities()
        } catch (error: any) {
          const msg = error.response?.data?.error || `Failed to ${action} tenant`
          addToast('error', `${label.verb} failed`, msg)
        }
      }
    })
  }

  const handleEditTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTenant) return
    try {
      await apiClient.patch(`/superadmin/tenants/${editingTenant.id}`, { action: 'edit', ...editFormData })
      addToast('success', 'Tenant updated', `"${editFormData.name}" has been updated.`)
      setEditingTenant(null)
      await loadTenants()
      await loadEntities()
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to update tenant'
      addToast('error', 'Update failed', msg)
    }
  }

  const openEditForm = (tenant: Tenant) => {
    setEditingTenant(tenant)
    setEditFormData({ name: tenant.name, email: tenant.email, address: tenant.address || '' })
  }

  // ===========================
  // USER MANAGEMENT HANDLERS
  // ===========================

  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editUserFormData, setEditUserFormData] = useState({ name: '', email: '' })

  const handleUserAction = (id: string, action: 'activate' | 'suspend' | 'disable', userName: string) => {
    const labels = {
      activate: { verb: 'Activate', past: 'activated', color: 'bg-green-600 hover:bg-green-700' },
      suspend:  { verb: 'Suspend',  past: 'suspended', color: 'bg-yellow-600 hover:bg-yellow-700' },
      disable:  { verb: 'Disable',  past: 'disabled',  color: 'bg-orange-600 hover:bg-orange-700' },
    }
    const label = labels[action]
    const descriptions = {
      activate: `This will restore full access for "${userName}". The user will be able to log in and use the platform.`,
      suspend:  `This will temporarily restrict access for "${userName}". The user will not be able to log in until re-activated.`,
      disable:  `This will deactivate "${userName}". All access will be blocked until a superadmin re-activates the account.`,
    }
    showConfirm({
      title: `${label.verb} User`,
      message: descriptions[action],
      confirmLabel: label.verb,
      confirmColor: label.color,
      onConfirm: async () => {
        try {
          await apiClient.patch(`/superadmin/users/${id}`, { action })
          addToast('success', `User ${label.past}`, `"${userName}" has been ${label.past}.`)
          await loadUsers()
        } catch (error: any) {
          const msg = error.response?.data?.error || `Failed to ${action} user`
          addToast('error', `${label.verb} failed`, msg)
        }
      }
    })
  }

  const handleDeleteUser = (id: string, userName: string) => {
    showConfirm({
      title: 'Delete User',
      message: `Are you sure you want to permanently delete "${userName}"? This action cannot be undone. All associated data will be removed.`,
      confirmLabel: 'Delete Permanently',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      onConfirm: async () => {
        try {
          await apiClient.delete(`/superadmin/users/${id}`)
          addToast('success', 'User deleted', `"${userName}" has been permanently removed.`)
          await loadUsers()
        } catch (error: any) {
          const msg = error.response?.data?.error || 'Failed to delete user'
          addToast('error', 'Delete failed', msg)
        }
      }
    })
  }

  const openEditUserForm = (user: User) => {
    setEditingUser(user)
    setEditUserFormData({ name: user.name || '', email: user.email })
  }

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    try {
      await apiClient.patch(`/superadmin/users/${editingUser.id}`, { action: 'edit', ...editUserFormData })
      addToast('success', 'User updated', `"${editUserFormData.name || editUserFormData.email}" has been updated.`)
      setEditingUser(null)
      await loadUsers()
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to update user'
      addToast('error', 'Update failed', msg)
    }
  }

  const EntityCard = ({ entity }: { entity: Entity }) => (
    <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h4 className="text-white font-bold text-lg">{entity.name}</h4>
          <p className="text-slate-400 text-sm">Code: {entity.code}</p>
        </div>
        {entity.is_active ? (
          <CheckCircle className="w-5 h-5 text-green-400" />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-400" />
        )}
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <Mail className="w-4 h-4 text-slate-500" />
          <p className="text-slate-300">{entity.email}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-slate-500" />
          <p className="text-slate-300">{entity.user_count} users</p>
        </div>
      </div>

      <div className="flex gap-2 pt-3 border-t border-slate-700">
        <span className={`flex-1 px-3 py-1 rounded-full text-xs font-semibold text-center ${
          entity.is_active
            ? 'bg-green-500/20 text-green-400'
            : 'bg-red-500/20 text-red-400'
        }`}>
          {entity.is_active ? 'Active' : 'Inactive'}
        </span>
        {entity.pending_approvals > 0 && (
          <span className="flex-1 px-3 py-1 rounded-full text-xs font-semibold text-center bg-yellow-500/20 text-yellow-400">
            {entity.pending_approvals} pending
          </span>
        )}
      </div>
    </div>
  )

  const statusConfig = {
    active:    { label: 'Active',    color: 'bg-green-500/20 text-green-400',  icon: <CheckCircle className="w-3.5 h-3.5" /> },
    suspended: { label: 'Suspended', color: 'bg-yellow-500/20 text-yellow-400', icon: <PauseCircle className="w-3.5 h-3.5" /> },
    disabled:  { label: 'Disabled',  color: 'bg-red-500/20 text-red-400',      icon: <Ban className="w-3.5 h-3.5" /> },
  }

  const TenantRow = ({ tenant }: { tenant: Tenant }) => {
    const status = tenant.status || (tenant.is_active ? 'active' : 'disabled')
    const cfg = statusConfig[status] || statusConfig.active

    return (
      <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h4 className="text-white font-bold text-lg">{tenant.name}</h4>
            <p className="text-slate-400 text-xs font-mono mt-0.5">{tenant.code}</p>
          </div>
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
            {cfg.icon} {cfg.label}
          </span>
        </div>

        <div className="space-y-1.5 mb-3">
          <div className="flex items-center gap-2 text-sm">
            <Mail className="w-4 h-4 text-slate-500" />
            <p className="text-slate-300 truncate">{tenant.email}</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-slate-500" />
            <p className="text-slate-300">{tenant.user_count} users</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-slate-500" />
            <p className="text-slate-300">{tenant.type === 'school' ? '🏫 School' : '🏢 Corporate'}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-700 flex flex-wrap gap-2">
          <button
            onClick={() => openEditForm(tenant)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
            title="Edit tenant details"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>

          {status !== 'active' && (
            <button
              onClick={() => handleTenantAction(tenant.id, 'activate', tenant.name)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-colors"
              title="Activate — restore full access"
            >
              <Play className="w-3.5 h-3.5" /> Activate
            </button>
          )}

          {status !== 'suspended' && status === 'active' && (
            <button
              onClick={() => handleTenantAction(tenant.id, 'suspend', tenant.name)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors"
              title="Suspend — temporarily restrict access (reversible)"
            >
              <PauseCircle className="w-3.5 h-3.5" /> Suspend
            </button>
          )}

          {status !== 'disabled' && (
            <button
              onClick={() => handleTenantAction(tenant.id, 'disable', tenant.name)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 transition-colors"
              title="Disable — deactivate tenant (requires manual re-activation)"
            >
              <Ban className="w-3.5 h-3.5" /> Disable
            </button>
          )}

          <button
            onClick={() => handleDeleteTenant(tenant.id, tenant.name)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
            title="Delete — permanently remove this tenant"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>
    )
  }

  const UserRow = ({ user }: { user: User }) => {
    const statusColor = 
      user.is_suspended ? 'text-yellow-400 bg-yellow-500/20' :
      !user.is_active ? 'text-red-400 bg-red-500/20' :
      'text-green-400 bg-green-500/20'
    
    const statusLabel = 
      user.is_suspended ? 'Suspended' :
      !user.is_active ? 'Disabled' :
      'Active'

    const isSuperadmin = user.role === 'superadmin'

    return (
      <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h4 className="text-white font-bold">{user.name || user.email}</h4>
            <p className="text-slate-400 text-sm">{user.email}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        <div className="space-y-2 text-sm mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-slate-500" />
            <span className="text-slate-300 capitalize">{user.role}</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-500" />
            <span className="text-slate-300">{user.entity_name}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs">Created {new Date(user.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Action Buttons */}
        {!isSuperadmin && (
          <div className="pt-3 border-t border-slate-700 flex flex-wrap gap-2">
            <button
              onClick={() => openEditUserForm(user)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
              title="Edit user details"
            >
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </button>

            {!user.is_active && (
              <button
                onClick={() => handleUserAction(user.id, 'activate', user.name || user.email)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-colors"
                title="Activate — restore full access"
              >
                <Play className="w-3.5 h-3.5" /> Activate
              </button>
            )}

            {user.is_active && !user.is_suspended && (
              <button
                onClick={() => handleUserAction(user.id, 'suspend', user.name || user.email)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors"
                title="Suspend — temporarily restrict access"
              >
                <PauseCircle className="w-3.5 h-3.5" /> Suspend
              </button>
            )}

            {user.is_active && (
              <button
                onClick={() => handleUserAction(user.id, 'disable', user.name || user.email)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 transition-colors"
                title="Disable — deactivate user account"
              >
                <Ban className="w-3.5 h-3.5" /> Disable
              </button>
            )}

            <button
              onClick={() => handleDeleteUser(user.id, user.name || user.email)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
              title="Delete — permanently remove this user"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}
      </div>
    )
  }

  const filteredUsers = allUsers.filter(user => {
    switch (userFilter) {
      case 'active':
        return user.is_active && !user.is_suspended
      case 'disabled':
        return !user.is_active
      case 'suspended':
        return user.is_suspended
      default:
        return true
    }
  })

  if (loading) {
    return (
      <SuperadminLayout currentPage="management">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading data...</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="management">
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialogComponent dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}

      <div className="space-y-6">
        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('entities')}
            className={`px-4 py-3 font-semibold border-b-2 transition-colors ${
              activeTab === 'entities'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Entities
          </button>
          <button
            onClick={() => setActiveTab('tenants')}
            className={`px-4 py-3 font-semibold border-b-2 transition-colors ${
              activeTab === 'tenants'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Manage Tenants
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-3 font-semibold border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Users
          </button>
        </div>

        {/* ENTITIES TAB */}
        {activeTab === 'entities' && (
          <div className="space-y-8">
            {/* Schools Section */}
            <div>
              <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-1 h-8 bg-blue-500 rounded-full" />
                Schools ({schools.length})
              </h3>
              {schools.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {schools.map((school) => (
                    <EntityCard key={school.id} entity={school} />
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
                <span className="w-1 h-8 bg-purple-500 rounded-full" />
                Corporates ({corporates.length})
              </h3>
              {corporates.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {corporates.map((corporate) => (
                    <EntityCard key={corporate.id} entity={corporate} />
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center rounded-lg bg-slate-800/30 border border-dashed border-slate-700">
                  <p className="text-slate-400">No corporates found</p>
                </div>
              )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                <p className="text-slate-400 text-sm">Total Schools</p>
                <p className="text-4xl font-bold text-blue-400 mt-2">{schools.length}</p>
                <p className="text-xs text-slate-500 mt-2">
                  {schools.filter(s => s.is_active).length} active · {schools.filter(s => !s.is_active).length} inactive
                </p>
              </div>
              <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                <p className="text-slate-400 text-sm">Total Corporates</p>
                <p className="text-4xl font-bold text-purple-400 mt-2">{corporates.length}</p>
                <p className="text-xs text-slate-500 mt-2">
                  {corporates.filter(c => c.is_active).length} active · {corporates.filter(c => !c.is_active).length} inactive
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TENANTS TAB */}
        {activeTab === 'tenants' && (
          <div className="space-y-6">
            {/* Add Tenant Button */}
            <button
              onClick={() => setShowTenantForm(!showTenantForm)}
              className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-lg transition-all shadow-lg"
            >
              {showTenantForm ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {showTenantForm ? 'Cancel' : 'Create New Tenant'}
            </button>

            {/* Add Tenant Form */}
            {showTenantForm && (
              <form
                onSubmit={handleAddTenant}
                className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Tenant Name</label>
                  <input
                    type="text"
                    value={tenantFormData.name}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-green-500 outline-none"
                    placeholder="Enter tenant name"
                    required
                  />
                </div>

                <div className="p-3 rounded-lg bg-slate-900/50 border border-dashed border-slate-700">
                  <p className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    <span><strong className="text-slate-400">Code</strong> will be auto-generated: <code className="text-green-400">{tenantFormData.type === 'school' ? 'SAS-XXX-SP' : 'SAS-XXX-CP'}</code></span>
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={tenantFormData.email}
                      onChange={(e) => setTenantFormData({ ...tenantFormData, email: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-green-500 outline-none"
                      placeholder="Enter email"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Type</label>
                    <select
                      value={tenantFormData.type}
                      onChange={(e) => setTenantFormData({ ...tenantFormData, type: e.target.value as 'school' | 'corporate' })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-green-500 outline-none"
                    >
                      <option value="school">School</option>
                      <option value="corporate">Corporate</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Address</label>
                  <textarea
                    value={tenantFormData.address}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, address: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-green-500 outline-none resize-none"
                    placeholder="Enter institution address"
                    rows={3}
                    required
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                  >
                    Create Tenant
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTenantForm(false)}
                    className="flex-1 px-4 py-2 border border-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Edit Tenant Modal */}
            {editingTenant && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <form
                  onSubmit={handleEditTenant}
                  className="w-full max-w-lg p-6 rounded-xl bg-slate-800 border border-slate-700 space-y-4 shadow-2xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-white">Edit Tenant</h3>
                    <button type="button" onClick={() => setEditingTenant(null)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">{editingTenant.code} · {editingTenant.type === 'school' ? '🏫 School' : '🏢 Corporate'}</p>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Tenant Name</label>
                    <input
                      type="text"
                      value={editFormData.name}
                      onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={editFormData.email}
                      onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Address</label>
                    <textarea
                      value={editFormData.address}
                      onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
                      rows={3}
                      required
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                      Save Changes
                    </button>
                    <button type="button" onClick={() => setEditingTenant(null)} className="flex-1 px-4 py-2 border border-slate-600 text-slate-300 hover:text-white rounded-lg font-medium transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Status Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-green-400" /> Active — Full access</span>
              <span className="flex items-center gap-1"><PauseCircle className="w-3.5 h-3.5 text-yellow-400" /> Suspended — Temporary restriction</span>
              <span className="flex items-center gap-1"><Ban className="w-3.5 h-3.5 text-red-400" /> Disabled — Deactivated</span>
            </div>

            {/* Tenants Grid */}
            {tenants.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tenants.map((tenant) => (
                  <TenantRow key={tenant.id} tenant={tenant} />
                ))}
              </div>
            ) : (
              <div className="p-12 text-center rounded-xl bg-slate-800/30 border border-dashed border-slate-700">
                <p className="text-slate-400 text-lg">No tenants yet</p>
                <p className="text-slate-500 text-sm mt-2">Create a new tenant to get started</p>
              </div>
            )}
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* User Filter Buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setUserFilter('all')}
                className={`px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                  userFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                All Users ({allUsers.length})
              </button>
              <button
                onClick={() => setUserFilter('active')}
                className={`px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                  userFilter === 'active'
                    ? 'bg-green-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Active ({allUsers.filter(u => u.is_active && !u.is_suspended).length})
              </button>
              <button
                onClick={() => setUserFilter('suspended')}
                className={`px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                  userFilter === 'suspended'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Suspended ({allUsers.filter(u => u.is_suspended).length})
              </button>
              <button
                onClick={() => setUserFilter('disabled')}
                className={`px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                  userFilter === 'disabled'
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Disabled ({allUsers.filter(u => !u.is_active).length})
              </button>
            </div>

            {/* Edit User Modal */}
            {editingUser && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <form
                  onSubmit={handleEditUser}
                  className="w-full max-w-lg p-6 rounded-xl bg-slate-800 border border-slate-700 space-y-4 shadow-2xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-white">Edit User</h3>
                    <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    <span className="capitalize">{editingUser.role}</span> · {editingUser.entity_name}
                  </p>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={editUserFormData.name}
                      onChange={(e) => setEditUserFormData({ ...editUserFormData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={editUserFormData.email}
                      onChange={(e) => setEditUserFormData({ ...editUserFormData, email: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                      required
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                      Save Changes
                    </button>
                    <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-2 border border-slate-600 text-slate-300 hover:text-white rounded-lg font-medium transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Users Grid */}
            {filteredUsers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredUsers.map((user) => (
                  <UserRow key={user.id} user={user} />
                ))}
              </div>
            ) : (
              <div className="p-12 text-center rounded-xl bg-slate-800/30 border border-dashed border-slate-700">
                <p className="text-slate-400 text-lg">No users found</p>
                <p className="text-slate-500 text-sm mt-2">No users match the selected filter</p>
              </div>
            )}
          </div>
        )}
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminManagementPage
