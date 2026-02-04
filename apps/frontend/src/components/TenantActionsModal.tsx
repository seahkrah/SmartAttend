import React, { useState } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'

interface Entity {
  id: string
  name: string
  code: string
  email: string
  is_active: boolean
  user_count: number
  pending_approvals: number
}

interface TenantActionsModalProps {
  isOpen: boolean
  tenant: Entity | null
  onClose: () => void
  onSuccess: () => void
  entityType: 'school' | 'corporate'
}

const TenantActionsModal: React.FC<TenantActionsModalProps> = ({
  isOpen,
  tenant,
  onClose,
  onSuccess,
  entityType
}) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showLockConfirm, setShowLockConfirm] = useState(false)
  const [lockReason, setLockReason] = useState('')

  const handleLockTenant = async () => {
    if (!tenant) return

    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')

      await axios.post(
        '/api/superadmin/tenants/lock',
        {
          entity_id: tenant.id,
          entity_type: entityType,
          reason: lockReason || 'Locked by superadmin'
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )

      setError('')
      setShowLockConfirm(false)
      setLockReason('')
      onSuccess()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to lock tenant')
    } finally {
      setLoading(false)
    }
  }

  const handleUnlockTenant = async () => {
    if (!tenant) return

    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')

      await axios.post(
        '/api/superadmin/tenants/unlock',
        {
          entity_id: tenant.id,
          entity_type: entityType
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )

      setError('')
      onSuccess()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to unlock tenant')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !tenant) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-800 rounded-xl border border-slate-700 max-w-md w-full p-6 space-y-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">{tenant.name}</h2>
          <p className="text-slate-400">{tenant.email}</p>
          <div className="flex gap-4 mt-4 text-sm">
            <span className="text-slate-400">Code: <span className="text-white font-semibold">{tenant.code}</span></span>
            <span className={`px-2 py-1 rounded ${tenant.is_active ? 'bg-green-600/30 text-green-300' : 'bg-red-600/30 text-red-300'}`}>
              {tenant.is_active ? 'Active' : 'Locked'}
            </span>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-900/20 border border-red-600 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {!showLockConfirm ? (
          <div className="space-y-3">
            {tenant.is_active ? (
              <>
                <p className="text-slate-300 text-sm">Select an action for this tenant:</p>
                <button
                  onClick={() => setShowLockConfirm(true)}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
                >
                  🔒 Lock Tenant
                </button>
              </>
            ) : (
              <>
                <p className="text-slate-300 text-sm">This tenant is currently locked. Unlock to restore access.</p>
                <button
                  onClick={handleUnlockTenant}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
                >
                  🔓 Unlock Tenant
                </button>
              </>
            )}
            <button
              onClick={onClose}
              disabled={loading}
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm font-semibold">Lock Reason (optional)</p>
            <textarea
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="e.g., Security incident, Policy violation, Payment overdue..."
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              rows={3}
              disabled={loading}
            />
            <div className="flex gap-2">
              <button
                onClick={handleLockTenant}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
              >
                {loading ? 'Locking...' : 'Confirm Lock'}
              </button>
              <button
                onClick={() => {
                  setShowLockConfirm(false)
                  setLockReason('')
                }}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

export default TenantActionsModal
