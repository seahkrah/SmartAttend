import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
      <motion.div
        initial={false}
        animate={{ width: sidebarOpen ? 280 : 80 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="relative bg-slate-900 border-r border-slate-800 flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <AnimatePresence>
            {sidebarOpen && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-3"
              >
                <img
                  src="/logos/platform-logo.png"
                  alt="SmartAttend"
                  className="w-10 h-10 rounded-lg object-cover"
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
                <div>
                  <h1 className="text-lg font-bold text-white">SmartAttend</h1>
                  <p className="text-xs text-slate-400">Console</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* User Profile */}
        {sidebarOpen && user && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="p-4 m-4 rounded-lg bg-slate-800/50 border border-slate-700"
          >
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Logged in as</p>
            <p className="text-sm font-semibold text-white truncate">{user.email}</p>
            <p className="text-xs text-blue-400 mt-1">👤 Superadmin</p>
          </motion.div>
        )}

        {/* Navigation */}
        <nav className="p-4 space-y-2 flex-1">
          {SIDEBAR_ITEMS.map((item) => (
            <motion.button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              whileHover={{ x: 4 }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 relative ${
                currentPage === item.id
                  ? `bg-gradient-to-r ${item.color} text-white shadow-lg`
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
              title={item.label}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="font-medium text-sm"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {currentPage === item.id && (
                <motion.div
                  layoutId="activeIndicator"
                  className="ml-auto w-2 h-2 rounded-full bg-white"
                />
              )}
            </motion.button>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-slate-700">
          <motion.button
            onClick={handleLogout}
            whileHover={{ scale: 1.02 }}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <AnimatePresence>
              {sidebarOpen && (
                <motion.span
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                >
                  Logout
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-slate-900 border-b border-slate-800 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {showBackButton && onBack && (
              <motion.button
                onClick={onBack}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                title="Go back"
              >
                <ArrowLeft className="w-6 h-6 text-slate-400 hover:text-white" />
              </motion.button>
            )}
            <h2 className="text-2xl font-bold text-white">{currentPageLabel}</h2>
          </div>
          <div className="flex items-center gap-4">
            <Bell className="w-6 h-6 text-slate-400 hover:text-white cursor-pointer transition-colors" />
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-8">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default SuperadminLayout
