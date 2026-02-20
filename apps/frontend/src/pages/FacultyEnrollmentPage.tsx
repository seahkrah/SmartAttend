/**
 * Faculty Enrollment Page
 *
 * Allows faculty to:
 * - View enrolled students per schedule
 * - Search and add students to their schedules
 * - Remove students from their schedules
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import FacultyLayout from '../components/FacultyLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'
import {
  UserPlus,
  UserMinus,
  Search,
  Users,
  BookOpen,
  AlertCircle,
} from 'lucide-react'

interface Schedule {
  id: string
  course_id: string
  course_name: string
  course_code: string
  room_name: string
  days_of_week: string
  start_time: string
  end_time: string
  section: number
  student_count: string
}

interface EnrolledStudent {
  student_id: string
  student_code: string
  first_name: string
  last_name: string
  email: string
  enrolled_at: string
}

interface AvailableStudent {
  id: string
  student_id: string
  first_name: string
  last_name: string
  email: string
}

const FacultyEnrollmentPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [enrolled, setEnrolled] = useState<EnrolledStudent[]>([])
  const [available, setAvailable] = useState<AvailableStudent[]>([])
  const [loadingSchedules, setLoadingSchedules] = useState(true)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [searchAvailable, setSearchAvailable] = useState('')
  const [searchEnrolled, setSearchEnrolled] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    loadSchedules()
  }, [])

  const loadSchedules = async () => {
    try {
      const res = await axiosClient.get('/faculty/schedules')
      const data = Array.isArray(res.data) ? res.data : []
      setSchedules(data)
      if (data.length > 0) {
        selectSchedule(data[0])
      }
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load schedules' })
    } finally {
      setLoadingSchedules(false)
    }
  }

  const selectSchedule = useCallback(async (schedule: Schedule) => {
    setSelectedSchedule(schedule)
    setLoadingStudents(true)
    try {
      const [enrolledRes, availableRes] = await Promise.all([
        axiosClient.get(`/faculty/enrollment/enrolled?schedule_id=${schedule.id}`),
        axiosClient.get(`/faculty/enrollment/available?schedule_id=${schedule.id}`),
      ])
      setEnrolled(enrolledRes.data)
      setAvailable(availableRes.data)
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load enrollment data' })
    } finally {
      setLoadingStudents(false)
    }
  }, [addToast])

  const handleAdd = async (studentId: string) => {
    if (!selectedSchedule) return
    setAdding(studentId)
    try {
      await axiosClient.post('/faculty/enrollment/add', {
        schedule_id: selectedSchedule.id,
        student_id: studentId,
      })
      addToast({ type: 'success', title: 'Enrolled', message: 'Student added to schedule' })
      // Refresh
      selectSchedule(selectedSchedule)
      // Update schedule count locally
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === selectedSchedule.id
            ? { ...s, student_count: String(parseInt(s.student_count) + 1) }
            : s
        )
      )
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to add student'
      addToast({ type: 'error', title: 'Error', message: msg })
    } finally {
      setAdding(null)
    }
  }

  const handleRemove = async (studentId: string) => {
    if (!selectedSchedule) return
    if (!window.confirm('Remove this student from the schedule?')) return
    setRemoving(studentId)
    try {
      await axiosClient.post('/faculty/enrollment/remove', {
        schedule_id: selectedSchedule.id,
        student_id: studentId,
      })
      addToast({ type: 'success', title: 'Removed', message: 'Student removed from schedule' })
      selectSchedule(selectedSchedule)
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === selectedSchedule.id
            ? { ...s, student_count: String(Math.max(0, parseInt(s.student_count) - 1)) }
            : s
        )
      )
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to remove student'
      addToast({ type: 'error', title: 'Error', message: msg })
    } finally {
      setRemoving(null)
    }
  }

  const filteredAvailable = useMemo(() => {
    if (!searchAvailable) return available
    const q = searchAvailable.toLowerCase()
    return available.filter(
      (s) =>
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
        s.student_id?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q)
    )
  }, [available, searchAvailable])

  const filteredEnrolled = useMemo(() => {
    if (!searchEnrolled) return enrolled
    const q = searchEnrolled.toLowerCase()
    return enrolled.filter(
      (s) =>
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
        s.student_code?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q)
    )
  }, [enrolled, searchEnrolled])

  if (loadingSchedules) {
    return (
      <FacultyLayout currentPage="enrollment">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-slate-400">Loading schedules...</span>
        </div>
      </FacultyLayout>
    )
  }

  if (schedules.length === 0) {
    return (
      <FacultyLayout currentPage="enrollment">
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400 text-lg">No schedules assigned</p>
          <p className="text-slate-500 text-sm mt-1">Contact your admin to assign class schedules first.</p>
        </div>
      </FacultyLayout>
    )
  }

  return (
    <FacultyLayout currentPage="enrollment">
      <div className="space-y-6">
        {/* Schedule selector */}
        <div className="flex flex-wrap gap-2">
          {schedules.map((s) => (
            <button
              key={s.id}
              onClick={() => selectSchedule(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                selectedSchedule?.id === s.id
                  ? 'bg-teal-600 border-teal-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {s.course_code} — Sec {s.section}
              <span className="ml-2 text-xs opacity-75">({s.student_count})</span>
            </button>
          ))}
        </div>

        {/* Schedule details */}
        {selectedSchedule && (
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 flex items-center gap-4 flex-wrap">
            <BookOpen className="w-5 h-5 text-teal-400 flex-shrink-0" />
            <div>
              <span className="text-white font-medium">{selectedSchedule.course_name}</span>
              <span className="text-slate-400 text-sm ml-2">
                Section {selectedSchedule.section} • {selectedSchedule.room_name || 'No room'} •{' '}
                {selectedSchedule.start_time?.slice(0, 5)}–{selectedSchedule.end_time?.slice(0, 5)}
              </span>
            </div>
          </div>
        )}

        {loadingStudents ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── Enrolled students ── */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
              <div className="border-b border-slate-700 px-4 py-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Enrolled ({enrolled.length})
                </h3>
              </div>
              <div className="p-3">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search enrolled..."
                    value={searchEnrolled}
                    onChange={(e) => setSearchEnrolled(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {filteredEnrolled.length === 0 ? (
                    <p className="text-center py-8 text-slate-500 text-sm">
                      {enrolled.length === 0 ? 'No students enrolled yet' : 'No matches'}
                    </p>
                  ) : (
                    filteredEnrolled.map((s) => (
                      <div
                        key={s.student_id}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate">
                            {s.first_name} {s.last_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {s.student_code} • {s.email}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemove(s.student_id)}
                          disabled={removing === s.student_id}
                          className="ml-2 p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0 disabled:opacity-50"
                          title="Remove from schedule"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ── Available students ── */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
              <div className="border-b border-slate-700 px-4 py-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-semibold text-white">
                  Available to Add ({available.length})
                </h3>
              </div>
              <div className="p-3">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search available..."
                    value={searchAvailable}
                    onChange={(e) => setSearchAvailable(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {filteredAvailable.length === 0 ? (
                    <p className="text-center py-8 text-slate-500 text-sm">
                      {available.length === 0 ? 'All students are enrolled' : 'No matches'}
                    </p>
                  ) : (
                    filteredAvailable.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate">
                            {s.first_name} {s.last_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {s.student_id} • {s.email}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAdd(s.id)}
                          disabled={adding === s.id}
                          className="ml-2 p-1.5 rounded-lg text-teal-400 hover:bg-teal-500/20 transition-colors flex-shrink-0 disabled:opacity-50"
                          title="Add to schedule"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </FacultyLayout>
  )
}

export default FacultyEnrollmentPage
