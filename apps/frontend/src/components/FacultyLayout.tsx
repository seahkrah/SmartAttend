/**
 * Faculty Portal Layout
 *
 * Sidebar navigation with student stats, collapsible design.
 * Mirrors the TenantAdminLayout pattern for consistency.
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { axiosClient } from '../utils/axiosClient'
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  UserPlus,
  BookOpen,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Bell,
  GraduationCap,
  LucideIcon,
  CalendarDays,
  BarChart3,
  Settings,
} from 'lucide-react'

// ── Sidebar items ──

interface SidebarItem {
  id: string
  label: string
  icon: LucideIcon
  color: string
  badge?: number | string
}

const FACULTY_SIDEBAR_ITEMS: Omit<SidebarItem, 'badge'>[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'from-blue-500 to-blue-600' },
  { id: 'students', label: 'My Students', icon: Users, color: 'from-emerald-500 to-emerald-600' },
  { id: 'courses', label: 'Courses', icon: BookOpen, color: 'from-purple-500 to-purple-600' },
  { id: 'enrollment', label: 'Enrollment', icon: UserPlus, color: 'from-teal-500 to-teal-600' },
  { id: 'attendance', label: 'Attendance', icon: ClipboardList, color: 'from-orange-500 to-orange-600' },
  { id: 'schedules', label: 'Schedules', icon: CalendarDays, color: 'from-violet-500 to-violet-600' },
  { id: 'reports', label: 'Reports', icon: BarChart3, color: 'from-cyan-500 to-cyan-600' },
  { id: 'settings', label: 'Settings', icon: Settings, color: 'from-slate-500 to-slate-600' },
]

const FACULTY_ROUTES: Record<string, string> = {
  dashboard: '/faculty',
  students: '/faculty/students',
  courses: '/faculty/courses',
  enrollment: '/faculty/enrollment',
  attendance: '/faculty/attendance',
  schedules: '/faculty/schedules',
  reports: '/faculty/reports',
  settings: '/faculty/settings',
}

// ── Stats type ──

interface SidebarStats {
  totalStudents: number
  courseBreakdown: { courseCode: string; courseName: string; studentCount: number }[]
}

// ── Component ──

interface FacultyLayoutProps {
  children: React.ReactNode
  currentPage: string
}

export const FacultyLayout: React.FC<FacultyLayoutProps> = ({ children, currentPage }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [stats, setStats] = useState<SidebarStats | null>(null)
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  useEffect(() => {
    loadSidebarStats()
  }, [])

  const loadSidebarStats = async () => {
    try {
      const res = await axiosClient.get('/faculty/dashboard')
      const d = res.data
      setStats({
        totalStudents: d.total_students ?? 0,
        courseBreakdown: d.course_breakdown ?? [],
      })
    } catch {
      // stats unavailable — no-op
    }
  }

  const handleNavigate = (pageId: string) => {
    navigate(FACULTY_ROUTES[pageId] || '/faculty')
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const currentLabel =
    FACULTY_SIDEBAR_ITEMS.find((i) => i.id === currentPage)?.label || 'Dashboard'

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* ── Sidebar ── */}
      <div
        className={`${
          sidebarOpen ? 'w-64' : 'w-16'
        } bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 ease-in-out relative`}
      >
        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-6 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center hover:bg-slate-700 transition-colors z-10"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* Brand */}
        <div className="p-4 border-b border-slate-800 bg-gradient-to-r from-indigo-600 to-indigo-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="text-lg font-bold text-white">SmartAttend</h1>
                <p className="text-xs text-white/70">Faculty Portal</p>
              </div>
            )}
          </div>
        </div>

        {/* User */}
        {sidebarOpen && user && (
          <div className="p-3 m-3 rounded-lg bg-slate-800/50 border border-slate-700 text-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Logged in as</p>
            <p className="text-xs font-semibold text-white truncate">{user.fullName || user.email}</p>
            <p className="text-xs mt-1 text-indigo-400">🎓 Faculty</p>
          </div>
        )}

        {/* Student stats */}
        {sidebarOpen && stats && (
          <div className="mx-3 mb-2 p-3 rounded-lg bg-slate-800/30 border border-slate-700/50">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">My Students</p>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold text-white">{stats.totalStudents}</span>
              <span className="text-xs text-slate-500">total enrolled</span>
            </div>
            {stats.courseBreakdown.length > 0 && (
              <div className="space-y-1.5">
                {stats.courseBreakdown.map((c) => (
                  <div key={c.courseCode} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 truncate mr-2" title={c.courseName}>
                      {c.courseCode}
                    </span>
                    <span className="text-slate-300 font-medium tabular-nums">
                      {c.studentCount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
          {FACULTY_SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 relative group ${
                currentPage === item.id
                  ? `bg-gradient-to-r ${item.color} text-white shadow-lg`
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
              title={item.label}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && (
                <span className="text-sm font-medium truncate">{item.label}</span>
              )}
              {currentPage === item.id && (
                <div className="ml-auto w-2 h-2 rounded-full bg-white flex-shrink-0" />
              )}
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-2 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors text-sm"
            title="Logout"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="bg-slate-900 border-b border-slate-800 px-8 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">{currentLabel}</h2>
          <Bell className="w-6 h-6 text-slate-400 hover:text-white cursor-pointer transition-colors" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </div>
    </div>
  )
}

export default FacultyLayout
