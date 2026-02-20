/**
 * Student Schedule Page
 *
 * Weekly timetable grid + list view toggle.
 */

import React, { useState, useEffect } from 'react'
import { StudentLayout } from '../components/StudentLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'

interface ScheduleItem {
  schedule_id: string
  course_code: string
  course_name: string
  start_time: string
  end_time: string
  day_of_week: number | null
  days_of_week: string | null
  section: number | null
  room_name: string | null
  faculty_name: string | null
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DAY_COLORS = [
  'border-l-red-500',
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-amber-500',
  'border-l-purple-500',
  'border-l-cyan-500',
  'border-l-pink-500',
]

function expandScheduleByDay(items: ScheduleItem[]): Map<number, ScheduleItem[]> {
  const dayMap = new Map<number, ScheduleItem[]>()
  for (let d = 0; d < 7; d++) dayMap.set(d, [])

  for (const item of items) {
    if (item.days_of_week) {
      const days = item.days_of_week.split(',').map((d) => parseInt(d.trim()))
      for (const day of days) {
        if (dayMap.has(day)) {
          dayMap.get(day)!.push(item)
        }
      }
    } else if (item.day_of_week != null) {
      if (dayMap.has(item.day_of_week)) {
        dayMap.get(item.day_of_week)!.push(item)
      }
    }
  }

  // Sort each day by start_time
  for (const [, items] of dayMap) {
    items.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  }

  return dayMap
}

export const StudentSchedulePage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'timetable' | 'list'>('timetable')

  useEffect(() => {
    loadSchedule()
  }, [])

  const loadSchedule = async () => {
    try {
      const res = await axiosClient.get('/student/schedules')
      setSchedule(Array.isArray(res.data) ? res.data : [])
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load schedule' })
    } finally {
      setLoading(false)
    }
  }

  const dayMap = expandScheduleByDay(schedule)
  const todayIdx = new Date().getDay()

  return (
    <StudentLayout currentPage="schedule">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">My Schedule</h1>
            <p className="text-slate-400 mt-1">Weekly class timetable</p>
          </div>
          <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
            <button
              onClick={() => setView('timetable')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${
                view === 'timetable' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Timetable
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${
                view === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              List
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-slate-400">Loading schedule...</span>
          </div>
        ) : schedule.length === 0 ? (
          <div className="text-center py-20 bg-slate-800 rounded-lg border border-slate-700">
            <div className="text-5xl mb-4">📅</div>
            <p className="text-xl text-slate-400">No schedule found</p>
            <p className="text-sm text-slate-500 mt-2">You haven't been enrolled in any classes yet.</p>
          </div>
        ) : view === 'timetable' ? (
          /* ── Timetable View ── */
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {DAYS.map((_dayName, dayIdx) => {
              const items = dayMap.get(dayIdx) || []
              const isToday = dayIdx === todayIdx
              return (
                <div
                  key={dayIdx}
                  className={`bg-slate-800 rounded-lg border ${
                    isToday ? 'border-emerald-600/50 ring-1 ring-emerald-600/20' : 'border-slate-700'
                  }`}
                >
                  <div className={`px-3 py-2 border-b ${
                    isToday ? 'border-emerald-700/50 bg-emerald-900/20' : 'border-slate-700 bg-slate-700/40'
                  }`}>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${
                      isToday ? 'text-emerald-400' : 'text-slate-400'
                    }`}>
                      {SHORT_DAYS[dayIdx]}
                      {isToday && <span className="ml-1 text-emerald-500">•</span>}
                    </p>
                  </div>
                  <div className="p-2 space-y-2 min-h-[80px]">
                    {items.length === 0 ? (
                      <p className="text-xs text-slate-600 text-center py-4">Free</p>
                    ) : (
                      items.map((item, i) => (
                        <div
                          key={`${item.schedule_id}-${i}`}
                          className={`p-2 rounded bg-slate-700/40 border-l-2 ${DAY_COLORS[dayIdx % DAY_COLORS.length]}`}
                        >
                          <p className="text-xs font-semibold text-white truncate">{item.course_code}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {item.start_time?.slice(0, 5)}–{item.end_time?.slice(0, 5)}
                          </p>
                          {item.room_name && (
                            <p className="text-xs text-slate-500 mt-0.5">📍 {item.room_name}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── List View ── */
          <div className="space-y-2">
            {DAYS.map((dayName, dayIdx) => {
              const items = dayMap.get(dayIdx) || []
              if (items.length === 0) return null
              const isToday = dayIdx === todayIdx
              return (
                <div key={dayIdx}>
                  <h3 className={`text-sm font-semibold uppercase tracking-wider mb-2 ${
                    isToday ? 'text-emerald-400' : 'text-slate-400'
                  }`}>
                    {dayName} {isToday && '(Today)'}
                  </h3>
                  <div className="space-y-2 mb-4">
                    {items.map((item, i) => (
                      <div
                        key={`${item.schedule_id}-${i}`}
                        className={`flex items-center gap-4 p-4 bg-slate-800 rounded-lg border ${
                          isToday ? 'border-emerald-700/50' : 'border-slate-700'
                        }`}
                      >
                        <div className="w-20 text-center">
                          <div className="text-sm font-bold text-white">{item.start_time?.slice(0, 5)}</div>
                          <div className="text-xs text-slate-500">{item.end_time?.slice(0, 5)}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white">{item.course_name}</p>
                          <p className="text-xs text-slate-400">
                            {item.course_code}
                            {item.section ? ` • Sec ${item.section}` : ''}
                            {item.room_name ? ` • ${item.room_name}` : ''}
                          </p>
                        </div>
                        {item.faculty_name && (
                          <div className="text-xs text-slate-500 hidden md:block">{item.faculty_name}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </StudentLayout>
  )
}

export default StudentSchedulePage
