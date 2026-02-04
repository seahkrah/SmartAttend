import React from 'react'
import { motion } from 'framer-motion'

interface MetricData {
  label: string
  current: number
  target: number
  unit?: string
  threshold?: 'good' | 'warning' | 'critical'
}

interface PerformanceMetricsProps {
  metrics: MetricData[]
  title?: string
  columns?: 2 | 3 | 4
}

const getThresholdColor = (current: number, target: number, threshold?: string) => {
  const percentage = (current / target) * 100

  if (threshold === 'critical') {
    return percentage < 50 ? 'text-red-400' : 'text-orange-400'
  }
  if (threshold === 'warning') {
    return percentage < 75 ? 'text-amber-400' : 'text-green-400'
  }

  return percentage >= 90 ? 'text-green-400' : percentage >= 70 ? 'text-amber-400' : 'text-red-400'
}

const getProgressColor = (current: number, target: number) => {
  const percentage = Math.min((current / target) * 100, 100)
  if (percentage >= 90) return 'from-green-600 to-green-400'
  if (percentage >= 70) return 'from-amber-600 to-amber-400'
  return 'from-red-600 to-red-400'
}

const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({
  metrics,
  title,
  columns = 3
}) => {
  const colSpan = `grid-cols-1 md:grid-cols-${columns}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {title && <h3 className="text-lg font-bold text-white">{title}</h3>}

      <div className={`grid ${colSpan} gap-4`}>
        {metrics.map((metric, idx) => {
          const percentage = Math.min((metric.current / metric.target) * 100, 100)
          const statusColor = getThresholdColor(metric.current, metric.target, metric.threshold)
          const progressColor = getProgressColor(metric.current, metric.target)

          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.05 }}
              className="p-4 rounded-lg bg-slate-700/30 border border-slate-700 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400">{metric.label}</p>
                  <p className={`text-2xl font-bold ${statusColor} transition-colors`}>
                    {metric.current}
                    {metric.unit && <span className="text-sm ml-1">{metric.unit}</span>}
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Goal: {metric.target}
                  {metric.unit && metric.unit}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{ duration: 1, delay: 0.2 }}
                    className={`h-full bg-gradient-to-r ${progressColor} transition-all`}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">{percentage.toFixed(0)}%</span>
                  <span className={`text-xs font-semibold ${statusColor}`}>
                    {percentage >= 90 ? '✓ On Track' : percentage >= 70 ? '⚠ Needs Attention' : '✕ Below Target'}
                  </span>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

export default PerformanceMetrics
