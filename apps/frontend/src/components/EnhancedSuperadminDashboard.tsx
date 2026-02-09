import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart3, Building2, Users, AlertTriangle, Settings, LogOut, Menu, X,
  TrendingUp, Activity, Shield, Clock, CheckCircle, PieChart, FileText,
  Home, Bell, Plus, Edit, Trash2, Lock, Unlock
} from 'lucide-react'
import axios from 'axios'
import { ResponsiveContainer, BarChart, PieChart as PieChartRechart, Bar, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from 'recharts'

interface User {
  id: string
  email: string
  name?: string
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

const EnhancedSuperadminDashboard: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analytics' | 'entities' | 'admins' | 'tenants' | 'audit' | 'settings'>('dashboard')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats>({
    total_schools: 0,
    active_schools: 0,
    total_corporates: 0,
    active_corporates: 0,
    total_users: 0,
    active_users: 0,
    pending_school_approvals: 0,
    pending_corporate_approvals: 0
  })
  const [entities, setEntities] = useState<{ schools: Entity[]; corporates: Entity[] }>({ schools: [], corporates: [] })
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showTenantForm, setShowTenantForm] = useState(false)
  const [showAdminForm, setShowAdminForm] = useState(false)
  const [auditLogs, setAuditLogs] = useState<any[]>([])

  useEffect(() => {
    loadDashboardData()
    // Get current user from token
    const token = localStorage.getItem('accessToken')
    if (token) {
      try {
        const decoded = JSON.parse(atob(token.split('.')[1]))
        setCurrentUser({ id: decoded.userId, email: decoded.email })
      } catch (e) {
        console.log('Failed to decode token')
      }
    }
  }, [])

  const loadDashboardData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/auth/superadmin/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      const data = response.data.data
      setStats(data.stats || {
        total_schools: 0,
        active_schools: 0,
        total_corporates: 0,
        active_corporates: 0,
        total_users: 0,
        active_users: 0,
        pending_school_approvals: 0,
        pending_corporate_approvals: 0
      })
      setEntities(data.entities || { schools: [], corporates: [] })
      
      // Generate alerts with null checks
      const newAlerts: Alert[] = []
      const totalPending = (data.stats?.pending_school_approvals || 0) + (data.stats?.pending_corporate_approvals || 0)
      if (totalPending > 5) {
        newAlerts.push({
          id: 'approvals',
          type: 'warning',
          title: 'Pending Approvals',
          message: `${totalPending} approvals awaiting review`,
          timestamp: new Date()
        })
      }
      setAlerts(newAlerts)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
      // Set default values on error
      setStats({
        total_schools: 0,
        active_schools: 0,
        total_corporates: 0,
        active_corporates: 0,
        total_users: 0,
        active_users: 0,
        pending_school_approvals: 0,
        pending_corporate_approvals: 0
      })
    } finally {
      setLoading(false)
    }
  }

  const loadAuditLogs = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/superadmin/audit-logs?limit=50', {
        headers: { Authorization: `Bearer ${token}` }
      })
      setAuditLogs(response.data.logs || [])
    } catch (error) {
      console.error('Failed to load audit logs:', error)
      setAuditLogs([])
    }
  }

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditLogs()
    }
  }, [activeTab])

  const handleLogout = () => {
    localStorage.removeItem('accessToken')
    window.location.href = '/login'
  }

  const SIDEBAR_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, color: 'from-blue-500 to-blue-600' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, color: 'from-purple-500 to-purple-600' },
    { id: 'entities', label: 'Entities', icon: Building2, color: 'from-green-500 to-green-600' },
    { id: 'tenants', label: 'Manage Tenants', icon: Building2, color: 'from-indigo-500 to-indigo-600' },
    { id: 'admins', label: 'Admin Management', icon: Users, color: 'from-orange-500 to-orange-600' },
    { id: 'audit', label: 'Audit Logs', icon: FileText, color: 'from-cyan-500 to-cyan-600' },
    { id: 'settings', label: 'Settings', icon: Settings, color: 'from-red-500 to-red-600' },
  ]

  const chartColors = ['#0ea5e9', '#06b6d4', '#14b8a6', '#8b5cf6']

  const totalTenants = (stats?.total_schools || 0) + (stats?.total_corporates || 0)
  const activeTenants = (stats?.active_schools || 0) + (stats?.active_corporates || 0)

  return (
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <motion.div
        initial={{ x: -300 }}
        animate={{ x: sidebarOpen ? 0 : -300 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`w-72 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-r border-slate-700 shadow-2xl overflow-y-auto fixed lg:static h-full z-40 lg:z-auto`}
      >
        {/* Logo Section */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <img src="/logos/platform-logo.png" alt="SmartAttend" className="w-10 h-10 rounded-lg object-cover" onError={(e) => {
              e.currentTarget.style.display = 'none'
              const fallback = e.currentTarget.nextElementSibling as HTMLElement
              if (fallback) {
                fallback.classList.remove('hidden')
                fallback.classList.add('flex', 'items-center', 'justify-center')
              }
            }} />
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 items-center justify-center hidden">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">SmartAttend</h1>
              <p className="text-xs text-slate-400">Superadmin Console</p>
            </div>
          </div>
        </div>

        {/* User Profile */}
        {currentUser && (
          <div className="p-4 m-4 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Logged in as</p>
            <p className="text-sm font-semibold text-white truncate">{currentUser.email}</p>
            <p className="text-xs text-blue-400 mt-1">👤 Superadmin</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any)
                setSidebarOpen(false)
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                activeTab === item.id
                  ? `bg-gradient-to-r ${item.color} text-white shadow-lg`
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">{item.label}</span>
              {activeTab === item.id && (
                <motion.div
                  layoutId="activeIndicator"
                  className="ml-auto w-2 h-2 rounded-full bg-white"
                />
              )}
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="absolute bottom-6 left-4 right-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-slate-900 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
              {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <h2 className="text-2xl font-bold text-white">
              {SIDEBAR_ITEMS.find(item => item.id === activeTab)?.label || 'Dashboard'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors relative">
              <Bell className="w-6 h-6 text-slate-300" />
              {alerts.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          <div className="p-6 max-w-7xl mx-auto">
            <AnimatePresence mode="wait">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full"
                  />
                </div>
              ) : (
                <>
                  {/* Dashboard Tab */}
                  {activeTab === 'dashboard' && (
                    <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      {/* Alerts */}
                      {alerts.length > 0 && (
                        <div className="grid gap-3">
                          {alerts.map(alert => (
                            <div key={alert.id} className="p-4 rounded-lg bg-amber-900/20 border border-amber-700/50 flex items-start gap-3">
                              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="font-semibold text-white">{alert.title}</p>
                                <p className="text-sm text-slate-300">{alert.message}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* KPI Cards */}
                      {stats && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          {[
                            { label: 'Total Tenants', value: totalTenants || 0, icon: Building2, color: 'blue' },
                            { label: 'Active Tenants', value: activeTenants || 0, icon: CheckCircle, color: 'green' },
                            { label: 'Total Users', value: stats.total_users || 0, icon: Users, color: 'cyan' },
                            { label: 'Pending Approvals', value: (stats.pending_school_approvals || 0) + (stats.pending_corporate_approvals || 0), icon: Clock, color: 'amber' },
                          ].map((kpi, idx) => (
                            <motion.div
                              key={idx}
                              whileHover={{ scale: 1.05, translateY: -5 }}
                              className={`p-6 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-${kpi.color}-500/20 shadow-lg group cursor-pointer overflow-hidden`}
                            >
                              <div className="relative z-10">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">{kpi.label}</p>
                                  <kpi.icon className={`w-5 h-5 text-${kpi.color}-400`} />
                                </div>
                                <p className="text-3xl font-bold text-white mb-2">{String(kpi.value || 0)}</p>
                                <div className={`flex items-center gap-2 text-${kpi.color}-400 text-sm`}>
                                  <TrendingUp className="w-4 h-4" />
                                  <span>+12% from last week</span>
                                </div>
                              </div>
                              <div className={`absolute inset-0 bg-gradient-to-br from-${kpi.color}-500 to-transparent opacity-0 group-hover:opacity-10 transition-opacity`} />
                            </motion.div>
                          ))}
                        </div>
                      )}

                      {/* Charts Row */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Entity Distribution */}
                        {stats && (
                          <motion.div whileHover={{ scale: 1.02 }} className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 shadow-lg">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                              <PieChart className="w-5 h-5" />
                              Entity Distribution
                            </h3>
                            <ResponsiveContainer width="100%" height={300}>
                              <PieChartRechart>
                                <Pie
                                  data={[
                                    { name: 'Schools', value: stats.total_schools },
                                    { name: 'Corporates', value: stats.total_corporates }
                                  ]}
                                  cx="50%"
                                  cy="50%"
                                  outerRadius={80}
                                  dataKey="value"
                                  label={{ fill: '#94a3b8' }}
                                >
                                  {[0, 1].map((idx) => (
                                    <Cell key={`cell-${idx}`} fill={chartColors[idx]} />
                                  ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                              </PieChartRechart>
                            </ResponsiveContainer>
                          </motion.div>
                        )}

                        {/* Activity Overview */}
                        {stats && (
                          <motion.div whileHover={{ scale: 1.02 }} className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 shadow-lg">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                              <Activity className="w-5 h-5" />
                              Activity Overview
                            </h3>
                            <ResponsiveContainer width="100%" height={300}>
                              <BarChart data={[
                                { name: 'Active', value: stats.active_users },
                                { name: 'Inactive', value: stats.total_users - stats.active_users }
                              ]}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(71, 85, 105, 0.2)" />
                                <XAxis dataKey="name" stroke="#94a3b8" />
                                <YAxis stroke="#94a3b8" />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                                <Bar dataKey="value" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Analytics Tab */}
                  {activeTab === 'analytics' && (
                    <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 p-6 rounded-xl bg-slate-800/50 border border-slate-700 shadow-lg">
                          <h3 className="text-lg font-bold text-white mb-4">User Growth Trend</h3>
                          <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={Array.from({ length: 30 }, (_, i) => ({
                              date: `Day ${i + 1}`,
                              users: Math.floor(Math.random() * 200) + 800
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(71, 85, 105, 0.2)" />
                              <XAxis dataKey="date" stroke="#94a3b8" />
                              <YAxis stroke="#94a3b8" />
                              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                              <Line type="monotone" dataKey="users" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-3">
                          <div className="p-4 rounded-xl bg-red-900/20 border border-red-700/50">
                            <p className="text-xs text-red-300 uppercase tracking-wider mb-1">Critical Issues</p>
                            <p className="text-2xl font-bold text-red-400">3</p>
                          </div>
                          <div className="p-4 rounded-xl bg-amber-900/20 border border-amber-700/50">
                            <p className="text-xs text-amber-300 uppercase tracking-wider mb-1">Warnings</p>
                            <p className="text-2xl font-bold text-amber-400">12</p>
                          </div>
                          <div className="p-4 rounded-xl bg-green-900/20 border border-green-700/50">
                            <p className="text-xs text-green-300 uppercase tracking-wider mb-1">Healthy Systems</p>
                            <p className="text-2xl font-bold text-green-400">98%</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Entities Tab */}
                  {activeTab === 'entities' && (
                    <motion.div key="entities" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Schools */}
                        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 shadow-lg">
                          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-blue-400" />
                            Schools
                          </h3>
                          <div className="space-y-2">
                            {entities.schools.slice(0, 5).map((school) => (
                              <div key={school.id} className="p-3 rounded-lg bg-slate-700/50 border border-slate-600 hover:border-blue-500/50 transition-colors">
                                <p className="font-semibold text-white">{school.name}</p>
                                <p className="text-xs text-slate-400">{school.user_count} users</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Corporates */}
                        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 shadow-lg">
                          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-green-400" />
                            Corporates
                          </h3>
                          <div className="space-y-2">
                            {entities.corporates.slice(0, 5).map((corp) => (
                              <div key={corp.id} className="p-3 rounded-lg bg-slate-700/50 border border-slate-600 hover:border-green-500/50 transition-colors">
                                <p className="font-semibold text-white">{corp.name}</p>
                                <p className="text-xs text-slate-400">{corp.user_count} users</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Admin Management Tab */}
                  {activeTab === 'admins' && (
                    <motion.div key="admins" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-white">Tenant Admin Management</h3>
                        <button
                          onClick={() => setShowAdminForm(!showAdminForm)}
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:shadow-lg transition-all hover:scale-105"
                        >
                          <Plus className="w-5 h-5" />
                          Add New Admin
                        </button>
                      </div>

                      <AnimatePresence>
                        {showAdminForm && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6">
                            <div className="p-6 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 shadow-xl">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-white">Create New Tenant Admin</h3>
                                <button onClick={() => setShowAdminForm(false)} className="p-2 hover:bg-slate-700 rounded-lg">
                                  <X className="w-5 h-5 text-slate-400" />
                                </button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input placeholder="Full Name" className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500" />
                                <input placeholder="Email" type="email" className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500" />
                                <select className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white">
                                  <option>-- Select Tenant --</option>
                                </select>
                                <input placeholder="Password" type="password" className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500" />
                              </div>
                              <div className="flex gap-3 mt-4">
                                <button onClick={() => setShowAdminForm(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50">
                                  Cancel
                                </button>
                                <button className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                                  Create Admin
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Admin cards placeholder */}
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
                            <p className="font-semibold text-white mb-2">Admin {i}</p>
                            <p className="text-xs text-slate-400 mb-3">admin{i}@school.local</p>
                            <button className="text-xs px-3 py-1 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 transition-colors">
                              View Details
                            </button>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Tenant Management Tab */}
                  {activeTab === 'tenants' && (
                    <motion.div key="tenants" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-white">Manage Tenants</h3>
                        <button
                          onClick={() => setShowTenantForm(!showTenantForm)}
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:shadow-lg transition-all hover:scale-105"
                        >
                          <Plus className="w-5 h-5" />
                          Add Tenant
                        </button>
                      </div>

                      <AnimatePresence>
                        {showTenantForm && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6">
                            <div className="p-6 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 shadow-xl">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-white">Add/Edit Tenant</h3>
                                <button onClick={() => setShowTenantForm(false)} className="p-2 hover:bg-slate-700 rounded-lg">
                                  <X className="w-5 h-5 text-slate-400" />
                                </button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input placeholder="Tenant Name" className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500" />
                                <input placeholder="Tenant Code" className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500" />
                                <input placeholder="Email" type="email" className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500" />
                                <select className="px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-white">
                                  <option>Type: School</option>
                                  <option>Type: Corporate</option>
                                </select>
                              </div>
                              <div className="flex gap-3 mt-4">
                                <button onClick={() => setShowTenantForm(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50">
                                  Cancel
                                </button>
                                <button className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                                  Save Tenant
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="grid grid-cols-1 gap-4">
                        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-blue-400" />
                            Schools
                          </h4>
                          <div className="space-y-2">
                            {entities.schools.slice(0, 10).map((school) => (
                              <div key={school.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50 border border-slate-600 hover:border-blue-500/50 transition-colors">
                                <div className="flex-1">
                                  <p className="font-semibold text-white">{school.name}</p>
                                  <p className="text-xs text-slate-400">{school.user_count} users • {school.code}</p>
                                </div>
                                <div className="flex gap-2">
                                  <button className="p-2 hover:bg-slate-600 rounded text-slate-400 hover:text-white transition-colors">
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button className="p-2 hover:bg-slate-600 rounded text-slate-400 hover:text-white transition-colors">
                                    {school.is_active ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                  </button>
                                  <button className="p-2 hover:bg-red-600/20 rounded text-slate-400 hover:text-red-400 transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-green-400" />
                            Corporates
                          </h4>
                          <div className="space-y-2">
                            {entities.corporates.slice(0, 10).map((corp) => (
                              <div key={corp.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50 border border-slate-600 hover:border-green-500/50 transition-colors">
                                <div className="flex-1">
                                  <p className="font-semibold text-white">{corp.name}</p>
                                  <p className="text-xs text-slate-400">{corp.user_count} users • {corp.code}</p>
                                </div>
                                <div className="flex gap-2">
                                  <button className="p-2 hover:bg-slate-600 rounded text-slate-400 hover:text-white transition-colors">
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button className="p-2 hover:bg-slate-600 rounded text-slate-400 hover:text-white transition-colors">
                                    {corp.is_active ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                  </button>
                                  <button className="p-2 hover:bg-red-600/20 rounded text-slate-400 hover:text-red-400 transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Audit Logs Tab */}
                  {activeTab === 'audit' && (
                    <motion.div key="audit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                          <FileText className="w-5 h-5" />
                          System Audit Logs
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-700">
                                <th className="px-4 py-3 text-left text-slate-400 font-semibold">Timestamp</th>
                                <th className="px-4 py-3 text-left text-slate-400 font-semibold">Action</th>
                                <th className="px-4 py-3 text-left text-slate-400 font-semibold">User</th>
                                <th className="px-4 py-3 text-left text-slate-400 font-semibold">IP Address</th>
                                <th className="px-4 py-3 text-left text-slate-400 font-semibold">Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditLogs.length > 0 ? (
                                auditLogs.slice(0, 20).map((log, idx) => (
                                  <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                                    <td className="px-4 py-3 text-slate-300">{new Date(log.timestamp || log.created_at).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-slate-300">{log.action}</td>
                                    <td className="px-4 py-3 text-slate-300">{log.user_email || 'System'}</td>
                                    <td className="px-4 py-3 text-slate-300 text-xs">{log.ip_address || '-'}</td>
                                    <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">{JSON.stringify(log.details || {})}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                                    No audit logs available
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Settings Tab */}
                  {activeTab === 'settings' && (
                    <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 shadow-lg">
                        <h3 className="text-lg font-bold text-white mb-4">System Settings</h3>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-700/50 transition-colors">
                            <div>
                              <p className="font-semibold text-white">Enable 2FA for Admins</p>
                              <p className="text-xs text-slate-400">Require two-factor authentication</p>
                            </div>
                            <input type="checkbox" className="w-5 h-5 rounded" defaultChecked />
                          </div>
                          <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-700/50 transition-colors">
                            <div>
                              <p className="font-semibold text-white">Audit Logging</p>
                              <p className="text-xs text-slate-400">Log all administrative actions</p>
                            </div>
                            <input type="checkbox" className="w-5 h-5 rounded" defaultChecked />
                          </div>
                          <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-700/50 transition-colors">
                            <div>
                              <p className="font-semibold text-white">Backup Policy</p>
                              <p className="text-xs text-slate-400">Daily automatic backups</p>
                            </div>
                            <select className="px-3 py-1 rounded bg-slate-700 text-white text-sm border border-slate-600">
                              <option>Daily</option>
                              <option>Hourly</option>
                              <option>Weekly</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 lg:hidden z-30"
        />
      )}
    </div>
  )
}

export default EnhancedSuperadminDashboard
