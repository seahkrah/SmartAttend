/**
 * PHASE 9: STUDENT/EMPLOYEE SELF-SERVICE VIEW
 * 
 * QUESTION: Can students and employees see their attendance data correctly and safely?
 * 
 * Operational Surface:
 * - View personal attendance record
 * - View attendance analytics & trends
 * - View per-course breakdown
 * - Edit profile (name, email, phone, emergency contact)
 * - Flag attendance discrepancies
 * - Export personal reports
 * - View academic/employment metrics
 */

import React from 'react';
import {
  User, BarChart3, TrendingUp, AlertCircle, CheckCircle2, Download,
  Edit, Eye, Mail, Phone, MapPin, Calendar, Activity, FileText,
  BookOpen, Clock, Flag, ChevronRight
} from 'lucide-react';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'STUDENT' | 'EMPLOYEE' | 'HR';
  enrollment_id?: string;
  department?: string;
  profile_photo_url?: string;
  joined_at: string;
}

interface PersonalAttendanceMetrics {
  total_sessions: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  attendance_percentage: number;
  status: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
}

interface CourseOrDepartmentAttendance {
  id: string;
  name: string;
  code?: string;
  total_classes: number;
  present: number;
  absent: number;
  late: number;
  attendance_percentage: number;
  instructor?: string;
  semester?: string;
}

interface AttendanceDiscrepancy {
  id: string;
  date: string;
  course: string;
  reported_status: 'PRESENT' | 'ABSENT' | 'LATE';
  description: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  filed_at: string;
  resolved_at?: string;
  resolution?: string;
}

// ============================================================================
// COMPONENT 1: ProfileCard.tsx
// ============================================================================

interface ProfileCardProps {
  profile: UserProfile;
  onEdit: () => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({ profile, onEdit }) => {
  return (
    <div className="p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          {profile.profile_photo_url ? (
            <img
              src={profile.profile_photo_url}
              alt={profile.name}
              className="w-16 h-16 rounded-lg object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-slate-700 flex items-center justify-center">
              <User className="w-8 h-8 text-slate-500" />
            </div>
          )}
          <div>
            <p className="text-2xl font-bold text-white">{profile.name}</p>
            <p className="text-slate-400 text-sm">{profile.role}</p>
            {profile.department && (
              <p className="text-slate-500 text-xs">{profile.department}</p>
            )}
          </div>
        </div>

        <button
          onClick={onEdit}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
        >
          <Edit className="w-4 h-4" />
          Edit
        </button>
      </div>

