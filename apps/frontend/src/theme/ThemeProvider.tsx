import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Theme control.
 *
 * The mockups choose light or dark by surface, not by user preference: admin
 * and record screens are light; attendance capture, authentication, the
 * superadmin control plane and marketing pages are dark. So the common case is
 * a screen declaring what it needs, via `useSurfaceTheme`, rather than the user
 * picking.
 *
 * `preference` is what the user chose — 'system' by default, meaning "follow
 * the OS". `resolved` is what is actually applied once a surface override and
 * the system setting are taken into account.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'jjelotech.theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  /** Force a theme for the current screen. Pass null to release the override. */
  setSurfaceOverride: (t: ResolvedTheme | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  // Storage throws in private mode and when site data is blocked.
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* fall through to the default */
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => systemTheme() === 'dark');
  const [surfaceOverride, setSurfaceOverride] = useState<ResolvedTheme | null>(null);

  // Track the OS setting so 'system' stays live rather than sampling once.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme =
    surfaceOverride ?? (preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    // Keeps form controls, scrollbars and the like in step with the theme.
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* preference simply will not persist */
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, setSurfaceOverride }),
    [preference, resolved, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/**
 * Declare the theme a screen needs, and release it on unmount.
 *
 *   useSurfaceTheme('dark');  // e.g. the faculty attendance capture screen
 *
 * Pass null to let the user's preference apply.
 */
export function useSurfaceTheme(theme: ResolvedTheme | null): void {
  const { setSurfaceOverride } = useTheme();
  useEffect(() => {
    setSurfaceOverride(theme);
    return () => setSurfaceOverride(null);
  }, [theme, setSurfaceOverride]);
}
