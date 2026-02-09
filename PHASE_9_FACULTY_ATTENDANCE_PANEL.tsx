/**
 * PHASE 9: FACULTY ATTENDANCE MARKING PANEL
 * 
 * QUESTION: Can faculty mark attendance correctly, safely, and without ambiguity?
 * 
 * Operational Surface:
 * - View assigned courses & enrollment rosters
 * - Mark attendance via:
 *   a) Facial recognition (QR code to start, then camera capture)
 *   b) Manual marking (per-student buttons)
 * - Bulk edit attendance (mark whole class as absent, mark late, etc.)
 * - Record absence reasons
 * - Submit & lock attendance (cannot edit after deadline)
 * - Generate & export reports (PDF, XLSX, CSV)
 * - View attendance analytics
 */

import React from 'react';
import {
  Camera, QrCode, Upload, Download, CheckCircle2, X, Clock, AlertCircle,
  BookOpen, Users, Calendar, Eye, Lock, Unlock, Send, Plus, FileText,
  TrendingUp, Activity, Edit, Trash2
} from 'lucide-react';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CourseRoster {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  enrollment_date: string;
  total_enrolled: number;
}

interface StudentAttendanceRecord {
  student_id: string;
  student_name: string;
  email: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'NOT_MARKED';
  marked_at?: string;
  marked_by_ip?: string;
  absence_reason?: string;
  notes?: string;
}

interface AttendanceSession {
  id: string;
  course_id: string;
  date: string;
  start_time: string;
  end_time: string;
  marked_count: number;
  total_enrolled: number;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED';
  created_at: string;
  submitted_at?: string;
  locked_at?: string;
}

interface AttendanceReport {
  student_id: string;
  student_name: string;
  total_classes: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: number;
}

// ============================================================================
// COMPONENT 1: CourseRosterView.tsx
// ============================================================================

interface CourseRosterViewProps {
  courses: CourseRoster[];
  selectedCourseId?: string;
  onSelectCourse: (courseId: string) => void;
}

