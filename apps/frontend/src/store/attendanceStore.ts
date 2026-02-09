/**
 * Attendance Store
 * 
 * Self-service state:
 * - My profile
 * - My metrics
 * - My course breakdown
 * - My discrepancies
 * - HR-specific: All employees' attendance
 */

import { create } from 'zustand';
import { useToastStore } from '../components/Toast';
import attendanceService, {
  AttendanceMetrics,
  CourseAttendance,
  DiscrepancyReport,
  UserProfile,
  CreateDiscrepancyRequest
} from '../services/attendanceService';

export interface AttendanceState {
  // Data
  profile: UserProfile | null;
  metrics: AttendanceMetrics | null;
  courses: CourseAttendance[];
  discrepancies: DiscrepancyReport[];
  discrepanciesTotal: number;

  // HR-specific
  allEmployees: CourseAttendance[]; // For HR viewing all employee attendance
  allEmployeesTotal: number;

  // Loading/Error
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchProfile: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  fetchMetrics: () => Promise<void>;
  fetchCourseBreakdown: () => Promise<void>;
  fetchDiscrepancies: (limit?: number, offset?: number, status?: string) => Promise<void>;
  reportDiscrepancy: (data: CreateDiscrepancyRequest) => Promise<void>;
  exportReport: (format: 'PDF' | 'XLSX' | 'CSV') => Promise<Blob>;

  // HR-specific
  fetchAllEmployeeAttendance: (limit?: number, offset?: number, filters?: any) => Promise<void>;
  getEmployeeAttendance: (employeeId: string) => Promise<void>;
  sendNotification: (employeeId: string, message: string, type: 'WARNING' | 'ALERT' | 'INFO') => Promise<void>;
  exportDepartmentReport: (format: 'PDF' | 'XLSX' | 'CSV') => Promise<Blob>;

  clearError: () => void;
}

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  profile: null,
  metrics: null,
  courses: [],
  discrepancies: [],
  discrepanciesTotal: 0,
  allEmployees: [],
  allEmployeesTotal: 0,
  isLoading: false,
  error: null,

  fetchProfile: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await attendanceService.getProfile();
      set({ profile: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  updateProfile: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await attendanceService.updateProfile(data);
      set({ profile: updated, isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Profile updated',
        message: 'Your profile has been saved',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to update profile',
        message: error.message,
        duration: null
      });
    }
  },

  fetchMetrics: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await attendanceService.getMetrics();
      set({ metrics: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchCourseBreakdown: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await attendanceService.getCourseBreakdown();
      set({ courses: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchDiscrepancies: async (limit = 20, offset = 0, status) => {
    set({ isLoading: true, error: null });
    try {
      const data = await attendanceService.getDiscrepancies(limit, offset, status as any);
      set({ discrepancies: data.reports, discrepanciesTotal: data.total, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  reportDiscrepancy: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await attendanceService.reportDiscrepancy(data);
      get().fetchDiscrepancies();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Discrepancy reported',
        message: 'Your report has been submitted for review',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to report discrepancy',
        message: error.message,
        duration: null
      });
    }
  },

  exportReport: async (format) => {
    set({ isLoading: true, error: null });
    try {
      const blob = await attendanceService.exportReport(format);
      set({ isLoading: false });
      return blob;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  // HR Actions
  fetchAllEmployeeAttendance: async (limit = 50, offset = 0, filters) => {
    set({ isLoading: true, error: null });
    try {
      const data = await attendanceService.getAllEmployeeAttendance(limit, offset, filters);
      set({ allEmployees: data.employees, allEmployeesTotal: data.total, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  getEmployeeAttendance: async (employeeId) => {
    set({ isLoading: true, error: null });
    try {
      const data = await attendanceService.getEmployeeAttendance(employeeId);
      set({
        profile: data.profile,
        metrics: data.metrics,
        courses: data.breakdown,
        isLoading: false
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  sendNotification: async (employeeId, message, type) => {
    set({ isLoading: true, error: null });
    try {
      await attendanceService.sendNotificationToEmployee(employeeId, message, type);
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Notification sent',
        message: 'Message has been delivered to the employee',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to send notification',
        message: error.message,
        duration: null
      });
    }
  },

  exportDepartmentReport: async (format) => {
    set({ isLoading: true, error: null });
    try {
      const blob = await attendanceService.exportDepartmentReport(format);
      set({ isLoading: false });
      return blob;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null })
}));
