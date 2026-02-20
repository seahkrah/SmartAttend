/**
 * Faculty Dashboard Page
 *
 * Overview for faculty:
 * - Total students, courses, schedules
 * - Today's classes
 * - Recent attendance stats
 * - Quick actions
 */

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FacultyLayout from '../components/FacultyLayout'
import { axiosClient } from '../utils/axiosClient'
import {
  Users,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  TrendingUp,
  Clock,
  UserPlus,
  ArrowRight,
} from 'lucide-react'

interface DashboardData {
  total_students: number
  total_courses: number
  total_schedules: number
  today_classes: TodayClass[]
  attendance_rate: number
  recent_sessions: number
  course_breakdown: { courseCode: string; courseName: string; studentCount: number }[]
}

interface TodayClass {
  schedule_id: string
  course_name: string
  course_code: string
  room_name: string
  start_time: string
  end_time: string
  section: number
  student_count: string
  days_of_week: string
}

function formatTime(t: string) {
  return t?.slice(0, 5) || ''
}

const FacultyDashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    try {
      const res = await axiosClient.get('/faculty/dashboard')
      setData(res.data)
    } catch {
      // error
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <FacultyLayout currentPage="dashboard">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-slate-400">Loading dashboard...</span>
        </div>
      </FacultyLayout>
    )
  }

  if (!data) {
    return (
      <FacultyLayout currentPage="dashboard">
        <div className="text-center py-20 text-slate-400">Failed to load dashboard data.</div>
      </FacultyLayout>
    )
  }

  const statCards = [
    { label: 'Total Students', value: data.total_students, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
    { label: 'Courses', value: data.total_courses, icon: BookOpen, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
    { label: 'Schedules', value: data.total_schedules, icon: CalendarDays, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
    { label: 'Attendance Rate', value: `${data.attendance_rate}%`, icon: TrendingUp, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  ]

  return (
    <FacultyLayout currentPage="dashboard">
      <div className="space-y-8">
        {/* ── Stat cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-xl border p-5 ${card.bg} transition-transform hover:scale-[1.02]`}
            >
              <div className="flex items-center justify-between mb-3">
                <card.icon className={`w-6 h-6 ${card.color}`} />
              </div>
              <div className="text-3xl font-bold text-white">{card.value}</div>
              <div className="text-sm text-slate-400 mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        {/* ── Today's classes + Quick actions ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Today's classes */}
          <div className="lg:col-span-2 rounded-xl border border-slate-700 bg-slate-800/50">
            <div className="border-b border-slate-700 px-5 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-400" />
                Today's Classes
              </h3>
              <span className="text-xs text-slate-500">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className="p-4">
              {data.today_classes.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>No classes scheduled for today</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.today_classes.map((cls) => (
                    <button
                      key={cls.schedule_id}
                      onClick={() => navigate('/faculty/attendance')}
                      className="w-full flex items-center gap-4 p-4 rounded-lg bg-slate-700/50 border border-slate-600/50 hover:border-indigo-500/50 hover:bg-slate-700 transition-all text-left group"
                    >
                      <div className="w-14 h-14 rounded-lg bg-indigo-500/20 flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-xs text-indigo-300 font-medium">{formatTime(cls.start_time)}</span>
                        <span className="text-[10px] text-slate-500">to</span>
                        <span className="text-xs text-indigo-300 font-medium">{formatTime(cls.end_time)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                          {cls.course_name}
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {cls.course_code} • Section {cls.section} • {cls.room_name || 'No room'}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {cls.student_count} students
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={() => navigate('/faculty/attendance')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 transition-colors text-sm font-medium"
                >
                  <ClipboardCheck className="w-5 h-5" />
                  Take Attendance
                </button>
                <button
                  onClick={() => navigate('/faculty/enrollment')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors text-sm font-medium"
                >
                  <UserPlus className="w-5 h-5" />
                  Manage Enrollment
                </button>
                <button
                  onClick={() => navigate('/faculty/students')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors text-sm font-medium"
                >
                  <Users className="w-5 h-5" />
                  View All Students
                </button>
                <button
                  onClick={() => navigate('/faculty/reports')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30 transition-colors text-sm font-medium"
                >
                  <TrendingUp className="w-5 h-5" />
                  View Reports
                </button>
              </div>
            </div>

            {/* Course breakdown */}
            {data.course_breakdown.length > 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Students per Course</h3>
                <div className="space-y-2">
                  {data.course_breakdown.map((c) => (
                    <div key={c.courseCode} className="flex items-center justify-between">
                      <div className="min-w-0 flex-1 mr-3">
                        <p className="text-sm text-white truncate">{c.courseName}</p>
                        <p className="text-xs text-slate-500">{c.courseCode}</p>
                      </div>
                      <span className="text-lg font-bold text-indigo-400 tabular-nums">{c.studentCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </FacultyLayout>
  )
}

export default FacultyDashboardPage
