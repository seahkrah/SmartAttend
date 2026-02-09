/**
 * HR Store
 * 
 * Organization-wide state:
 * - Attendance overview
 * - Member attendance table
 * - Detected patterns
 * - Notification campaigns
 */

import { create } from 'zustand';
import { useToastStore } from '../components/Toast';
import hrService, {
  AttendanceOverview,
  MemberAttendanceSummary,
  DepartmentMetrics,
  AttendancePattern,
  NotificationCampaign,
  CreateCampaignRequest
} from '../services/hrService';

export interface HRState {
  // Data
  overview: AttendanceOverview | null;
  members: MemberAttendanceSummary[];
  membersTotal: number;
  departments: DepartmentMetrics[];
  patterns: AttendancePattern[];
  campaigns: NotificationCampaign[];

  // Loading/Error
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchOverview: () => Promise<void>;
  fetchDepartmentMetrics: () => Promise<void>;
  fetchMembers: (limit?: number, offset?: number, filters?: any) => Promise<void>;
  fetchPatterns: () => Promise<void>;
  fetchCampaigns: (status?: 'DRAFT' | 'SCHEDULED' | 'SENT') => Promise<void>;
  sendNotification: (memberId: string, message: string, type: 'WARNING' | 'ALERT' | 'INFO') => Promise<void>;
  createCampaign: (data: CreateCampaignRequest) => Promise<void>;
  sendCampaign: (campaignId: string) => Promise<void>;
  cancelCampaign: (campaignId: string) => Promise<void>;
  exportReport: (format: 'PDF' | 'XLSX') => Promise<Blob>;
  getComplianceSummary: () => Promise<void>;
  clearError: () => void;
}

export const useHRStore = create<HRState>((set, get) => ({
  overview: null,
  members: [],
  membersTotal: 0,
  departments: [],
  patterns: [],
  campaigns: [],
  isLoading: false,
  error: null,

  fetchOverview: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await hrService.getOverview();
      set({ overview: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchDepartmentMetrics: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await hrService.getDepartmentMetrics();
      set({ departments: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchMembers: async (limit = 50, offset = 0, filters) => {
    set({ isLoading: true, error: null });
    try {
      const data = await hrService.listMembers(limit, offset, filters);
      set({ members: data.members, membersTotal: data.total, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchPatterns: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await hrService.getPatterns();
      set({ patterns: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchCampaigns: async (status) => {
    set({ isLoading: true, error: null });
    try {
      const data = await hrService.listCampaigns(status);
      set({ campaigns: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  sendNotification: async (memberId, message, type) => {
    set({ isLoading: true, error: null });
    try {
      await hrService.sendNotification(memberId, message, type);
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Notification sent',
        message: 'Message has been delivered',
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

  createCampaign: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await hrService.createCampaign(data);
      get().fetchCampaigns();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Campaign created',
        message: 'Notification campaign has been created. Ready to send.',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to create campaign',
        message: error.message,
        duration: null
      });
    }
  },

  sendCampaign: async (campaignId) => {
    set({ isLoading: true, error: null });
    try {
      await hrService.sendCampaign(campaignId);
      get().fetchCampaigns();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Campaign sent',
        message: 'Notifications have been sent to all targeted employees',
        duration: 5000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to send campaign',
        message: error.message,
        duration: null
      });
    }
  },

  cancelCampaign: async (campaignId) => {
    set({ isLoading: true, error: null });
    try {
      await hrService.cancelCampaign(campaignId);
      get().fetchCampaigns();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'warning',
        title: 'Campaign cancelled',
        message: 'The notification campaign has been cancelled',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to cancel campaign',
        message: error.message,
        duration: null
      });
    }
  },

  exportReport: async (format) => {
    set({ isLoading: true, error: null });
    try {
      const blob = await hrService.exportReport(format);
      set({ isLoading: false });
      return blob;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  getComplianceSummary: async () => {
    set({ isLoading: true, error: null });
    try {
      await hrService.getComplianceSummary();
      set({ isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  clearError: () => set({ error: null })
}));
