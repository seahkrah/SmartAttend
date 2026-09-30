import { axiosClient } from '../utils/axiosClient';

/**
 * EMS leave: types, balances, requests, approvals and the calendar.
 *
 * The employee is resolved server-side from the authenticated identity, so
 * nothing here sends one except where HR is deliberately acting on someone's
 * behalf.
 */

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  days_per_year: number;
  is_paid: boolean;
  requires_approval: boolean;
  requires_document: boolean;
  allows_half_day: boolean;
  max_carry_over: number;
  min_notice_days: number;
  is_active: boolean;
}

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  entitled: number;
  carriedOver: number;
  taken: number;
  pending: number;
  available: number;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_number?: string;
  first_name?: string;
  last_name?: string;
  department_name?: string | null;
  leave_type_id: string;
  type_code: string;
  type_name: string;
  is_paid: boolean;
  start_date: string;
  end_date: string;
  total_days: number;
  reason?: string | null;
  status: LeaveStatus;
  decision_note?: string | null;
  decided_at?: string | null;
}

export interface CalendarDay {
  leave_date: string;
  portion: number | string;
  employee_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  type_code: string;
  type_name: string;
  status: LeaveStatus;
}

export const leaveService = {
  async listTypes(): Promise<LeaveType[]> {
    const { data } = await axiosClient.get('/leave/types');
    return data.types;
  },

  async createType(input: Record<string, unknown>): Promise<LeaveType> {
    const { data } = await axiosClient.post('/leave/types', input);
    return data.type;
  },

  async updateType(id: string, input: Record<string, unknown>): Promise<LeaveType> {
    const { data } = await axiosClient.patch(`/leave/types/${id}`, input);
    return data.type;
  },

  async deleteType(id: string): Promise<void> {
    await axiosClient.delete(`/leave/types/${id}`);
  },

  async balances(year?: number, employeeId?: string): Promise<{
    employee: { id: string; employeeNumber: string; firstName: string; lastName: string };
    year: number;
    balances: LeaveBalance[];
  }> {
    const { data } = await axiosClient.get('/leave/balances', {
      params: { year, employeeId },
    });
    return data;
  },

  async setBalance(input: {
    employeeId: string; leaveTypeId: string; year: number;
    entitledDays?: number; carriedOver?: number;
  }): Promise<void> {
    await axiosClient.put('/leave/balances', input);
  },

  async listRequests(params?: { status?: LeaveStatus; scope?: 'mine' | 'all' }): Promise<LeaveRequest[]> {
    const { data } = await axiosClient.get('/leave/requests', { params });
    return data.requests;
  },

  async preview(input: { startDate: string; endDate: string; halfDays?: string[]; leaveTypeId?: string }): Promise<{
    days: Array<{ date: string; portion: number }>;
    totalDays: number;
    available: number | null;
  }> {
    const { data } = await axiosClient.post('/leave/requests/preview', input);
    return data;
  },

  async submit(input: {
    leaveTypeId: string; startDate: string; endDate: string;
    reason?: string; halfDays?: string[]; employeeId?: string;
  }): Promise<{ request: LeaveRequest; totalDays: number }> {
    const { data } = await axiosClient.post('/leave/requests', input);
    return data;
  },

  async decide(id: string, decision: 'approved' | 'rejected', note?: string): Promise<LeaveRequest> {
    const { data } = await axiosClient.post(`/leave/requests/${id}/decision`, { decision, note });
    return data.request;
  },

  async cancel(id: string): Promise<void> {
    await axiosClient.post(`/leave/requests/${id}/cancel`, {});
  },

  async calendar(from: string, to: string): Promise<CalendarDay[]> {
    const { data } = await axiosClient.get('/leave/calendar', { params: { from, to } });
    return data.days;
  },
};
