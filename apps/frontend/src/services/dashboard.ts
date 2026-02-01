import { AttendanceStats } from '@smartattend/types';
import { apiClient } from './api';

export interface DashboardStats extends AttendanceStats {
  recentAttendance?: any[];
}

class DashboardService {
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    try {
      const stats = await apiClient.getAttendanceStats(userId);
      return stats;
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
      // Return mock data if API fails
      return {
        totalAttendance: 94,
        presentDays: 47,
        absentDays: 8,
        lateDays: 3,
        excusedDays: 2,
        totalMembers: 324,
        trend: 'up',
      };
    }
  }

  async getAttendanceHistory(userId: string, limit = 10) {
    try {
      const history = await apiClient.getAttendanceHistory(userId, undefined, undefined, limit);
      return history;
    } catch (error) {
      console.error('Failed to fetch attendance history:', error);
      return { data: [] };
    }
  }

  async getUserProfile(userId: string) {
    try {
      const profile = await apiClient.getUserProfile(userId);
      return profile;
    } catch (error) {
      console.error('Failed to fetch user profile:', error);
      return null;
    }
  }
}

export const dashboardService = new DashboardService();
