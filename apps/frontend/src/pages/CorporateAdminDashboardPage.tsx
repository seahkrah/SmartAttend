/**
 * Corporate Admin Dashboard Page
 * 
 * Main dashboard for corporate tenant admins with overview stats,
 * quick actions, and recent activity
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  Users,
  Building2,
  ClipboardCheck,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  FolderTree,
  BarChart3,
  MapPin,
} from 'lucide-react'
import axios from 'axios'

interface DashboardData {
  entity: { id: string; name: string; code: string; industry: string }
  stats: {
    totalUsers: number
    activeUsers: number
    totalEmployees: number
    activeEmployees: number
    departments: number
    pendingApprovals: number
    todayCheckins: number
    completedCheckouts: number
    attendanceRate: number
  }
  recentCheckins: Array<{
    id: string
    check_in_time: string
    check_out_time: string | null
    check_in_type: string
    face_verified: boolean
    first_name: string
    last_name: string
    emp_code: string
    department_name: string | null
  }>
}

export const CorporateAdminDashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/corporate/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      })
      setData(response.data)
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const stats = data?.stats || {
    totalUsers: 0, activeUsers: 0, totalEmployees: 0, activeEmployees: 0,
    departments: 0, pendingApprovals: 0, todayCheckins: 0, completedCheckouts: 0, attendanceRate: 0,
  }

  const StatCard: React.FC<{
    label: string; value: string | number; icon: React.ReactNode; color: string
  }> = ({ label, value, icon, color }) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${color}`}>{icon}</div>
      </div>
      <p className="text-3xl font-bold text-white mb-1">{value}</p>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  )

  const QuickAction: React.FC<{
    label: string; description: string; icon: React.ReactNode; onClick: () => void; color: string
  }> = ({ label, description, icon, onClick, color }) => (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-4 bg-slate-800/30 border border-slate-700 rounded-xl hover:bg-slate-800/50 hover:border-slate-600 transition-all group text-left w-full"
    >
      <div className={`p-3 rounded-lg ${color}`}>{icon}</div>
      <div className="flex-1">
        <p className="font-medium text-white">{label}</p>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
      <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
    </button>
  )

  if (loading) {
    return (
      <TenantAdminLayout currentPage="dashboard" platform="corporate">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
        </div>
      </TenantAdminLayout>
    )
  }

  return (
    <TenantAdminLayout currentPage="dashboard" platform="corporate">
      <div className="space-y-8">
        {/* Welcome Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {data?.entity?.name || 'Welcome back!'}
            </h1>
            <p className="text-slate-400 mt-1">
              Here's your organization's overview for today
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 rounded-lg">
            <Building2 className="w-5 h-5 text-indigo-400" />
            <span className="text-indigo-400 font-medium">
              {data?.entity?.code || 'Corporate'}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Total Employees"
            value={stats.totalEmployees || stats.totalUsers}
            icon={<Users className="w-6 h-6 text-white" />}
            color="bg-indigo-500"
          />
          <StatCard
            label="Departments"
            value={stats.departments}
            icon={<FolderTree className="w-6 h-6 text-white" />}
            color="bg-teal-500"
          />
          <StatCard
            label="Pending Approvals"
            value={stats.pendingApprovals}
            icon={<ClipboardCheck className="w-6 h-6 text-white" />}
            color="bg-orange-500"
          />
          <StatCard
            label="Attendance Rate"
            value={`${stats.attendanceRate}%`}
            icon={<TrendingUp className="w-6 h-6 text-white" />}
            color="bg-violet-500"
          />
        </div>

        {/* Quick Actions & Recent Check-ins */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Quick Actions */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <QuickAction
                label="Manage Employees"
                description={`${stats.totalEmployees || stats.activeUsers} employee(s) in your organization`}
                icon={<Users className="w-5 h-5 text-white" />}
                color="bg-indigo-500"
                onClick={() => navigate('/admin/corporate/employees')}
              />
              <QuickAction
                label="Departments"
                description={`${stats.departments} department(s) configured`}
                icon={<FolderTree className="w-5 h-5 text-white" />}
                color="bg-teal-500"
                onClick={() => navigate('/admin/corporate/departments')}
              />
              <QuickAction
                label="View Attendance"
                description="See today's check-in/check-out records"
                icon={<ClipboardCheck className="w-5 h-5 text-white" />}
                color="bg-violet-500"
                onClick={() => navigate('/admin/corporate/attendance')}
              />
              <QuickAction
                label="Reports & Analytics"
                description="Attendance trends and department breakdown"
                icon={<BarChart3 className="w-5 h-5 text-white" />}
                color="bg-green-500"
                onClick={() => navigate('/admin/corporate/reports')}
              />
            </div>
          </div>

          {/* Recent Check-ins */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Recent Check-ins</h3>
            <div className="space-y-3">
              {(data?.recentCheckins?.length ?? 0) > 0 ? (
                data!.recentCheckins.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg">
                    <div className={`p-2 rounded-lg ${c.check_out_time ? 'bg-teal-500/20' : 'bg-indigo-500/20'}`}>
                      {c.check_out_time
                        ? <CheckCircle2 className="w-4 h-4 text-teal-400" />
                        : <Clock className="w-4 h-4 text-indigo-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{c.first_name} {c.last_name}</p>
                      <p className="text-xs text-slate-500">
                        {c.emp_code} {c.department_name ? `· ${c.department_name}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">
                        {new Date(c.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-500" />
                        <span className="text-xs text-slate-500">{c.check_in_type}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <Clock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No check-ins recorded yet</p>
                  <p className="text-xs text-slate-500 mt-1">Employee check-ins will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Today's Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Today's Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-4 p-4 bg-teal-500/10 border border-teal-500/20 rounded-lg">
              <CheckCircle2 className="w-8 h-8 text-teal-400" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.todayCheckins}</p>
                <p className="text-sm text-slate-400">Checked In</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
              <Clock className="w-8 h-8 text-indigo-400" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.completedCheckouts}</p>
                <p className="text-sm text-slate-400">Checked Out</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <AlertTriangle className="w-8 h-8 text-orange-400" />
              <div>
                <p className="text-2xl font-bold text-white">
                  {(stats.activeEmployees || stats.activeUsers) - stats.todayCheckins}
                </p>
                <p className="text-sm text-slate-400">Absent Today</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <XCircle className="w-8 h-8 text-red-400" />
              <div>
                <p className="text-2xl font-bold text-white">
                  {(stats.totalEmployees || stats.totalUsers) - (stats.activeEmployees || stats.activeUsers)}
                </p>
                <p className="text-sm text-slate-400">Inactive</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default CorporateAdminDashboardPage
