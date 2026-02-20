/**
 * Corporate Admin Attendance Page
 * 
 * Daily attendance view with date picker, department filter,
 * present/absent/checked-out summary
 */

import React, { useState, useEffect, useCallback } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  ClipboardCheck, Loader2, CheckCircle2,
  XCircle, Clock, LogOut, Users, ChevronLeft, ChevronRight,
} from 'lucide-react'
import axios from 'axios'

interface AttendanceRecord {
  checkin_id: string
  check_in_time: string
  check_out_time: string | null
  check_in_type: string
  face_verified: boolean
  first_name: string
  last_name: string
  emp_code: string
  department_name: string | null
  employee_id: string
}

interface AttendanceSummary {
  total: number
  present: number
  absent: number
  checkedOut: number
  rate: number
}

interface Department {
  id: string
  name: string
}

const CorporateAdminAttendancePage: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [summary, setSummary] = useState<AttendanceSummary>({
    total: 0, present: 0, absent: 0, checkedOut: 0, rate: 0,
  })
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [deptFilter, setDeptFilter] = useState('')

  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }

  const fetchAttendance = useCallback(async () => {
    try {
      setLoading(true)
      const params: Record<string, string> = { date }
      if (deptFilter) params.department_id = deptFilter
      const res = await axios.get('/api/corporate/admin/attendance', { headers, params })
      setRecords(res.data.records || [])
      setSummary(res.data.summary || { total_employees: 0, present: 0, absent: 0, attendance_rate: 0 })
    } catch (err) {
      console.error('Failed to load attendance:', err)
    } finally {
      setLoading(false)
    }
  }, [date, deptFilter])

  const fetchDepartments = async () => {
    try {
      const res = await axios.get('/api/corporate/departments', { headers })
      setDepartments(res.data.departments || [])
    } catch (err) {
      console.error('Failed to load departments:', err)
    }
  }

  useEffect(() => { fetchDepartments() }, [])
  useEffect(() => { fetchAttendance() }, [fetchAttendance])

  const navigateDate = (offset: number) => {
    const d = new Date(date)
    d.setDate(d.getDate() + offset)
    setDate(d.toISOString().split('T')[0])
  }

  const isToday = date === new Date().toISOString().split('T')[0]

  const formatTime = (ts: string | null) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getDuration = (inTime: string, outTime: string | null) => {
    if (!outTime) return 'In progress'
    const diff = new Date(outTime).getTime() - new Date(inTime).getTime()
    const hours = Math.floor(diff / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    return `${hours}h ${mins}m`
  }

  return (
    <TenantAdminLayout currentPage="attendance" platform="corporate">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Attendance</h1>
            <p className="text-slate-400 mt-1">Daily attendance tracking and overview</p>
          </div>
        </div>

        {/* Date & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <button onClick={() => navigateDate(-1)}
              className="p-2 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="px-2 py-2 bg-transparent text-white text-sm focus:outline-none"
            />
            <button onClick={() => navigateDate(1)} disabled={isToday}
              className="p-2 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {!isToday && (
            <button onClick={() => setDate(new Date().toISOString().split('T')[0])}
              className="px-3 py-2 text-sm text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/10 transition-colors">
              Today
            </button>
          )}
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-indigo-500">
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-4 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-indigo-500/20 rounded-lg">
              <Users className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.total}</p>
              <p className="text-xs text-slate-400">Total Employees</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-teal-500/20 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.present}</p>
              <p className="text-xs text-slate-400">Present</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-red-500/20 rounded-lg">
              <XCircle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.absent}</p>
              <p className="text-xs text-slate-400">Absent</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
            <div className="p-3 bg-violet-500/20 rounded-lg">
              <ClipboardCheck className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{summary.rate}%</p>
              <p className="text-xs text-slate-400">Attendance Rate</p>
            </div>
          </div>
        </div>

        {/* Records Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center">
            <ClipboardCheck className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 text-lg">No attendance records</p>
            <p className="text-sm text-slate-500 mt-1">
              {isToday ? 'No check-ins recorded for today yet' : `No records for ${new Date(date).toLocaleDateString()}`}
            </p>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Employee</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Department</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Check In</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Check Out</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Duration</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Type</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.checkin_id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                            <span className="text-indigo-400 text-xs font-medium">
                              {r.first_name[0]}{r.last_name[0]}
                            </span>
                          </div>
                          <div>
                            <p className="text-white text-sm">{r.first_name} {r.last_name}</p>
                            <p className="text-xs text-slate-500">{r.emp_code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-300">
                        {r.department_name || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-sm text-white">{formatTime(r.check_in_time)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {r.check_out_time ? (
                          <div className="flex items-center gap-1.5">
                            <LogOut className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-sm text-white">{formatTime(r.check_out_time)}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-500 italic">Still in</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-300">
                        {getDuration(r.check_in_time, r.check_out_time)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-700 text-slate-300 capitalize">
                          {r.check_in_type}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {r.face_verified ? (
                          <CheckCircle2 className="w-4 h-4 text-teal-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-slate-500" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </TenantAdminLayout>
  )
}

export default CorporateAdminAttendancePage
