/**
 * Student Courses Page
 *
 * Displays enrolled courses with schedule, faculty, and room info.
 */

import React, { useState, useEffect } from 'react'
import { StudentLayout } from '../components/StudentLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'

interface Course {
  course_id: string
  code: string
  name: string
  credits: number | null
  description: string | null
  schedule_id: string
  start_time: string
  end_time: string
  day_of_week: number | null
  days_of_week: string | null
  section: number | null
  room_name: string | null
  faculty_name: string | null
  enrolled_at: string
}

const DAY_MAP: Record<number, string> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
}

function formatDays(dayOfWeek: number | null, daysOfWeek: string | null): string {
  if (daysOfWeek) {
    return daysOfWeek.split(',').map((d) => DAY_MAP[parseInt(d.trim())] || d.trim()).join(', ')
  }
  if (dayOfWeek != null) return DAY_MAP[dayOfWeek] || `Day ${dayOfWeek}`
  return '—'
}

export const StudentCoursesPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCourses()
  }, [])

  const loadCourses = async () => {
    try {
      const res = await axiosClient.get('/student/courses')
      setCourses(Array.isArray(res.data) ? res.data : [])
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load courses' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <StudentLayout currentPage="courses">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">My Courses</h1>
        <p className="text-slate-400 mb-8">
          {courses.length} course{courses.length !== 1 ? 's' : ''} enrolled
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-slate-400">Loading courses...</span>
          </div>
        ) : courses.length === 0 ? (
          <div className="text-center py-20 bg-slate-800 rounded-lg border border-slate-700">
            <div className="text-5xl mb-4">📚</div>
            <p className="text-xl text-slate-400">No courses enrolled</p>
            <p className="text-sm text-slate-500 mt-2">Contact your admin or faculty to be enrolled in courses.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => (
              <div
                key={course.schedule_id}
                className="bg-slate-800 rounded-xl border border-slate-700 p-5 hover:border-emerald-600/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{course.name}</h3>
                    <p className="text-sm text-slate-400">{course.code}{course.section ? ` • Section ${course.section}` : ''}</p>
                  </div>
                  {course.credits && (
                    <span className="text-xs bg-emerald-900/40 text-emerald-400 px-2 py-1 rounded border border-emerald-700/50">
                      {course.credits} cr
                    </span>
                  )}
                </div>

                {course.description && (
                  <p className="text-xs text-slate-500 mb-3 line-clamp-2">{course.description}</p>
                )}

                <div className="space-y-1.5 text-sm text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 w-16">Days:</span>
                    <span className="text-slate-300">{formatDays(course.day_of_week, course.days_of_week)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 w-16">Time:</span>
                    <span className="text-slate-300">
                      {course.start_time?.slice(0, 5)} – {course.end_time?.slice(0, 5)}
                    </span>
                  </div>
                  {course.room_name && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 w-16">Room:</span>
                      <span className="text-slate-300">{course.room_name}</span>
                    </div>
                  )}
                  {course.faculty_name && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 w-16">Faculty:</span>
                      <span className="text-slate-300">{course.faculty_name}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
                  Enrolled {new Date(course.enrolled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </StudentLayout>
  )
}

export default StudentCoursesPage
