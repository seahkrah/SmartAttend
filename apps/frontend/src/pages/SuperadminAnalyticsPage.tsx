import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import axios from 'axios'
import SuperadminLayout from '../components/SuperadminLayout'

interface AnalyticsData {
  date: string
  activeUsers: number
  totalUsers: number
  newRegistrations: number
}

const SuperadminAnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsData[]>([])
  const [systemHealth, setSystemHealth] = useState({
    criticalIssues: 3,
    warnings: 12,
    healthy: 98,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalyticsData()
  }, [])

  const loadAnalyticsData = async () => {
    try {
      setLoading(true)
      // Simulate 30-day growth data
      const days = 30
      const mockData = Array.from({ length: days }, (_, idx) => ({
        date: new Date(Date.now() - (days - idx) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        activeUsers: Math.floor(Math.random() * 500) + 800,
        totalUsers: Math.floor(Math.random() * 1000) + 1500,
        newRegistrations: Math.floor(Math.random() * 100) + 20,
      }))
      setData(mockData)
    } catch (error) {
      console.error('Error loading analytics data:', error)
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

  return (
    <SuperadminLayout currentPage="analytics">
      <div className="space-y-6">
        {/* User Growth Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-xl bg-slate-800/50 border border-slate-700"
        >
          <h3 className="text-lg font-bold text-white mb-4">30-Day User Growth Trend</h3>
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
        </motion.div>

        {/* System Health Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-6 rounded-xl bg-red-500/10 border border-red-500/30"
          >
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <h4 className="text-lg font-bold text-white">Critical Issues</h4>
            </div>
            <p className="text-4xl font-bold text-white">{systemHealth.criticalIssues}</p>
            <p className="text-sm text-slate-400 mt-2">Immediate action required</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-6 rounded-xl bg-yellow-500/10 border border-yellow-500/30"
          >
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-yellow-400" />
              <h4 className="text-lg font-bold text-white">Warnings</h4>
            </div>
            <p className="text-4xl font-bold text-white">{systemHealth.warnings}</p>
            <p className="text-sm text-slate-400 mt-2">Review recommended</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="p-6 rounded-xl bg-green-500/10 border border-green-500/30"
          >
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-green-400" />
              <h4 className="text-lg font-bold text-white">Healthy</h4>
            </div>
            <p className="text-4xl font-bold text-white">{systemHealth.healthy}</p>
            <p className="text-sm text-slate-400 mt-2">Operating normally</p>
          </motion.div>
        </div>

        {/* Detailed Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 rounded-xl bg-slate-800/50 border border-slate-700"
        >
          <h3 className="text-lg font-bold text-white mb-4">Key Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Avg. Response Time</span>
                <span className="text-xl font-bold text-cyan-400">245ms</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">System Uptime</span>
                <span className="text-xl font-bold text-green-400">99.97%</span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">API Calls/Hour</span>
                <span className="text-xl font-bold text-blue-400">156,234</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Active Sessions</span>
                <span className="text-xl font-bold text-purple-400">1,247</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminAnalyticsPage
