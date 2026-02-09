/**
 * Admin Store
 * 
 * State:
 * - Tenant users
 * - Courses
 * - Pending approvals
 * - Tenant analytics
 */

import { create } from 'zustand';
import { useToastStore } from '../components/Toast';
import adminService, {
  AdminUser,
  Course,
  PendingApproval,
  TenantAnalytics,
  CreateUserRequest,
  CreateCourseRequest
} from '../services/adminService';

export interface AdminState {
  // Data
  users: AdminUser[];
  usersTotal: number;
  courses: Course[];
  coursesTotal: number;
  pendingApprovals: PendingApproval[];
  analytics: TenantAnalytics | null;

  // Loading/Error
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchAnalytics: () => Promise<void>;
  fetchUsers: (limit?: number, offset?: number, filters?: any) => Promise<void>;
  fetchCourses: (limit?: number, offset?: number, filters?: any) => Promise<void>;
  fetchPendingApprovals: () => Promise<void>;
  createUser: (data: CreateUserRequest) => Promise<void>;
  updateUser: (userId: string, data: Partial<CreateUserRequest>) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  bulkImportUsers: (file: File) => Promise<void>;
  createCourse: (data: CreateCourseRequest) => Promise<void>;
  assignFaculty: (courseId: string, facultyId: string) => Promise<void>;
  approveUser: (approvalId: string, notes?: string) => Promise<void>;
  rejectUser: (approvalId: string, reason: string) => Promise<void>;
  clearError: () => void;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  users: [],
  usersTotal: 0,
  courses: [],
  coursesTotal: 0,
  pendingApprovals: [],
  analytics: null,
  isLoading: false,
  error: null,

  fetchAnalytics: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await adminService.getTenantAnalytics();
      set({ analytics: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchUsers: async (limit = 50, offset = 0, filters) => {
    set({ isLoading: true, error: null });
    try {
      const data = await adminService.listUsers(limit, offset, filters);
      set({ users: data.users, usersTotal: data.total, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchCourses: async (limit = 50, offset = 0, filters) => {
    set({ isLoading: true, error: null });
    try {
      const data = await adminService.listCourses(limit, offset, filters);
      set({ courses: data.courses, coursesTotal: data.total, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchPendingApprovals: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await adminService.getPendingApprovals();
      set({ pendingApprovals: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createUser: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.createUser(data);
      get().fetchUsers();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'User created',
        message: `${data.email} has been added successfully`,
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to create user',
        message: error.message,
        duration: null
      });
    }
  },

  updateUser: async (userId, data) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.updateUser(userId, data);
      get().fetchUsers();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'User updated',
        message: 'Changes have been saved',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to update user',
        message: error.message,
        duration: null
      });
    }
  },

  deleteUser: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.deleteUser(userId);
      get().fetchUsers();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'User deleted',
        message: 'The user has been permanently removed',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to delete user',
        message: error.message,
        duration: null
      });
    }
  },

  bulkImportUsers: async (file) => {
    set({ isLoading: true, error: null });
    try {
      const result = await adminService.bulkImportUsers(file);
      get().fetchUsers();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Import completed',
        message: `${result.successful} users imported, ${result.failed} failed`,
        duration: 5000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Import failed',
        message: error.message,
        duration: null
      });
    }
  },

  createCourse: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.createCourse(data);
      get().fetchCourses();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Course created',
        message: `${data.course_name} has been added`,
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to create course',
        message: error.message,
        duration: null
      });
    }
  },

  assignFaculty: async (courseId, facultyId) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.assignFacultyToCourse(courseId, { faculty_id: facultyId });
      get().fetchCourses();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Faculty assigned',
        message: 'Faculty member has been assigned to the course',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to assign faculty',
        message: error.message,
        duration: null
      });
    }
  },

  approveUser: async (approvalId, notes) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.approveUser(approvalId, notes);
      get().fetchPendingApprovals();
      get().fetchUsers();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'User approved',
        message: 'The user has been approved and is now active',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to approve user',
        message: error.message,
        duration: null
      });
    }
  },

  rejectUser: async (approvalId, reason) => {
    set({ isLoading: true, error: null });
    try {
      await adminService.rejectUser(approvalId, reason);
      get().fetchPendingApprovals();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'warning',
        title: 'User rejected',
        message: 'The user application has been rejected',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to reject user',
        message: error.message,
        duration: null
      });
    }
  },

  clearError: () => set({ error: null })
}));
