/**
 * Corporate Admin Reports Page
 * 
 * Analytics: daily attendance trend, department breakdown, late arrivals
 */

import React, { useState, useEffect } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  BarChart3, TrendingUp, Building2, Clock, Loader2,
  Calendar, AlertTriangle,
} from 'lucide-react'
import axios from 'axios'

interface DailyTrend {
  date: string
  checkins: number
  unique_employees: number
}

interface DeptBreakdown {
  department_name: string
  total_checkins: number
  unique_employees: number
  avg_checkins_per_day: number
}

interface LateArrival {
  first_name: string
  last_name: string
  employee_code: string
  check_in_time: string
  department_name: string | null
}

interface ReportData {
  dailyTrend: DailyTrend[]
  departmentBreakdown: DeptBreakdown[]
  lateArrivals: LateArrival[]
}

const CorporateAdminReportsPage: React.FC = () => {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true)
        const res = await axios.get('/api/corporate/admin/reports', {
          headers, params: { days },
        })
        setData(res.data)
      } catch (err) {
        console.error('Failed to load reports:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchReports()
  }, [days])

  // Compute stats from trend data
  const avgDaily = data?.dailyTrend?.length
    ? Math.round(data.dailyTrend.reduce((s, d) => s + d.checkins, 0) / data.dailyTrend.length)
    : 0
  const peakDay = data?.dailyTrend?.reduce(
    (max, d) => (d.checkins > (max?.checkins || 0) ? d : max),
    null as DailyTrend | null,
  )
  const totalCheckins = data?.dailyTrend?.reduce((s, d) => s + d.checkins, 0) || 0

  // Bar chart helper – render as simple HTML bars
  const maxCheckins = data?.dailyTrend?.length
    ? Math.max(...data.dailyTrend.map((d) => d.checkins), 1)
    : 1

  if (loading) {
    return (
      <TenantAdminLayout currentPage="reports" platform="corporate">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </TenantAdminLayout>
    )
  }

  return (
    <TenantAdminLayout currentPage="reports" platform="corporate">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
            <p className="text-slate-400 mt-1">Attendance insights and trends</p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  days === d
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                }`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Summary Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-4 p-5 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-indigo-500/20 rounded-lg">
              <BarChart3 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{totalCheckins}</p>
              <p className="text-xs text-slate-400">Total Check‑ins ({days}d)</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-5 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-teal-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{avgDaily}</p>
              <p className="text-xs text-slate-400">Avg daily check‑ins</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-5 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-violet-500/20 rounded-lg">
              <Calendar className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {peakDay ? new Date(peakDay.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
              </p>
              <p className="text-xs text-slate-400">
                Peak day ({peakDay?.checkins || 0} check‑ins)
              </p>
            </div>
          </div>
        </div>

        {/* Daily Trend Chart (HTML bars) */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Daily Attendance Trend</h3>
          {(data?.dailyTrend?.length ?? 0) > 0 ? (
            <div className="flex items-end gap-1 h-48 overflow-x-auto pb-2">
              {data!.dailyTrend.map((d) => {
                const height = (d.checkins / maxCheckins) * 100
                return (
                  <div key={d.date} className="flex flex-col items-center flex-shrink-0 group" style={{ minWidth: days <= 14 ? '3rem' : '1.5rem' }}>
                    <div className="relative w-full flex items-end justify-center" style={{ height: '10rem' }}>
                      <div
                        className="w-3/4 bg-indigo-500/60 hover:bg-indigo-500 rounded-t transition-all"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${d.date}: ${d.checkins} check-ins`}
                      />
                      <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-indigo-300 whitespace-nowrap">
                        {d.checkins}
                      </div>
                    </div>
                    {days <= 14 && (
                      <span className="text-[10px] text-slate-500 mt-1">
                        {new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-slate-500 text-center py-8">No data for this period</p>
          )}
        </div>

        {/* Department Breakdown & Late Arrivals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Department Breakdown */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Department Breakdown</h3>
            {(data?.departmentBreakdown?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {data!.departmentBreakdown.map((dept, i) => {
                  const maxDept = Math.max(...data!.departmentBreakdown.map((d) => d.total_checkins), 1)
                  const pct = (dept.total_checkins / maxDept) * 100
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-teal-400" />
                          <span className="text-sm text-white">{dept.department_name || 'Unassigned'}</span>
                        </div>
                        <span className="text-xs text-slate-400">
                          {dept.total_checkins} check-ins · {dept.unique_employees} employees
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-8">No department data</p>
            )}
          </div>

          {/* Late Arrivals */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
              Late Arrivals (after 9 AM)
            </h3>
            {(data?.lateArrivals?.length ?? 0) > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data!.lateArrivals.map((la, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <span className="text-orange-400 text-xs font-medium">
                        {la.first_name[0]}{la.last_name[0]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{la.first_name} {la.last_name}</p>
                      <p className="text-xs text-slate-500">{la.employee_code} {la.department_name ? `· ${la.department_name}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1 text-orange-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-xs">
                        {new Date(la.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No late arrivals in this period</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default CorporateAdminReportsPage
