import { axiosClient } from '../utils/axiosClient';
import type { Transcript, TranscriptEntry } from './gradebookService';
import type { Statement, Clearance } from './feesService';

/**
 * SMS guardians: the school's management of them (/guardians), and a
 * guardian's own portal (/guardian).
 *
 * Neither side sends a tenant. The school is resolved on the server from the
 * signed-in identity, and a guardian's children from the links the school
 * recorded — so there is nothing on these calls to tamper with.
 */

export const RELATIONSHIPS = [
  'mother', 'father', 'parent', 'guardian', 'grandparent', 'sibling', 'relative', 'sponsor', 'other',
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export type AccountState = 'none' | 'invited' | 'active' | 'disabled';

export interface GuardianLink {
  id: string;
  student_id: string;
  student_number: string | null;
  first_name: string;
  last_name: string;
  student_status?: string | null;
  relationship: Relationship;
  is_primary: boolean;
  can_view_attendance: boolean;
  can_view_results: boolean;
  can_view_fees: boolean;
  receives_notifications: boolean;
}

export interface Guardian {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  occupation: string | null;
  notes: string | null;
  user_id: string | null;
  account: AccountState;
  last_login: string | null;
  created_at: string;
  student_count?: number;
  students: Array<GuardianLink | {
    link_id: string; student_id: string; student_number: string | null;
    first_name: string; last_name: string; relationship: Relationship; is_primary: boolean;
  }>;
}

export interface GuardianInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  occupation?: string | null;
  notes?: string | null;
}

export interface LinkInput {
  relationship?: Relationship;
  isPrimary?: boolean;
  canViewAttendance?: boolean;
  canViewResults?: boolean;
  canViewFees?: boolean;
  receivesNotifications?: boolean;
}

export interface Invitation {
  delivery: 'email' | 'simulated' | 'unavailable' | 'handover';
  link?: string;
  reason?: string;
  expiresInDays?: number;
}

export const guardiansAdminService = {
  async list(params: { search?: string; studentId?: string } = {}): Promise<Guardian[]> {
    const { data } = await axiosClient.get('/guardians', { params });
    return data.guardians;
  },
  async get(guardianId: string): Promise<Guardian> {
    const { data } = await axiosClient.get(`/guardians/${guardianId}`);
    return data.guardian;
  },
  async create(input: GuardianInput & { students?: Array<LinkInput & { studentId: string }> }): Promise<Guardian> {
    const { data } = await axiosClient.post('/guardians', input);
    return data.guardian;
  },
  async update(guardianId: string, changes: Partial<GuardianInput>): Promise<Guardian> {
    const { data } = await axiosClient.patch(`/guardians/${guardianId}`, changes);
    return data.guardian;
  },
  async remove(guardianId: string): Promise<{ removed: boolean; accountDeactivated: boolean }> {
    const { data } = await axiosClient.delete(`/guardians/${guardianId}`);
    return data;
  },
  async link(guardianId: string, studentId: string, link: LinkInput = {}): Promise<Guardian> {
    const { data } = await axiosClient.post(`/guardians/${guardianId}/students`, { studentId, ...link });
    return data.guardian;
  },
  async updateLink(guardianId: string, linkId: string, changes: LinkInput): Promise<Guardian> {
    const { data } = await axiosClient.patch(`/guardians/${guardianId}/students/${linkId}`, changes);
    return data.guardian;
  },
  async unlink(guardianId: string, linkId: string): Promise<Guardian> {
    const { data } = await axiosClient.delete(`/guardians/${guardianId}/students/${linkId}`);
    return data.guardian;
  },
  async invite(guardianId: string, handover = false): Promise<{
    invitation: Invitation | null; reusedAccount: boolean; guardian: Guardian;
  }> {
    const { data } = await axiosClient.post(`/guardians/${guardianId}/invitation`, { handover });
    return data;
  },
};

// ---------------------------------------------------------------- portal

export interface Permissions {
  attendance: boolean;
  results: boolean;
  fees: boolean;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
}

export interface AttendanceRecord {
  id: string;
  attendance_date: string;
  status: 'present' | 'late' | 'absent' | 'excused';
  course_code: string;
  course_name: string;
  start_time: string | null;
  end_time: string | null;
}

export interface Child {
  id: string;
  studentNumber: string | null;
  firstName: string;
  lastName: string;
  status: string | null;
  photoUrl: string | null;
  relationship: Relationship;
  isPrimary: boolean;
  permissions: Permissions;
  summary: {
    attendance?: AttendanceSummary;
    fees?: { cleared: boolean; balance: string; currency: string | null; overdueCount: number };
  };
}

export interface ChildrenResponse {
  guardian: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
  school: string | null;
  children: Child[];
}

export interface ChildOverview {
  student: {
    id: string; studentNumber: string | null; firstName: string; middleName: string | null;
    lastName: string; status: string | null; department: string | null; college: string | null;
    enrollmentYear: number | null; photoUrl: string | null;
  };
  programme: { code: string; name: string; award: string | null; current_study_year: number | null } | null;
  relationship: Relationship;
  isPrimary: boolean;
  permissions: Permissions;
  attendance?: { overall: AttendanceSummary; last30Days: AttendanceSummary; recent: AttendanceRecord[] };
  results?: {
    cgpa: number | null; creditsEarned: number; creditsAttempted: number;
    creditWeighted: boolean; latest: TranscriptEntry[];
  };
  fees?: Clearance;
}

export interface ScheduleSlot {
  id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  section: string | null;
  course_code: string;
  course_name: string;
  room_name: string | null;
  lecturer_name: string | null;
}

export const guardianPortalService = {
  async children(): Promise<ChildrenResponse> {
    const { data } = await axiosClient.get('/guardian/children');
    return data;
  },
  async overview(studentId: string): Promise<ChildOverview> {
    const { data } = await axiosClient.get(`/guardian/children/${studentId}`);
    return data;
  },
  async attendance(studentId: string, params: { from?: string; to?: string } = {}): Promise<{
    summary: AttendanceSummary; records: AttendanceRecord[];
  }> {
    const { data } = await axiosClient.get(`/guardian/children/${studentId}/attendance`, { params });
    return data;
  },
  async schedule(studentId: string): Promise<ScheduleSlot[]> {
    const { data } = await axiosClient.get(`/guardian/children/${studentId}/schedule`);
    return data.schedule;
  },
  async results(studentId: string): Promise<Transcript> {
    const { data } = await axiosClient.get(`/guardian/children/${studentId}/results`);
    return data;
  },
  async fees(studentId: string): Promise<Statement> {
    const { data } = await axiosClient.get(`/guardian/children/${studentId}/fees`);
    return data;
  },
};
