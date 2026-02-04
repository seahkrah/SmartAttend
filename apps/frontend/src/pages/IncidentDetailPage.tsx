import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'
import { useParams, useNavigate } from 'react-router-dom'

interface IncidentTimeline {
  id: string
  action: string
  notes: string
  status?: string
  created_at: string
  created_by: string
}

interface Incident {
  id: string
  title: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  status: 'open' | 'investigating' | 'resolved' | 'closed'
  affected_entities: string[]
  affected_entity_count: number
  impact_users: number
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
  timeline: IncidentTimeline[]
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'critical':
      return { bg: 'bg-red-900/20', border: 'border-red-600', text: 'text-red-300', badge: '🔴' }
    case 'high':
      return { bg: 'bg-orange-900/20', border: 'border-orange-600', text: 'text-orange-300', badge: '🟠' }
    case 'medium':
      return { bg: 'bg-amber-900/20', border: 'border-amber-600', text: 'text-amber-300', badge: '🟡' }
    case 'low':
      return { bg: 'bg-blue-900/20', border: 'border-blue-600', text: 'text-blue-300', badge: '🟢' }
    default:
      return { bg: 'bg-slate-900/20', border: 'border-slate-600', text: 'text-slate-300', badge: '⚪' }
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'open':
      return { bg: 'bg-red-600/30', text: 'text-red-300', icon: '🔴' }
    case 'investigating':
      return { bg: 'bg-amber-600/30', text: 'text-amber-300', icon: '🔍' }
    case 'resolved':
      return { bg: 'bg-green-600/30', text: 'text-green-300', icon: '✅' }
    case 'closed':
      return { bg: 'bg-blue-600/30', text: 'text-blue-300', icon: '✓' }
    default:
      return { bg: 'bg-slate-600/30', text: 'text-slate-300', icon: '⭕' }
  }
}

