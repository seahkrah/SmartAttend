/**
 * Attendance Types
 */

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id: string;
  userId?: string;
  studentId?: string;
  employeeId?: string;
  status: AttendanceStatus;
  date: string;
  notes?: string;
  markedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MarkAttendanceRequest {
  userId?: string;
  studentId?: string;
  employeeId?: string;
  status: AttendanceStatus;
  date: string;
  notes?: string;
}

export interface AttendanceStats {
  totalAttendance: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  totalMembers: number;
  trend: 'up' | 'down' | 'stable';
}

export interface AttendanceHistory {
  data: AttendanceRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface AttendanceReport {
  data: (AttendanceRecord & {
    userInfo?: {
      name: string;
      email: string;
      studentId?: string;
      employeeId?: string;
    };
  })[];
  total: number;
  limit: number;
  offset: number;
  generatedAt: string;
}
