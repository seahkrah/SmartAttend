import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import { ResponsiveContainer, BarChart, PieChart as PieChartRechart, Bar, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import axios from 'axios'
import SuperadminLayout from '../components/SuperadminLayout'

interface DashboardStats {
  total_schools: number
  active_schools: number
  total_corporates: number
  active_corporates: number
  total_users: number
  active_users: number
  pending_school_approvals: number
  pending_corporate_approvals: number
}

interface Alert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  message: string
  timestamp: Date
}

interface Entity {
  id: string
  name: string
  code: string
  email: string
  is_active: boolean
  user_count: number
  pending_approvals: number
}

const SuperadminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>({
    total_schools: 0,
    active_schools: 0,
    total_corporates: 0,
    active_corporates: 0,
    total_users: 0,
    active_users: 0,
    pending_school_approvals: 0,
    pending_corporate_approvals: 0,
  })
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      setLoading(true)
      const response = await axios.get('http://localhost:5000/api/superadmin/stats', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      })
      setStats(response.data || {})
    } catch (error) {
      console.error('Error loading dashboard stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalTenants = (stats?.total_schools || 0) + (stats?.total_corporates || 0)
  const activeTenants = (stats?.active_schools || 0) + (stats?.active_corporates || 0)
  const pendingApprovals = (stats?.pending_school_approvals || 0) + (stats?.pending_corporate_approvals || 0)

  const entityDistribution = [
    { name: 'Schools', value: stats?.total_schools || 0, fill: '#0ea5e9' },
    { name: 'Corporates', value: stats?.total_corporates || 0, fill: '#8b5cf6' },
  ]

  const activityOverview = [
    { name: 'Active', value: stats?.active_users || 0, fill: '#10b981' },
    { name: 'Inactive', value: (stats?.total_users || 0) - (stats?.active_users || 0), fill: '#64748b' },
  ]

  const KPICard = ({ title, value, trend, icon: Icon, color }: any) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-6 rounded-xl bg-gradient-to-br ${color} border border-slate-700 shadow-lg`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-slate-300 text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold text-white mt-2">{String(value) || '0'}</p>
        </div>
        <Icon className="w-8 h-8 text-white/50" />
      </div>
      {trend && (
        <div className="flex items-center gap-1">
          <TrendingUp className="w-4 h-4 text-green-400" />
          <span className="text-green-400 text-sm font-semibold">{trend}% this month</span>
        </div>
      )}
    </motion.div>
  )

  if (loading) {
    return (
      <SuperadminLayout currentPage="dashboard">
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400">Loading dashboard...</div>
        </div>
      </SuperadminLayout>
    )
  }

  return (
    <SuperadminLayout currentPage="dashboard">
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total Tenants"
            value={totalTenants}
            trend={12}
            icon={AlertTriangle}
            color="from-blue-500/20 to-blue-600/20"
          />
          <KPICard
            title="Active Tenants"
            value={activeTenants}
            trend={8}
            icon={AlertTriangle}
            color="from-green-500/20 to-green-600/20"
          />
          <KPICard
            title="Total Users"
            value={stats.total_users}
            trend={15}
            icon={AlertTriangle}
            color="from-purple-500/20 to-purple-600/20"
          />
          <KPICard
            title="Pending Approvals"
            value={pendingApprovals}
            trend={-5}
            icon={AlertTriangle}
            color="from-orange-500/20 to-orange-600/20"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Entity Distribution */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-6 rounded-xl bg-slate-800/50 border border-slate-700"
          >
            <h3 className="text-lg font-bold text-white mb-4">Entity Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChartRechart>
                <Pie
                  data={entityDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {entityDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                  }}
                />
              </PieChartRechart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-4">
              {entityDistribution.map((entry, idx) => (
                <div key={idx} className="text-center">
                  <div
                    className="w-3 h-3 rounded-full mx-auto mb-2"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <div className="text-sm text-slate-300">{entry.name}</div>
                  <div className="text-lg font-bold text-white">{entry.value}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Activity Overview */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-6 rounded-xl bg-slate-800/50 border border-slate-700"
          >
            <h3 className="text-lg font-bold text-white mb-4">Activity Overview</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={activityOverview}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="value" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Critical Alerts */}
        {alerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-xl bg-red-500/10 border border-red-500/30"
          >
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Critical Alerts
            </h3>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-4 bg-slate-800/50 rounded-lg">
                  <p className="text-white font-semibold">{alert.title}</p>
                  <p className="text-slate-300 text-sm mt-1">{alert.message}</p>
                  <p className="text-slate-500 text-xs mt-2">{new Date(alert.timestamp).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminDashboardPage
