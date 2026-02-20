/**
 * Tenant Admin Layout
 * 
 * Shared layout component for School and Corporate admin dashboards
 * Features a collapsible sidebar and consistent navigation
 */

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Bell,
  ArrowLeft,
  GraduationCap,
  Building2,
  LucideIcon,
  BookOpen,
  DoorOpen,
  BarChart3,
  CalendarDays,
  UserCheck,
  UserPlus,
  ClipboardList,
} from 'lucide-react'

interface SidebarItem {
  id: string
  label: string
  icon: LucideIcon
  color: string
}

const SCHOOL_SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'from-blue-500 to-blue-600' },
  { id: 'users', label: 'Users', icon: Users, color: 'from-emerald-500 to-emerald-600' },
  { id: 'students', label: 'Students', icon: GraduationCap, color: 'from-purple-500 to-purple-600' },
  { id: 'faculty', label: 'Faculty', icon: UserCheck, color: 'from-indigo-500 to-indigo-600' },
  { id: 'courses', label: 'Courses', icon: BookOpen, color: 'from-pink-500 to-pink-600' },
  { id: 'rooms', label: 'Rooms', icon: DoorOpen, color: 'from-cyan-500 to-cyan-600' },
  { id: 'schedules', label: 'Schedules', icon: CalendarDays, color: 'from-violet-500 to-violet-600' },
  { id: 'enrollment', label: 'Enrollment', icon: UserPlus, color: 'from-teal-500 to-teal-600' },
  { id: 'attendance', label: 'Attendance', icon: ClipboardList, color: 'from-orange-500 to-orange-600' },
  { id: 'reports', label: 'Reports', icon: BarChart3, color: 'from-green-500 to-green-600' },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, color: 'from-amber-500 to-amber-600' },
  { id: 'settings', label: 'Settings', icon: Settings, color: 'from-slate-500 to-slate-600' },
]

const CORPORATE_SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'from-indigo-500 to-indigo-600' },
  { id: 'users', label: 'Users', icon: Users, color: 'from-teal-500 to-teal-600' },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, color: 'from-orange-500 to-orange-600' },
  { id: 'settings', label: 'Settings', icon: Settings, color: 'from-slate-500 to-slate-600' },
]

const SCHOOL_PAGE_ROUTES: Record<string, string> = {
  dashboard: '/admin/school',
  users: '/admin/school/users',
  students: '/admin/school/students',
  faculty: '/admin/school/faculty',
  courses: '/admin/school/courses',
  rooms: '/admin/school/rooms',
  schedules: '/admin/school/schedules',
  enrollment: '/admin/school/enrollment',
  attendance: '/admin/school/attendance',
  reports: '/admin/school/reports',
  approvals: '/admin/school/approvals',
  settings: '/admin/school/settings',
}

const CORPORATE_PAGE_ROUTES: Record<string, string> = {
  dashboard: '/admin/corporate',
  users: '/admin/corporate/users',
  approvals: '/admin/corporate/approvals',
  settings: '/admin/corporate/settings',
}

interface TenantAdminLayoutProps {
  children: React.ReactNode
  currentPage: string
  platform: 'school' | 'corporate'
  showBackButton?: boolean
  onBack?: () => void
}

export const TenantAdminLayout: React.FC<TenantAdminLayoutProps> = ({
  children,
  currentPage,
  platform,
  showBackButton = false,
  onBack,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const sidebarItems = platform === 'school' ? SCHOOL_SIDEBAR_ITEMS : CORPORATE_SIDEBAR_ITEMS
  const pageRoutes = platform === 'school' ? SCHOOL_PAGE_ROUTES : CORPORATE_PAGE_ROUTES

  const handleNavigate = (pageId: string) => {
    navigate(pageRoutes[pageId])
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const currentPageLabel = sidebarItems.find((item) => item.id === currentPage)?.label || 'Dashboard'
  const PlatformIcon = platform === 'school' ? GraduationCap : Building2
  const platformName = platform === 'school' ? 'School Admin' : 'Corporate Admin'
  const platformColor = platform === 'school' ? 'from-blue-600 to-blue-700' : 'from-indigo-600 to-indigo-700'
  const platformBadgeColor = platform === 'school' ? 'text-blue-400' : 'text-indigo-400'

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-64' : 'w-16'
        } bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 ease-in-out relative`}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-6 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center hover:bg-slate-700 transition-colors z-10"
        >
          {sidebarOpen ? (
            <ChevronLeft className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {/* Logo/Brand */}
        <div className={`p-4 border-b border-slate-800 bg-gradient-to-r ${platformColor}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <PlatformIcon className="w-6 h-6 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="text-lg font-bold text-white">SmartAttend</h1>
                <p className="text-xs text-white/70">{platformName}</p>
              </div>
            )}
          </div>
        </div>

        {/* User Profile */}
        {sidebarOpen && user && (
          <div className="p-3 m-3 rounded-lg bg-slate-800/50 border border-slate-700 text-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Logged in as</p>
            <p className="text-xs font-semibold text-white truncate">{user.email}</p>
            <p className={`text-xs mt-1 ${platformBadgeColor}`}>👤 {platformName}</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
          {sidebarItems.map((item) => (
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-slate-900 border-b border-slate-800 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {showBackButton && onBack && (
              <button
                onClick={onBack}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                title="Go back"
              >
                <ArrowLeft className="w-6 h-6 text-slate-400 hover:text-white" />
              </button>
            )}
            <h2 className="text-2xl font-bold text-white">{currentPageLabel}</h2>
          </div>
          <div className="flex items-center gap-4">
            <Bell className="w-6 h-6 text-slate-400 hover:text-white cursor-pointer transition-colors" />
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-8">
          <div key={currentPage}>{children}</div>
        </div>
      </div>
    </div>
  )
}

export default TenantAdminLayout
