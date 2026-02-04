import React, { useState } from 'react'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar } from 'recharts'
import { motion } from 'framer-motion'

interface AnalyticsData {
  date: string
  users: number
  active: number
  incidents: number
  revenue?: number
}

interface AnalyticsPanelProps {
  data: AnalyticsData[]
  title: string
  description?: string
}

const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ data, title, description }) => {
  const [chartType, setChartType] = useState<'line' | 'area' | 'composed'>('area')
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d')

  const filteredData = data.slice(Math.max(0, data.length - parseInt(timeRange)))

  // Calculate trend statistics
  const calculateTrend = (values: number[]) => {
    if (values.length < 2) return 0
    const recent = values.slice(-7).reduce((a, b) => a + b, 0) / 7
    const previous = values.slice(-14, -7).reduce((a, b) => a + b, 0) / 7
    return ((recent - previous) / previous) * 100
  }

  const userTrend = calculateTrend(filteredData.map(d => d.users))

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 space-y-4"
    >
      <div>
        <h3 className="text-xl font-bold text-white">{title}</h3>
        {description && <p className="text-slate-400 text-sm mt-1">{description}</p>}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2">
          {(['line', 'area', 'composed'] as const).map(type => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                chartType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {type === 'line' ? '📊' : type === 'area' ? '📈' : '📉'} {type}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-slate-700/50">
          <p className="text-xs text-slate-400">Avg Users</p>
          <p className="text-lg font-bold text-white">
            {Math.round(filteredData.reduce((a, d) => a + d.users, 0) / filteredData.length)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-slate-700/50">
          <p className="text-xs text-slate-400">Avg Incidents</p>
          <p className="text-lg font-bold text-white">
            {Math.round(filteredData.reduce((a, d) => a + d.incidents, 0) / filteredData.length)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-slate-700/50">
          <p className="text-xs text-slate-400">User Trend</p>
          <p className={`text-lg font-bold ${userTrend > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {userTrend > 0 ? '+' : ''}{userTrend.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-80 -mx-6 px-6">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'line' && (
            <LineChart data={filteredData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.2)" />
              <XAxis dataKey="date" stroke="rgba(148, 163, 184, 0.5)" />
              <YAxis stroke="rgba(148, 163, 184, 0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(100, 116, 139, 0.5)',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="users" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="active" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="incidents" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          )}

          {chartType === 'area' && (
            <AreaChart data={filteredData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.2)" />
              <XAxis dataKey="date" stroke="rgba(148, 163, 184, 0.5)" />
              <YAxis stroke="rgba(148, 163, 184, 0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(100, 116, 139, 0.5)',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Area type="monotone" dataKey="users" stackId="1" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3} />
              <Area type="monotone" dataKey="active" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
              <Area type="monotone" dataKey="incidents" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} />
            </AreaChart>
          )}

          {chartType === 'composed' && (
            <ComposedChart data={filteredData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.2)" />
              <XAxis dataKey="date" stroke="rgba(148, 163, 184, 0.5)" />
              <YAxis stroke="rgba(148, 163, 184, 0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(100, 116, 139, 0.5)',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Bar dataKey="users" fill="#0ea5e9" opacity={0.7} />
              <Line type="monotone" dataKey="active" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="incidents" stroke="#ef4444" strokeWidth={2} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}

export default AnalyticsPanel
