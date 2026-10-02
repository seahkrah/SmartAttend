/**
 * Keeping a session alive.
 *
 * The session lives in cookies the page cannot read (httpOnly): the API sets
 * them when the person signs in and replaces them on every refresh. What the
 * page does hold, in memory only, is the CSRF token the API hands back with
 * each sign-in and refresh; every state-changing request sends it as
 * X-CSRF-Token. A page reload loses it, and the next /auth/me or refresh
 * returns it again.
 *
 * The server treats a replaced refresh token, presented again later, as
 * stolen and ends the session. Two tabs refreshing at once is not theft: the
 * slower one is answered 409, by which time the faster one's answer has put
 * the new cookies in the browser, so it simply retries its request.
 *
 * Both HTTP clients (utils/axiosClient.ts and services/api.ts), and the
 * default axios instance (utils/httpDefaults.ts), use this.
 */
import axios from 'axios';

let csrfToken: string | null = null;
let inflight: Promise<boolean> | null = null;

/** Whether this browser believes it has a session. Not a credential: a hint for the first render. */
const SIGNED_IN_FLAG = 'signedIn';

export function rememberCsrfToken(token: unknown): void {
  if (typeof token === 'string' && token) csrfToken = token;
}

export function csrfHeader(method: string | undefined): Record<string, string> {
  const m = String(method ?? 'get').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || !csrfToken) return {};
  return { 'X-CSRF-Token': csrfToken };
}

export function markSignedIn(): void {
  try { localStorage.setItem(SIGNED_IN_FLAG, '1'); } catch { /* private mode: the flag is only a hint */ }
}

export function seemsSignedIn(): boolean {
  try { return localStorage.getItem(SIGNED_IN_FLAG) === '1'; } catch { return false; }
}

/** Requests that must never trigger a refresh: they are how you get a session. */
export function isSessionlessAuthCall(url: string | undefined): boolean {
  return /\/auth\/(login|login-superadmin|refresh|register-with-role|register-superadmin|activate|password\/(forgot|reset)|mfa\/verify|sso|passkeys\/sign-in)\b/
    .test(url ?? '');
}

export function clearStoredSession(): void {
  csrfToken = null;
  try {
    localStorage.removeItem(SIGNED_IN_FLAG);
    localStorage.removeItem('user');
  } catch { /* nothing stored */ }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refreshOnce(apiBase: string): Promise<boolean> {
  try {
    const res = await axios.post(`${apiBase}/auth/refresh`, {}, {
      withCredentials: true,
      headers: { 'X-Auth-Transport': 'cookie' },
    });
    rememberCsrfToken(res.data?.csrfToken);
    return true;
  } catch (e: any) {
    // Another tab refreshed a moment ago; its answer set the new cookies.
    if (e?.response?.status === 409) {
      await wait(200);
      return true;
    }
    return false;
  }
}

/** After a 401: whether the session could be renewed, so the request is worth retrying. */
export async function recoverSession(apiBase: string): Promise<boolean> {
  if (!inflight) {
    inflight = refreshOnce(apiBase).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Sends the person to sign in again, unless they are already on a public page. */
export function endSession(): void {
  clearStoredSession();
  const publicPaths = ['/login', '/activate', '/reset-password', '/forgot-password', '/register', '/superadmin', '/sso'];
  if (!publicPaths.some((p) => window.location.pathname.startsWith(p))) {
    window.location.href = '/login';
  }
}

/**
 * A person whose role must use two-factor sign-in, signed in without it, is
 * refused everything but the setup page (MFA_SETUP_REQUIRED). Takes them
 * there. Returns whether it did.
 */
export function redirectForMfaSetup(error: any): boolean {
  if (error?.response?.status !== 403 || error.response.data?.code !== 'MFA_SETUP_REQUIRED') return false;
  if (window.location.pathname !== '/account/security') {
    window.location.href = '/account/security?required=1';
  }
  return true;
}
