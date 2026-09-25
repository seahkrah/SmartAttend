/**
 * Face capture that answers a server challenge.
 *
 * 1. Opens the camera.
 * 2. Asks the server for a challenge: a random order of head poses, valid for
 *    two minutes and usable once.
 * 3. Takes one photo per pose, in that order, as the person follows each
 *    instruction.
 * 4. Sends the photos. The server finds the face, checks the poses and the
 *    identity, and answers.
 *
 * Nothing about the face is computed here. The preview is mirrored, as people
 * expect of a selfie camera; the photos sent are not.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { FacePose } from '@jjelotech/types';
import {
  biometricsService, BiometricRefusal, POSE_INSTRUCTIONS, type Purpose, type SubjectType,
} from '../../services/biometricsService';

interface Props<T> {
  purpose: Purpose;
  title: string;
  subtitle?: string;
  subjectType?: SubjectType;
  subjectId?: string;
  scheduleId?: string;
  onDone: (result: T) => void;
  onClose: () => void;
}

type Phase =
  | { kind: 'camera' }
  | { kind: 'camera_error'; message: string }
  | { kind: 'starting' }
  | { kind: 'capturing'; challengeId: string; steps: FacePose[]; expiresAt: number; step: number }
  | { kind: 'submitting' }
  | { kind: 'refused'; message: string; retryable: boolean }
  | { kind: 'done'; message: string };

const NOT_RETRYABLE = new Set(['no_consent', 'not_enrolled', 'disabled', 'not_configured', 'forbidden', 'not_found', 'paused']);

export function FaceChallengeCapture<T>({
  purpose, title, subtitle, subjectType, subjectId, scheduleId, onDone, onClose,
}: Props<T>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const framesRef = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  // The camera takes a moment to deliver its first frame; a photo taken
  // before then is empty, so the button waits for it.
  const [videoReady, setVideoReady] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    framesRef.current = [];
    setThumbs((old) => { old.forEach((u) => URL.revokeObjectURL(u)); return []; });
    setPhase({ kind: 'starting' });
    try {
      const ch = await biometricsService.challenge(purpose, { subjectType, subjectId, scheduleId });
      setPhase({
        kind: 'capturing', challengeId: ch.challengeId, steps: ch.steps,
        expiresAt: new Date(ch.expiresAt).getTime(), step: 0,
      });
    } catch (e) {
      const r = e as BiometricRefusal;
      setPhase({ kind: 'refused', message: r.message, retryable: !NOT_RETRYABLE.has(r.code ?? '') });
    }
  }, [purpose, subjectType, subjectId, scheduleId]);

  // Camera on mount, off on unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase({ kind: 'camera_error', message: 'This browser cannot use a camera. Use the manual option instead.' });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        await start();
      } catch (e: any) {
        setPhase({
          kind: 'camera_error',
          message: e?.name === 'NotAllowedError'
            ? 'Camera access was refused. Allow the camera for this site, or use the manual option.'
            : 'No camera could be opened. Use the manual option instead.',
        });
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [start, stopCamera]);

  // A visible countdown while capturing, so an expired challenge is no surprise.
  useEffect(() => {
    if (phase.kind !== 'capturing') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase.kind]);

  const capture = async () => {
    if (phase.kind !== 'capturing' || !videoRef.current) return;
    const video = videoRef.current;
    setCaptureError(null);
    if (!video.videoWidth || !video.videoHeight) {
      setCaptureError('The camera has not started yet. Wait a moment and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setCaptureError('The photo could not be taken. Try again.');
      return;
    }
    framesRef.current.push(blob);
    setThumbs((t) => [...t, URL.createObjectURL(blob)]);

    if (phase.step + 1 < phase.steps.length) {
      setPhase({ ...phase, step: phase.step + 1 });
      return;
    }
    setPhase({ kind: 'submitting' });
    try {
      const result = await biometricsService.submit<T>(purpose, phase.challengeId, framesRef.current);
      setPhase({ kind: 'done', message: purpose === 'enroll' ? 'Enrolled.' : 'Matched.' });
      stopCamera();
      onDone(result);
    } catch (e) {
      const r = e as BiometricRefusal;
      setPhase({ kind: 'refused', message: r.message, retryable: !NOT_RETRYABLE.has(r.code ?? '') });
    }
  };

  const secondsLeft = phase.kind === 'capturing' ? Math.max(0, Math.round((phase.expiresAt - now) / 1000)) : 0;
  const expired = phase.kind === 'capturing' && secondsLeft === 0;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" role="dialog"
         aria-modal="true" aria-labelledby="face-capture-title">
      <div className="card w-full max-w-lg p-0 overflow-hidden">
        <div className="flex items-start justify-between px-5 py-4 border-b border-subtle">
          <div>
            <h3 id="face-capture-title" className="font-semibold text-primary flex items-center gap-2">
              <Camera className="w-4 h-4" /> {title}
            </h3>
            {subtitle && <p className="text-sm text-secondary mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn btn-ghost p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative bg-black aspect-video">
          <video ref={videoRef} autoPlay playsInline muted onPlaying={() => setVideoReady(true)}
                 className="w-full h-full object-cover -scale-x-100" />
          {(phase.kind === 'starting' || phase.kind === 'submitting' || phase.kind === 'camera') && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50" role="status" aria-live="polite">
              <p className="text-white text-sm">
                {phase.kind === 'camera' ? 'Opening the camera…'
                  : phase.kind === 'starting' ? 'Preparing…' : 'Checking the photos…'}
              </p>
            </div>
          )}
          {phase.kind === 'capturing' && (
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-4 py-3 flex items-center justify-between">
              <p className="text-white font-medium" aria-live="assertive">
                Step {phase.step + 1} of {phase.steps.length}: {POSE_INSTRUCTIONS[phase.steps[phase.step]]}
              </p>
              <span className={`text-xs ${secondsLeft < 20 ? 'text-amber-300' : 'text-slate-300'}`}>{secondsLeft}s</span>
            </div>
          )}
        </div>

        {thumbs.length > 0 && (
          <div className="flex gap-2 px-5 pt-3" aria-label="Photos taken">
            {thumbs.map((u, i) => (
              <img key={u} src={u} alt={`Photo ${i + 1}`} className="w-16 h-12 object-cover rounded -scale-x-100" />
            ))}
          </div>
        )}

        <div className="px-5 py-4 space-y-3">
          {phase.kind === 'camera_error' && (
            <p className="text-sm text-danger-600 flex gap-2"><ShieldAlert className="w-4 h-4 shrink-0" />{phase.message}</p>
          )}
          {phase.kind === 'refused' && (
            <p className="text-sm text-danger-600 flex gap-2" role="alert"><ShieldAlert className="w-4 h-4 shrink-0" />{phase.message}</p>
          )}
          {phase.kind === 'done' && (
            <p className="text-sm text-success-600 flex gap-2" role="status"><CheckCircle2 className="w-4 h-4" />{phase.message}</p>
          )}
          {captureError && (
            <p className="text-sm text-amber-600" role="alert">{captureError}</p>
          )}
          {expired && (
            <p className="text-sm text-amber-600" role="alert">This capture has expired. Start again.</p>
          )}

          <div className="flex justify-end gap-2">
            {phase.kind === 'capturing' && !expired && (
              <button onClick={capture} className="btn btn-primary" disabled={!videoReady}>
                {videoReady ? 'Take photo' : 'Starting camera…'}
              </button>
            )}
            {(expired || (phase.kind === 'refused' && phase.retryable)) && (
              <button onClick={start} className="btn btn-secondary flex items-center gap-1">
                <RefreshCw className="w-4 h-4" /> Start again
              </button>
            )}
            <button onClick={onClose} className="btn btn-ghost">{phase.kind === 'done' ? 'Close' : 'Cancel'}</button>
          </div>
          <p className="text-xs text-muted">
            Photos are checked on the server and not kept. Face matching confirms the person matches the one
            enrolled and that the head moved as asked; it is not proof against a prepared video.
          </p>
        </div>
      </div>
    </div>
  );
}

export default FaceChallengeCapture;
