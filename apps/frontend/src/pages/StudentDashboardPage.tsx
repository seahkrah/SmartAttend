/**
 * Student Dashboard Page
 *
 * Overview: attendance rate ring, today's schedule, recent attendance, enrolled courses count.
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../components/StudentLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'

interface DashboardData {
  student_name: string
  student_code: string
  enrolled_courses: number
  attendance_summary: {
    total_sessions: number
    present: number
    late: number
    absent: number
    excused: number
    rate: number
  }
  today_schedule: {
    id: string
    course_code: string
    course_name: string
    start_time: string
    end_time: string
    section: number | null
    room_name: string | null
  }[]
  recent_attendance: {
    attendance_date: string
    status: string
    face_verified: boolean | null
    course_code: string
    course_name: string
  }[]
}

const STATUS_COLORS: Record<string, string> = {
  present: 'text-green-400 bg-green-900/30 border-green-700/50',
  late: 'text-amber-400 bg-amber-900/30 border-amber-700/50',
  absent: 'text-red-400 bg-red-900/30 border-red-700/50',
  excused: 'text-blue-400 bg-blue-900/30 border-blue-700/50',
}

const STATUS_ICONS: Record<string, string> = {
  present: '✓',
  late: '⏰',
  absent: '✗',
  excused: '📋',
}

export const StudentDashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    try {
      const res = await axiosClient.get('/student/dashboard')
      setData(res.data)
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load dashboard' })
    } finally {
      setLoading(false)
    }
  }

  const att = data?.attendance_summary

  return (
    <StudentLayout currentPage="dashboard">
      <div className="max-w-6xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-slate-400">Loading dashboard...</span>
          </div>
        ) : !data ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">📭</div>
            <p className="text-xl text-slate-400">No data available</p>
          </div>
        ) : (
          <>
            {/* Welcome Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white">
                Welcome back, {data.student_name.split(' ')[0]}!
              </h1>
              <p className="text-slate-400 mt-1">
                {data.student_code} • {data.enrolled_courses} course{data.enrolled_courses !== 1 ? 's' : ''} enrolled
              </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {/* Attendance Rate */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 text-center">
                <div className="relative w-20 h-20 mx-auto mb-3">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="#334155" strokeWidth="6" />
                    <circle
                      cx="36" cy="36" r="30" fill="none"
                      stroke={att && att.rate >= 75 ? '#10b981' : att && att.rate >= 50 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${((att?.rate || 0) / 100) * 188.5} 188.5`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-white">{att?.rate || 0}%</span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Attendance Rate</p>
              </div>

              {/* Present */}
              <div className="bg-slate-800 rounded-xl border border-green-800/50 p-5 text-center">
                <div className="text-3xl font-bold text-green-400 mb-1">{att?.present || 0}</div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Present</p>
                <p className="text-xs text-slate-500 mt-1">of {att?.total_sessions || 0} sessions</p>
              </div>

              {/* Late */}
              <div className="bg-slate-800 rounded-xl border border-amber-800/50 p-5 text-center">
                <div className="text-3xl font-bold text-amber-400 mb-1">{att?.late || 0}</div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Late</p>
              </div>

              {/* Absent */}
              <div className="bg-slate-800 rounded-xl border border-red-800/50 p-5 text-center">
                <div className="text-3xl font-bold text-red-400 mb-1">{att?.absent || 0}</div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Absent</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Today's Schedule */}
              <div className="bg-slate-800 rounded-xl border border-slate-700">
                <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="font-semibold text-white">Today's Schedule</h3>
                  <button
                    onClick={() => navigate('/student/schedule')}
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    View Full →
                  </button>
                </div>
                <div className="p-4">
                  {data.today_schedule.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-6">No classes today 🎉</p>
                  ) : (
                    <div className="space-y-3">
                      {data.today_schedule.map((cls) => (
                        <div
                          key={cls.id}
                          className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg border border-slate-700/50"
                        >
                          <div className="w-12 text-center">
                            <div className="text-sm font-bold text-white">
                              {cls.start_time?.slice(0, 5)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {cls.end_time?.slice(0, 5)}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{cls.course_name}</p>
                            <p className="text-xs text-slate-400">
                              {cls.course_code}
                              {cls.section ? ` • Sec ${cls.section}` : ''}
                              {cls.room_name ? ` • ${cls.room_name}` : ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Attendance */}
              <div className="bg-slate-800 rounded-xl border border-slate-700">
                <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="font-semibold text-white">Recent Attendance</h3>
                  <button
                    onClick={() => navigate('/student/attendance')}
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    View All →
                  </button>
                </div>
                <div className="p-4">
                  {data.recent_attendance.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-6">No attendance records yet</p>
                  ) : (
                    <div className="space-y-2">
                      {data.recent_attendance.map((rec, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-700/50 bg-slate-700/20"
                        >
                          <span
                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold border ${
                              STATUS_COLORS[rec.status] || 'text-slate-400 bg-slate-800 border-slate-600'
                            }`}
                          >
                            {STATUS_ICONS[rec.status] || '?'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{rec.course_name}</p>
                            <p className="text-xs text-slate-500">
                              {new Date(rec.attendance_date).toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric',
                              })}
                              {rec.face_verified && ' • 📷 Face verified'}
                            </p>
                          </div>
                          <span className={`text-xs font-medium capitalize px-2 py-0.5 rounded ${STATUS_COLORS[rec.status]}`}>
                            {rec.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </StudentLayout>
  )
}

export default StudentDashboardPage
