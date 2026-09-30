import React, { useState, useEffect } from 'react'
import { FileText, Search } from 'lucide-react'
import { apiClient } from '../services/api'

interface AuditLog {
  id: string
  created_at: string
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
      const response = await apiClient.get('/superadmin/audit-logs?limit=100')
      // Backend returns array directly
      const logs = Array.isArray(response.data) ? response.data : []
      setLogs(logs)
    } catch (error) {
      console.error('Error loading audit logs:', error)
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  const filteredLogs = Array.isArray(logs) 
    ? logs.filter(
        (log) =>
          log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.user_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.ip_address.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : []

  const ActionBadge = ({ action }: { action: string }) => {
    const colorMap: Record<string, string> = {
      CREATE: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
      UPDATE: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
      DELETE: 'bg-red-500/20 text-red-700 dark:text-red-400',
      LOGIN: 'bg-green-500/20 text-green-700 dark:text-green-400',
      LOGOUT: 'bg-raised text-secondary',
    }

    const baseColor = colorMap[action] || 'bg-raised text-secondary'

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${baseColor}`}>
        {action}
      </span>
    )
  }

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center h-full">
          <div className="text-secondary">Loading audit logs...</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-3 w-5 h-5 text-muted" />
          <input
            type="text"
            placeholder="Search by action, email, or IP address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-sunken border border-subtle rounded-lg text-primary placeholder:text-muted focus:border-cyan-500 outline-none transition-colors"
          />
        </div>

        {/* Audit Logs Table */}
        <div className="overflow-x-auto">
          {filteredLogs.length > 0 ? (
            <div className="space-y-3">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 rounded-lg bg-sunken border border-subtle hover:border-strong transition-colors"
                >
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
                    {/* Timestamp */}
                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wider mb-1">Timestamp</p>
                      <p className="text-sm font-mono text-secondary">
                        {log.created_at ? new Date(log.created_at).toLocaleString() : 'N/A'}
                      </p>
                    </div>

                    {/* Action */}
                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wider mb-1">Action</p>
                      <ActionBadge action={log.action} />
                    </div>

                    {/* User */}
                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wider mb-1">User</p>
                      <p className="text-sm text-secondary break-all">{log.user_email}</p>
                    </div>

                    {/* IP Address */}
                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wider mb-1">IP Address</p>
                      <p className="text-sm font-mono text-secondary">{log.ip_address}</p>
                    </div>

                    {/* Details */}
                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wider mb-1">Details</p>
                      <details className="cursor-pointer">
                        <summary className="text-sm text-cyan-700 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300">
                          View details
                        </summary>
                        <div className="mt-2 p-2 bg-card rounded text-xs text-secondary max-h-40 overflow-y-auto font-mono">
                          <pre>{JSON.stringify(log.details, null, 2)}</pre>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center rounded-xl bg-sunken border border-dashed border-subtle">
              <FileText className="w-12 h-12 text-muted mx-auto mb-4" />
              <p className="text-secondary text-lg">
                {searchTerm ? 'No audit logs match your search' : 'No audit logs found'}
              </p>
            </div>
          )}
        </div>

        {/* Stats */}
        {logs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-sunken border border-subtle">
              <p className="text-sm text-secondary">Total Logs</p>
              <p className="text-2xl font-bold text-primary mt-1">{logs.length}</p>
            </div>

            <div className="p-4 rounded-lg bg-sunken border border-subtle">
              <p className="text-sm text-secondary">Unique Users</p>
              <p className="text-2xl font-bold text-primary mt-1">
                {new Set(logs.map((l) => l.user_email)).size}
              </p>
            </div>

            <div className="p-4 rounded-lg bg-sunken border border-subtle">
              <p className="text-sm text-secondary">Latest Event</p>
              <p className="text-sm font-mono text-secondary mt-1">
                {logs[0]?.created_at ? new Date(logs[0].created_at).toLocaleString() : 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default SuperadminAuditLogsPage
