/**
 * Faculty Students Page
 *
 * Shows all students across the faculty's courses/schedules.
 * Filterable by course. Shows attendance summary per student.
 */

import React, { useEffect, useState, useMemo } from 'react'
import { axiosClient } from '../utils/axiosClient'
import { Search, Users, Filter, ChevronDown } from 'lucide-react'

interface Student {
  student_id: string
  student_code: string
  first_name: string
  last_name: string
  email: string
  course_code: string
  course_name: string
  schedule_section: number
  attendance_percent: number | null
  total_classes: number
  present_count: number
  absent_count: number
}

interface CourseOption {
  course_id: string
  course_code: string
  course_name: string
}

const FacultyStudentsPage: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([])
  const [courses, setCourses] = useState<CourseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCourse, setSelectedCourse] = useState<string>('all')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [studentsRes, coursesRes] = await Promise.all([
        axiosClient.get('/faculty/students'),
        axiosClient.get('/faculty/courses'),
      ])
      setStudents(studentsRes.data)
      // /faculty/courses answers with the course's own column names (id,
      // code, name); this page's filter was written against course_* names
      // that endpoint never sent, so the dropdown offered one blank option.
      setCourses((coursesRes.data ?? []).map((c: any) => ({
        course_id: c.id, course_code: c.code, course_name: c.name,
      })))
    } catch {
      // error
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const matchSearch =
        searchTerm === '' ||
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.student_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.email?.toLowerCase().includes(searchTerm.toLowerCase())
      const matchCourse = selectedCourse === 'all' || s.course_code === selectedCourse
      return matchSearch && matchCourse
    })
  }, [students, searchTerm, selectedCourse])

  // Unique students count
  const uniqueStudentIds = useMemo(
    () => new Set(filtered.map((s) => s.student_id)).size,
    [filtered]
  )

  return (
    <>
      <div className="space-y-6">
        {/* Header + stats */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-secondary text-sm">
              {uniqueStudentIds} unique student{uniqueStudentIds !== 1 ? 's' : ''} across{' '}
              {courses.length} course{courses.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
            <input
              type="text"
              placeholder="Search by name, ID, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-sunken border border-subtle rounded-lg text-primary text-sm placeholder:text-muted focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="pl-10 pr-8 py-2 bg-sunken border border-subtle rounded-lg text-primary text-sm appearance-none cursor-pointer focus:border-indigo-500 outline-none min-w-[200px]"
            >
              <option value="all">All Courses</option>
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_code}>
                  {c.course_code} — {c.course_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-muted pointer-events-none" />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-secondary">Loading students...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-sunken rounded-xl border border-subtle">
            <Users className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p className="text-secondary">
              {searchTerm || selectedCourse !== 'all'
                ? 'No students match your filters'
                : 'No students enrolled in your schedules'}
            </p>
          </div>
        ) : (
          <div className="bg-sunken rounded-xl border border-subtle overflow-hidden">
            <table className="w-full">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Course</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-secondary uppercase tracking-wider">Classes</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-secondary uppercase tracking-wider">Present</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-secondary uppercase tracking-wider">Absent</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-secondary uppercase tracking-wider">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {filtered.map((s, idx) => {
                  const rate = s.total_classes > 0
                    ? Math.round((s.present_count / s.total_classes) * 100)
                    : null
                  return (
                    <tr key={`${s.student_id}-${s.course_code}`} className="hover:bg-sunken transition-colors">
                      <td className="px-4 py-3 text-sm text-muted">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-primary">{s.first_name} {s.last_name}</div>
                        <div className="text-xs text-muted">{s.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-secondary">{s.student_code || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-sunken text-secondary px-2 py-1 rounded">{s.course_code}</span>
                        {s.schedule_section > 0 && (
                          <span className="text-xs text-muted ml-1">S{s.schedule_section}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-secondary">{s.total_classes}</td>
                      <td className="px-4 py-3 text-center text-sm text-green-700 dark:text-green-400">{s.present_count}</td>
                      <td className="px-4 py-3 text-center text-sm text-red-700 dark:text-red-400">{s.absent_count}</td>
                      <td className="px-4 py-3 text-center">
                        {rate !== null ? (
                          <span
                            className={`text-sm font-semibold ${
                              rate >= 75 ? 'text-green-700 dark:text-green-400' : rate >= 50 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {rate}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

export default FacultyStudentsPage
