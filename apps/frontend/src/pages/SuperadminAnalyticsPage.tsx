import React, { useState, useEffect } from 'react'
import { AlertCircle, Users, Building2, Shield } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import SuperadminLayout from '../components/SuperadminLayout'
import axios from 'axios'

interface AnalyticsData {
  date: string
  activeUsers: number
  totalUsers: number
  newRegistrations: number
}

interface SystemHealth {
  critical: number
  warnings: number
  healthy: number
}

interface KeyMetrics {
  avgResponseTimeMs: number
  systemUptime: number
  apiCallsLastHour: number
  activeSessions: number
}

interface Summary {
  totalUsers: number
  activeUsers: number
  totalSchools: number
  totalCorporates: number
  totalIncidents: number
  roleBreakdown: { role: string; count: number }[]
}

const SuperadminAnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsData[]>([])
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({ critical: 0, warnings: 0, healthy: 0 })
  const [keyMetrics, setKeyMetrics] = useState<KeyMetrics>({ avgResponseTimeMs: 0, systemUptime: 100, apiCallsLastHour: 0, activeSessions: 0 })
  const [summary, setSummary] = useState<Summary>({ totalUsers: 0, activeUsers: 0, totalSchools: 0, totalCorporates: 0, totalIncidents: 0, roleBreakdown: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAnalyticsData()
  }, [])

  const loadAnalyticsData = async () => {
    try {
      setLoading(true)
      setError(null)

      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/superadmin/analytics?days=30', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.data?.success && response.data?.data) {
        const { userGrowth, systemHealth: health, keyMetrics: metrics, summary: sum } = response.data.data

        setData(
          (userGrowth || []).map((d: any) => ({
            date: d.date,
            activeUsers: d.activeUsers,
            totalUsers: d.totalUsers,
            newRegistrations: d.newRegistrations,
          }))
        )
        setSystemHealth(health || { critical: 0, warnings: 0, healthy: 0 })
        setKeyMetrics(metrics || { avgResponseTimeMs: 0, systemUptime: 100, apiCallsLastHour: 0, activeSessions: 0 })
        setSummary(sum || { totalUsers: 0, activeUsers: 0, totalSchools: 0, totalCorporates: 0, totalIncidents: 0, roleBreakdown: [] })
      }
    } catch (err: any) {
      console.error('Error loading analytics data:', err)
      setError(err.response?.data?.error || 'Failed to load analytics data')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <SuperadminLayout currentPage="analytics">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading analytics...</div>
        </div>
      </SuperadminLayout>
    )
  }

  if (error) {
    return (
      <SuperadminLayout currentPage="analytics">
        <div className="flex items-center justify-center h-full">
          <div className="text-red-400">Error: {error}</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="analytics">
      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-cyan-400" />
              <span className="text-sm text-slate-400">Total Users</span>
            </div>
            <p className="text-3xl font-bold text-white">{summary.totalUsers}</p>
            <p className="text-sm text-green-400 mt-1">{summary.activeUsers} active</p>
          </div>
          <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="w-5 h-5 text-blue-400" />
              <span className="text-sm text-slate-400">Schools</span>
            </div>
            <p className="text-3xl font-bold text-white">{summary.totalSchools}</p>
          </div>
          <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="w-5 h-5 text-purple-400" />
              <span className="text-sm text-slate-400">Corporates</span>
            </div>
            <p className="text-3xl font-bold text-white">{summary.totalCorporates}</p>
          </div>
          <div className="p-5 rounded-xl bg-slate-800/50 border border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="w-5 h-5 text-red-400" />
              <span className="text-sm text-slate-400">Incidents</span>
            </div>
            <p className="text-3xl font-bold text-white">{summary.totalIncidents}</p>
          </div>
        </div>

        {/* Roles Breakdown */}
        {summary.roleBreakdown.length > 0 && (
          <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
            <h3 className="text-lg font-bold text-white mb-4">Users by Role</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {summary.roleBreakdown.map((rb) => (
                <div key={rb.role} className="p-3 bg-slate-900/50 rounded-lg text-center">
                  <p className="text-xl font-bold text-cyan-400">{rb.count}</p>
                  <p className="text-xs text-slate-400 capitalize">{rb.role.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Growth Chart */}
        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">30-Day User Growth Trend</h3>
          {data.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="activeUsers"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  name="Active Users"
                />
                <Line
                  type="monotone"
                  dataKey="totalUsers"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                  name="Total Users"
                />
                <Line
                  type="monotone"
                  dataKey="newRegistrations"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  name="New Registrations"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-500">No user data available yet</div>
          )}
        </div>

        {/* System Health Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <h4 className="text-lg font-bold text-white">Critical Issues</h4>
            </div>
            <p className="text-4xl font-bold text-white">{systemHealth.critical}</p>
            <p className="text-sm text-slate-400 mt-2">{systemHealth.critical > 0 ? 'Immediate action required' : 'No critical issues'}</p>
          </div>

          <div className="p-6 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-yellow-400" />
              <h4 className="text-lg font-bold text-white">Warnings</h4>
            </div>
            <p className="text-4xl font-bold text-white">{systemHealth.warnings}</p>
            <p className="text-sm text-slate-400 mt-2">{systemHealth.warnings > 0 ? 'Review recommended' : 'No warnings'}</p>
          </div>

          <div className="p-6 rounded-xl bg-green-500/10 border border-green-500/30">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-green-400" />
              <h4 className="text-lg font-bold text-white">Healthy</h4>
            </div>
            <p className="text-4xl font-bold text-white">{systemHealth.healthy}</p>
            <p className="text-sm text-slate-400 mt-2">Operating normally</p>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">Key Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Avg. Response Time</span>
                <span className="text-xl font-bold text-cyan-400">{keyMetrics.avgResponseTimeMs > 0 ? `${keyMetrics.avgResponseTimeMs}ms` : 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">System Uptime</span>
                <span className="text-xl font-bold text-green-400">{keyMetrics.systemUptime}%</span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">API Calls / Hour</span>
                <span className="text-xl font-bold text-blue-400">{keyMetrics.apiCallsLastHour.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Active Sessions</span>
                <span className="text-xl font-bold text-purple-400">{keyMetrics.activeSessions.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminAnalyticsPage
