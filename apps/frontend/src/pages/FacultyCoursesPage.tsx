/**
 * Faculty Courses Page
 *
 * Shows all courses assigned to the faculty member with
 * per-course attendance summaries and roster links.
 */

import React, { useEffect, useState } from 'react'
import FacultyLayout from '../components/FacultyLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react'

interface Course {
  id: string
  name: string
  code: string
  description?: string
  credits: number
}

interface AttendanceSummary {
  student_id: string
  student_name: string
  classes_total: string
  present: string
  absent: string
  late: string
  excused: string
  attendance_percent: number
}

const FacultyCoursesPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Record<string, AttendanceSummary[]>>({})
  const [loadingSummary, setLoadingSummary] = useState<string | null>(null)

  useEffect(() => {
    loadCourses()
  }, [])

  const loadCourses = async () => {
    try {
      const res = await axiosClient.get('/faculty/courses')
      setCourses(Array.isArray(res.data) ? res.data : [])
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load courses' })
    } finally {
      setLoading(false)
    }
  }

  const toggleCourse = async (courseId: string) => {
    if (expandedCourse === courseId) {
      setExpandedCourse(null)
      return
    }
    setExpandedCourse(courseId)

    if (!summaries[courseId]) {
      setLoadingSummary(courseId)
      try {
        const res = await axiosClient.get(`/faculty/courses/${courseId}/attendance-summary`)
        setSummaries((prev) => ({ ...prev, [courseId]: res.data }))
      } catch {
        addToast({ type: 'error', title: 'Error', message: 'Failed to load attendance data' })
      } finally {
        setLoadingSummary(null)
      }
    }
  }

  const getCourseAvg = (courseId: string): number | null => {
    const data = summaries[courseId]
    if (!data || data.length === 0) return null
    const total = data.reduce((acc, s) => acc + s.attendance_percent, 0)
    return Math.round(total / data.length)
  }

  const rateColor = (pct: number) =>
    pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'

  if (loading) {
    return (
      <FacultyLayout currentPage="courses">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-slate-400">Loading courses...</span>
        </div>
      </FacultyLayout>
    )
  }

  return (
    <FacultyLayout currentPage="courses">
      <div className="space-y-4">
        {courses.length === 0 ? (
          <div className="text-center py-20">
            <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-600" />
            <p className="text-slate-400 text-lg">No courses assigned</p>
            <p className="text-slate-500 text-sm mt-1">
              Contact your administrator to assign class schedules.
            </p>
          </div>
        ) : (
          courses.map((course) => {
            const isOpen = expandedCourse === course.id
            const summary = summaries[course.id]
            const avg = getCourseAvg(course.id)

            return (
              <div
                key={course.id}
                className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"
              >
                <button
                  onClick={() => toggleCourse(course.id)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-white font-semibold">{course.code}</h3>
                      <p className="text-sm text-slate-400">{course.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {avg !== null && (
                      <span className={`text-sm font-semibold ${rateColor(avg)}`}>
                        {avg}% avg
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{course.credits} cr</span>
                    {isOpen ? (
                      <ChevronUp className="w-5 h-5 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-500" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-700 px-6 py-4">
                    {loadingSummary === course.id ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : summary && summary.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700">
                              <th className="text-left py-2 px-2">Student</th>
                              <th className="text-center py-2 px-2">
                                <CheckCircle className="w-4 h-4 inline text-emerald-400" /> Present
                              </th>
                              <th className="text-center py-2 px-2">
                                <XCircle className="w-4 h-4 inline text-red-400" /> Absent
                              </th>
                              <th className="text-center py-2 px-2">
                                <Clock className="w-4 h-4 inline text-amber-400" /> Late
                              </th>
                              <th className="text-center py-2 px-2">
                                <AlertCircle className="w-4 h-4 inline text-blue-400" /> Excused
                              </th>
                              <th className="text-center py-2 px-2">Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.map((s) => (
                              <tr key={s.student_id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                <td className="py-2.5 px-2 text-white">{s.student_name}</td>
                                <td className="py-2.5 px-2 text-center text-emerald-400 font-medium">
                                  {s.present}
                                </td>
                                <td className="py-2.5 px-2 text-center text-red-400 font-medium">
                                  {s.absent}
                                </td>
                                <td className="py-2.5 px-2 text-center text-amber-400 font-medium">
                                  {s.late}
                                </td>
                                <td className="py-2.5 px-2 text-center text-blue-400 font-medium">
                                  {s.excused}
                                </td>
                                <td className={`py-2.5 px-2 text-center font-bold ${rateColor(s.attendance_percent)}`}>
                                  {s.attendance_percent}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-center text-slate-500 py-6 text-sm">
                        No attendance records yet for this course.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </FacultyLayout>
  )
}

export default FacultyCoursesPage
