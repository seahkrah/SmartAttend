/**
 * Faculty Schedules Page
 *
 * Shows a weekly timetable grid of all class schedules assigned
 * to the faculty member, with course info, room, and student counts.
 */

import React, { useEffect, useState } from 'react'
import FacultyLayout from '../components/FacultyLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  MapPin,
  Users,
  Clock,
  BookOpen,
  ChevronRight,
} from 'lucide-react'

interface Schedule {
  id: string
  course_id: string
  course_name: string
  course_code: string
  room_name: string | null
  days_of_week: string
  start_time: string
  end_time: string
  section: number
  student_count: string
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SCHEDULE_COLORS = [
  'from-indigo-500/80 to-indigo-600/80 border-indigo-400/40',
  'from-emerald-500/80 to-emerald-600/80 border-emerald-400/40',
  'from-purple-500/80 to-purple-600/80 border-purple-400/40',
  'from-orange-500/80 to-orange-600/80 border-orange-400/40',
  'from-cyan-500/80 to-cyan-600/80 border-cyan-400/40',
  'from-rose-500/80 to-rose-600/80 border-rose-400/40',
  'from-amber-500/80 to-amber-600/80 border-amber-400/40',
  'from-teal-500/80 to-teal-600/80 border-teal-400/40',
]

function formatTime(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hr = parseInt(h, 10)
  const ampm = hr >= 12 ? 'PM' : 'AM'
  const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
  return `${hr12}:${m} ${ampm}`
}

function parseDays(days: string): number[] {
  if (!days) return []
  return days.split(',').map((d) => parseInt(d.trim(), 10)).filter((n) => !isNaN(n))
}

const FacultySchedulesPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'timetable' | 'list'>('timetable')

  useEffect(() => {
    loadSchedules()
  }, [])

  const loadSchedules = async () => {
    try {
      const res = await axiosClient.get('/faculty/schedules')
      setSchedules(Array.isArray(res.data) ? res.data : [])
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load schedules' })
    } finally {
      setLoading(false)
    }
  }

  // Build color map per course
  const courseColorMap: Record<string, string> = {}
  let colorIdx = 0
  schedules.forEach((s) => {
    if (!courseColorMap[s.course_id]) {
      courseColorMap[s.course_id] = SCHEDULE_COLORS[colorIdx % SCHEDULE_COLORS.length]
      colorIdx++
    }
  })

  // Build a grid: for each day (1-6 Mon-Sat + 0 Sun), which schedules fall on it
  const daySchedules: Record<number, Schedule[]> = {}
  for (let d = 0; d < 7; d++) daySchedules[d] = []
  schedules.forEach((s) => {
    const days = parseDays(s.days_of_week)
    days.forEach((d) => {
      daySchedules[d]?.push(s)
    })
  })

  // Get current day highlight
  const todayIdx = new Date().getDay()

  // Compute totals
  const totalStudents = schedules.reduce((acc, s) => acc + parseInt(s.student_count || '0'), 0)
  const uniqueCourses = new Set(schedules.map((s) => s.course_id)).size
  const activeDays = new Set(
    schedules.flatMap((s) => parseDays(s.days_of_week))
  ).size

  if (loading) {
    return (
      <FacultyLayout currentPage="schedules">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-slate-400">Loading schedules...</span>
        </div>
      </FacultyLayout>
    )
  }

  if (schedules.length === 0) {
    return (
      <FacultyLayout currentPage="schedules">
        <div className="text-center py-20">
          <CalendarDays className="w-12 h-12 mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400 text-lg">No schedules assigned</p>
          <p className="text-slate-500 text-sm mt-1">
            Contact your administrator to assign class schedules.
          </p>
        </div>
      </FacultyLayout>
    )
  }

  return (
    <FacultyLayout currentPage="schedules">
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Schedules</p>
            <p className="text-2xl font-bold text-white mt-1">{schedules.length}</p>
          </div>
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Courses</p>
            <p className="text-2xl font-bold text-white mt-1">{uniqueCourses}</p>
          </div>
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Total Enrolled</p>
            <p className="text-2xl font-bold text-white mt-1">{totalStudents}</p>
          </div>
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Active Days</p>
            <p className="text-2xl font-bold text-white mt-1">{activeDays}/7</p>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('timetable')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'timetable'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            Timetable View
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            List View
          </button>
        </div>

        {/* ── TIMETABLE VIEW ── */}
        {viewMode === 'timetable' && (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-2 min-w-[700px]">
              {/* Day headers */}
              {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => (
                <div
                  key={dayIdx}
                  className={`text-center py-2 rounded-t-lg text-sm font-semibold ${
                    dayIdx === todayIdx
                      ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {DAY_SHORT[dayIdx]}
                  {dayIdx === todayIdx && (
                    <span className="ml-1 text-[10px] bg-violet-500 text-white px-1.5 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>
              ))}

              {/* Day columns */}
              {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => (
                <div key={`col-${dayIdx}`} className="space-y-2 min-h-[120px]">
                  {daySchedules[dayIdx].length === 0 ? (
                    <div className="text-center py-8 text-slate-600 text-xs">No classes</div>
                  ) : (
                    daySchedules[dayIdx]
                      .sort((a, b) => a.start_time.localeCompare(b.start_time))
                      .map((s) => (
                        <div
                          key={`${dayIdx}-${s.id}`}
                          className={`rounded-lg p-3 bg-gradient-to-br border cursor-pointer hover:scale-[1.02] transition-transform ${courseColorMap[s.course_id]}`}
                          onClick={() => navigate('/faculty/attendance')}
                          title={`${s.course_name} — Click to take attendance`}
                        >
                          <p className="text-white font-bold text-sm leading-tight">
                            {s.course_code}
                          </p>
                          <p className="text-white/70 text-xs mt-0.5">Sec {s.section}</p>
                          <div className="flex items-center gap-1 mt-2 text-white/80 text-xs">
                            <Clock className="w-3 h-3" />
                            <span>
                              {formatTime(s.start_time)}–{formatTime(s.end_time)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-1 text-white/80 text-xs">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">{s.room_name || 'TBD'}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-1 text-white/80 text-xs">
                            <Users className="w-3 h-3" />
                            <span>{s.student_count} student{parseInt(s.student_count) !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {viewMode === 'list' && (
          <div className="space-y-3">
            {schedules.map((s) => {
              const days = parseDays(s.days_of_week)
              return (
                <div
                  key={s.id}
                  className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 flex items-center justify-between hover:bg-slate-800/80 transition-colors group"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div
                      className={`w-12 h-12 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 ${courseColorMap[s.course_id]}`}
                    >
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-white font-semibold text-base">
                        {s.course_code} — {s.course_name}
                      </h3>
                      <p className="text-slate-400 text-sm mt-0.5">
                        Section {s.section}
                      </p>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatTime(s.start_time)} – {formatTime(s.end_time)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {s.room_name || 'No room'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {s.student_count} enrolled
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5" />
                          {days.map((d) => DAY_SHORT[d]).join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate('/faculty/attendance')}
                    className="ml-4 flex items-center gap-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Attendance <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </FacultyLayout>
  )
}

export default FacultySchedulesPage
