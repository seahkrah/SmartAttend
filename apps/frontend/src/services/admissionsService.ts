import { axiosClient } from '../utils/axiosClient';

/**
 * SMS admissions: intakes, applicants, applications, decisions and enrolment.
 *
 * The tenant is never sent. It is resolved server-side from the authenticated
 * identity, so nothing here takes a tenant id and nothing here could send one.
 */

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'offer'
  | 'accepted'
  | 'declined'
  | 'rejected'
  | 'waitlisted'
  | 'withdrawn'
  | 'enrolled';

export type IntakeStatus = 'draft' | 'open' | 'closed' | 'archived';

export interface AdmissionIntake {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  academic_year_id?: string | null;
  academic_year_name?: string | null;
  opens_at: string;
  closes_at: string;
  decision_by?: string | null;
  capacity?: number | null;
  status: IntakeStatus;
  application_count?: number;
  places_taken?: number;
}

export interface IntakeCapacity {
  capacity: number | null;
  taken: number;
  remaining: number | null;
}

export interface Applicant {
  id: string;
  reference: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  email: string;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  address?: string | null;
  prior_school?: string | null;
  prior_qualification?: string | null;
  converted_student_id?: string | null;
  application_count?: number;
}

export interface Application {
  id: string;
  reference: string;
  applicant_id: string;
  intake_id: string;
  status: ApplicationStatus;
  submitted_at?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  decision_note?: string | null;
  offered_programme_id?: string | null;
  offered_programme_name?: string | null;
  offered_programme_code?: string | null;
  offer_expires_at?: string | null;
  student_id?: string | null;
  student_number?: string | null;
  enrolled_at?: string | null;
  created_at: string;
  // Joined from the applicant and intake for list and detail views.
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  email?: string;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  address?: string | null;
  prior_school?: string | null;
  prior_qualification?: string | null;
  applicant_reference?: string;
  intake_name?: string;
  intake_code?: string;
  intake_status?: IntakeStatus;
  opens_at?: string;
  closes_at?: string;
  decision_by?: string | null;
}

export interface ApplicationChoice {
  id: string;
  application_id: string;
  programme_id: string;
  programme_code: string;
  programme_name: string;
  preference_rank: number;
}

export interface ApplicationDocument {
  id: string;
  application_id: string;
  kind: string;
  label: string;
  file_url?: string | null;
  /** The stored file behind this record, once one has been uploaded. */
  file_id?: string | null;
  is_required: boolean;
  status: 'awaited' | 'received' | 'verified' | 'rejected';
  verified_by?: string | null;
  verified_by_name?: string | null;
  verified_at?: string | null;
  note?: string | null;
}

export interface ApplicationEvent {
  id: string;
  application_id: string;
  from_status?: ApplicationStatus | null;
  to_status: ApplicationStatus;
  actor_id?: string | null;
  actor_name?: string | null;
  note?: string | null;
  occurred_at: string;
}

export interface ApplicationDetail {
  application: Application;
  choices: ApplicationChoice[];
  documents: ApplicationDocument[];
  allowedTransitions: ApplicationStatus[];
}

export interface IntakeFunnel {
  intakeId: string;
  total: number;
  byStatus: Record<string, number>;
  submitted: number;
  offers: number;
  accepted: number;
  enrolled: number;
  rejected: number;
  /** Null where the denominator is zero — no offers made is not a 0% rate. */
  offerRate: number | null;
  acceptanceRate: number | null;
  yieldRate: number | null;
}

export interface AdmissionsOverview {
  byStatus: Record<string, number>;
  total: number;
  openIntakes: Array<{
    id: string;
    code: string;
    name: string;
    opens_at: string;
    closes_at: string;
    capacity: number | null;
    application_count: number;
    places_taken: number;
  }>;
  awaitingDecision: number;
  offersOutstanding: number;
  readyToEnrol: number;
}

export interface EnrolmentResult {
  application: Application;
  student: { id: string; userId: string; studentId: string };
  /** Shown once, at enrolment. The account must reset it on first login. */
  temporaryPassword: string;
}

