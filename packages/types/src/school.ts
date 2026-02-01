/**
 * School Platform Types
 */

export interface Student {
  id: string;
  studentId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  college: string;
  email: string;
  status: string;
  enrollmentYear: number;
  isCurrentlyEnrolled: boolean;
  phone?: string;
  profileImage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentCreateRequest {
  userId: string;
  studentId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  college: string;
  email: string;
  status?: string;
  enrollmentYear: number;
  phone?: string;
}

export interface StudentUpdateRequest {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  college?: string;
  status?: string;
  isCurrentlyEnrolled?: boolean;
  phone?: string;
}

export interface StudentListResponse {
  data: Student[];
  total: number;
  limit: number;
  offset: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  createdAt?: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  departmentId: string;
  description?: string;
  capacity?: number;
  createdAt?: string;
}
