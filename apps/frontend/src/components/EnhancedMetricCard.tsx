import React from 'react'

interface MetricCardProps {
  label: string
  value: number | string
  change?: { value: number; isPositive: boolean }
  icon?: React.ReactNode
  color: 'blue' | 'green' | 'amber' | 'red' | 'cyan' | 'purple'
  onClick?: () => void
  trend?: 'up' | 'down' | 'stable'
}

const borderColorMap = {
  blue: 'border-blue-500',
  green: 'border-green-500',
  amber: 'border-amber-500',
  red: 'border-red-500',
  cyan: 'border-cyan-500',
  purple: 'border-purple-500'
}

const bgColorMap = {
  blue: 'bg-blue-50 dark:bg-blue-900/20',
  green: 'bg-green-50 dark:bg-green-900/20',
  amber: 'bg-amber-50 dark:bg-amber-900/20',
  red: 'bg-red-50 dark:bg-red-900/20',
  cyan: 'bg-cyan-50 dark:bg-cyan-900/20',
  purple: 'bg-purple-50 dark:bg-purple-900/20'
}

const EnhancedMetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  change,
  icon,
  color,
  onClick,
  trend
}) => {
  const trendIcon = trend === 'up' ? '📈' : trend === 'down' ? '📉' : '→'
  const changeColor = change?.isPositive ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
  
  // Safe value rendering - handle NaN and undefined
  const displayValue = typeof value === 'number' && !isNaN(value) ? value : (value || '—')

  return (
    <div
      onClick={onClick}
      className={`p-6 rounded-xl ${bgColorMap[color]} border ${borderColorMap[color]} backdrop-blur-sm transition-all cursor-pointer group hover:scale-105 hover:-translate-y-1`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <p className="text-secondary text-sm font-medium mb-2">{label}</p>
          <p className="text-3xl font-bold text-white group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text transition-all"
             style={{backgroundImage: `linear-gradient(to right, var(--tw-gradient-stops))`}}>
            {displayValue}
          </p>
        </div>
        {icon && <div className="text-3xl opacity-20 group-hover:opacity-30 transition-opacity">{icon}</div>}
      </div>

      {change && (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${changeColor}`}>
            {change.isPositive ? '+' : ''}{change.value}%
          </span>
          <span className="text-xs text-secondary">vs last month</span>
          <span className="ml-auto text-lg">{trendIcon}</span>
        </div>
      )}
    </div>
  )
}

export default EnhancedMetricCard
