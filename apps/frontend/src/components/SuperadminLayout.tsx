import React, { useState } from 'react'
import {
  BarChart3, Building2, Users, AlertTriangle, Settings, LogOut, Menu, X,
  Home, Bell, ArrowLeft, Shield
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

interface LayoutProps {
  children: React.ReactNode
  currentPage: 'dashboard' | 'analytics' | 'entities' | 'tenants' | 'admins' | 'audit' | 'settings'
  showBackButton?: boolean
  onBack?: () => void
}

const SIDEBAR_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, color: 'from-blue-500 to-blue-600' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, color: 'from-purple-500 to-purple-600' },
  { id: 'entities', label: 'Entities', icon: Building2, color: 'from-green-500 to-green-600' },
  { id: 'tenants', label: 'Manage Tenants', icon: Building2, color: 'from-indigo-500 to-indigo-600' },
  { id: 'admins', label: 'Admin Management', icon: Users, color: 'from-orange-500 to-orange-600' },
  { id: 'audit', label: 'Audit Logs', icon: AlertTriangle, color: 'from-cyan-500 to-cyan-600' },
  { id: 'settings', label: 'Settings', icon: Settings, color: 'from-red-500 to-red-600' },
]

const PAGE_ROUTES = {
  dashboard: '/superadmin/dashboard',
  analytics: '/superadmin/analytics',
  entities: '/superadmin/entities',
  tenants: '/superadmin/tenants',
  admins: '/superadmin/admins',
  audit: '/superadmin/audit',
  settings: '/superadmin/settings',
}

export const SuperadminLayout: React.FC<LayoutProps> = ({
  children,
  currentPage,
  showBackButton = false,
  onBack,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleNavigate = (pageId: string) => {
    const route = PAGE_ROUTES[pageId as keyof typeof PAGE_ROUTES]
    if (route) {
      navigate(route)
    }
  }

  const currentPageLabel = SIDEBAR_ITEMS.find(item => item.id === currentPage)?.label || 'Dashboard'

  return (
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <div
        className={`relative bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'w-72' : 'w-20'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          {sidebarOpen && (
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/logos/platform-logo.png"
                alt="SmartAttend"
                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement
                  if (fallback) {
                    fallback.classList.remove('hidden')
                    fallback.classList.add('flex', 'items-center', 'justify-center')
                  }
                }}
              />
              <div className="hidden">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div className="truncate">
                <h1 className="text-sm font-bold text-white truncate">SmartAttend</h1>
                <p className="text-xs text-slate-400">Console</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex-shrink-0 p-2 hover:bg-slate-800 rounded-lg transition-colors ml-auto"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* User Profile */}
        {sidebarOpen && user && (
          <div className="p-3 m-3 rounded-lg bg-slate-800/50 border border-slate-700 text-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Logged in as</p>
            <p className="text-xs font-semibold text-white truncate">{user.email}</p>
            <p className="text-xs text-blue-400 mt-1">👤 Superadmin</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
          {SIDEBAR_ITEMS.map((item) => (
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
          <div key={currentPage}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SuperadminLayout
