/**
 * Admin Service
 * 
 * Per-tenant admin endpoints:
 * - User Management (CRUD)
 * - Course/Department Management
 * - Approval Queue
 * - Tenant Analytics
 */

import { axiosClient } from '../utils/axiosClient';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'STUDENT' | 'EMPLOYEE' | 'FACULTY' | 'HR' | 'ADMIN';
  department?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_APPROVAL';
  created_at: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  role: 'STUDENT' | 'EMPLOYEE' | 'FACULTY' | 'HR';
  department?: string;
  password?: string;
}

export interface BulkImportRequest {
  file: File; // CSV: email, name, role, department
}

export interface Course {
  id: string;
  name: string;
  code: string;
  semester: string;
  instructor_id?: string;
  instructor_name?: string;
  students_count: number;
  created_at: string;
}

export interface CreateCourseRequest {
  name: string;
  code: string;
  semester: string;
}

export interface AssignFacultyRequest {
  faculty_id: string;
}

export interface PendingApproval {
  id: string;
  user_email: string;
  user_name: string;
  role: string;
  department?: string;
  requested_at: string;
  requested_by?: string;
}

export interface TenantAnalytics {
  total_users: number;
  faculty_count: number;
  student_count: number;
  employee_count: number;
  total_courses: number;
  active_sessions: number;
  average_attendance_percent: number;
  users_at_risk: number;
  pending_approvals: number;
  last_week_new_users: number;
}

class AdminService {
  /**
   * Get Tenant Analytics
   */
  async getTenantAnalytics(): Promise<TenantAnalytics> {
    const response = await axiosClient.get<TenantAnalytics>('/admin/analytics');
    return response.data;
  }

  /**
   * List Users in Tenant
   */
  async listUsers(
    limit = 50,
    offset = 0,
    filters?: { role?: string; department?: string; status?: string; search?: string }
  ): Promise<{
    users: AdminUser[];
    total: number;
  }> {
    const response = await axiosClient.get('/admin/users', {
      params: { limit, offset, ...filters }
    });
    return response.data;
  }

  /**
   * Create New User
   */
  async createUser(data: CreateUserRequest): Promise<AdminUser> {
    const response = await axiosClient.post<AdminUser>('/admin/users', data);
    return response.data;
  }

  /**
   * Update User
   */
  async updateUser(userId: string, data: Partial<CreateUserRequest>): Promise<AdminUser> {
    const response = await axiosClient.put<AdminUser>(`/admin/users/${userId}`, data);
    return response.data;
  }

  /**
   * Delete User
   */
  async deleteUser(userId: string): Promise<{ success: boolean }> {
    const response = await axiosClient.delete(`/admin/users/${userId}`);
    return response.data;
  }

  /**
   * Bulk Import Users (CSV)
   */
  async bulkImportUsers(file: File): Promise<{
    imported: number;
    failed: number;
    errors: Array<{ row: number; error: string }>;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axiosClient.post('/admin/users/bulk-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  }

  /**
   * List Courses
   */
  async listCourses(
    limit = 50,
    offset = 0,
    filters?: { semester?: string; search?: string }
  ): Promise<{
    courses: Course[];
    total: number;
  }> {
    const response = await axiosClient.get('/admin/courses', {
      params: { limit, offset, ...filters }
    });
    return response.data;
  }

  /**
   * Create Course
   */
  async createCourse(data: CreateCourseRequest): Promise<Course> {
    const response = await axiosClient.post<Course>('/admin/courses', data);
    return response.data;
  }

  /**
   * Update Course
   */
  async updateCourse(courseId: string, data: Partial<CreateCourseRequest>): Promise<Course> {
    const response = await axiosClient.put<Course>(`/admin/courses/${courseId}`, data);
    return response.data;
  }

  /**
   * Assign Faculty to Course
   */
  async assignFacultyToCourse(
    courseId: string,
    data: AssignFacultyRequest
  ): Promise<Course> {
    const response = await axiosClient.put<Course>(
      `/admin/courses/${courseId}/assign-faculty`,
      data
    );
    return response.data;
  }

  /**
   * Get Approval Queue
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const response = await axiosClient.get<PendingApproval[]>('/admin/approvals/pending');
    return response.data;
  }

  /**
   * Approve User
   */
  async approveUser(approvalId: string, notes?: string): Promise<{ success: boolean }> {
    const response = await axiosClient.post('/admin/approvals/approve', {
      approval_id: approvalId,
      notes
    });
    return response.data;
  }

  /**
   * Reject User
   */
  async rejectUser(approvalId: string, reason: string): Promise<{ success: boolean }> {
    const response = await axiosClient.post('/admin/approvals/reject', {
      approval_id: approvalId,
      reason
    });
    return response.data;
  }

  /**
   * Export Tenant Report
   */
  async exportTenantReport(format: 'PDF' | 'XLSX'): Promise<Blob> {
    const response = await axiosClient.get('/admin/export/tenant-report', {
      params: { format },
      responseType: 'blob'
    });
    return response.data;
  }
}

export default new AdminService();
