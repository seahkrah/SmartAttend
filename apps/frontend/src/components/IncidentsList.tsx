import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import IncidentDetailModal from './IncidentDetailModal'

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
}

interface IncidentsListProps {
  filterStatus?: string
  filterSeverity?: string
  onIncidentClick?: (incident: Incident) => void
  compact?: boolean
}

const getSeverityColor = (severity: string) => {
  const colors: Record<string, { bg: string; border: string; badge: string; text: string }> = {
    critical: { bg: 'bg-red-900/20', border: 'border-red-600', badge: '🔴', text: 'text-red-300' },
    high: { bg: 'bg-orange-900/20', border: 'border-orange-600', badge: '🟠', text: 'text-orange-300' },
    medium: { bg: 'bg-amber-900/20', border: 'border-amber-600', badge: '🟡', text: 'text-amber-300' },
    low: { bg: 'bg-blue-900/20', border: 'border-blue-600', badge: '🟢', text: 'text-blue-300' }
  }
  return colors[severity] || colors.low
}

const getStatusBadge = (status: string) => {
  const badges: Record<string, { icon: string; text: string; color: string }> = {
    open: { icon: '🔴', text: 'Open', color: 'text-red-400' },
    investigating: { icon: '🔍', text: 'Investigating', color: 'text-amber-400' },
    resolved: { icon: '✅', text: 'Resolved', color: 'text-green-400' },
    closed: { icon: '✓', text: 'Closed', color: 'text-blue-400' }
  }
  return badges[status] || badges.open
}

const IncidentsList: React.FC<IncidentsListProps> = ({
  filterStatus,
  filterSeverity,
  onIncidentClick,
  compact = false
}) => {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchIncidents()
  }, [filterStatus, filterSeverity])

  const fetchIncidents = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams()
      if (filterStatus) params.append('status', filterStatus)
      if (filterSeverity) params.append('severity', filterSeverity)

      const response = await axios.get(
        `/api/superadmin/incidents?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setIncidents(response.data.data || [])
    } catch (err) {
      console.error('Error fetching incidents:', err)
      setIncidents([])
    } finally {
      setLoading(false)
    }
  }

  const filteredIncidents = incidents.filter(incident =>
    incident.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    incident.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    incident.id.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleIncidentSelect = (incident: Incident) => {
    setSelectedIncident(incident)
    setShowModal(true)
    onIncidentClick?.(incident)
  }

  const handleViewDetails = (incident: Incident) => {
    navigate(`/superadmin/incident/${incident.id}`)
  }

  const handleStatusChange = (newStatus: string) => {
    if (selectedIncident) {
      setIncidents(prev =>
        prev.map(i =>
          i.id === selectedIncident.id
            ? { ...i, status: newStatus as any, updated_at: new Date().toISOString() }
            : i
        )
      )
      setSelectedIncident(prev =>
        prev ? { ...prev, status: newStatus as any, updated_at: new Date().toISOString() } : null
      )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full"
        />
      </div>
    )
  }

  if (filteredIncidents.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-lg">No incidents found</p>
        <p className="text-sm">Check back later or adjust your filters</p>
      </div>
    )
  }

  return (
    <>
      {!compact && (
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search incidents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      <div className={`space-y-4 ${compact ? 'max-h-96 overflow-y-auto' : ''}`}>
        {filteredIncidents.map((incident, idx) => {
          const severityStyle = getSeverityColor(incident.severity)
          const statusBadge = getStatusBadge(incident.status)

          return (
            <motion.div
              key={incident.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => handleIncidentSelect(incident)}
              className={`p-4 rounded-lg border ${severityStyle.border} ${severityStyle.bg} cursor-pointer transition-all hover:shadow-lg hover:scale-105 backdrop-blur-sm`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-3 flex-1">
                  <span className="text-2xl flex-shrink-0">{severityStyle.badge}</span>
                  <div className="flex-1">
                    <h4 className="font-bold text-white mb-1">{incident.title}</h4>
                    <p className="text-sm text-slate-300 mb-2 line-clamp-2">{incident.description}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>ID: {incident.id.substring(0, 8)}...</span>
                      <span>•</span>
                      <span>{new Date(incident.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`text-sm font-semibold px-2 py-1 bg-slate-700/50 rounded ${statusBadge.color}`}>
                    {statusBadge.icon} {statusBadge.text}
                  </span>
                  <span className="text-xs text-slate-400 px-2 py-1 bg-slate-700/50 rounded capitalize">
                    {incident.severity}
                  </span>
                </div>
              </div>

              {/* Impact Row */}
              <div className="flex gap-4 pt-3 border-t border-slate-700/50">
                <div className="text-sm">
                  <span className="text-slate-400">Affected: </span>
                  <span className="font-bold text-cyan-400">{incident.affected_entity_count}</span>
                </div>
                <div className="text-sm">
                  <span className="text-slate-400">Users: </span>
                  <span className="font-bold text-amber-400">{incident.impact_users.toLocaleString()}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleViewDetails(incident)
                  }}
                  className="ml-auto text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors font-semibold"
                >
                  Full View →
                </button>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Detail Modal */}
      {selectedIncident && (
        <IncidentDetailModal
          isOpen={showModal}
          incident={selectedIncident}
          onClose={() => setShowModal(false)}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  )
}

export default IncidentsList
