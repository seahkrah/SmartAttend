/**
 * Face matching (/api/biometrics).
 *
 * The browser sends camera images and nothing else. It never computes, sends
 * or receives a face descriptor: the server finds the face and decides.
 */
import { axiosClient } from '../utils/axiosClient';
import type { FaceChallenge, FacePose } from '@jjelotech/types';

export type SubjectType = 'student' | 'employee';
export type Purpose = 'enroll' | 'verify' | 'identify';

export interface BiometricSettings {
  enabled: boolean;
  threshold: number;
  /** False when the server has no template key: face matching cannot run. */
  configured: boolean;
}

export interface SubjectStatus {
  consent: { granted_at: string; basis: string; granted_by_name: string | null } | null;
  enrolment: { enrolled_at: string; frames_used: number; model: string; enrolled_by_name: string | null } | null;
}

export interface BiometricEvent {
  id: string;
  action: string;
  outcome: 'success' | 'failure';
  reason: string | null;
  subject_type: SubjectType | null;
  subject_id: string | null;
  distance: number | null;
  threshold: number | null;
  model: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface IdentifyResult {
  matched: true;
  matchId: string;
  student: { id: string; student_id: string; first_name: string; last_name: string };
  distance: number;
  threshold: number;
}

export interface VerifyResult {
  matched: true;
  matchId: string;
  distance: number;
  threshold: number;
}

/** The server's refusal, with its code, so screens can say the right thing. */
export class BiometricRefusal extends Error {
  constructor(message: string, readonly code: string | undefined, readonly status: number | undefined) {
    super(message);
  }
}

function refusal(e: any, fallback: string): BiometricRefusal {
  return new BiometricRefusal(
    e?.response?.data?.error ?? fallback,
    e?.response?.data?.code,
    e?.response?.status,
  );
}

export const POSE_INSTRUCTIONS: Record<FacePose, string> = {
  center: 'Look straight at the camera',
  left: 'Turn your head to your left',
  right: 'Turn your head to your right',
};

export const biometricsService = {
  async settings(): Promise<BiometricSettings> {
    const { data } = await axiosClient.get('/biometrics/settings');
    return data.settings;
  },

  async saveSettings(enabled: boolean, threshold: number): Promise<BiometricSettings> {
    try {
      const { data } = await axiosClient.put('/biometrics/settings', { enabled, threshold });
      return data.settings;
    } catch (e) {
      throw refusal(e, 'Could not save the settings');
    }
  },

  async status(type: SubjectType, id: string): Promise<SubjectStatus> {
    const { data } = await axiosClient.get(`/biometrics/subjects/${type}/${id}`);
    return data;
  },

  async grantConsent(type: SubjectType, id: string, basis: string): Promise<void> {
    try {
      await axiosClient.post(`/biometrics/subjects/${type}/${id}/consent`, { basis });
    } catch (e) {
      throw refusal(e, 'Could not record consent');
    }
  },

  async withdrawConsent(type: SubjectType, id: string, reason?: string): Promise<void> {
    try {
      await axiosClient.delete(`/biometrics/subjects/${type}/${id}/consent`, { data: { reason } });
    } catch (e) {
      throw refusal(e, 'Could not withdraw consent');
    }
  },

  async deleteTemplate(type: SubjectType, id: string): Promise<void> {
    try {
      await axiosClient.delete(`/biometrics/subjects/${type}/${id}/template`);
    } catch (e) {
      throw refusal(e, 'Could not delete the enrolment');
    }
  },

  async challenge(
    purpose: Purpose,
    opts: { subjectType?: SubjectType; subjectId?: string; scheduleId?: string } = {},
  ): Promise<FaceChallenge> {
    try {
      const { data } = await axiosClient.post('/biometrics/challenges', { purpose, ...opts });
      return data;
    } catch (e) {
      throw refusal(e, 'Could not start the capture');
    }
  },

  /** Sends the captured frames. Content-Type is left for the browser to set. */
  async submit<T>(purpose: Purpose, challengeId: string, frames: Blob[]): Promise<T> {
    const form = new FormData();
    form.append('challengeId', challengeId);
    frames.forEach((f, i) => form.append('frames', f, `frame-${i + 1}.jpg`));
    try {
      const { data } = await axiosClient.post(`/biometrics/${purpose}`, form, { timeout: 90000 });
      return data as T;
    } catch (e) {
      throw refusal(e, 'The face check could not be completed');
    }
  },

  async events(opts: { subjectType?: SubjectType; subjectId?: string; limit?: number } = {}): Promise<BiometricEvent[]> {
    const { data } = await axiosClient.get('/biometrics/events', { params: opts });
    return data.events;
  },
};
