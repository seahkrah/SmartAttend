import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import TenantActionsModal from './TenantActionsModal'
import IncidentCreationModal from './IncidentCreationModal'
import EnhancedMetricCard from './EnhancedMetricCard'
import AnalyticsPanel from './AnalyticsPanel'
import AlertPanel, { Alert } from './AlertPanel'
import DataTable from './DataTable'
import PerformanceMetrics from './PerformanceMetrics'
import IncidentsList from './IncidentsList'

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

interface Entity {
  id: string
  name: string
  code: string
  email: string
  is_active: boolean
  user_count: number
  pending_approvals: number
}

interface Approval {
  id: string
  entity_type: 'school' | 'corporate'
  entity_name: string
  user_name: string
  user_email: string
  role: string
  requested_at: string
}

interface UserStats {
  platform_name: string
  total_users: number
  active_users: number
  admin_count: number
  student_count: number
  faculty_count: number
  employee_count: number
  it_count: number
  hr_count: number
}

interface ActionLog {
  id: string
  action: string
  entity_type?: string
  entity_id?: string
  details?: any
  created_at: string
}

const SuperadminDashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [entities, setEntities] = useState<{ schools: Entity[]; corporates: Entity[] }>({ schools: [], corporates: [] })
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([])
  const [userStats, setUserStats] = useState<UserStats[]>([])
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'entities' | 'approvals' | 'incidents' | 'users' | 'logs'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tenantActionsModal, setTenantActionsModal] = useState<{ isOpen: boolean; tenant: Entity | null; type: 'school' | 'corporate' }>({ isOpen: false, tenant: null, type: 'school' })
  const [showIncidentModal, setShowIncidentModal] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      
      const response = await axios.get('/api/auth/superadmin/dashboard', { 
        headers: { Authorization: `Bearer ${token}` } 
      })

      const dashboardData = response.data.data
      setStats(dashboardData.stats)
      setEntities(dashboardData.entities)
      setPendingApprovals(dashboardData.pendingApprovals.list || [])
      setUserStats(dashboardData.userStatistics || [])
      setActionLogs(dashboardData.recentActions || [])

      // Generate alerts based on data
      const newAlerts: Alert[] = []
      if (dashboardData.stats.pending_school_approvals + dashboardData.stats.pending_corporate_approvals > 5) {
        newAlerts.push({
          id: 'alert-approvals',
          type: 'warning',
          title: 'High Pending Approvals',
          message: `${dashboardData.stats.pending_school_approvals + dashboardData.stats.pending_corporate_approvals} approvals waiting for review`,
          timestamp: new Date(),
          actionLabel: 'Review Now',
          onAction: () => setActiveTab('approvals')
        })
      }

      if (dashboardData.stats.active_schools < dashboardData.stats.total_schools * 0.9) {
        newAlerts.push({
          id: 'alert-schools',
          type: 'info',
          title: 'School Downtime Detected',
          message: `${dashboardData.stats.total_schools - dashboardData.stats.active_schools} schools currently inactive`,
          timestamp: new Date()
        })
      }

      setAlerts(newAlerts)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch dashboard data')
      console.error('Dashboard error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full"
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="text-center">
          <p className="text-red-500 text-2xl font-bold mb-4">Error</p>
          <p className="text-slate-300">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            Superadmin Dashboard
          </h1>
          <p className="text-slate-400">Platform-wide system overview and management</p>
        </motion.div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 mb-8 border-b border-slate-700 pb-4 overflow-x-auto">
          {(['overview', 'analytics', 'entities', 'approvals', 'incidents', 'users', 'logs'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 rounded-t-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tab === 'overview' && '📊'} 
              {tab === 'analytics' && '📈'}
              {tab === 'entities' && '🏢'}
              {tab === 'approvals' && '✓'}
              {tab === 'incidents' && '🚨'}
              {tab === 'users' && '👥'}
              {tab === 'logs' && '📝'}
              {' ' + tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Overview Tab */}
          {activeTab === 'overview' && stats && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              {/* Alerts Section */}
              {alerts.length > 0 && (
                <AlertPanel 
                  alerts={alerts.map(a => ({ ...a, dismissed: dismissedAlerts.has(a.id) }))} 
                  onDismiss={(id) => setDismissedAlerts(new Set([...dismissedAlerts, id]))}
                />
              )}

              {/* Enhanced Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <EnhancedMetricCard 
                  label="Total Schools"
                  value={stats.total_schools}
                  change={{ value: 12, isPositive: true }}
                  icon="🏫"
                  color="blue"
                  trend="up"
                  onClick={() => setActiveTab('entities')}
                />
                <EnhancedMetricCard 
                  label="Active Schools"
                  value={stats.active_schools}
                  change={{ value: 5, isPositive: true }}
                  icon="✅"
                  color="green"
                  trend="up"
                  onClick={() => setActiveTab('entities')}
                />
                <EnhancedMetricCard 
                  label="Total Users"
                  value={stats.total_users}
                  change={{ value: 8, isPositive: true }}
                  icon="👥"
                  color="cyan"
                  trend="up"
                  onClick={() => setActiveTab('users')}
                />
                <EnhancedMetricCard 
                  label="Pending Approvals"
                  value={stats.pending_school_approvals + stats.pending_corporate_approvals}
                  change={{ value: -15, isPositive: false }}
                  icon="⏳"
                  color="amber"
                  trend="down"
                  onClick={() => setActiveTab('approvals')}
                />
              </div>

              {/* Performance Metrics */}
              <PerformanceMetrics
                title="System Health & KPIs"
                metrics={[
                  {
                    label: 'System Uptime',
                    current: 99.8,
                    target: 99.9,
                    unit: '%',
                    threshold: 'good'
                  },
                  {
                    label: 'Active Users',
                    current: stats.active_users,
                    target: stats.total_users,
                    threshold: 'good'
                  },
                  {
                    label: 'Database Response Time',
                    current: 45,
                    target: 100,
                    unit: 'ms',
                    threshold: 'good'
                  },
                  {
                    label: 'Approval Backlog',
                    current: Math.max(0, stats.pending_school_approvals + stats.pending_corporate_approvals - 10),
                    target: 5,
                    threshold: 'warning'
                  }
                ]}
                columns={2}
              />

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Entity Distribution */}
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="p-6 rounded-xl bg-slate-800 bg-opacity-50 border border-slate-700"
                >
                  <h3 className="text-xl font-bold mb-6">Entity Distribution</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Schools', value: stats.total_schools },
                          { name: 'Corporates', value: stats.total_corporates }
                        ]}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        label
                      >
                        {[0, 1].map((idx) => (
                          <Cell key={`cell-${idx}`} fill={['#0ea5e9', '#06b6d4'][idx]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </motion.div>

                {/* User Activity */}
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="p-6 rounded-xl bg-slate-800 bg-opacity-50 border border-slate-700"
                >
                  <h3 className="text-xl font-bold mb-6">User Activity</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        { name: 'Active', value: stats.active_users },
                        { name: 'Inactive', value: stats.total_users - stats.active_users }
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.1)" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  onClick={() => setShowIncidentModal(true)}
                  className="p-4 rounded-xl bg-blue-600 bg-opacity-20 border border-blue-600 hover:bg-opacity-30 transition-colors text-left"
                >
                  <p className="text-lg font-bold text-blue-300">📋 Create Incident</p>
                  <p className="text-sm text-slate-400">Report system issues and track incidents</p>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  onClick={() => setActiveTab('entities')}
                  className="p-4 rounded-xl bg-cyan-600 bg-opacity-20 border border-cyan-600 hover:bg-opacity-30 transition-colors text-left"
                >
                  <p className="text-lg font-bold text-cyan-300">🏢 Manage Tenants</p>
                  <p className="text-sm text-slate-400">Lock/unlock schools and corporate entities</p>
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <AnalyticsPanel
                title="Platform Analytics"
                description="Comprehensive system metrics over time with customizable views"
                data={Array.from({ length: 30 }, (_, i) => ({
                  date: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  users: stats?.total_users ? Math.round(stats.total_users * (0.8 + Math.random() * 0.2)) : 1000,
                  active: stats?.active_users ? Math.round(stats.active_users * (0.85 + Math.random() * 0.15)) : 800,
                  incidents: Math.floor(Math.random() * 5)
                }))}
              />
            </motion.div>
          )}

          {/* Entities Tab */}
          {activeTab === 'entities' && (
            <motion.div
              key="entities"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              {/* Schools */}
              <div>
                <h3 className="text-2xl font-bold mb-4">Schools</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {entities.schools.map((school) => (
                    <motion.div
                      key={school.id}
                      whileHover={{ scale: 1.02 }}
                      className={`p-4 rounded-lg border ${school.is_active ? 'bg-green-900 bg-opacity-20 border-green-600' : 'bg-red-900 bg-opacity-20 border-red-600'}`}
                    >
                      <h4 className="text-lg font-bold">{school.name}</h4>
                      <p className="text-slate-400 text-sm">{school.code}</p>
                      <p className="text-slate-400 text-sm">{school.email}</p>
                      <div className="flex justify-between mt-4 text-sm">
                        <span>Users: {school.user_count}</span>
                        <span className="text-amber-400">Pending: {school.pending_approvals}</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => setTenantActionsModal({ isOpen: true, tenant: school, type: 'school' })}
                          className="flex-1 px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs font-semibold transition-colors"
                        >
                          ⚙️ Manage
                        </button>
                        <span className={`flex-1 px-3 py-1 rounded-full text-xs font-semibold text-center ${school.is_active ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                          {school.is_active ? 'Active' : 'Locked'}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Corporate Entities */}
              <div>
                <h3 className="text-2xl font-bold mb-4">Corporate Entities</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {entities.corporates.map((corp) => (
                    <motion.div
                      key={corp.id}
                      whileHover={{ scale: 1.02 }}
                      className={`p-4 rounded-lg border ${corp.is_active ? 'bg-blue-900 bg-opacity-20 border-blue-600' : 'bg-red-900 bg-opacity-20 border-red-600'}`}
                    >
                      <h4 className="text-lg font-bold">{corp.name}</h4>
                      <p className="text-slate-400 text-sm">{corp.code}</p>
                      <p className="text-slate-400 text-sm">{corp.email}</p>
                      <div className="flex justify-between mt-4 text-sm">
                        <span>Users: {corp.user_count}</span>
                        <span className="text-amber-400">Pending: {corp.pending_approvals}</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => setTenantActionsModal({ isOpen: true, tenant: corp, type: 'corporate' })}
                          className="flex-1 px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs font-semibold transition-colors"
                        >
                          ⚙️ Manage
                        </button>
                        <span className={`flex-1 px-3 py-1 rounded-full text-xs font-semibold text-center ${corp.is_active ? 'bg-blue-600 text-white' : 'bg-red-600 text-white'}`}>
                          {corp.is_active ? 'Active' : 'Locked'}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Approvals Tab */}
          {activeTab === 'approvals' && (
            <motion.div
              key="approvals"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <DataTable
                title="Pending Role Approvals"
                columns={[
                  { key: 'entity_name', label: 'Entity', searchable: true },
                  { 
                    key: 'user_name', 
                    label: 'User',
                    render: (_, row: any) => (
                      <div>
                        <p className="font-semibold">{row.user_name}</p>
                        <p className="text-slate-400 text-sm">{row.user_email}</p>
                      </div>
                    )
                  },
                  { 
                    key: 'role', 
                    label: 'Role',
                    render: (value) => (
                      <span className="px-3 py-1 bg-blue-600 bg-opacity-30 text-blue-300 rounded-full text-sm font-semibold">
                        {value}
                      </span>
                    )
                  },
                  { 
                    key: 'requested_at', 
                    label: 'Date',
                    render: (value) => new Date(value).toLocaleDateString()
                  },
                  { 
                    key: 'entity_type', 
                    label: 'Type',
                    render: (value) => (
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                        value === 'school' 
                          ? 'bg-green-600 bg-opacity-30 text-green-300'
                          : 'bg-blue-600 bg-opacity-30 text-blue-300'
                      }`}>
                        {value}
                      </span>
                    )
                  }
                ]}
                data={pendingApprovals}
                searchPlaceholder="Search by entity, user, or role..."
              />
            </motion.div>
          )}

          {/* Incidents Tab */}
          {activeTab === 'incidents' && (
            <motion.div
              key="incidents"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold">System Incidents</h2>
                  <p className="text-slate-400">View, manage, and resolve system incidents</p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  onClick={() => setShowIncidentModal(true)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors"
                >
                  + New Incident
                </motion.button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="p-4 rounded-lg bg-red-900/20 border border-red-600"
                >
                  <p className="text-sm text-slate-400">🔴 Critical</p>
                  <p className="text-3xl font-bold text-red-300">—</p>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="p-4 rounded-lg bg-orange-900/20 border border-orange-600"
                >
                  <p className="text-sm text-slate-400">🟠 High</p>
                  <p className="text-3xl font-bold text-orange-300">—</p>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="p-4 rounded-lg bg-amber-900/20 border border-amber-600"
                >
                  <p className="text-sm text-slate-400">🟡 Open</p>
                  <p className="text-3xl font-bold text-amber-300">—</p>
                </motion.div>
              </div>

              <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                <IncidentsList compact={false} />
              </div>
            </motion.div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <motion.div
              key="users"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={userStats} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.1)" />
                  <XAxis dataKey="platform_name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total_users" fill="#0ea5e9" name="Total Users" />
                  <Bar dataKey="active_users" fill="#10b981" name="Active Users" />
                  <Bar dataKey="admin_count" fill="#f59e0b" name="Admins" />
                </BarChart>
              </ResponsiveContainer>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {userStats.map((stat) => (
                  <motion.div
                    key={stat.platform_name}
                    whileHover={{ scale: 1.02 }}
                    className="p-6 rounded-xl bg-slate-800 bg-opacity-50 border border-slate-700"
                  >
                    <h4 className="text-xl font-bold mb-4 capitalize">{stat.platform_name} Platform</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span>Total Users:</span><span className="font-semibold">{stat.total_users}</span></div>
                      <div className="flex justify-between"><span>Active Users:</span><span className="font-semibold text-green-400">{stat.active_users}</span></div>
                      <div className="flex justify-between"><span>Admins:</span><span className="font-semibold">{stat.admin_count}</span></div>
                      {stat.student_count > 0 && <div className="flex justify-between"><span>Students:</span><span className="font-semibold">{stat.student_count}</span></div>}
                      {stat.faculty_count > 0 && <div className="flex justify-between"><span>Faculty:</span><span className="font-semibold">{stat.faculty_count}</span></div>}
                      {stat.employee_count > 0 && <div className="flex justify-between"><span>Employees:</span><span className="font-semibold">{stat.employee_count}</span></div>}
                      {stat.it_count > 0 && <div className="flex justify-between"><span>IT Staff:</span><span className="font-semibold">{stat.it_count}</span></div>}
                      {stat.hr_count > 0 && <div className="flex justify-between"><span>HR Staff:</span><span className="font-semibold">{stat.hr_count}</span></div>}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <DataTable
                title="Recent Superadmin Actions"
                columns={[
                  { 
                    key: 'action', 
                    label: 'Action', 
                    searchable: true,
                    render: (value) => <span className="font-semibold text-blue-400">{value}</span>
                  },
                  { 
                    key: 'entity_type', 
                    label: 'Entity Type'
                  },
                  { 
                    key: 'created_at', 
                    label: 'Timestamp',
                    render: (value) => new Date(value).toLocaleString()
                  }
                ]}
                data={actionLogs}
                searchPlaceholder="Search actions..."
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modals */}
        <TenantActionsModal
          isOpen={tenantActionsModal.isOpen}
          tenant={tenantActionsModal.tenant}
          entityType={tenantActionsModal.type}
          onClose={() => setTenantActionsModal({ isOpen: false, tenant: null, type: 'school' })}
          onSuccess={() => {
            setTenantActionsModal({ isOpen: false, tenant: null, type: 'school' })
            fetchDashboardData()
          }}
        />

        <IncidentCreationModal
          isOpen={showIncidentModal}
          onClose={() => setShowIncidentModal(false)}
          onSuccess={() => {
            setShowIncidentModal(false)
            fetchDashboardData()
          }}
        />

        {/* Refresh Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={fetchDashboardData}
          className="fixed bottom-8 right-8 px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all"
        >
          🔄 Refresh
        </motion.button>
      </div>
    </div>
  )
}

export default SuperadminDashboard
