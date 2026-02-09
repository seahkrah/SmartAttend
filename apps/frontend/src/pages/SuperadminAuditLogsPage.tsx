import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FileText, Search } from 'lucide-react'
import axios from 'axios'
import SuperadminLayout from '../components/SuperadminLayout'

interface AuditLog {
  id: string
  timestamp: string
  action: string
  user_email: string
  ip_address: string
  details: any
}

const SuperadminAuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAuditLogs()
  }, [])

  const loadAuditLogs = async () => {
    try {
      setLoading(true)
      const response = await axios.get(
        'http://localhost:5000/api/superadmin/audit-logs?limit=100',
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
        }
      )
      setLogs(response.data || [])
    } catch (error) {
      console.error('Error loading audit logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.ip_address.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const ActionBadge = ({ action }: { action: string }) => {
    const colorMap: Record<string, string> = {
      CREATE: 'bg-blue-500/20 text-blue-400',
      UPDATE: 'bg-yellow-500/20 text-yellow-400',
      DELETE: 'bg-red-500/20 text-red-400',
      LOGIN: 'bg-green-500/20 text-green-400',
      LOGOUT: 'bg-slate-500/20 text-slate-400',
    }

    const baseColor = colorMap[action] || 'bg-slate-500/20 text-slate-400'

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${baseColor}`}>
        {action}
      </span>
    )
  }

  if (loading) {
    return (
      <SuperadminLayout currentPage="audit">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading audit logs...</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="audit">
      <div className="space-y-6">
        {/* Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative"
        >
          <Search className="absolute left-4 top-3 w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Search by action, email, or IP address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-cyan-500 outline-none transition-colors"
          />
        </motion.div>

        {/* Audit Logs Table */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="overflow-x-auto"
        >
          {filteredLogs.length > 0 ? (
            <div className="space-y-3">
              {filteredLogs.map((log, idx) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
                    {/* Timestamp */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Timestamp</p>
                      <p className="text-sm font-mono text-slate-300">
                        {new Date(log.timestamp).toLocaleString()}
                      </p>
                    </div>

                    {/* Action */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Action</p>
                      <ActionBadge action={log.action} />
                    </div>

                    {/* User */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">User</p>
                      <p className="text-sm text-slate-300 break-all">{log.user_email}</p>
                    </div>

                    {/* IP Address */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">IP Address</p>
                      <p className="text-sm font-mono text-slate-300">{log.ip_address}</p>
                    </div>

                    {/* Details */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Details</p>
                      <details className="cursor-pointer">
                        <summary className="text-sm text-cyan-400 hover:text-cyan-300">
                          View details
                        </summary>
                        <div className="mt-2 p-2 bg-slate-900/50 rounded text-xs text-slate-300 max-h-40 overflow-y-auto font-mono">
                          <pre>{JSON.stringify(log.details, null, 2)}</pre>
                        </div>
                      </details>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-12 text-center rounded-xl bg-slate-800/30 border border-dashed border-slate-700"
            >
              <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg">
                {searchTerm ? 'No audit logs match your search' : 'No audit logs found'}
              </p>
            </motion.div>
          )}
        </motion.div>

        {/* Stats */}
        {logs.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <p className="text-sm text-slate-400">Total Logs</p>
              <p className="text-2xl font-bold text-white mt-1">{logs.length}</p>
            </div>

            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <p className="text-sm text-slate-400">Unique Users</p>
              <p className="text-2xl font-bold text-white mt-1">
                {new Set(logs.map((l) => l.user_email)).size}
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <p className="text-sm text-slate-400">Latest Event</p>
              <p className="text-sm font-mono text-slate-300 mt-1">
                {logs[0] ? new Date(logs[0].timestamp).toLocaleString() : 'N/A'}
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminAuditLogsPage
