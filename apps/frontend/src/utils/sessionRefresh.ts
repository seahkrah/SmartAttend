/**
 * Keeping a session alive.
 *
 * The server replaces the refresh token on every refresh and treats the old
 * one, presented again later, as stolen: it ends the session. So the browser
 * must (1) always store the new refresh token, (2) never run two refreshes
 * at once in one tab, and (3) cope with another tab having refreshed first,
 * which the server answers with 409 and which leaves the new tokens in the
 * shared localStorage.
 *
 * Both HTTP clients (utils/axiosClient.ts and services/api.ts) use this.
 */
import axios from 'axios';

let inflight: Promise<string | null> | null = null;

/** Requests that must never trigger a refresh: they are how you get a session. */
export function isSessionlessAuthCall(url: string | undefined): boolean {
  return /\/auth\/(login|login-superadmin|refresh|register-with-role|register-superadmin|activate|password\/(forgot|reset))\b/
    .test(url ?? '');
}

export function clearStoredSession(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refreshOnce(apiBase: string): Promise<string | null> {
  const used = localStorage.getItem('refreshToken');
  if (!used) return null;
  try {
    const res = await axios.post(`${apiBase}/auth/refresh`, { refreshToken: used });
    localStorage.setItem('accessToken', res.data.accessToken);
    localStorage.setItem('refreshToken', res.data.refreshToken);
    return res.data.accessToken as string;
  } catch (e: any) {
    if (e?.response?.status === 409) {
      // Another tab refreshed with the same token a moment ago and has stored
      // (or is about to store) the new pair. Use what it stored.
      for (let i = 0; i < 10; i++) {
        await wait(150);
        const now = localStorage.getItem('refreshToken');
        if (now && now !== used) return localStorage.getItem('accessToken');
      }
    }
    return null;
  }
}

/**
 * Returns a usable access token after a 401, or null when the session has
 * ended. `failedWith` is the token the failed request carried: if another
 * tab has already replaced it, that replacement is used without a refresh.
 */
export async function recoverSession(apiBase: string, failedWith: string | null): Promise<string | null> {
  const current = localStorage.getItem('accessToken');
  if (current && failedWith && current !== failedWith) return current;
  if (!inflight) {
    inflight = refreshOnce(apiBase).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Sends the person to sign in again, unless they are already on a public page. */
export function endSession(): void {
  clearStoredSession();
  const publicPaths = ['/login', '/activate', '/reset-password', '/forgot-password', '/register', '/superadmin'];
  if (!publicPaths.some((p) => window.location.pathname.startsWith(p))) {
    window.location.href = '/login';
  }
}
