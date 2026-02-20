/**
 * Faculty Students Page
 *
 * Shows all students across the faculty's courses/schedules.
 * Filterable by course. Shows attendance summary per student.
 */

import React, { useEffect, useState, useMemo } from 'react'
import FacultyLayout from '../components/FacultyLayout'
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
      setCourses(coursesRes.data)
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
    <FacultyLayout currentPage="students">
      <div className="space-y-6">
        {/* Header + stats */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-slate-400 text-sm">
              {uniqueStudentIds} unique student{uniqueStudentIds !== 1 ? 's' : ''} across{' '}
              {courses.length} course{courses.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, ID, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="pl-10 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm appearance-none cursor-pointer focus:border-indigo-500 outline-none min-w-[200px]"
            >
              <option value="all">All Courses</option>
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_code}>
                  {c.course_code} — {c.course_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-slate-400">Loading students...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-slate-800/50 rounded-xl border border-slate-700">
            <Users className="w-12 h-12 mx-auto mb-3 text-slate-600" />
            <p className="text-slate-400">
              {searchTerm || selectedCourse !== 'all'
                ? 'No students match your filters'
                : 'No students enrolled in your schedules'}
            </p>
          </div>
        ) : (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-700/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Course</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Classes</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Present</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Absent</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {filtered.map((s, idx) => {
                  const rate = s.total_classes > 0
                    ? Math.round((s.present_count / s.total_classes) * 100)
                    : null
                  return (
                    <tr key={`${s.student_id}-${s.course_code}`} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-white">{s.first_name} {s.last_name}</div>
                        <div className="text-xs text-slate-500">{s.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-400">{s.student_code || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">{s.course_code}</span>
                        {s.schedule_section > 0 && (
                          <span className="text-xs text-slate-500 ml-1">S{s.schedule_section}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-300">{s.total_classes}</td>
                      <td className="px-4 py-3 text-center text-sm text-green-400">{s.present_count}</td>
                      <td className="px-4 py-3 text-center text-sm text-red-400">{s.absent_count}</td>
                      <td className="px-4 py-3 text-center">
                        {rate !== null ? (
                          <span
                            className={`text-sm font-semibold ${
                              rate >= 75 ? 'text-green-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'
                            }`}
                          >
                            {rate}%
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
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
    </FacultyLayout>
  )
}

export default FacultyStudentsPage
