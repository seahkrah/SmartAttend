import React from 'react'
import { motion } from 'framer-motion'

export interface Alert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  message: string
  timestamp: Date
  actionLabel?: string
  onAction?: () => void
  dismissed?: boolean
}

interface AlertPanelProps {
  alerts: Alert[]
  onDismiss: (id: string) => void
}

const alertConfig = {
  critical: {
    bg: 'bg-red-900/20',
    border: 'border-red-600',
    icon: '🔴',
    text: 'text-red-300',
    title: 'text-red-200',
    action: 'bg-red-600 hover:bg-red-700'
  },
  warning: {
    bg: 'bg-amber-900/20',
    border: 'border-amber-600',
    icon: '🟠',
    text: 'text-amber-300',
    title: 'text-amber-200',
    action: 'bg-amber-600 hover:bg-amber-700'
  },
  info: {
    bg: 'bg-blue-900/20',
    border: 'border-blue-600',
    icon: '🔵',
    text: 'text-blue-300',
    title: 'text-blue-200',
    action: 'bg-blue-600 hover:bg-blue-700'
  },
  success: {
    bg: 'bg-green-900/20',
    border: 'border-green-600',
    icon: '🟢',
    text: 'text-green-300',
    title: 'text-green-200',
    action: 'bg-green-600 hover:bg-green-700'
  }
}

const AlertPanel: React.FC<AlertPanelProps> = ({ alerts, onDismiss }) => {
  const activeAlerts = alerts.filter(a => !a.dismissed).slice(0, 5)

  if (activeAlerts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 rounded-xl bg-green-900/20 border border-green-600 text-center"
      >
        <p className="text-green-300 font-semibold">✅ All systems operating normally</p>
        <p className="text-green-400/60 text-sm mt-1">No active alerts</p>
      </motion.div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider px-2">
        🔔 Alerts ({activeAlerts.length})
      </h3>
      {activeAlerts.map((alert, idx) => {
        const config = alertConfig[alert.type]
        return (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={`p-4 rounded-lg ${config.bg} border ${config.border} space-y-2`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3 flex-1">
                <span className="text-xl mt-0.5">{config.icon}</span>
                <div className="flex-1">
                  <p className={`font-semibold ${config.title}`}>{alert.title}</p>
                  <p className={`text-sm ${config.text}`}>{alert.message}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {alert.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onDismiss(alert.id)}
                className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
              >
                ✕
              </button>
            </div>

            {alert.actionLabel && alert.onAction && (
              <button
                onClick={alert.onAction}
                className={`w-full px-3 py-2 rounded text-sm font-semibold text-white transition-colors ${config.action}`}
              >
                {alert.actionLabel}
              </button>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

export default AlertPanel