export const CourseRosterView: React.FC<CourseRosterViewProps> = ({
  courses,
  selectedCourseId,
  onSelectCourse
}) => {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <BookOpen className="w-5 h-5" />
        Your Courses ({courses.length})
      </h3>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {courses.map(course => (
          <button
            key={course.id}
            onClick={() => onSelectCourse(course.id)}
            className={`w-full text-left p-4 rounded-lg border transition-all ${
              selectedCourseId === course.id
                ? 'bg-blue-500/20 border-blue-500/50'
                : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="font-bold text-white">{course.course_name}</p>
                <p className="text-sm text-slate-400">{course.course_code}</p>
                <p className="text-sm text-slate-400 mt-1">
                  {course.total_enrolled} students enrolled
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-500" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: AttendanceMarkingInterface.tsx
// ============================================================================

type MarkingMode = 'QR_CODE' | 'FACIAL_RECOGNITION' | 'MANUAL' | 'BULK_EDIT';

interface AttendanceMarkingInterfaceProps {
  roster: StudentAttendanceRecord[];
  markingMode: MarkingMode;
  onChangeMode: (mode: MarkingMode) => void;
  onMarkAttendance: (studentId: string, status: string, reason?: string) => void;
  onBulkMark: (studentIds: string[], status: string) => void;
}

export const AttendanceMarkingInterface: React.FC<AttendanceMarkingInterfaceProps> = ({
  roster,
  markingMode,
  onChangeMode,
  onMarkAttendance,
  onBulkMark
}) => {
  const [selectedStudents, setSelectedStudents] = React.useState<Set<string>>(new Set());
  const [cameraActive, setCameraActive] = React.useState(false);
  const [qrData, setQrData] = React.useState<string | null>(null);

  const toggleStudentSelection = (studentId: string) => {
    const newSet = new Set(selectedStudents);
    if (newSet.has(studentId)) {
      newSet.delete(studentId);
    } else {
      newSet.add(studentId);
    }
    setSelectedStudents(newSet);
  };

  const selectAllAbsent = () => {
    const allAbsent = new Set(
      roster
        .filter(r => r.status === 'NOT_MARKED')
        .map(r => r.student_id)
    );
    setSelectedStudents(allAbsent);
  };

  const markSelectedAs = (status: string) => {
    onBulkMark(Array.from(selectedStudents), status);
    setSelectedStudents(new Set());
  };

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div>
        <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Activity className="w-6 h-6" />
          Mark Attendance
        </h3>

        {/* Mode Selection */}
        <div className="flex gap-2 flex-wrap mb-4">
          {[
            { id: 'QR_CODE', label: 'QR Code', icon: QrCode },
            { id: 'FACIAL_RECOGNITION', label: 'Facial Recognition', icon: Camera },
            { id: 'MANUAL', label: 'Manual Marking', icon: CheckCircle2 },
            { id: 'BULK_EDIT', label: 'Bulk Edit', icon: Upload }
          ].map(mode => (
            <button
              key={mode.id}
              onClick={() => onChangeMode(mode.id as MarkingMode)}
              className={`flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                markingMode === mode.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <mode.icon className="w-4 h-4" />
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* QR Code Mode */}
      {markingMode === 'QR_CODE' && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded">
          <p className="text-blue-400 font-medium mb-3">QR Code Mode</p>
          <p className="text-sm text-slate-300 mb-4">
            1. Display QR code for students to scan
            2. System will open camera after scan
            3. Student's face will be matched with enrollment photo
          </p>
          <button
            onClick={() => setCameraActive(!cameraActive)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
              cameraActive
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            <Camera className="w-5 h-5" />
            {cameraActive ? 'Stop Camera' : 'Start Camera'}
          </button>
        </div>
      )}

      {/* Facial Recognition Mode */}
      {markingMode === 'FACIAL_RECOGNITION' && (
        <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded">
          <p className="text-purple-400 font-medium mb-3">Facial Recognition Mode</p>
          <p className="text-sm text-slate-300 mb-4">
            Students' faces will be automatically matched against enrollment database.
            Confidence threshold: 95%
          </p>
          <button
            onClick={() => setCameraActive(!cameraActive)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
              cameraActive
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            <Camera className="w-5 h-5" />
            {cameraActive ? 'Stop Camera' : 'Start Camera'}
          </button>
          {cameraActive && (
            <div className="mt-4 p-4 bg-black rounded aspect-video flex items-center justify-center text-slate-400 border-2 border-slate-600">
              📹 Camera Feed Placeholder
            </div>
          )}
        </div>
      )}

      {/* Manual Marking Mode */}
      {markingMode === 'MANUAL' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={selectAllAbsent}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
            >
              Select All Absent
            </button>
            {selectedStudents.size > 0 && (
              <>
                <button
                  onClick={() => markSelectedAs('PRESENT')}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                >
                  Mark {selectedStudents.size} Present
                </button>
                <button
                  onClick={() => markSelectedAs('ABSENT')}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                >
                  Mark {selectedStudents.size} Absent
                </button>
                <button
                  onClick={() => markSelectedAs('LATE')}
                  className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm"
                >
                  Mark {selectedStudents.size} Late
                </button>
              </>
            )}
          </div>

          {/* Student List with Manual Checkboxes */}
          <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-700 rounded p-3">
            {roster.map(student => (
              <div
                key={student.student_id}
                className="flex items-center justify-between p-3 bg-slate-700/50 rounded"
              >
                <div className="flex items-center gap-3 flex-1">
                  <input
                    type="checkbox"
                    checked={selectedStudents.has(student.student_id)}
                    onChange={() => toggleStudentSelection(student.student_id)}
                    className="w-4 h-4"
                  />
                  <div>
                    <p className="font-medium text-white">{student.student_name}</p>
                    <p className="text-xs text-slate-400">{student.email}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => onMarkAttendance(student.student_id, 'PRESENT')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      student.status === 'PRESENT'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-600 text-slate-300 hover:bg-green-600'
                    }`}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => onMarkAttendance(student.student_id, 'ABSENT')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      student.status === 'ABSENT'
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-600 text-slate-300 hover:bg-red-600'
                    }`}
                  >
                    ✕
                  </button>
                  <button
                    onClick={() => onMarkAttendance(student.student_id, 'LATE')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      student.status === 'LATE'
                        ? 'bg-yellow-600 text-white'
                        : 'bg-slate-600 text-slate-300 hover:bg-yellow-600'
                    }`}
                  >
                    ⏱
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Edit Mode */}
      {markingMode === 'BULK_EDIT' && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded">
          <p className="text-yellow-400 font-medium mb-3">Bulk Edit Mode</p>
          <p className="text-sm text-slate-300">
            Upload CSV or use preset options to mark multiple students at once.
          </p>
          <div className="mt-3">
            <input
              type="file"
              accept=".csv"
              className="w-full py-2 px-3 bg-slate-700 border border-slate-600 rounded text-white file:mr-4 file:py-1 file:px-3 file:bg-blue-600 file:text-white file:rounded file:cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 3: AttendanceSubmission.tsx
// ============================================================================

interface AttendanceSubmissionProps {
  session: AttendanceSession | null;
  markedCount: number;
  totalCount: number;
  onSubmit: () => void;
  onLock: () => void;
}

export const AttendanceSubmission: React.FC<AttendanceSubmissionProps> = ({
  session,
  markedCount,
  totalCount,
  onSubmit,
  onLock
}) => {
  const completionPercent = totalCount > 0 ? Math.round((markedCount / totalCount) * 100) : 0;

  if (!session) return null;

  return (
    <div className="p-6 bg-slate-800/50 rounded-lg border border-slate-700 space-y-4">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <Send className="w-5 h-5" />
        Attendance Status
      </h3>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Marked: {markedCount} / {totalCount}</span>
          <span className={`font-bold ${completionPercent === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
            {completionPercent}%
          </span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all ${
              completionPercent === 100 ? 'bg-green-500' : 'bg-yellow-500'
            }`}
            style={{ width: `${completionPercent}%` }}
          />
        </div>
      </div>

      {/* Status Info */}
      <div className={`p-3 rounded-lg border ${
        session.status === 'LOCKED'
          ? 'bg-slate-700/50 border-slate-600'
          : session.status === 'SUBMITTED'
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-blue-500/10 border-blue-500/30'
      }`}>
        <p className="text-sm font-medium">
          Status: <span className="font-bold">{session.status}</span>
        </p>
        {session.submitted_at && (
          <p className="text-xs text-slate-400 mt-1">
            Submitted: {new Date(session.submitted_at).toLocaleString()}
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {session.status === 'DRAFT' && (
          <>
            <button
              onClick={onSubmit}
              disabled={completionPercent < 100}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              <Send className="w-4 h-4" />
              Submit Attendance
            </button>
          </>
        )}

        {session.status === 'SUBMITTED' && (
          <button
            onClick={onLock}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
          >
            <Lock className="w-4 h-4" />
            Lock & Finalize
          </button>
        )}

        {session.status === 'LOCKED' && (
          <div className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 rounded-lg text-white font-medium">
            <Lock className="w-4 h-4" />
            ✓ Finalized
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 4: AttendanceReporting.tsx
// ============================================================================

interface AttendanceReportingProps {
  courseId: string;
  reports: AttendanceReport[];
  onExport: (format: 'PDF' | 'XLSX' | 'CSV') => void;
}

export const AttendanceReporting: React.FC<AttendanceReportingProps> = ({
  courseId,
  reports,
  onExport
}) => {
  const [exportFormat, setExportFormat] = React.useState<'PDF' | 'XLSX' | 'CSV'>('PDF');

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Attendance Reports
        </h3>

        <div className="flex gap-2">
          <select
            value={exportFormat}
            onChange={e => setExportFormat(e.target.value as any)}
            className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
          >
            <option value="PDF">PDF</option>
            <option value="XLSX">Excel</option>
            <option value="CSV">CSV</option>
          </select>

          <button
            onClick={() => onExport(exportFormat)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Reports Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-3 text-slate-400 font-semibold">Student</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Classes</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Present</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Absent</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Late</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {reports.map(report => (
              <tr key={report.student_id} className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors">
                <td className="py-3 px-3 text-white">{report.student_name}</td>
                <td className="text-center py-3 px-3 text-slate-300">{report.total_classes}</td>
                <td className="text-center py-3 px-3 text-green-400 font-bold">{report.present}</td>
                <td className="text-center py-3 px-3 text-red-400 font-bold">{report.absent}</td>
                <td className="text-center py-3 px-3 text-yellow-400 font-bold">{report.late}</td>
                <td className="text-center py-3 px-3">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    report.percentage >= 80
                      ? 'bg-green-500/20 text-green-300'
                      : report.percentage >= 60
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}>
                    {report.percentage}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN PAGE: FacultyAttendancePanel.tsx
// ============================================================================

export const FacultyAttendancePanel: React.FC = () => {
  const [courses, setCourses] = React.useState<CourseRoster[]>([]);
  const [selectedCourseId, setSelectedCourseId] = React.useState<string>();
  const [roster, setRoster] = React.useState<StudentAttendanceRecord[]>([]);
  const [markingMode, setMarkingMode] = React.useState<MarkingMode>('MANUAL');
  const [session, setSession] = React.useState<AttendanceSession | null>(null);
  const [reports, setReports] = React.useState<AttendanceReport[]>([]);

  const markedCount = roster.filter(r => r.status !== 'NOT_MARKED').length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Camera className="w-8 h-8 text-green-500" />
          <h1 className="text-3xl font-bold text-white">FACULTY ATTENDANCE PANEL</h1>
        </div>
        <p className="text-slate-400">
          Mark attendance • QR codes • Facial recognition • Generate reports
        </p>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar - Courses */}
        <div className="lg:col-span-1">
          <CourseRosterView
            courses={courses}
            selectedCourseId={selectedCourseId}
            onSelectCourse={setSelectedCourseId}
          />
        </div>

        {/* Center & Right - Marking Interface */}
        <div className="lg:col-span-3 space-y-6">
          {selectedCourseId ? (
            <>
              <AttendanceMarkingInterface
                roster={roster}
                markingMode={markingMode}
                onChangeMode={setMarkingMode}
                onMarkAttendance={() => {}}
                onBulkMark={() => {}}
              />

              <AttendanceSubmission
                session={session}
                markedCount={markedCount}
                totalCount={roster.length}
                onSubmit={() => {}}
                onLock={() => {}}
              />

              <AttendanceReporting
                courseId={selectedCourseId}
                reports={reports}
                onExport={() => {}}
              />
            </>
          ) : (
            <div className="p-12 text-center bg-slate-800/50 rounded-lg border border-slate-700">
              <p className="text-slate-400 text-lg">Select a course to mark attendance</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FacultyAttendancePanel;
