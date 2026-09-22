import React from 'react';

/**
 * JjeloTech brand marks.
 *
 * Drawn as SVG rather than loaded from a raster file so the logo scales
 * cleanly, inherits the theme palette, and needs no asset round-trip. The
 * geometry keeps the original platform identity: a hexagonal chevron block
 * paired with a location pin carrying a check.
 *
 * To use raster artwork instead, point these at a file in /public/logos —
 * see apps/frontend/public/logos/README.md.
 */

const GRADIENT_FROM = '#5d7fff'; // primary-500
const GRADIENT_TO = '#8b5cf6'; // secondary-500
const CHECK_GREEN = '#22c55e'; // accent-500

/**
 * The icon mark on its own — no wordmark.
 *
 * `idSuffix` keeps the gradient ids unique: SVG ids are document-global, so
 * two marks on one page would otherwise share (and fight over) one gradient.
 */
export const JjeloTechMark: React.FC<{ className?: string; idSuffix?: string }> = ({
  className = '',
  idSuffix = 'default',
}) => {
  const gradientId = `jjelotech-mark-gradient-${idSuffix}`;

  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className={className} role="presentation">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={GRADIENT_FROM} />
          <stop offset="100%" stopColor={GRADIENT_TO} />
        </linearGradient>
      </defs>

      {/* Hexagonal chevron block */}
      <path
        d="M30 18 L56 18 L44 38 L18 38 Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M14 44 L40 44 L52 64 L40 84 L14 84 L26 64 Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M30 90 L56 90 L44 70 L18 70 Z"
        fill={`url(#${gradientId})`}
        opacity="0.55"
      />

      {/* Location pin with check */}
      <path
        d="M70 26 C81 26 90 35 90 46 C90 58 76 74 70 82 C64 74 50 58 50 46 C50 35 59 26 70 26 Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M61 46 L68 53 L80 39"
        stroke="#ffffff"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/**
 * Full lockup: mark plus wordmark.
 */
export const JjeloTechLogo: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  idSuffix?: string;
}> = ({ size = 'md', showText = true, className = '', idSuffix }) => {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  };

  const textSizes = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <JjeloTechMark
        className={`${sizes[size]} flex-shrink-0`}
        idSuffix={idSuffix ?? `logo-${size}`}
      />

      {showText && (
        <div className="flex flex-col leading-tight">
          <span className={`font-bold text-gradient ${textSizes[size]}`}>JjeloTech</span>
          <span className="text-xs text-slate-400">Attendance Platform</span>
        </div>
      )}
    </div>
  );
};

/**
 * Compact icon in a filled tile, for tight spots like a collapsed sidebar.
 */
export const JjeloTechIcon: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const sizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div
      className={`${sizes[size]} bg-gradient-to-br from-primary-500 to-secondary-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-soft ${className}`}
    >
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-full p-1" role="presentation">
        <circle cx="50" cy="50" r="30" fill="none" stroke="white" strokeWidth="2.5" />
        <circle cx="50" cy="50" r="3" fill="white" />
        <line x1="50" y1="50" x2="65" y2="35" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="50" y1="50" x2="65" y2="65" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <g transform="translate(75, 25) scale(0.8)">
          <circle cx="0" cy="0" r="12" fill={CHECK_GREEN} />
          <path
            d="M -6 0 L -2 4 L 6 -6"
            stroke="white"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
};

export { JjeloTechMark as default };
