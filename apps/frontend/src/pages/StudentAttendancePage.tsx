/**
 * Student Attendance Page
 *
 * Full attendance history with filters (course, date range, status), summary bar.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'

interface AttendanceRecord {
  id: string
  attendance_date: string
  status: string
  remarks: string | null
  face_verified: boolean | null
  marked_at: string | null
  course_code: string
  course_name: string
  section: number | null
}

interface Summary {
  total: number
  present: number
  late: number
  absent: number
  excused: number
  rate: number
}

interface CourseOption {
  course_id: string
  code: string
  name: string
}

const STATUS_COLORS: Record<string, string> = {
  present: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700/50',
  late: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/50',
  absent: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-700/50',
  excused: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-700/50',
}

export const StudentAttendancePage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [courses, setCourses] = useState<CourseOption[]>([])

  // Filters
  const [courseFilter, setCourseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    loadCourses()
  }, [])

  useEffect(() => {
    loadAttendance()
  }, [courseFilter, statusFilter, dateFrom, dateTo])

  const loadCourses = async () => {
    try {
      const res = await axiosClient.get('/student/courses')
      const data = Array.isArray(res.data) ? res.data : []
      const unique = new Map<string, CourseOption>()
      data.forEach((c: any) => {
        if (!unique.has(c.course_id)) {
          unique.set(c.course_id, { course_id: c.course_id, code: c.code, name: c.name })
        }
      })
      setCourses(Array.from(unique.values()))
    } catch { /* ignore */ }
  }

  const loadAttendance = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (courseFilter) params.course_id = courseFilter
      if (statusFilter) params.status = statusFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo

      const res = await axiosClient.get('/student/attendance', { params })
      setRecords(res.data.records || [])
      setSummary(res.data.summary || null)
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load attendance' })
    } finally {
      setLoading(false)
    }
  }, [courseFilter, statusFilter, dateFrom, dateTo, addToast])

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-primary mb-2">My Attendance</h1>
        <p className="text-secondary mb-6">View your attendance records across all courses.</p>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            <div className="bg-sunken rounded-lg p-4 border border-subtle text-center">
              <div className="text-2xl font-bold text-primary">{summary.total}</div>
              <div className="text-xs text-secondary">Total</div>
            </div>
            <div className="bg-sunken rounded-lg p-4 border border-green-200 dark:border-green-800/50 text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">{summary.present}</div>
              <div className="text-xs text-secondary">Present</div>
            </div>
            <div className="bg-sunken rounded-lg p-4 border border-amber-200 dark:border-amber-800/50 text-center">
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{summary.late}</div>
              <div className="text-xs text-secondary">Late</div>
            </div>
            <div className="bg-sunken rounded-lg p-4 border border-red-200 dark:border-red-800/50 text-center">
              <div className="text-2xl font-bold text-red-700 dark:text-red-400">{summary.absent}</div>
              <div className="text-xs text-secondary">Absent</div>
            </div>
            <div className="bg-sunken rounded-lg p-4 border border-blue-200 dark:border-blue-800/50 text-center">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{summary.excused}</div>
              <div className="text-xs text-secondary">Excused</div>
            </div>
            <div className="bg-sunken rounded-lg p-4 border border-emerald-200 dark:border-emerald-800/50 text-center">
              <div className={`text-2xl font-bold ${summary.rate >= 75 ? 'text-emerald-700 dark:text-emerald-400' : summary.rate >= 50 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'}`}>
                {summary.rate}%
              </div>
              <div className="text-xs text-secondary">Rate</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="bg-sunken border border-strong text-primary text-sm rounded-lg px-3 py-2 focus:border-emerald-500 outline-none"
          >
            <option value="">All Courses</option>
            {courses.map((c) => (
              <option key={c.course_id} value={c.course_id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-sunken border border-strong text-primary text-sm rounded-lg px-3 py-2 focus:border-emerald-500 outline-none"
          >
            <option value="">All Statuses</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="excused">Excused</option>
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-sunken border border-strong text-primary text-sm rounded-lg px-3 py-2 focus:border-emerald-500 outline-none"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-sunken border border-strong text-primary text-sm rounded-lg px-3 py-2 focus:border-emerald-500 outline-none"
            placeholder="To"
          />

          {(courseFilter || statusFilter || dateFrom || dateTo) && (
            <button
              onClick={() => { setCourseFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); }}
              className="text-xs text-secondary hover:text-primary px-3 py-2"
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-secondary">Loading...</span>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-16 bg-sunken rounded-lg border border-subtle">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-lg text-secondary">No attendance records found</p>
            <p className="text-sm text-muted mt-1">Adjust your filters or check back after classes.</p>
          </div>
        ) : (
          <div className="bg-sunken rounded-lg border border-subtle overflow-hidden">
            <table className="w-full">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Course</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-secondary uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-secondary uppercase">Face</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-sunken transition-colors">
                    <td className="px-4 py-3 text-sm text-secondary">
                      {new Date(rec.attendance_date).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-primary">{rec.course_name}</div>
                      <div className="text-xs text-muted">{rec.course_code}{rec.section ? ` • Sec ${rec.section}` : ''}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 text-xs font-semibold rounded-full border capitalize ${STATUS_COLORS[rec.status] || 'text-secondary'}`}>
                        {rec.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      {rec.face_verified ? (
                        <span className="text-green-700 dark:text-green-400" title="Face verified">✅</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary truncate max-w-[200px]">
                      {rec.remarks || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

export default StudentAttendancePage
