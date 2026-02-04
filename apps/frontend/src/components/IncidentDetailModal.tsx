import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'

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
  affected_entity_count: number
  impact_users: number
  created_at: string
  updated_at: string
  updated_by: string
  timeline?: IncidentTimeline[]
}

interface IncidentDetailModalProps {
  isOpen: boolean
  incident: Incident | null
  onClose: () => void
  onStatusChange?: (status: string) => void
}

const getSeverityColor = (severity: string) => {
  const colors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    critical: { bg: 'bg-red-900/20', border: 'border-red-600', text: 'text-red-300', badge: '🔴' },
    high: { bg: 'bg-orange-900/20', border: 'border-orange-600', text: 'text-orange-300', badge: '🟠' },
    medium: { bg: 'bg-amber-900/20', border: 'border-amber-600', text: 'text-amber-300', badge: '🟡' },
    low: { bg: 'bg-blue-900/20', border: 'border-blue-600', text: 'text-blue-300', badge: '🟢' }
  }
  return colors[severity] || colors.low
}

const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({ isOpen, incident, onClose, onStatusChange }) => {
  const [newStatus, setNewStatus] = useState(incident?.status || 'open')
  const [updating, setUpdating] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [showNoteForm, setShowNoteForm] = useState(false)

  useEffect(() => {
    if (incident) {
      setNewStatus(incident.status)
    }
  }, [incident])

  const handleStatusChange = async () => {
    if (newStatus === incident?.status || !incident) return

    try {
      setUpdating(true)
      const token = localStorage.getItem('accessToken')
      await axios.put(
        `/api/superadmin/incidents/${incident.id}`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      onStatusChange?.(newStatus)
    } catch (err) {
      console.error('Error updating incident:', err)
      setNewStatus(incident?.status || 'open')
    } finally {
      setUpdating(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim() || !incident) return

    try {
      setUpdating(true)
      const token = localStorage.getItem('accessToken')
      await axios.put(
        `/api/superadmin/incidents/${incident.id}`,
        { notes: newNote },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setNewNote('')
      setShowNoteForm(false)
    } catch (err) {
      console.error('Error adding note:', err)
    } finally {
      setUpdating(false)
    }
  }

  if (!incident) return null

  const severityStyle = getSeverityColor(incident.severity)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className={`w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl ${severityStyle.bg} border ${severityStyle.border} bg-gradient-to-b from-slate-800 to-slate-900 shadow-2xl`}>
              {/* Header */}
              <div className="sticky top-0 p-6 border-b border-slate-700 bg-slate-800/95 backdrop-blur-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{severityStyle.badge}</span>
                  <div>
                    <h2 className="text-xl font-bold text-white">{incident.title}</h2>
                    <p className="text-sm text-slate-400">ID: {incident.id}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-white transition-colors text-2xl"
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Severity & Status */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase">Severity</label>
                    <p className={`mt-1 font-semibold ${severityStyle.text} capitalize`}>
                      {severityStyle.badge} {incident.severity}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase">Status</label>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value as any)}
                      onBlur={handleStatusChange}
                      disabled={updating}
                      className="mt-1 w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 text-sm capitalize"
                    >
                      <option value="open">🔴 Open</option>
                      <option value="investigating">🔍 Investigating</option>
                      <option value="resolved">✅ Resolved</option>
                      <option value="closed">✓ Closed</option>
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <h3 className="text-sm font-bold text-slate-300 mb-2">Description</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{incident.description}</p>
                </div>

                {/* Impact */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-700/30 rounded-lg">
                  <div>
                    <p className="text-xs text-slate-400">Affected Entities</p>
                    <p className="text-2xl font-bold text-cyan-400">{incident.affected_entity_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Users Impacted</p>
                    <p className="text-2xl font-bold text-amber-400">{incident.impact_users.toLocaleString()}</p>
                  </div>
                </div>

                {/* Timeline Preview */}
                {incident.timeline && incident.timeline.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-slate-300">Recent Updates</h3>
                      {!showNoteForm && (
                        <button
                          onClick={() => setShowNoteForm(true)}
                          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {incident.timeline.slice(0, 5).map((entry, idx) => (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="p-3 bg-slate-700/30 rounded-lg text-sm"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <p className="font-semibold text-slate-300 capitalize">{entry.action}</p>
                            <p className="text-xs text-slate-500">
                              {new Date(entry.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          {entry.notes && (
                            <p className="text-slate-400 text-xs">{entry.notes.substring(0, 100)}...</p>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Note Form */}
                {showNoteForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-4 bg-blue-900/20 border border-blue-600 rounded-lg space-y-2"
                  >
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add a note..."
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm"
                      rows={3}
                      disabled={updating}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddNote}
                        disabled={updating || !newNote.trim()}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-semibold transition-colors"
                      >
                        {updating ? 'Adding...' : 'Add'}
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteForm(false)
                          setNewNote('')
                        }}
                        disabled={updating}
                        className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm font-semibold transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Timestamps */}
                <div className="border-t border-slate-700 pt-4 text-xs text-slate-400 space-y-1">
                  <p>Created: {new Date(incident.created_at).toLocaleString()}</p>
                  <p>Last updated: {new Date(incident.updated_at).toLocaleString()} by {incident.updated_by}</p>
                </div>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 p-4 border-t border-slate-700 bg-slate-800/95 flex gap-3 justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition-colors"
                >
                  Close
                </button>
                {incident.status !== 'closed' && (
                  <button
                    onClick={() => {
                      setNewStatus('closed')
                      setTimeout(handleStatusChange, 100)
                    }}
                    disabled={updating}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors"
                  >
                    {updating ? '...' : 'Close'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default IncidentDetailModal
