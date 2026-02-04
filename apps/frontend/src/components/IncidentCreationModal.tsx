import React, { useState } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'

interface IncidentCreationModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const IncidentCreationModal: React.FC<IncidentCreationModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('medium')
  const [affectedEntities, setAffectedEntities] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim()) {
      setError('Incident title is required')
      return
    }

    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')

      await axios.post(
        '/api/superadmin/incidents',
        {
          title: title.trim(),
          description: description.trim(),
          severity,
          affected_entities: affectedEntities.trim() ? affectedEntities.split(',').map(e => e.trim()) : []
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )

      setError('')
      setTitle('')
      setDescription('')
      setSeverity('medium')
      setAffectedEntities('')
      onSuccess()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create incident')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-800 rounded-xl border border-slate-700 max-w-md w-full p-6"
      >
        <h2 className="text-2xl font-bold text-white mb-4">Create Incident</h2>

        {error && (
          <div className="p-3 mb-4 bg-red-900/20 border border-red-600 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleCreateIncident} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Incident Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Database connection failure"
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description of the incident..."
              disabled={loading}
              rows={3}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Severity
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="critical">🔴 Critical</option>
              <option value="high">🟠 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Affected Entities (comma-separated IDs)
            </label>
            <input
              type="text"
              value={affectedEntities}
              onChange={(e) => setAffectedEntities(e.target.value)}
              placeholder="e.g., school-123, corporate-456"
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
            >
              {loading ? 'Creating...' : 'Create Incident'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

export default IncidentCreationModal
