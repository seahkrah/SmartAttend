/**
 * Attendance Service
 * 
 * Self-service endpoints for Students/Employees:
 * - My Attendance Metrics
 * - My Course/Department Breakdown
 * - My Discrepancy Reports
 * - My Data Export
 */

import { axiosClient } from '../utils/axiosClient';

export interface AttendanceMetrics {
  attendance_percent: number;
  rating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  sessions_total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  last_updated: string;
}

export interface CourseAttendance {
  course_id: string;
  course_name: string;
  code: string;
  semester: string;
  sessions_total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendance_percent: number;
  instructor_name?: string;
}

export interface EmployeeAttendance {
  department: string;
  sessions_total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendance_percent: number;
}

export interface DiscrepancyReport {
  id: string;
  course_id?: string;
  course_name?: string;
  date_of_class: string;
  date_reported: string;
  reported_status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
  current_status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
  description: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED';
  resolved_by?: string;
  resolution_notes?: string;
}

export interface CreateDiscrepancyRequest {
  course_id?: string;
  date_of_class: string;
  reported_status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
  description: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'STUDENT' | 'EMPLOYEE';
  enrollment_id?: string;
  department?: string;
  joined_date: string;
  avatar_url?: string;
}

class AttendanceService {
  /**
   * Get My Profile
   */
  async getProfile(): Promise<UserProfile> {
    const response = await axiosClient.get<UserProfile>('/attendance/profile');
    return response.data;
  }

  /**
   * Update My Profile
   */
  async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
    const response = await axiosClient.put<UserProfile>('/attendance/profile', data);
    return response.data;
  }

  /**
   * Get My Attendance Metrics
   */
  async getMetrics(): Promise<AttendanceMetrics> {
    const response = await axiosClient.get<AttendanceMetrics>('/attendance/me/metrics');
    return response.data;
  }

  /**
   * Get My Course/Department Attendance Breakdown
   */
  async getCourseBreakdown(): Promise<CourseAttendance[]> {
    const response = await axiosClient.get<CourseAttendance[]>('/attendance/me/courses');
    return response.data;
  }

  /**
   * Get My Discrepancy Reports
   */
  async getDiscrepancies(
    limit = 20,
    offset = 0,
    status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED'
  ): Promise<{
    reports: DiscrepancyReport[];
    total: number;
  }> {
    const response = await axiosClient.get('/attendance/me/discrepancies', {
      params: { limit, offset, status }
    });
    return response.data;
  }

  /**
   * Report Discrepancy
   */
  async reportDiscrepancy(data: CreateDiscrepancyRequest): Promise<DiscrepancyReport> {
    const response = await axiosClient.post<DiscrepancyReport>(
      '/attendance/me/discrepancies',
      data
    );
    return response.data;
  }

  /**
   * Export My Attendance Report
   */
  async exportReport(format: 'PDF' | 'XLSX' | 'CSV'): Promise<Blob> {
    const response = await axiosClient.get('/attendance/me/export', {
      params: { format },
      responseType: 'blob'
    });
    return response.data;
  }

  /**
   * ===== HR-SPECIFIC ENDPOINTS (if role === HR) =====
   */

  /**
   * Get All Employees' Attendance (HR only)
   */
  async getAllEmployeeAttendance(
    limit = 50,
    offset = 0,
    filters?: { department?: string; search?: string }
  ): Promise<{
    employees: CourseAttendance[]; // Reusing same interface for dept breakdown
    total: number;
  }> {
    const response = await axiosClient.get('/attendance/department/all', {
      params: { limit, offset, ...filters }
    });
    return response.data;
  }

  /**
   * Get Employee Attendance Details (HR only)
   */
  async getEmployeeAttendance(employeeId: string): Promise<{
    profile: UserProfile;
    metrics: AttendanceMetrics;
    breakdown: CourseAttendance[];
  }> {
    const response = await axiosClient.get(`/attendance/employees/${employeeId}`);
    return response.data;
  }

  /**
   * Send Notification to Employee (HR only)
   */
  async sendNotificationToEmployee(
    employeeId: string,
    message: string,
    type: 'WARNING' | 'ALERT' | 'INFO'
  ): Promise<{
    success: boolean;
    sent_at: string;
  }> {
    const response = await axiosClient.post('/attendance/notifications/send', {
      recipient_id: employeeId,
      message,
      type
    });
    return response.data;
  }

  /**
   * Export Department Report (HR only)
   */
  async exportDepartmentReport(format: 'PDF' | 'XLSX' | 'CSV'): Promise<Blob> {
    const response = await axiosClient.get('/attendance/department/export', {
      params: { format },
      responseType: 'blob'
    });
    return response.data;
  }
}

export default new AttendanceService();
