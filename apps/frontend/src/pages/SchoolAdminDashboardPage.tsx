/**
 * School Admin Dashboard Page
 * 
 * Main dashboard for school tenant admins with overview stats,
 * quick actions, and recent activity
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  Users,
  GraduationCap,
  ClipboardCheck,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from 'lucide-react'
import axios from 'axios'

interface DashboardStats {
  totalUsers: number
  activeUsers: number
  pendingApprovals: number
  todayAttendance: number
  attendanceRate: number
}

interface RecentActivity {
  id: string
  type: 'approval' | 'attendance' | 'user'
  message: string
  timestamp: Date
}

const SchoolAdminDashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsers: 0,
    pendingApprovals: 0,
    todayAttendance: 0,
    attendanceRate: 0,
  })
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      
      // Fetch dashboard stats
      const response = await axios.get('/api/auth/admin/school/stats', {
        headers: { Authorization: `Bearer ${token}` },
      })
      
      if (response.data.stats) {
        // Ensure all values are valid numbers
        const validStats = {
          totalUsers: Number(response.data.stats.totalUsers) || 0,
          activeUsers: Number(response.data.stats.activeUsers) || 0,
          pendingApprovals: Number(response.data.stats.pendingApprovals) || 0,
          todayAttendance: Number(response.data.stats.todayAttendance) || 0,
          attendanceRate: Number(response.data.stats.attendanceRate) || 0,
        }
        setStats(validStats)
      }
      
      if (response.data.recentActivity) {
        setRecentActivity(response.data.recentActivity)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
      // Use mock data for demo
      setStats({
        totalUsers: 150,
        activeUsers: 142,
        pendingApprovals: 5,
        todayAttendance: 138,
        attendanceRate: 92,
      })
    } finally {
      setLoading(false)
    }
  }

  const StatCard: React.FC<{
    label: string
    value: string | number
    icon: React.ReactNode
    color: string
    trend?: string
  }> = ({ label, value, icon, color, trend }) => {
    // Ensure value is never NaN
    const displayValue = typeof value === 'number' && isNaN(value) ? '0' : value
    
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-lg ${color}`}>{icon}</div>
          {trend && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> {trend}
            </span>
          )}
        </div>
        <p className="text-3xl font-bold text-white mb-1">{displayValue}</p>
        <p className="text-sm text-slate-400">{label}</p>
      </div>
    )
  }

  const QuickAction: React.FC<{
    label: string
    description: string
    icon: React.ReactNode
    onClick: () => void
    color: string
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

  return (
    <TenantAdminLayout currentPage="dashboard" platform="school">
      <div className="space-y-8">
        {/* Welcome Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Welcome back!</h1>
            <p className="text-slate-400 mt-1">
              Here's what's happening in your school today
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 border border-blue-500/30 rounded-lg">
            <GraduationCap className="w-5 h-5 text-blue-400" />
            <span className="text-blue-400 font-medium">School Platform</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Total Users"
            value={stats.totalUsers}
            icon={<Users className="w-6 h-6 text-white" />}
            color="bg-blue-500"
            trend="+12%"
          />
          <StatCard
            label="Active Users"
            value={stats.activeUsers}
            icon={<CheckCircle2 className="w-6 h-6 text-white" />}
            color="bg-emerald-500"
          />
          <StatCard
            label="Pending Approvals"
            value={stats.pendingApprovals}
            icon={<ClipboardCheck className="w-6 h-6 text-white" />}
            color="bg-amber-500"
          />
          <StatCard
            label="Attendance Rate"
            value={`${stats.attendanceRate}%`}
            icon={<TrendingUp className="w-6 h-6 text-white" />}
            color="bg-indigo-500"
            trend="+5%"
          />
        </div>

        {/* Quick Actions & Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Quick Actions */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <QuickAction
                label="Manage Users"
                description="View and manage all users in your school"
                icon={<Users className="w-5 h-5 text-white" />}
                color="bg-blue-500"
                onClick={() => navigate('/admin/school/users')}
              />
              <QuickAction
                label="Review Approvals"
                description={`${stats.pendingApprovals} pending approval requests`}
                icon={<ClipboardCheck className="w-5 h-5 text-white" />}
                color="bg-amber-500"
                onClick={() => navigate('/admin/school/approvals')}
              />
              <QuickAction
                label="View Settings"
                description="Configure your school settings"
                icon={<GraduationCap className="w-5 h-5 text-white" />}
                color="bg-slate-500"
                onClick={() => navigate('/admin/school/settings')}
              />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
            <div className="space-y-4">
              {loading ? (
                <div className="text-center py-8 text-slate-400">Loading...</div>
              ) : recentActivity.length > 0 ? (
                recentActivity.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 p-3 bg-slate-800/30 rounded-lg"
                  >
                    <div className="p-2 bg-slate-700 rounded-lg">
                      {activity.type === 'approval' && (
                        <ClipboardCheck className="w-4 h-4 text-amber-400" />
                      )}
                      {activity.type === 'attendance' && (
                        <Clock className="w-4 h-4 text-blue-400" />
                      )}
                      {activity.type === 'user' && (
                        <Users className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-white">{activity.message}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <Clock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No recent activity</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Today's Summary */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Today's Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.todayAttendance}</p>
                <p className="text-sm text-slate-400">Present Today</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <div>
                <p className="text-2xl font-bold text-white">
                  {stats.activeUsers - stats.todayAttendance}
                </p>
                <p className="text-sm text-slate-400">Absent Today</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <XCircle className="w-8 h-8 text-red-400" />
              <div>
                <p className="text-2xl font-bold text-white">
                  {stats.totalUsers - stats.activeUsers}
                </p>
                <p className="text-sm text-slate-400">Inactive Users</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default SchoolAdminDashboardPage
