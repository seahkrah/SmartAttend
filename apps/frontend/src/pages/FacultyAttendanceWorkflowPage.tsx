/**
 * Faculty Attendance Workflow Page
 *
 * Practical attendance-taking flow:
 * 1. Faculty sees their assigned schedules
 * 2. Selects a schedule and date
 * 3. Marks each student present/absent/late/excused
 * 4. OR identifies a student by face (server-side matching, /api/biometrics)
 *    and marks them present; the save cites the match it relied on
 * 5. Submits attendance (persisted to school_attendance table)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useToastStore } from '../components/Toast';
import { axiosClient } from '../utils/axiosClient';
import FaceChallengeCapture from '../components/face/FaceChallengeCapture';
import type { IdentifyResult } from '../services/biometricsService';

// ──────── Types ────────

interface Schedule {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  room_id: string;
  room_name: string;
  days_of_week: string;
  start_time: string;
  end_time: string;
  section: number;
  student_count: string;
}

interface StudentRecord {
  student_id: string;
  student_code: string;
  first_name: string;
  last_name: string;
  email: string;
  attendance_status: string | null;
  remarks: string | null;
  marked_at: string | null;
  face_verified: boolean | null;
  has_face_enrolled: boolean;
}

interface HistoryEntry {
  attendance_date: string;
  total_marked: string;
  present_count: string;
  absent_count: string;
  late_count: string;
  excused_count: string;
}

type Status = 'present' | 'absent' | 'late' | 'excused';

const STATUS_COLORS: Record<Status, string> = {
  present: 'bg-green-600 hover:bg-green-700 text-white',
  absent: 'bg-red-600 hover:bg-red-700 text-white',
  late: 'bg-amber-600 hover:bg-amber-700 text-white',
  excused: 'bg-blue-600 hover:bg-blue-700 text-white',
};

const STATUS_INACTIVE: Record<Status, string> = {
  present: 'bg-slate-700 hover:bg-green-600/40 text-slate-300',
  absent: 'bg-slate-700 hover:bg-red-600/40 text-slate-300',
  late: 'bg-slate-700 hover:bg-amber-600/40 text-slate-300',
  excused: 'bg-slate-700 hover:bg-blue-600/40 text-slate-300',
};

const STATUS_LABELS: Record<Status, string> = {
  present: 'P',
  absent: 'A',
  late: 'L',
  excused: 'E',
};

// ──────── Component ────────

export const FacultyAttendanceWorkflowPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast);

  // Schedule list state
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);

  // Attendance view state
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [localStatuses, setLocalStatuses] = useState<Record<string, Status>>({});
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ── Face matching state ──
  // A scan returns a match id; the save cites it, and the server checks it
  // is a recent match for that student in this class. Matches are usable
  // for five minutes and once.
  const [showFaceScan, setShowFaceScan] = useState(false);
  const [faceMatches, setFaceMatches] = useState<Record<string, string>>({});
  const [enrollingStudentId, setEnrollingStudentId] = useState<string | null>(null);

  // ──── Load schedules on mount ────
  useEffect(() => {
    loadSchedules();
  }, []);

  const loadSchedules = async () => {
    setLoadingSchedules(true);
    try {
      const res = await axiosClient.get('/faculty/schedules');
      setSchedules(Array.isArray(res.data) ? res.data : []);
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load schedules' });
    } finally {
      setLoadingSchedules(false);
    }
  };

  // ──── Load students for a schedule + date ────
  const loadStudents = useCallback(async (scheduleId: string, date: string) => {
    setLoadingStudents(true);
    try {
      const res = await axiosClient.get(`/faculty/schedules/${scheduleId}/students`, {
        params: { date },
      });
      const studentData: StudentRecord[] = res.data.students || [];
      setStudents(studentData);

      // Initialize local statuses from persisted data
      const statuses: Record<string, Status> = {};
      studentData.forEach((s) => {
        if (s.attendance_status) {
          statuses[s.student_id] = s.attendance_status as Status;
        }
      });
      setLocalStatuses(statuses);
      setHasUnsavedChanges(false);
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load students' });
    } finally {
      setLoadingStudents(false);
    }
  }, [addToast]);

  // ──── Load attendance history ────
  const loadHistory = useCallback(async (scheduleId: string) => {
    try {
      const res = await axiosClient.get('/faculty/attendance/history', {
        params: { schedule_id: scheduleId },
      });
      setHistory(res.data);
    } catch {
      setHistory([]);
    }
  }, []);

  // ──── Handlers ────
  const handleSelectSchedule = (schedule: Schedule) => {
    setSelectedSchedule(schedule);
    setShowHistory(false);
    loadStudents(schedule.id, attendanceDate);
    loadHistory(schedule.id);
  };

  const handleDateChange = (date: string) => {
    setAttendanceDate(date);
    if (selectedSchedule) {
      loadStudents(selectedSchedule.id, date);
    }
  };

  const handleMarkStudent = (studentId: string, status: Status) => {
    setLocalStatuses((prev) => ({ ...prev, [studentId]: status }));
    // A face match is evidence of presence; it does not travel with another status.
    if (status !== 'present') {
      setFaceMatches((prev) => {
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
    }
    setHasUnsavedChanges(true);
  };

  const handleMarkAll = (status: Status) => {
    const all: Record<string, Status> = {};
    students.forEach((s) => {
      all[s.student_id] = status;
    });
    setLocalStatuses(all);
    setHasUnsavedChanges(true);
  };

  const handleSubmit = async () => {
    if (!selectedSchedule) return;

    const entries = Object.entries(localStatuses).map(([student_id, status]) => ({
      student_id,
      status,
    }));

    if (entries.length === 0) {
      addToast({ type: 'warning', title: 'No marks', message: 'Mark at least one student before submitting' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await axiosClient.post('/faculty/attendance/mark', {
        schedule_id: selectedSchedule.id,
        date: attendanceDate,
        entries: entries.map((e) => ({
          ...e,
          ...(faceMatches[e.student_id] && e.status === 'present'
            ? { face_match_id: faceMatches[e.student_id] } : {}),
        })),
      });
      addToast({
        type: 'success',
        title: 'Attendance Saved',
        message: `${res.data.marked_count} record(s) saved successfully`,
      });
      setHasUnsavedChanges(false);
      setFaceMatches({});
      // Reload to reflect saved state
      loadStudents(selectedSchedule.id, attendanceDate);
      loadHistory(selectedSchedule.id);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Not saved',
        message: err?.response?.data?.error ?? 'Failed to save attendance',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Discard them?')) return;
    }
    setShowFaceScan(false);
    setEnrollingStudentId(null);
    setSelectedSchedule(null);
    setStudents([]);
    setLocalStatuses({});
    setHasUnsavedChanges(false);
    setShowHistory(false);
    setFaceMatches({});
  };

  // ══════════════════════════════════
  // FACE MATCHING
  // ══════════════════════════════════

  const onIdentified = (result: IdentifyResult) => {
    const id = result.student.id;
    setLocalStatuses((prev) => ({ ...prev, [id]: 'present' }));
    setFaceMatches((prev) => ({ ...prev, [id]: result.matchId }));
    setHasUnsavedChanges(true);
    setShowFaceScan(false);
    addToast({
      type: 'success',
      title: 'Face matched',
      message: `${result.student.first_name} ${result.student.last_name} marked present. Save within five minutes.`,
    });
  };

  const onEnrolled = () => {
    const id = enrollingStudentId;
    setEnrollingStudentId(null);
    if (id) {
      setStudents((prev) => prev.map((s) => (s.student_id === id ? { ...s, has_face_enrolled: true } : s)));
    }
    addToast({ type: 'success', title: 'Face enrolled', message: 'This student can now be identified in class.' });
  };

  // Computed: how many students have face enrolled
  const faceEnrolledCount = students.filter((s) => s.has_face_enrolled).length;

  // ──── Computed values ────
  const markedCount = Object.keys(localStatuses).length;
  const presentCount = Object.values(localStatuses).filter((s) => s === 'present').length;
  const absentCount = Object.values(localStatuses).filter((s) => s === 'absent').length;
  const lateCount = Object.values(localStatuses).filter((s) => s === 'late').length;
  const excusedCount = Object.values(localStatuses).filter((s) => s === 'excused').length;
  const unmarkedCount = (students?.length || 0) - markedCount;

  // ════════════════════════════════════
  // RENDER: SCHEDULE LIST (no schedule selected)
  // ════════════════════════════════════
  if (!selectedSchedule) {
    return (
      <>
      <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2">Take Attendance</h1>
          <p className="text-slate-400 mb-8">Select a class schedule to begin marking attendance.</p>

          {loadingSchedules ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-slate-400">Loading schedules...</span>
            </div>
          ) : !schedules || schedules.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">📭</div>
              <p className="text-xl text-slate-400">No schedules assigned</p>
              <p className="text-sm text-slate-500 mt-2">Contact your admin to assign class schedules.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {schedules.map((schedule) => (
                <button
                  key={schedule.id}
                  onClick={() => handleSelectSchedule(schedule)}
                  className="p-5 rounded-lg border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-750 transition-all text-left group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors">
                        {schedule.course_name}
                      </h3>
                      <p className="text-sm text-slate-400 mt-0.5">{schedule.course_code}</p>
                    </div>
                    {schedule.section && (
                      <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                        Sec {schedule.section}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 space-y-1.5 text-sm text-slate-400">
                    {schedule.days_of_week && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Days:</span>
                        <span className="text-slate-300">{schedule.days_of_week}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Time:</span>
                      <span className="text-slate-300">
                        {schedule.start_time?.slice(0, 5)} – {schedule.end_time?.slice(0, 5)}
                      </span>
                    </div>
                    {schedule.room_name && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Room:</span>
                        <span className="text-slate-300">{schedule.room_name}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-sm text-slate-400">
                      {schedule.student_count} student{parseInt(schedule.student_count) !== 1 ? 's' : ''} enrolled
                    </span>
                    <span className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Take Attendance →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  // ════════════════════════════════════
  // RENDER: ATTENDANCE MARKING VIEW
  // ════════════════════════════════════
  return (
    <>
      <div className="max-w-6xl mx-auto">
        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <button
              onClick={handleBack}
              className="text-sm text-slate-400 hover:text-white mb-2 flex items-center gap-1 transition-colors"
            >
              ← Back to Schedules
            </button>
            <h1 className="text-2xl font-bold text-white">
              {selectedSchedule.course_name}
              {selectedSchedule.section ? ` — Section ${selectedSchedule.section}` : ''}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {selectedSchedule.course_code}
              {selectedSchedule.days_of_week ? ` • ${selectedSchedule.days_of_week}` : ''}
              {' • '}
              {selectedSchedule.start_time?.slice(0, 5)}–{selectedSchedule.end_time?.slice(0, 5)}
              {selectedSchedule.room_name ? ` • ${selectedSchedule.room_name}` : ''}
            </p>
          </div>

          {/* Date picker */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-400">Date:</label>
            <input
              type="date"
              value={attendanceDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-sm text-slate-400 mr-2">Quick Actions:</span>
          <button
            onClick={() => handleMarkAll('present')}
            className="px-3 py-1.5 bg-green-700/30 border border-green-600/50 text-green-400 rounded text-xs font-medium hover:bg-green-700/50 transition-colors"
          >
            Mark All Present
          </button>
          <button
            onClick={() => handleMarkAll('absent')}
            className="px-3 py-1.5 bg-red-700/30 border border-red-600/50 text-red-400 rounded text-xs font-medium hover:bg-red-700/50 transition-colors"
          >
            Mark All Absent
          </button>

          <button
            onClick={() => setShowFaceScan(true)}
            disabled={faceEnrolledCount === 0}
            title={faceEnrolledCount === 0 ? 'No student in this class has an enrolled face' : undefined}
            className="px-3 py-1.5 bg-purple-700/30 border border-purple-600/50 text-purple-400 rounded text-xs font-medium hover:bg-purple-700/50 transition-colors flex items-center gap-1"
          >
            📷 Face Scan {faceEnrolledCount > 0 && <span className="bg-purple-600/40 px-1 rounded">{faceEnrolledCount}</span>}
          </button>

          <div className="flex-1" />

          {/* History toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              showHistory
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {showHistory ? 'Hide History' : 'View History'}
          </button>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || markedCount === 0}
            className={`px-5 py-1.5 rounded text-sm font-medium transition-colors ${
              markedCount > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {submitting ? 'Saving...' : hasUnsavedChanges ? 'Save Attendance' : 'Saved ✓'}
          </button>
        </div>

        {/* ── Summary Bar ── */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700 text-center">
            <div className="text-xl font-bold text-white">{students.length}</div>
            <div className="text-xs text-slate-400">Total</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-green-800/50 text-center">
            <div className="text-xl font-bold text-green-400">{presentCount}</div>
            <div className="text-xs text-slate-400">Present</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-red-800/50 text-center">
            <div className="text-xl font-bold text-red-400">{absentCount}</div>
            <div className="text-xs text-slate-400">Absent</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-amber-800/50 text-center">
            <div className="text-xl font-bold text-amber-400">{lateCount}</div>
            <div className="text-xs text-slate-400">Late</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-blue-800/50 text-center">
            <div className="text-xl font-bold text-blue-400">{excusedCount}</div>
            <div className="text-xs text-slate-400">Excused</div>
          </div>
        </div>

        {/* ── Progress Bar ── */}
        {students.length > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
              <span>{markedCount} of {students.length} marked</span>
              <span>{unmarkedCount > 0 ? `${unmarkedCount} remaining` : 'All marked'}</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden flex">
              {presentCount > 0 && (
                <div className="h-full bg-green-500 transition-all" style={{ width: `${(presentCount / students.length) * 100}%` }} />
              )}
              {lateCount > 0 && (
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${(lateCount / students.length) * 100}%` }} />
              )}
              {excusedCount > 0 && (
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${(excusedCount / students.length) * 100}%` }} />
              )}
              {absentCount > 0 && (
                <div className="h-full bg-red-500 transition-all" style={{ width: `${(absentCount / students.length) * 100}%` }} />
              )}
            </div>
          </div>
        )}

        {/* ── Student Table ── */}
        {loadingStudents ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-slate-400">Loading students...</span>
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-16 bg-slate-800 rounded-lg border border-slate-700">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-lg text-slate-400">No students enrolled</p>
            <p className="text-sm text-slate-500 mt-1">Enroll students via the admin enrollment page first.</p>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-700/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider w-10">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider w-20">Face</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {students.map((student, idx) => {
                  const currentStatus = localStatuses[student.student_id] || null;
                  const isSaved = student.attendance_status === currentStatus;

                  return (
                    <tr
                      key={student.student_id}
                      className={`transition-colors ${
                        currentStatus
                          ? 'bg-slate-800'
                          : 'bg-slate-800/50 hover:bg-slate-700/30'
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-200">
                          {student.first_name} {student.last_name}
                        </div>
                        <div className="text-xs text-slate-500">{student.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400 font-mono">
                        {student.student_code || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {faceMatches[student.student_id] ? (
                          <span className="inline-flex items-center gap-0.5 text-green-400 text-xs font-medium" title="Face matched; saved with the next save">
                            ✅
                          </span>
                        ) : student.has_face_enrolled ? (
                          <span className="text-purple-400 text-xs" title="Face enrolled">📷</span>
                        ) : (
                          <button
                            onClick={() => setEnrollingStudentId(student.student_id)}
                            className="text-xs text-slate-500 hover:text-purple-400 transition-colors"
                            title="Enroll face"
                          >
                            + Face
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {(['present', 'absent', 'late', 'excused'] as Status[]).map((status) => (
                            <button
                              key={status}
                              onClick={() => handleMarkStudent(student.student_id, status)}
                              title={status.charAt(0).toUpperCase() + status.slice(1)}
                              className={`w-9 h-8 rounded text-xs font-bold transition-all ${
                                currentStatus === status
                                  ? STATUS_COLORS[status]
                                  : STATUS_INACTIVE[status]
                              }`}
                            >
                              {STATUS_LABELS[status]}
                            </button>
                          ))}
                          {currentStatus && isSaved && (
                            <span className="ml-1 text-green-500 text-xs" title="Saved">✓</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── History Panel ── */}
        {showHistory && history.length > 0 && (
          <div className="mt-6 bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <div className="bg-slate-700/60 px-4 py-3 border-b border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300">Attendance History</h3>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-center">Present</th>
                  <th className="px-4 py-2 text-center">Absent</th>
                  <th className="px-4 py-2 text-center">Late</th>
                  <th className="px-4 py-2 text-center">Excused</th>
                  <th className="px-4 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {history.map((h) => (
                  <tr
                    key={h.attendance_date}
                    className="hover:bg-slate-700/30 cursor-pointer transition-colors"
                    onClick={() => handleDateChange(h.attendance_date)}
                  >
                    <td className="px-4 py-2 text-sm text-slate-300">
                      {new Date(h.attendance_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-2 text-center text-sm text-green-400">{h.present_count}</td>
                    <td className="px-4 py-2 text-center text-sm text-red-400">{h.absent_count}</td>
                    <td className="px-4 py-2 text-center text-sm text-amber-400">{h.late_count}</td>
                    <td className="px-4 py-2 text-center text-sm text-blue-400">{h.excused_count}</td>
                    <td className="px-4 py-2 text-center text-sm text-slate-300">{h.total_marked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showHistory && history.length === 0 && (
          <div className="mt-6 text-center py-8 bg-slate-800 rounded-lg border border-slate-700">
            <p className="text-slate-400 text-sm">No attendance history yet for this schedule.</p>
          </div>
        )}

        {showFaceScan && selectedSchedule && (
          <FaceChallengeCapture<IdentifyResult>
            purpose="identify"
            title="Identify a student"
            subtitle={`${selectedSchedule.course_code} — ${faceEnrolledCount} student${faceEnrolledCount !== 1 ? 's' : ''} with an enrolled face`}
            scheduleId={selectedSchedule.id}
            onDone={onIdentified}
            onClose={() => setShowFaceScan(false)}
          />
        )}

        {enrollingStudentId && (() => {
          const st = students.find((x) => x.student_id === enrollingStudentId);
          return (
            <FaceChallengeCapture
              purpose="enroll"
              title="Enrol a face"
              subtitle={st ? `${st.first_name} ${st.last_name} (${st.student_code}). Consent must already be on record.` : undefined}
              subjectType="student"
              subjectId={enrollingStudentId}
              onDone={onEnrolled}
              onClose={() => setEnrollingStudentId(null)}
            />
          );
        })()}
      </div>
    </>
  );
};

export default FacultyAttendanceWorkflowPage;
