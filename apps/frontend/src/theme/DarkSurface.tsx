import React from 'react';
import { useSurfaceTheme } from './ThemeProvider';

/**
 * A screen that is dark by design, whatever the person's theme: sign-in and
 * the public pages, the superadmin console, and attendance capture (see
 * ThemeProvider). Everything else follows the person's light/dark preference.
 *
 * These screens were always drawn dark, but never said so; on a computer set
 * to light, their token-based parts (cards, inputs) turned light inside a
 * dark page and their labels became grey on white.
 */
export const DarkSurface: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useSurfaceTheme('dark');
  return <>{children}</>;
};

export default DarkSurface;
