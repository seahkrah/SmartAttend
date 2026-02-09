/**
 * HR Service
 * 
 * Organization-wide analytics & management:
 * - Attendance Overview
 * - Member Attendance Table
 * - Pattern Detection
 * - Notification Campaigns
 */

import { axiosClient } from '../utils/axiosClient';

export interface AttendanceOverview {
  total_members: number;
  above_80_percent: number;
  sixty_to_80_percent: number;
  below_60_percent: number;
  average_attendance: number;
  at_risk_count: number;
  chronic_absentees: number;
}

export interface MemberAttendanceSummary {
  id: string;
  name: string;
  role: 'EMPLOYEE' | 'STUDENT';
  email: string;
  department?: string;
  attendance_percentage: number;
  status: 'EXCELLENT' | 'GOOD' | 'AT_RISK' | 'CRITICAL';
  sessions_attended: number;
  sessions_total: number;
  recent_absences: number;
  last_absence_date?: string;
  notification_sent: boolean;
  notes?: string;
}

export interface DepartmentMetrics {
  name: string;
  total_members: number;
  average_attendance: number;
  at_risk_count: number;
  attendance_trend: number; // % change from last period
}

export interface AttendancePattern {
  member_id: string;
  member_name: string;
  pattern: 'CHRONIC_ABSENTEE' | 'MONDAY_ABSENTEE' | 'FRIDAY_ABSENTEE' | 'PATTERNS_IRREGULAR' | 'NONE';
  confidence: number;
  absences_in_period: number;
  last_absence_date?: string;
}

export interface NotificationCampaign {
  id: string;
  name: string;
  target_group: string;
  criteria: string;
  created_at: string;
  sent_count: number;
  recipients: string[];
  message_template: string;
  status: 'DRAFT' | 'SCHEDULED' | 'SENT';
}

export interface CreateCampaignRequest {
  name: string;
  criteria: 'ATTENDANCE_BELOW_60' | 'CHRONIC_ABSENTEE' | 'MONDAY_PATTERN' | 'NO_ACTIVITY_30DAYS';
  message_template: string;
}

class HRService {
  /**
   * Get Attendance Overview
   */
  async getOverview(): Promise<AttendanceOverview> {
    const response = await axiosClient.get<AttendanceOverview>('/hr/overview');
    return response.data;
  }

  /**
   * Get Department Metrics
   */
  async getDepartmentMetrics(): Promise<DepartmentMetrics[]> {
    const response = await axiosClient.get<DepartmentMetrics[]>('/hr/departments/metrics');
    return response.data;
  }

  /**
   * List Members with Attendance
   */
  async listMembers(
    limit = 50,
    offset = 0,
    filters?: { department?: string; status?: string; search?: string }
  ): Promise<{
    members: MemberAttendanceSummary[];
    total: number;
  }> {
    const response = await axiosClient.get('/hr/members', {
      params: { limit, offset, ...filters }
    });
    return response.data;
  }

  /**
   * Get Member Detail
   */
  async getMemberDetail(memberId: string): Promise<MemberAttendanceSummary> {
    const response = await axiosClient.get<MemberAttendanceSummary>(`/hr/members/${memberId}`);
    return response.data;
  }

  /**
   * Get Detected Patterns
   */
  async getPatterns(): Promise<AttendancePattern[]> {
    const response = await axiosClient.get<AttendancePattern[]>('/hr/patterns');
    return response.data;
  }

  /**
   * Send Notification to Member
   */
  async sendNotification(
    memberId: string,
    message: string,
    type: 'WARNING' | 'ALERT' | 'INFO'
  ): Promise<{
    success: boolean;
    sent_at: string;
  }> {
    const response = await axiosClient.post('/hr/notifications/send', {
      recipient_id: memberId,
      message,
      type
    });
    return response.data;
  }

  /**
   * Create Notification Campaign
   */
  async createCampaign(data: CreateCampaignRequest): Promise<NotificationCampaign> {
    const response = await axiosClient.post<NotificationCampaign>('/hr/campaigns', data);
    return response.data;
  }

  /**
   * List Campaigns
   */
  async listCampaigns(
    status?: 'DRAFT' | 'SCHEDULED' | 'SENT'
  ): Promise<NotificationCampaign[]> {
    const response = await axiosClient.get('/hr/campaigns', {
      params: { ...(status && { status }) }
    });
    return response.data;
  }

  /**
   * Send Campaign
   */
  async sendCampaign(campaignId: string): Promise<{
    success: boolean;
    recipients_count: number;
    sent_at: string;
  }> {
    const response = await axiosClient.post(`/hr/campaigns/${campaignId}/send`);
    return response.data;
  }

  /**
   * Cancel Campaign
   */
  async cancelCampaign(campaignId: string): Promise<{
    success: boolean;
  }> {
    const response = await axiosClient.delete(`/hr/campaigns/${campaignId}`);
    return response.data;
  }

  /**
   * Export Organization Report
   */
  async exportReport(format: 'PDF' | 'XLSX'): Promise<Blob> {
    const response = await axiosClient.get('/hr/export/organization-report', {
      params: { format },
      responseType: 'blob'
    });
    return response.data;
  }

  /**
   * Get Compliance Summary
   */
  async getComplianceSummary(): Promise<{
    compliant_members: number;
    non_compliant_members: number;
    compliance_percent: number;
    last_updated: string;
  }> {
    const response = await axiosClient.get('/hr/compliance/summary');
    return response.data;
  }
}

export default new HRService();
