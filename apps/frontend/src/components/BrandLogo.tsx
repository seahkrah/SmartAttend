import React from 'react';

/**
 * SmartAttend Logo Component
 * Used consistently across all pages for brand visibility
 */

export const SmartAttendLogo: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}> = ({ size = 'md', showText = true, className = '' }) => {
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
      {/* Platform Logo Image */}
      <div className={`${sizes[size]} rounded-lg flex items-center justify-center flex-shrink-0`}>
        <img
          src="/logos/platform-logo.png"
          alt="SmartAttend"
          className="w-full h-full object-contain"
        />
      </div>

      {/* Text Logo */}
      {showText && (
        <div className="flex flex-col leading-tight">
          <span className={`font-bold text-gradient ${textSizes[size]}`}>
            SmartAttend
          </span>
          <span className="text-xs text-slate-400">Attendance Platform</span>
        </div>
      )}
    </div>
  );
};

/**
 * Favicon Icon Component
 * Just the icon, no text
 */
export const SmartAttendIcon: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({
  size = 'md',
  className = '',
}) => {
  const sizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className={`${sizes[size]} bg-gradient-to-br from-primary-500 to-secondary-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-soft ${className}`}>
      <svg
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full p-1"
      >
        <circle cx="50" cy="50" r="30" fill="none" stroke="white" strokeWidth="2.5" />
        <circle cx="50" cy="50" r="3" fill="white" />
        <line x1="50" y1="50" x2="65" y2="35" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="50" y1="50" x2="65" y2="65" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <g transform="translate(75, 25) scale(0.8)">
          <circle cx="0" cy="0" r="12" fill="#22c55e" />
          <path d="M -6 0 L -2 4 L 6 -6" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
};
