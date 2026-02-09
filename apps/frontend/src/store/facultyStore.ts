/**
 * Faculty Store
 * 
 * State:
 * - Faculty's courses
 * - Current course roster
 * - Attendance draft (current session)
 * - Attendance summary/reporting
 */

import { create } from 'zustand';
import { useToastStore } from '../components/Toast';
import facultyService, {
  Course,
  CourseRoster,
  AttendanceReport,
  StudentAttendanceSummary,
  MarkAttendanceRequest
} from '../services/facultyService';

export interface FacultyState {
  // Data
  courses: Course[];
  selectedCourseId: string | null;
  courseRoster: CourseRoster | null;
  attendanceDraft: AttendanceReport | null;
  attendanceSummary: StudentAttendanceSummary[];

  // Current session
  markingMode: 'QR_CODE' | 'FACIAL_RECOGNITION' | 'MANUAL' | 'BULK_EDIT' | null;
  selectedDate: string; // YYYY-MM-DD
  markedCount: number;
  totalCount: number;

  // Loading/Error
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchCourses: () => Promise<void>;
  selectCourse: (courseId: string) => Promise<void>;
  fetchRoster: (courseId: string) => Promise<void>;
  setMarkingMode: (mode: 'QR_CODE' | 'FACIAL_RECOGNITION' | 'MANUAL' | 'BULK_EDIT') => void;
  setSelectedDate: (date: string) => void;
  fetchAttendanceDraft: () => Promise<void>;
  markAttendance: (data: MarkAttendanceRequest) => Promise<void>;
  submitAttendance: () => Promise<void>;
  lockAttendance: () => Promise<void>;
  fetchAttendanceSummary: () => Promise<void>;
  bulkEdit: (action: 'MARK_ALL_PRESENT' | 'MARK_ALL_ABSENT' | 'CLEAR') => Promise<void>;
  exportReport: (format: 'PDF' | 'XLSX' | 'CSV') => Promise<Blob>;
  clearError: () => void;
}

export const useFacultyStore = create<FacultyState>((set, get) => ({
  courses: [],
  selectedCourseId: null,
  courseRoster: null,
  attendanceDraft: null,
  attendanceSummary: [],
  markingMode: null,
  selectedDate: new Date().toISOString().split('T')[0],
  markedCount: 0,
  totalCount: 0,
  isLoading: false,
  error: null,

  fetchCourses: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await facultyService.getCourses();
      set({ courses: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  selectCourse: async (courseId) => {
    set({ selectedCourseId: courseId });
    get().fetchRoster(courseId);
    get().fetchAttendanceSummary();
  },

  fetchRoster: async (courseId) => {
    set({ isLoading: true, error: null });
    try {
      const data = await facultyService.getCourseRoster(courseId);
      set({
        courseRoster: data,
        totalCount: data.students.length,
        isLoading: false
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  setMarkingMode: (mode) => {
    set({ markingMode: mode });
  },

  setSelectedDate: (date) => {
    set({ selectedDate: date });
  },

  fetchAttendanceDraft: async () => {
    const { selectedCourseId, selectedDate } = get();
    if (!selectedCourseId) return;

    set({ isLoading: true, error: null });
    try {
      const data = await facultyService.getAttendanceDraft(selectedCourseId, selectedDate);
      if (data) {
        set({
          attendanceDraft: data,
          markedCount: data.marked_count,
          isLoading: false
        });
      } else {
        set({
          attendanceDraft: null,
          markedCount: 0,
          isLoading: false
        });
      }
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  markAttendance: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await facultyService.markAttendance(data);
      get().fetchAttendanceDraft();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Attendance marked',
        message: `${data.studentIds.length} student(s) marked`,
        duration: 3000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to mark attendance',
        message: error.message,
        duration: null
      });
    }
  },

  submitAttendance: async () => {
    const { selectedCourseId, selectedDate } = get();
    if (!selectedCourseId) return;

    set({ isLoading: true, error: null });
    try {
      await facultyService.submitAttendance(selectedCourseId, selectedDate);
      get().fetchAttendanceDraft();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Attendance submitted',
        message: 'Attendance has been submitted for review',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to submit attendance',
        message: error.message,
        duration: null
      });
    }
  },

  lockAttendance: async () => {
    const { selectedCourseId, selectedDate } = get();
    if (!selectedCourseId) return;

    set({ isLoading: true, error: null });
    try {
      await facultyService.lockAttendance(selectedCourseId, selectedDate);
      get().fetchAttendanceDraft();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Attendance finalized',
        message: 'Attendance is now locked and cannot be edited',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to finalize attendance',
        message: error.message,
        duration: null
      });
    }
  },

  fetchAttendanceSummary: async () => {
    const { selectedCourseId } = get();
    if (!selectedCourseId) return;

    set({ isLoading: true, error: null });
    try {
      const data = await facultyService.getAttendanceSummary(selectedCourseId);
      set({ attendanceSummary: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  bulkEdit: async (action) => {
    const { selectedCourseId, selectedDate } = get();
    if (!selectedCourseId) return;

    set({ isLoading: true, error: null });
    try {
      await facultyService.bulkEditAttendance(selectedCourseId, selectedDate, action);
      get().fetchAttendanceDraft();
      set({ isLoading: false });
      const actionLabel = action === 'MARK_ALL_PRESENT' ? 'Marked all present' : action === 'MARK_ALL_ABSENT' ? 'Marked all absent' : 'Cleared marks';
      useToastStore.getState().addToast({
        type: 'success',
        title: actionLabel,
        message: `All students have been ${actionLabel.toLowerCase()}`,
        duration: 3000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Bulk edit failed',
        message: error.message,
        duration: null
      });
    }
  },

  exportReport: async (format) => {
    const { selectedCourseId } = get();
    if (!selectedCourseId) throw new Error('No course selected');

    set({ isLoading: true, error: null });
    try {
      const blob = await facultyService.exportAttendanceReport(selectedCourseId, format);
      set({ isLoading: false });
      return blob;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null })
}));