const IncidentDetailView: React.FC = () => {
  const { incidentId } = useParams<{ incidentId: string }>()
  const navigate = useNavigate()
  const [incident, setIncident] = useState<Incident | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [updating, setUpdating] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)

  useEffect(() => {
    fetchIncidentDetails()
  }, [incidentId])

  const fetchIncidentDetails = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.get(`/api/superadmin/incidents/${incidentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setIncident(response.data.data)
      setNewStatus(response.data.data.status)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load incident')
      console.error('Error fetching incident:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async () => {
    if (newStatus === incident?.status) return

    try {
      setUpdating(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.put(
        `/api/superadmin/incidents/${incidentId}`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setIncident(response.data.data)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update status')
      setNewStatus(incident?.status || 'open')
    } finally {
      setUpdating(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return

    try {
      setUpdating(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.put(
        `/api/superadmin/incidents/${incidentId}`,
        { notes: newNote },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setIncident(response.data.data)
      setNewNote('')
      setShowNoteForm(false)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add note')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full"
        />
      </div>
    )
  }

  if (error && !incident) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="text-center">
          <p className="text-red-500 text-2xl font-bold mb-4">Error</p>
          <p className="text-slate-300 mb-6">{error}</p>
          <button
            onClick={() => navigate('/superadmin')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (!incident) return null

  const severityStyle = getSeverityColor(incident.severity)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-8"
        >
          <button
            onClick={() => navigate('/superadmin')}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            ← Back
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{severityStyle.badge}</span>
              <h1 className="text-4xl font-bold">{incident.title}</h1>
            </div>
            <p className="text-slate-400">ID: {incident.id}</p>
          </div>
        </motion.div>

        {/* Error Alert */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-4 bg-red-900/20 border border-red-600 rounded-lg text-red-300"
          >
            {error}
          </motion.div>
        )}

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`p-8 rounded-xl border ${severityStyle.border} ${severityStyle.bg} backdrop-blur-sm`}
        >
          {/* Severity & Status Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
              <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Severity</label>
              <div className={`mt-2 px-4 py-2 rounded-lg font-semibold ${severityStyle.text} capitalize`}>
                {severityStyle.badge} {incident.severity}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Status</label>
              <select
                value={newStatus}
                onChange={(e) => {
                  setNewStatus(e.target.value)
                  setTimeout(() => {
                    setNewStatus(e.target.value)
                    const newVal = e.target.value
                    setIncident(prev => prev ? { ...prev, status: newVal as any } : null)
                  }, 300)
                }}
                disabled={updating}
                className="mt-2 w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 capitalize"
              >
                <option value="open">🔴 Open</option>
                <option value="investigating">🔍 Investigating</option>
                <option value="resolved">✅ Resolved</option>
                <option value="closed">✓ Closed</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="mb-8">
            <h3 className="text-lg font-bold mb-3">Description</h3>
            <p className="text-slate-300 leading-relaxed">{incident.description}</p>
          </div>

          {/* Meta Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-slate-400 mb-1">Created</p>
              <p className="font-semibold">{new Date(incident.created_at).toLocaleString()}</p>
              <p className="text-sm text-slate-400">by {incident.created_by}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400 mb-1">Last Updated</p>
              <p className="font-semibold">{new Date(incident.updated_at).toLocaleString()}</p>
              <p className="text-sm text-slate-400">by {incident.updated_by}</p>
            </div>
          </div>
        </motion.div>

        {/* Impact Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 space-y-4"
        >
          <h3 className="text-lg font-bold">Impact</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 rounded-lg bg-slate-700/30">
              <p className="text-sm text-slate-400">Affected Entities</p>
              <p className="text-3xl font-bold text-cyan-400">{incident.affected_entity_count}</p>
            </div>
            <div className="p-4 rounded-lg bg-slate-700/30">
              <p className="text-sm text-slate-400">Users Impacted</p>
              <p className="text-3xl font-bold text-amber-400">{incident.impact_users.toLocaleString()}</p>
            </div>
          </div>
          {incident.affected_entities.length > 0 && (
            <div>
              <p className="text-sm text-slate-400 mb-3">Affected IDs:</p>
              <div className="flex flex-wrap gap-2">
                {incident.affected_entities.map((entity, idx) => (
                  <span key={idx} className="px-3 py-1 bg-slate-700 rounded-full text-sm">
                    {entity}
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 space-y-6"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">Timeline</h3>
            {!showNoteForm && (
              <button
                onClick={() => setShowNoteForm(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-semibold"
              >
                + Add Note
              </button>
            )}
          </div>

          {/* Add Note Form */}
          {showNoteForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 rounded-lg bg-blue-900/20 border border-blue-600 space-y-3"
            >
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note to the timeline..."
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                rows={4}
                disabled={updating}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddNote}
                  disabled={updating || !newNote.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-semibold"
                >
                  {updating ? 'Adding...' : 'Add Note'}
                </button>
                <button
                  onClick={() => {
                    setShowNoteForm(false)
                    setNewNote('')
                  }}
                  disabled={updating}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg transition-colors font-semibold"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* Timeline Items */}
          <div className="space-y-4">
            {incident.timeline && incident.timeline.length > 0 ? (
              incident.timeline.map((entry, idx) => {
                const actionStyle = entry.status ? getStatusColor(entry.status) : { bg: '', text: '', icon: '📝' }
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex gap-4"
                  >
                    <div className="flex flex-col items-center">
                      <div className="text-2xl">{actionStyle.icon || '📝'}</div>
                      {idx < (incident.timeline?.length || 0) - 1 && (
                        <div className="w-1 h-12 bg-slate-700 mt-2" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="p-4 rounded-lg bg-slate-700/30 border border-slate-700">
                        <div className="flex items-start justify-between mb-2">
                          <p className="font-semibold capitalize">{entry.action}</p>
                          <p className="text-xs text-slate-400">
                            {new Date(entry.created_at).toLocaleTimeString()}
                          </p>
                        </div>
                        {entry.status && (
                          <p className={`text-sm mb-2 capitalize ${actionStyle.text}`}>
                            {actionStyle.icon} Status: {entry.status}
                          </p>
                        )}
                        {entry.notes && (
                          <p className="text-sm text-slate-300">{entry.notes}</p>
                        )}
                        <p className="text-xs text-slate-500 mt-2">by {entry.created_by}</p>
                      </div>
                    </div>
                  </motion.div>
                )
              })
            ) : (
              <p className="text-slate-400 text-center py-8">No timeline entries yet</p>
            )}
          </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex gap-3 justify-end"
        >
          <button
            onClick={() => navigate('/superadmin')}
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-colors"
          >
            Close
          </button>
          {incident.status !== 'closed' && (
            <button
              onClick={() => {
                setNewStatus('closed' as any)
                handleStatusChange()
              }}
              disabled={updating}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg font-semibold transition-colors"
            >
              {updating ? 'Updating...' : 'Close Incident'}
            </button>
          )}
        </motion.div>
      </div>
    </div>
  )
}

export default IncidentDetailView
