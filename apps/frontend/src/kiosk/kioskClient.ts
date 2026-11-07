/**
 * The kiosk's side of /api/kiosk. The kiosk has no user session: it holds
 * the token it was given when paired, in this browser's storage, and sends
 * it as `Authorization: Kiosk <token>`. Nothing else in the app uses it, and
 * the API accepts it nowhere but the kiosk routes.
 */
import type { FacePose } from '@jjelotech/types';
import { BiometricRefusal, type Purpose } from '../services/biometricsService';
import type { FaceApi } from '../components/face/FaceChallengeCapture';

const KEY = 'jjelotech.kioskToken';

export function storedToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* a kiosk without storage pairs again after a reload */
  }
}

export class KioskError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function send<T>(method: string, path: string, body?: unknown, token: string | null = storedToken()): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Kiosk ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api/kiosk${path}`, { method, headers, body: payload, credentials: 'omit' });
  } catch {
    throw new KioskError('The kiosk cannot reach the server. Check the network and try again.', 0, 'offline');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new KioskError(json?.error ?? 'That did not work', res.status, json?.code);
  return json as T;
}

export interface KioskSession {
  kiosk: { id: string; label: string; site: string | null; siteActive: boolean };
  organisation: string | null;
  faceEnabled: boolean;
  reasonCodes: string[];
}
export interface Lookup { employee: { displayName: string }; onTheClock: boolean; faceAvailable: boolean }
export interface Punch {
  replayed: boolean;
  action: 'in' | 'out';
  employee?: { displayName: string };
  checkIn?: { checkInTime: string; checkOutTime: string | null; faceVerified: boolean; awaitingApproval?: boolean; stateReason?: string | null };
  approval?: string;
}

export const kioskClient = {
  pair: (code: string) => send<{ token: string; kiosk: { id: string; label: string } }>('POST', '/pair', { code }, null),
  session: () => send<KioskSession>('GET', '/session'),
  lookup: (employeeCode: string) => send<Lookup>('POST', '/lookup', { employeeCode }),
  punch: (b: { employeeCode: string; action: 'in' | 'out'; faceMatchId?: string; pin?: string; reasonCode?: string; reasonText?: string; idempotencyKey: string }) =>
    send<Punch>('POST', '/punch', b),
};

/** The face capture's API at a kiosk, for one employee. */
export function kioskFaceApi(employeeCode: string): FaceApi {
  const asRefusal = (e: unknown) => {
    const k = e as KioskError;
    return new BiometricRefusal(k.message, k.code, k.status);
  };
  return {
    async challenge(_purpose: Purpose) {
      try {
        return await send<{ challengeId: string; steps: FacePose[]; expiresAt: string }>('POST', '/face/challenge', { employeeCode });
      } catch (e) {
        throw asRefusal(e);
      }
    },
    async submit<T>(_purpose: Purpose, challengeId: string, frames: Blob[], frameTimes: number[]): Promise<T> {
      const form = new FormData();
      form.append('challengeId', challengeId);
      form.append('employeeCode', employeeCode);
      if (frameTimes.length === frames.length) form.append('frameTimes', JSON.stringify(frameTimes));
      frames.forEach((f, i) => form.append('frames', f, `frame-${i}.jpg`));
      try {
        return await send<T>('POST', '/face/verify', form);
      } catch (e) {
        throw asRefusal(e);
      }
    },
  };
}
