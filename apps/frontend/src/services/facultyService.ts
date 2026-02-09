/**
 * Faculty Service
 * 
 * Endpoints:
 * - Course Roster
 * - Mark Attendance (4 modes)
 * - Attendance Submission & Lock
 * - Attendance Reporting & Export
 */

import { axiosClient } from '../utils/axiosClient';

export interface CourseRoster {
  course_id: string;
  course_name: string;
  code: string;
  students: RosterStudent[];
}

export interface RosterStudent {
  id: string;
  name: string;
  email: string;
  enrollment_id: string;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  semester: string;
  students_count: number;
}

export interface MarkAttendanceRequest {
  course_id: string;
  date: string;
  mode: 'QR_CODE' | 'FACIAL_RECOGNITION' | 'MANUAL' | 'BULK_EDIT';
  entries: AttendanceEntry[];
  notes?: string;
}

export interface AttendanceEntry {
  student_id: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
  marked_at: string;
}

export interface SubmitAttendanceRequest {
  course_id: string;
  date: string;
  locked: boolean; // true = lock, false = just submit draft
}

export interface AttendanceRecord {
  student_id: string;
  student_name: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
  marked_at: string;
}

export interface AttendanceReport {
  course_id: string;
  course_name: string;
  date: string;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED';
  total_students: number;
  marked_count: number;
  records: AttendanceRecord[];
}

export interface StudentAttendanceSummary {
  student_id: string;
  student_name: string;
  classes_total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendance_percent: number;
}

class FacultyService {
  /**
   * Get Faculty's Courses
   */
  async getCourses(): Promise<Course[]> {
    const response = await axiosClient.get<Course[]>('/faculty/courses');
    return response.data;
  }

  /**
   * Get Course Roster
   */
  async getCourseRoster(courseId: string): Promise<CourseRoster> {
    const response = await axiosClient.get<CourseRoster>(`/faculty/courses/${courseId}/roster`);
    return response.data;
  }

  /**
   * Mark Attendance
   */
  async markAttendance(data: MarkAttendanceRequest): Promise<{
    success: boolean;
    marked_count: number;
  }> {
    const response = await axiosClient.post('/faculty/attendance/mark', data);
    return response.data;
  }

  /**
   * Get Attendance Draft (current session)
   */
  async getAttendanceDraft(
    courseId: string,
    date: string
  ): Promise<AttendanceReport | null> {
    const response = await axiosClient.get(`/faculty/attendance/draft`, {
      params: { course_id: courseId, date }
    });
    return response.data;
  }

  /**
   * Submit Attendance
   */
  async submitAttendance(courseId: string, date: string): Promise<{
    success: boolean;
    status: 'SUBMITTED';
  }> {
    const response = await axiosClient.post('/faculty/attendance/submit', {
      course_id: courseId,
      date
    });
    return response.data;
  }

  /**
   * Lock Attendance (finalize)
   */
  async lockAttendance(courseId: string, date: string): Promise<{
    success: boolean;
    status: 'LOCKED';
  }> {
    const response = await axiosClient.post('/faculty/attendance/lock', {
      course_id: courseId,
      date
    });
    return response.data;
  }

  /**
   * Get Attendance Summary for Course
   */
  async getAttendanceSummary(courseId: string): Promise<StudentAttendanceSummary[]> {
    const response = await axiosClient.get<StudentAttendanceSummary[]>(
      `/faculty/courses/${courseId}/attendance-summary`
    );
    return response.data;
  }

  /**
   * Export Attendance Report
   */
  async exportAttendanceReport(
    courseId: string,
    format: 'PDF' | 'XLSX' | 'CSV'
  ): Promise<Blob> {
    const response = await axiosClient.get('/faculty/attendance/export', {
      params: { course_id: courseId, format },
      responseType: 'blob'
    });
    return response.data;
  }

  /**
   * Bulk Edit Attendance (preset actions)
   */
  async bulkEditAttendance(
    courseId: string,
    date: string,
    action: 'MARK_ALL_PRESENT' | 'MARK_ALL_ABSENT' | 'CLEAR'
  ): Promise<{
    success: boolean;
    affected_count: number;
  }> {
    const response = await axiosClient.post('/faculty/attendance/bulk-edit', {
      course_id: courseId,
      date,
      action
    });
    return response.data;
  }

  /**
   * Get QR Code for Class (for facial recognition workflow)
   */
  async generateQRCode(courseId: string): Promise<{
    qr_code_data: string; // Data URL
    session_id: string; // For matching facial recognition
  }> {
    const response = await axiosClient.get(`/faculty/courses/${courseId}/qr-code`);
    return response.data;
  }

  /**
   * Submit Facial Recognition Match
   */
  async submitFacialMatch(
    courseId: string,
    date: string,
    studentId: string,
    confidence: number
  ): Promise<{
    success: boolean;
  }> {
    const response = await axiosClient.post('/faculty/attendance/facial-match', {
      course_id: courseId,
      date,
      student_id: studentId,
      confidence
    });
    return response.data;
  }
}

export default new FacultyService();
