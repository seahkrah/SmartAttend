/**
 * Faculty Reports Page
 *
 * Provides attendance reports with:
 * - Course & schedule filters
 * - Date range selection
 * - Per-student attendance breakdown table
 * - Summary statistics
 * - CSV export
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import FacultyLayout from '../components/FacultyLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'
import {
  BarChart3,
  Download,
  Filter,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Calendar,
  TrendingUp,
  Search,
} from 'lucide-react'

interface Course {
  id: string
  name: string
  code: string
}

interface Schedule {
  id: string
  course_id: string
  course_name: string
  course_code: string
  section: number
  student_count: string
}

interface ReportRow {
  student_id: string
  student_code: string
  first_name: string
  last_name: string
  email: string
  total_sessions: number
  present: number
  absent: number
  late: number
  excused: number
  rate: number
}

interface ReportSummary {
  total_students: number
  total_sessions: number
  avg_attendance_rate: number
  highest_rate: number
  lowest_rate: number
}

const FacultyReportsPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)

  // Filter state
  const [courses, setCourses] = useState<Course[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedCourse, setSelectedCourse] = useState('all')
  const [selectedSchedule, setSelectedSchedule] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 3)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [search, setSearch] = useState('')

  // Data state
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingFilters, setLoadingFilters] = useState(true)
  const [hasGenerated, setHasGenerated] = useState(false)

  useEffect(() => {
    loadFilters()
  }, [])

  const loadFilters = async () => {
    try {
      const [coursesRes, schedulesRes] = await Promise.all([
        axiosClient.get('/faculty/courses'),
        axiosClient.get('/faculty/schedules'),
      ])
      setCourses(Array.isArray(coursesRes.data) ? coursesRes.data : [])
      setSchedules(Array.isArray(schedulesRes.data) ? schedulesRes.data : [])
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load filters' })
    } finally {
      setLoadingFilters(false)
    }
  }

  const filteredSchedules = useMemo(() => {
    if (selectedCourse === 'all') return schedules
    return schedules.filter((s) => s.course_id === selectedCourse)
  }, [schedules, selectedCourse])

  const generateReport = useCallback(async () => {
    setLoading(true)
    setHasGenerated(true)
    try {
      const params = new URLSearchParams()
      if (selectedCourse !== 'all') params.append('course_id', selectedCourse)
      if (selectedSchedule !== 'all') params.append('schedule_id', selectedSchedule)
      params.append('date_from', dateFrom)
      params.append('date_to', dateTo)

      const res = await axiosClient.get(`/faculty/reports?${params.toString()}`)
      setRows(Array.isArray(res.data) ? res.data : [])
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to generate report' })
    } finally {
      setLoading(false)
    }
  }, [selectedCourse, selectedSchedule, dateFrom, dateTo, addToast])

  const filteredRows = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(
      (r) =>
        `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
        r.student_code?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q)
    )
  }, [rows, search])

  const summary: ReportSummary | null = useMemo(() => {
    if (rows.length === 0) return null
    const rates = rows.map((r) => r.rate)
    return {
      total_students: rows.length,
      total_sessions: rows.length > 0 ? rows[0].total_sessions : 0,
      avg_attendance_rate: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
      highest_rate: Math.max(...rates),
      lowest_rate: Math.min(...rates),
    }
  }, [rows])

  const rateColor = (pct: number) =>
    pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'

  const rateBg = (pct: number) =>
    pct >= 75
      ? 'bg-emerald-500/20 text-emerald-400'
      : pct >= 50
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-red-500/20 text-red-400'

  const exportCSV = () => {
    if (filteredRows.length === 0) return
    const header = ['Student ID', 'First Name', 'Last Name', 'Email', 'Sessions', 'Present', 'Absent', 'Late', 'Excused', 'Rate (%)']
    const csvRows = [
      header.join(','),
      ...filteredRows.map((r) =>
        [r.student_code, r.first_name, r.last_name, r.email, r.total_sessions, r.present, r.absent, r.late, r.excused, r.rate].join(',')
      ),
    ]
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-report-${dateFrom}-to-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loadingFilters) {
    return (
      <FacultyLayout currentPage="reports">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-slate-400">Loading...</span>
        </div>
      </FacultyLayout>
    )
  }

  return (
    <FacultyLayout currentPage="reports">
      <div className="space-y-6">
        {/* ── Filter panel ── */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Report Filters</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Course */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Course</label>
              <select
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value)
                  setSelectedSchedule('all')
                }}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 outline-none"
              >
                <option value="all">All Courses</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Schedule */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Schedule / Section</label>
              <select
                value={selectedSchedule}
                onChange={(e) => setSelectedSchedule(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 outline-none"
              >
                <option value="all">All Sections</option>
                {filteredSchedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.course_code} Sec {s.section} ({s.student_count} students)
                  </option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 outline-none"
              />
            </div>

            {/* Date to */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-cyan-500 outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={generateReport}
              disabled={loading}
              className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <BarChart3 className="w-4 h-4" />
              )}
              Generate Report
            </button>
            {rows.length > 0 && (
              <button
                onClick={exportCSV}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            )}
          </div>
        </div>

        {/* ── Summary cards ── */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-slate-500 uppercase">Students</span>
              </div>
              <p className="text-2xl font-bold text-white">{summary.total_students}</p>
            </div>
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-violet-400" />
                <span className="text-xs text-slate-500 uppercase">Sessions</span>
              </div>
              <p className="text-2xl font-bold text-white">{summary.total_sessions}</p>
            </div>
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-slate-500 uppercase">Avg Rate</span>
              </div>
              <p className={`text-2xl font-bold ${rateColor(summary.avg_attendance_rate)}`}>
                {summary.avg_attendance_rate}%
              </p>
            </div>
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-slate-500 uppercase">Highest</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">{summary.highest_rate}%</p>
            </div>
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-xs text-slate-500 uppercase">Lowest</span>
              </div>
              <p className="text-2xl font-bold text-red-400">{summary.lowest_rate}%</p>
            </div>
          </div>
        )}

        {/* ── Results table ── */}
        {hasGenerated && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Attendance Results ({filteredRows.length} student{filteredRows.length !== 1 ? 's' : ''})
              </h3>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-cyan-500 outline-none w-64"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                {rows.length === 0
                  ? 'No attendance records found for the selected filters.'
                  : 'No matches for your search.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700 bg-slate-800/80">
                      <th className="text-left py-3 px-4">#</th>
                      <th className="text-left py-3 px-4">Student</th>
                      <th className="text-left py-3 px-4">ID</th>
                      <th className="text-center py-3 px-3">Sessions</th>
                      <th className="text-center py-3 px-3">
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Present
                        </span>
                      </th>
                      <th className="text-center py-3 px-3">
                        <span className="inline-flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5 text-red-400" /> Absent
                        </span>
                      </th>
                      <th className="text-center py-3 px-3">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-400" /> Late
                        </span>
                      </th>
                      <th className="text-center py-3 px-3">
                        <span className="inline-flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 text-blue-400" /> Excused
                        </span>
                      </th>
                      <th className="text-center py-3 px-4">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r, idx) => (
                      <tr
                        key={r.student_id}
                        className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                      >
                        <td className="py-3 px-4 text-slate-500">{idx + 1}</td>
                        <td className="py-3 px-4">
                          <p className="text-white font-medium">
                            {r.first_name} {r.last_name}
                          </p>
                          <p className="text-xs text-slate-500">{r.email}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono text-xs">{r.student_code}</td>
                        <td className="py-3 px-3 text-center text-slate-300 font-medium">{r.total_sessions}</td>
                        <td className="py-3 px-3 text-center text-emerald-400 font-semibold">{r.present}</td>
                        <td className="py-3 px-3 text-center text-red-400 font-semibold">{r.absent}</td>
                        <td className="py-3 px-3 text-center text-amber-400 font-semibold">{r.late}</td>
                        <td className="py-3 px-3 text-center text-blue-400 font-semibold">{r.excused}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${rateBg(r.rate)}`}>
                            {r.rate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Prompt if not generated yet */}
        {!hasGenerated && (
          <div className="text-center py-16">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 text-slate-600" />
            <p className="text-slate-400 text-lg">Select filters and generate a report</p>
            <p className="text-slate-500 text-sm mt-1">
              Choose a course, date range, and click Generate Report to view attendance data.
            </p>
          </div>
        )}
      </div>
    </FacultyLayout>
  )
}

export default FacultyReportsPage
