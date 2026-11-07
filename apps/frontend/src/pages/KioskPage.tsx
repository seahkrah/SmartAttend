/**
 * The attendance kiosk: a shared screen at a site where employees check in
 * and out (brief 5.5, 5.7).
 *
 *   - Paired once with a code from an administrator; after that it holds a
 *     token that reaches the kiosk routes and nothing else.
 *   - One person at a time: their employee number, then their face, or the
 *     attendant's PIN and a reason when the face cannot be used.
 *   - It resets itself: after each result, after a period with no touch, and
 *     when it is interrupted (full screen left, the page hidden). Nothing a
 *     person typed stays on the screen for the next.
 *   - Full screen is offered on the first screen, since a browser allows it
 *     only from a tap.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaceChallengeCapture } from '../components/face/FaceChallengeCapture';
import { KioskError, kioskClient, kioskFaceApi, storeToken, storedToken, type KioskSession, type Lookup, type Punch } from '../kiosk/kioskClient';

/** Idle seconds before the kiosk starts again; ?idle=N sets it, from 5 to 300 (a slow site, or a test). */
const IDLE_SECONDS = (() => {
  const v = Number(new URLSearchParams(window.location.search).get('idle'));
  return Number.isFinite(v) && v >= 5 && v <= 300 ? v : 45;
})();
const RESULT_SECONDS = 6;

const REASONS: Record<string, string> = {
  camera_failure: 'The camera is not working',
  face_not_recognised: 'My face was not recognised',
  network_outage: 'The network is down',
  enrolment_pending: 'My face is not enrolled yet',
  consent_withheld: 'I do not use face check-in',
  other: 'Something else',
};

type Screen =
  | { kind: 'loading' }
  | { kind: 'unpaired'; message?: string }
  | { kind: 'home'; notice?: string }
  | { kind: 'identified'; code: string; who: Lookup; key: string }
  | { kind: 'face'; code: string; who: Lookup; key: string }
  | { kind: 'attendant'; code: string; who: Lookup; key: string; faceMatchId?: undefined }
  | { kind: 'result'; ok: boolean; title: string; detail?: string };

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const timeOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

