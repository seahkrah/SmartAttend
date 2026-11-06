/**
 * This browser's attendance device id (brief 5.5), sent as X-Device-Id.
 *
 * A random id kept in this browser's storage, so that an administrator can
 * register this device for an employee's check-in or as a shared kiosk, and
 * so that one phone checking in several people shows up. It identifies the
 * browser profile, not the hardware: clearing site data makes a new one, and
 * it is not secret. Where storage is unavailable (a private window) it lasts
 * as long as the page.
 */
const KEY = 'jjelotech.deviceId';
let cached: string | null = null;

function fresh(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `web-${crypto.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function deviceId(): string {
  if (cached) return cached;
  try {
    const kept = localStorage.getItem(KEY);
    if (kept && kept.length >= 8 && kept.length <= 128) return (cached = kept);
    const made = fresh();
    localStorage.setItem(KEY, made);
    return (cached = made);
  } catch {
    return (cached = fresh());
  }
}

/**
 * The device's position, with its accuracy, for a check-in. Resolves null
 * when the browser has no location, the person declines, or it takes too
 * long: the server decides whether that matters.
 */
export function currentPosition(timeoutMs = 10000): Promise<{ latitude: number; longitude: number; accuracyMetres: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMetres: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}