export const admissionsService = {
  async overview(): Promise<AdmissionsOverview> {
    const { data } = await axiosClient.get('/admissions/overview');
    return data;
  },

  async listIntakes(status?: IntakeStatus): Promise<AdmissionIntake[]> {
    const { data } = await axiosClient.get('/admissions/intakes', {
      params: status ? { status } : undefined,
    });
    return data.intakes;
  },

  async getIntake(id: string): Promise<{ intake: AdmissionIntake; capacity: IntakeCapacity }> {
    const { data } = await axiosClient.get(`/admissions/intakes/${id}`);
    return data;
  },

  async createIntake(input: {
    code: string;
    name: string;
    opensAt: string;
    closesAt: string;
    description?: string;
    academicYearId?: string;
    decisionBy?: string;
    capacity?: number | null;
    status?: IntakeStatus;
  }): Promise<AdmissionIntake> {
    const { data } = await axiosClient.post('/admissions/intakes', input);
    return data.intake;
  },

  async updateIntake(id: string, input: Record<string, unknown>): Promise<AdmissionIntake> {
    const { data } = await axiosClient.patch(`/admissions/intakes/${id}`, input);
    return data.intake;
  },

  async deleteIntake(id: string): Promise<void> {
    await axiosClient.delete(`/admissions/intakes/${id}`);
  },

  async intakeFunnel(id: string): Promise<{ funnel: IntakeFunnel; capacity: IntakeCapacity }> {
    const { data } = await axiosClient.get(`/admissions/intakes/${id}/funnel`);
    return data;
  },

  async listApplicants(search?: string): Promise<Applicant[]> {
    const { data } = await axiosClient.get('/admissions/applicants', {
      params: search ? { q: search } : undefined,
    });
    return data.applicants;
  },

  async getApplicant(id: string): Promise<{ applicant: Applicant; applications: Application[] }> {
    const { data } = await axiosClient.get(`/admissions/applicants/${id}`);
    return data;
  },

  async createApplicant(input: {
    firstName: string;
    lastName: string;
    email: string;
    middleName?: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: string;
    nationality?: string;
    address?: string;
    priorSchool?: string;
    priorQualification?: string;
  }): Promise<Applicant> {
    const { data } = await axiosClient.post('/admissions/applicants', input);
    return data.applicant;
  },

  async updateApplicant(id: string, input: Record<string, unknown>): Promise<Applicant> {
    const { data } = await axiosClient.patch(`/admissions/applicants/${id}`, input);
    return data.applicant;
  },

  async listApplications(filters?: {
    intakeId?: string;
    status?: ApplicationStatus;
    q?: string;
  }): Promise<Application[]> {
    const { data } = await axiosClient.get('/admissions/applications', { params: filters });
    return data.applications;
  },

  async getApplication(id: string): Promise<ApplicationDetail> {
    const { data } = await axiosClient.get(`/admissions/applications/${id}`);
    return data;
  },

  async createApplication(input: {
    applicantId: string;
    intakeId: string;
    submit?: boolean;
    choices?: Array<{ programmeId: string; rank?: number }>;
    note?: string;
  }): Promise<Application> {
    const { data } = await axiosClient.post('/admissions/applications', input);
    return data.application;
  },

  async transition(id: string, input: {
    to: ApplicationStatus;
    note?: string;
    offeredProgrammeId?: string;
    offerExpiresAt?: string;
    /** Deliberately making an offer past the intake's capacity. */
    force?: boolean;
  }): Promise<{ application: Application; allowedTransitions: ApplicationStatus[] }> {
    const { data } = await axiosClient.post(`/admissions/applications/${id}/transition`, input);
    return data;
  },

  async enrol(id: string, input: {
    studentId?: string;
    programmeId?: string;
    academicYearId?: string;
    departmentId?: string;
    college?: string;
    entryYear?: number;
    note?: string;
  }): Promise<EnrolmentResult> {
    const { data } = await axiosClient.post(`/admissions/applications/${id}/enrol`, input);
    return data;
  },

  async events(id: string): Promise<ApplicationEvent[]> {
    const { data } = await axiosClient.get(`/admissions/applications/${id}/events`);
    return data.events;
  },

  async addChoice(applicationId: string, programmeId: string, rank?: number): Promise<ApplicationChoice> {
    const { data } = await axiosClient.post(`/admissions/applications/${applicationId}/choices`, {
      programmeId,
      rank,
    });
    return data.choice;
  },

  async removeChoice(applicationId: string, choiceId: string): Promise<void> {
    await axiosClient.delete(`/admissions/applications/${applicationId}/choices/${choiceId}`);
  },

  async addDocument(applicationId: string, input: {
    kind: string;
    label: string;
    /** From an upload. The server derives the URL from it. */
    fileId?: string;
    /** For a document held outside this system. Not retrievable. */
    fileUrl?: string;
    isRequired?: boolean;
    note?: string;
  }): Promise<ApplicationDocument> {
    const { data } = await axiosClient.post(`/admissions/applications/${applicationId}/documents`, input);
    return data.document;
  },

  async updateDocument(applicationId: string, documentId: string, input: {
    status?: ApplicationDocument['status'];
    fileId?: string;
    fileUrl?: string;
    note?: string;
    isRequired?: boolean;
  }): Promise<ApplicationDocument> {
    const { data } = await axiosClient.patch(
      `/admissions/applications/${applicationId}/documents/${documentId}`,
      input
    );
    return data.document;
  },

  async removeDocument(applicationId: string, documentId: string): Promise<void> {
    await axiosClient.delete(`/admissions/applications/${applicationId}/documents/${documentId}`);
  },
};