const KioskPage: React.FC = () => {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const lastTouch = useRef(Date.now());

  const lost = useCallback((e: unknown) => {
    const k = e as KioskError;
    if (k?.status === 401) {
      storeToken(null);
      setSession(null);
      setScreen({ kind: 'unpaired', message: 'This kiosk is no longer paired. Ask an administrator for a new pairing code.' });
      return true;
    }
    return false;
  }, []);

  const home = useCallback((notice?: string) => {
    setError(null);
    setBusy(false);
    setScreen({ kind: 'home', notice });
  }, []);

  // Start: paired or not.
  useEffect(() => {
    if (!storedToken()) { setScreen({ kind: 'unpaired' }); return; }
    kioskClient.session().then((s) => { setSession(s); setScreen({ kind: 'home' }); })
      .catch((e) => { if (!lost(e)) setScreen({ kind: 'home', notice: (e as Error).message }); });
  }, [lost]);

  // Any touch or key keeps the session alive.
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); };
  }, []);

  // Idle: back to the first screen, forgetting whoever was there.
  useEffect(() => {
    if (screen.kind === 'home' || screen.kind === 'unpaired' || screen.kind === 'loading' || screen.kind === 'result') return;
    // In front of the camera nobody touches the screen, and the server takes
    // a few seconds to match: the face screen waits as long as its challenge
    // lives (two minutes), not the usual idle time.
    const limit = screen.kind === 'face' ? Math.max(IDLE_SECONDS, 130) : IDLE_SECONDS;
    const t = setInterval(() => {
      if (Date.now() - lastTouch.current > limit * 1000) home('Nobody was using the kiosk, so it started again.');
    }, 1000);
    return () => clearInterval(t);
  }, [screen.kind, home]);

  // A result shows for a few seconds, then the kiosk is ready for the next person.
  useEffect(() => {
    if (screen.kind !== 'result') return;
    const t = setTimeout(() => home(), RESULT_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [screen, home]);

  // Interrupted: full screen left, or the page hidden, mid-session.
  useEffect(() => {
    const onFs = () => {
      const now = !!document.fullscreenElement;
      setFullscreen(now);
      if (!now && screen.kind !== 'home' && screen.kind !== 'unpaired' && screen.kind !== 'loading') {
        home('The kiosk left full screen, so it started again.');
      }
    };
    const onHide = () => {
      if (document.hidden && screen.kind !== 'home' && screen.kind !== 'unpaired') home('The kiosk was interrupted, so it started again.');
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('visibilitychange', onHide); };
  }, [screen.kind, home]);

  const goFullscreen = () => { document.documentElement.requestFullscreen?.().catch(() => undefined); };

  const doPair = async (code: string) => {
    setBusy(true); setError(null);
    try {
      const out = await kioskClient.pair(code);
      storeToken(out.token);
      setSession(await kioskClient.session());
      setScreen({ kind: 'home' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doLookup = async (code: string) => {
    setBusy(true); setError(null);
    try {
      const who = await kioskClient.lookup(code);
      setScreen({ kind: 'identified', code, who, key: newKey() });
    } catch (e) {
      if (!lost(e)) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPunch = async (s: { code: string; who: Lookup; key: string }, how: { faceMatchId?: string; pin?: string; reasonCode?: string; reasonText?: string }) => {
    setBusy(true); setError(null);
    const action = s.who.onTheClock ? 'out' : 'in';
    try {
      const r: Punch = await kioskClient.punch({ employeeCode: s.code, action, idempotencyKey: s.key, ...how });
      const name = r.employee?.displayName ?? s.who.employee.displayName;
      const at = r.action === 'out' ? timeOf(r.checkIn?.checkOutTime) : timeOf(r.checkIn?.checkInTime);
      setScreen({
        kind: 'result', ok: true,
        title: `${name} ${r.action === 'out' ? 'checked out' : 'checked in'}${at ? ` at ${at}` : ''}`,
        detail: r.checkIn?.awaitingApproval ? `Held for a manager: ${(r.checkIn.stateReason ?? '').replace(/^Awaiting a manager: /, '')}` : undefined,
      });
    } catch (e) {
      if (lost(e)) return;
      const k = e as KioskError;
      // A wrong PIN can be typed again; anything else ends this person's turn with the reason.
      if (k.code === 'wrong_pin' || k.code === 'reason_required' || k.code === 'reason_text_required' || k.status === 0) setError(k.message);
      else setScreen({ kind: 'result', ok: false, title: 'Not recorded', detail: k.message });
    } finally {
      setBusy(false);
    }
  };

  const faceApi = useMemo(() => (screen.kind === 'face' ? kioskFaceApi(screen.code) : null), [screen]);

  const big = 'w-full rounded-2xl px-6 py-5 text-2xl font-semibold disabled:opacity-50';
  const input = 'w-full rounded-2xl border-2 border-subtle bg-card px-6 py-5 text-3xl text-primary text-center tracking-wider';

  return (
    <div className="min-h-screen bg-page text-primary flex flex-col" data-testid="kiosk">
      <header className="flex items-center justify-between px-8 py-4 border-b border-subtle">
        <div>
          <div className="text-xl font-semibold">{session?.organisation ?? 'Attendance kiosk'}</div>
          <div className="text-sm text-secondary">{session ? `${session.kiosk.label}${session.kiosk.site ? ` · ${session.kiosk.site}` : ''}` : ''}</div>
        </div>
        {screen.kind === 'home' && !fullscreen && (
          <button className="rounded-xl border border-subtle px-4 py-2 text-sm" onClick={goFullscreen}>Full screen</button>
        )}
      </header>

      <main className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-xl space-y-6">
          {screen.kind === 'loading' && <p className="text-center text-xl text-secondary">Starting…</p>}

          {screen.kind === 'unpaired' && (
            <PairForm busy={busy} error={error} message={screen.message} onPair={doPair} />
          )}

          {screen.kind === 'home' && (
            <form className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get('code') ?? '').trim();
              if (v) void doLookup(v);
            }}>
              <h1 className="text-4xl font-semibold text-center">Check in or out</h1>
              {screen.notice && <p role="status" className="text-center text-amber-700 dark:text-amber-300">{screen.notice}</p>}
              {session && !session.kiosk.siteActive && (
                <p role="alert" className="text-center text-danger-600 dark:text-danger-400">This kiosk's site is no longer in use. Ask an administrator.</p>
              )}
              <label className="block text-center text-lg text-secondary" htmlFor="kiosk-code">Type your employee number</label>
              <input id="kiosk-code" name="code" autoComplete="off" autoFocus className={input} aria-label="Employee number" />
              {error && <p role="alert" className="text-center text-danger-600 dark:text-danger-400 text-lg">{error}</p>}
              <button type="submit" className={`${big} bg-primary-600 text-white`} disabled={busy}>Continue</button>
            </form>
          )}

          {screen.kind === 'identified' && (
            <div className="space-y-4 text-center">
              <h1 className="text-4xl font-semibold">Hello, {screen.who.employee.displayName}</h1>
              <p className="text-xl text-secondary">{screen.who.onTheClock ? 'You are checked in. Check out?' : 'You are not checked in. Check in?'}</p>
              {screen.who.faceAvailable && (
                <button className={`${big} bg-primary-600 text-white`} disabled={busy}
                  onClick={() => setScreen({ ...screen, kind: 'face' })}>
                  {screen.who.onTheClock ? 'Check out' : 'Check in'} with my face
                </button>
              )}
              <button className={`${big} border-2 border-subtle`} disabled={busy}
                onClick={() => setScreen({ ...screen, kind: 'attendant' })}>
                {screen.who.faceAvailable ? 'Use the attendant instead' : `${screen.who.onTheClock ? 'Check out' : 'Check in'} with the attendant`}
              </button>
              <button className="text-lg text-secondary underline" onClick={() => home()}>Not you? Start again</button>
            </div>
          )}

          {screen.kind === 'face' && faceApi && (
            <FaceChallengeCapture<{ matchId: string }>
              purpose="verify"
              api={faceApi}
              title={`${screen.who.onTheClock ? 'Check out' : 'Check in'}: ${screen.who.employee.displayName}`}
              subtitle="Follow each instruction; one photo is taken per step."
              onDone={(r) => void doPunch(screen, { faceMatchId: r.matchId })}
              onClose={() => setScreen({ ...screen, kind: 'identified' })}
            />
          )}

          {screen.kind === 'attendant' && (
            <AttendantForm busy={busy} error={error} who={screen.who}
              onCancel={() => { setError(null); setScreen({ ...screen, kind: 'identified' }); }}
              onSubmit={(pin, reasonCode, reasonText) => void doPunch(screen, { pin, reasonCode, reasonText })} />
          )}

          {screen.kind === 'result' && (
            <div role="status" className={`rounded-3xl p-10 text-center ${screen.ok ? 'bg-success-50 dark:bg-success-500/10' : 'bg-danger-50 dark:bg-danger-500/10'}`}>
              <div className={`text-4xl font-semibold ${screen.ok ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}`}>{screen.title}</div>
              {screen.detail && <p className="mt-3 text-xl text-secondary">{screen.detail}</p>}
              <button className="mt-6 text-lg underline text-secondary" onClick={() => home()}>Next person</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const PairForm: React.FC<{ busy: boolean; error: string | null; message?: string; onPair: (code: string) => void }> = ({ busy, error, message, onPair }) => (
  <form className="space-y-4" onSubmit={(e) => {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('pairing') ?? '').trim();
    if (v) onPair(v);
  }}>
    <h1 className="text-3xl font-semibold text-center">Pair this kiosk</h1>
    {message && <p role="alert" className="text-center text-amber-700 dark:text-amber-300">{message}</p>}
    <p className="text-center text-secondary">An administrator creates the kiosk under Check-in rules and is shown a pairing code. Type it here.</p>
    <input name="pairing" aria-label="Pairing code" autoComplete="off" autoFocus placeholder="XXXX-XXXX"
      className="w-full rounded-2xl border-2 border-subtle bg-card px-6 py-5 text-3xl text-center tracking-widest uppercase" />
    {error && <p role="alert" className="text-center text-danger-600 dark:text-danger-400">{error}</p>}
    <button type="submit" className="w-full rounded-2xl px-6 py-5 text-2xl font-semibold bg-primary-600 text-white disabled:opacity-50" disabled={busy}>Pair</button>
  </form>
);

const AttendantForm: React.FC<{
  busy: boolean; error: string | null; who: Lookup;
  onCancel: () => void; onSubmit: (pin: string, reasonCode: string, reasonText?: string) => void;
}> = ({ busy, error, who, onCancel, onSubmit }) => {
  const [reason, setReason] = useState('camera_failure');
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      onSubmit(String(f.get('pin') ?? ''), reason, reason === 'other' ? String(f.get('why') ?? '') : undefined);
    }}>
      <h1 className="text-3xl font-semibold text-center">Attendant: {who.onTheClock ? 'check out' : 'check in'} {who.employee.displayName}</h1>
      <label className="block text-lg">
        <span className="text-secondary">Why not by face?</span>
        <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-2xl border-2 border-subtle bg-card px-4 py-4 text-xl">
          {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {reason === 'other' && (
        <input name="why" aria-label="Say why" placeholder="Say why" className="w-full rounded-2xl border-2 border-subtle bg-card px-4 py-4 text-xl" />
      )}
      <input name="pin" type="password" inputMode="numeric" autoComplete="off" aria-label="Attendant PIN" placeholder="Attendant PIN"
        className="w-full rounded-2xl border-2 border-subtle bg-card px-6 py-5 text-3xl text-center tracking-widest" />
      {error && <p role="alert" className="text-center text-danger-600 dark:text-danger-400 text-lg">{error}</p>}
      <button type="submit" className="w-full rounded-2xl px-6 py-5 text-2xl font-semibold bg-primary-600 text-white disabled:opacity-50" disabled={busy}>Confirm</button>
      <button type="button" className="w-full text-lg text-secondary underline" onClick={onCancel}>Back</button>
    </form>
  );
};

export default KioskPage;