      {/* Contact Info */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-slate-400">
          <Mail className="w-4 h-4" />
          {profile.email}
        </div>
        {profile.phone && (
          <div className="flex items-center gap-2 text-slate-400">
            <Phone className="w-4 h-4" />
            {profile.phone}
          </div>
        )}
        {profile.enrollment_id && (
          <div className="flex items-center gap-2 text-slate-400">
            <Calendar className="w-4 h-4" />
            ID: {profile.enrollment_id}
          </div>
        )}
        <div className="flex items-center gap-2 text-slate-400">
          <Clock className="w-4 h-4" />
          Joined: {new Date(profile.joined_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 2: AttendanceMetricsOverview.tsx
// ============================================================================

interface AttendanceMetricsOverviewProps {
  metrics: PersonalAttendanceMetrics;
}

export const AttendanceMetricsOverview: React.FC<AttendanceMetricsOverviewProps> = ({ metrics }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EXCELLENT':
        return 'bg-green-500/20 border-green-500/50 text-green-400';
      case 'GOOD':
        return 'bg-blue-500/20 border-blue-500/50 text-blue-400';
      case 'FAIR':
        return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400';
      case 'POOR':
        return 'bg-red-500/20 border-red-500/50 text-red-400';
      default:
        return 'bg-slate-500/20 border-slate-500/50 text-slate-400';
    }
  };

  return (
    <div className={`p-6 rounded-lg border ${getStatusColor(metrics.status)}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-slate-400 text-sm opacity-75">Your Attendance Rating</p>
          <p className="text-4xl font-bold mt-2">{metrics.attendance_percentage}%</p>
        </div>
        <Activity className="w-12 h-12 opacity-50" />
      </div>

      <p className="font-bold mb-4">{metrics.status} Standing</p>

      <div className="grid grid-cols-5 gap-2 text-sm">
        <div>
          <p className="text-slate-400 opacity-75">Sessions</p>
          <p className="font-bold mt-1">{metrics.total_sessions}</p>
        </div>
        <div>
          <p className="text-green-400 opacity-75">Present</p>
          <p className="font-bold text-green-400 mt-1">{metrics.present_count}</p>
        </div>
        <div>
          <p className="text-red-400 opacity-75">Absent</p>
          <p className="font-bold text-red-400 mt-1">{metrics.absent_count}</p>
        </div>
        <div>
          <p className="text-yellow-400 opacity-75">Late</p>
          <p className="font-bold text-yellow-400 mt-1">{metrics.late_count}</p>
        </div>
        <div>
          <p className="text-blue-400 opacity-75">Excused</p>
          <p className="font-bold text-blue-400 mt-1">{metrics.excused_count}</p>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// COMPONENT 3: CourseAttendanceBreakdown.tsx
// ============================================================================

interface CourseAttendanceBreakdownProps {
  courses: CourseOrDepartmentAttendance[];
  userRole: string;
}

export const CourseAttendanceBreakdown: React.FC<CourseAttendanceBreakdownProps> = ({
  courses,
  userRole
}) => {
  const title = userRole === 'STUDENT' ? 'Courses' : 'Departments';
  const codeLabel = userRole === 'STUDENT' ? 'Course Code' : 'Department';

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        <BookOpen className="w-5 h-5" />
        Per-{title} Breakdown
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-3 text-slate-400 font-semibold">{title}</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Classes</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Present</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Absent</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Late</th>
              <th className="text-center py-3 px-3 text-slate-400 font-semibold">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {courses.map(course => (
              <tr key={course.id} className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors">
                <td className="py-3 px-3 text-white font-medium">{course.name}</td>
                <td className="text-center py-3 px-3 text-slate-300">{course.total_classes}</td>
                <td className="text-center py-3 px-3 text-green-400 font-bold">{course.present}</td>
                <td className="text-center py-3 px-3 text-red-400 font-bold">{course.absent}</td>
                <td className="text-center py-3 px-3 text-yellow-400 font-bold">{course.late}</td>
                <td className="text-center py-3 px-3">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    course.attendance_percentage >= 80
                      ? 'bg-green-500/20 text-green-300'
                      : course.attendance_percentage >= 60
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}>
                    {course.attendance_percentage}%
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
// COMPONENT 4: DiscrepancyReporting.tsx
// ============================================================================

interface DiscrepancyReportingProps {
  discrepancies: AttendanceDiscrepancy[];
  onReportDiscrepancy: (data: any) => void;
}

export const DiscrepancyReporting: React.FC<DiscrepancyReportingProps> = ({
  discrepancies,
  onReportDiscrepancy
}) => {
  const [showReportModal, setShowReportModal] = React.useState(false);
  const [formData, setFormData] = React.useState({
    date: '',
    course: '',
    reported_status: 'PRESENT' as const,
    description: ''
  });

  const handleSubmitReport = () => {
    onReportDiscrepancy(formData);
    setFormData({ date: '', course: '', reported_status: 'PRESENT', description: '' });
    setShowReportModal(false);
  };

  const openCount = discrepancies.filter(d => d.status === 'OPEN').length;

  return (
    <div className="space-y-4 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Flag className="w-5 h-5" />
          Attendance Discrepancies ({openCount})
        </h3>

        <button
          onClick={() => setShowReportModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          <AlertCircle className="w-4 h-4" />
          Report Issue
        </button>
      </div>

      {/* Discrepancies List */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {discrepancies.length === 0 ? (
          <div className="p-6 text-center text-slate-400 bg-green-500/5 rounded border border-green-500/30">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
            No discrepancies reported
          </div>
        ) : (
          discrepancies.map(disc => (
            <div
              key={disc.id}
              className={`p-3 rounded-lg border ${
                disc.status === 'OPEN'
                  ? 'bg-red-500/5 border-red-500/30'
                  : disc.status === 'ACKNOWLEDGED'
                  ? 'bg-yellow-500/5 border-yellow-500/30'
                  : 'bg-green-500/5 border-green-500/30'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-white">{disc.course}</p>
                  <p className="text-sm text-slate-400 mt-1">{disc.description}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(disc.filed_at).toLocaleString()}
                  </p>
                </div>

                <div className="text-right">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    disc.status === 'OPEN'
                      ? 'bg-red-500/20 text-red-300'
                      : disc.status === 'ACKNOWLEDGED'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-green-500/20 text-green-300'
                  }`}>
                    {disc.status}
                  </span>
                  {disc.resolution && (
                    <p className="text-xs text-slate-400 mt-2 max-w-48">{disc.resolution}</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Report Attendance Discrepancy</h3>

            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Course</label>
                <input
                  type="text"
                  value={formData.course}
                  onChange={e => setFormData({ ...formData, course: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">What Should Your Status Be?</label>
                <select
                  value={formData.reported_status}
                  onChange={e => setFormData({ ...formData, reported_status: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                >
                  <option value="PRESENT">Present</option>
                  <option value="LATE">Late</option>
                  <option value="ABSENT">Absent</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Explanation</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Explain the attendance discrepancy"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReport}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                disabled={!formData.date || !formData.course || !formData.description}
              >
                Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 5: ExportOptions.tsx
// ============================================================================

interface ExportOptionsProps {
  onExport: (format: string) => void;
}

export const ExportOptions: React.FC<ExportOptionsProps> = ({ onExport }) => {
  return (
    <div className="p-6 bg-slate-800/50 rounded-lg border border-slate-700">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5" />
        Download Your Reports
      </h3>

      <div className="grid grid-cols-3 gap-3">
        {[
          { format: 'PDF', icon: '📄', color: 'bg-red-600' },
          { format: 'XLSX', icon: '📊', color: 'bg-green-600' },
          { format: 'CSV', icon: '📋', color: 'bg-blue-600' }
        ].map(option => (
          <button
            key={option.format}
            onClick={() => onExport(option.format)}
            className={`flex flex-col items-center gap-2 px-4 py-4 ${option.color} hover:opacity-90 text-white rounded-lg font-medium transition-opacity`}
          >
            <span className="text-2xl">{option.icon}</span>
            <span>{option.format}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN PAGE: StudentEmployeeView.tsx
// ============================================================================

export const StudentEmployeeView: React.FC = () => {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [metrics, setMetrics] = React.useState<PersonalAttendanceMetrics | null>(null);
  const [courses, setCourses] = React.useState<CourseOrDepartmentAttendance[]>([]);
  const [discrepancies, setDiscrepancies] = React.useState<AttendanceDiscrepancy[]>([]);
  const [showEditProfile, setShowEditProfile] = React.useState(false);

  // Mock data initialization
  React.useEffect(() => {
    setProfile({
      id: '123',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '(555) 123-4567',
      role: 'STUDENT',
      enrollment_id: 'STU-2024-001',
      department: 'Computer Science',
      joined_at: new Date().toISOString()
    });

    setMetrics({
      total_sessions: 32,
      present_count: 28,
      absent_count: 2,
      late_count: 2,
      excused_count: 0,
      attendance_percentage: 87.5,
      status: 'GOOD'
    });

    setCourses([
      {
        id: '1',
        name: 'Introduction to Computer Science',
        code: 'CS101',
        total_classes: 16,
        present: 14,
        absent: 1,
        late: 1,
        attendance_percentage: 87.5,
        instructor: 'Dr. Smith'
      },
      {
        id: '2',
        name: 'Data Structures',
        code: 'CS201',
        total_classes: 16,
        present: 14,
        absent: 1,
        late: 1,
        attendance_percentage: 87.5,
        instructor: 'Prof. Johnson'
      }
    ]);

    setDiscrepancies([
      {
        id: '1',
        date: new Date().toISOString(),
        course: 'CS101',
        reported_status: 'PRESENT',
        description: 'I was present but marked absent',
        status: 'OPEN',
        filed_at: new Date().toISOString()
      }
    ]);
  }, []);

  if (!profile || !metrics) return <div>Loading...</div>;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <User className="w-8 h-8 text-blue-500" />
          <h1 className="text-3xl font-bold text-white">MY ATTENDANCE</h1>
        </div>
        <p className="text-slate-400">
          View your attendance record, analytics, and personal data
        </p>
      </div>

      {/* Profile & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <ProfileCard profile={profile} onEdit={() => setShowEditProfile(true)} />
        </div>

        <div className="lg:col-span-2">
          <AttendanceMetricsOverview metrics={metrics} />
        </div>
      </div>

      {/* Detailed Breakdown */}
      <CourseAttendanceBreakdown courses={courses} userRole={profile.role} />

      {/* Discrepancy Reporting */}
      <DiscrepancyReporting discrepancies={discrepancies} onReportDiscrepancy={() => {}} />

      {/* Export */}
      <ExportOptions onExport={() => {}} />
    </div>
  );
};

export default StudentEmployeeView;
