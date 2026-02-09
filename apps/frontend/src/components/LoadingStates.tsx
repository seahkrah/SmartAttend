/**
 * PHASE 11: Loading States & Skeleton Components
 * 
 * Visual feedback that prevents jumping/flashing:
 * - Loading spinners
 * - Skeleton screens (shimmer placeholders)
 * - Disabled states during loading
 * - Progress indicators
 */

import React from 'react';

// ============================================================================
// LOADING SPINNERS
// ============================================================================

export const LoadingSpinner: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const sizeMap = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };

  return (
    <div className={`${sizeMap[size]} animate-spin rounded-full border-b-2 border-blue-500`} />
  );
};

export const LoadingOverlay: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <LoadingSpinner size="lg" />
      <p className="text-slate-400">{message}</p>
    </div>
  );
};

// ============================================================================
// SKELETON SCREENS
// ============================================================================

/**
 * Generic skeleton block (shimmer effect)
 */
export const SkeletonBlock: React.FC<{ width?: string; height?: string; className?: string }> = ({
  width = 'w-full',
  height = 'h-4',
  className = ''
}) => (
  <div
    className={`${width} ${height} rounded bg-slate-700 animate-pulse ${className}`}
  />
);

/**
 * Skeleton for a table row
 */
export const TableRowSkeleton: React.FC<{ columns?: number }> = ({ columns = 5 }) => (
  <div className="flex gap-4 p-4 border-b border-slate-700">
    {Array.from({ length: columns }).map((_, i) => (
      <SkeletonBlock key={i} width="flex-1" height="h-4" />
    ))}
  </div>
);

/**
 * Skeleton for a table (multiple rows)
 */
export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({
  rows = 5,
  columns = 5
}) => (
  <div className="space-y-2">
    {/* Header */}
    <div className="flex gap-4 p-4 border-b border-slate-700">
      {Array.from({ length: columns }).map((_, i) => (
        <SkeletonBlock key={i} width="flex-1" height="h-4" />
      ))}
    </div>

    {/* Rows */}
    {Array.from({ length: rows }).map((_, i) => (
      <TableRowSkeleton key={i} columns={columns} />
    ))}
  </div>
);

/**
 * Skeleton for a card
 */
export const CardSkeleton: React.FC = () => (
  <div className="p-6 bg-slate-800/50 rounded-lg border border-slate-700 space-y-4">
    <SkeletonBlock height="h-6" width="w-1/3" />
    <SkeletonBlock height="h-12" />
    <SkeletonBlock height="h-12" />
    <div className="flex gap-2 pt-4">
      <SkeletonBlock height="h-10" width="w-1/4" />
      <SkeletonBlock height="h-10" width="w-1/4" />
    </div>
  </div>
);

/**
 * Skeleton for a form
 */
export const FormSkeleton: React.FC = () => (
  <div className="space-y-4">
    <div className="space-y-2">
      <SkeletonBlock height="h-4" width="w-1/4" />
      <SkeletonBlock height="h-10" />
    </div>

    <div className="space-y-2">
      <SkeletonBlock height="h-4" width="w-1/4" />
      <SkeletonBlock height="h-10" />
    </div>

    <div className="space-y-2">
      <SkeletonBlock height="h-4" width="w-1/4" />
      <SkeletonBlock height="h-20" />
    </div>

    <div className="flex gap-2 pt-4">
      <SkeletonBlock height="h-10" width="w-1/4" />
      <SkeletonBlock height="h-10" width="w-1/4" />
    </div>
  </div>
);

/**
 * Skeleton for dashboard overview cards
 */
export const OverviewCardsSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
    {Array.from({ length: count }).map((_, i) => (
      <CardSkeleton key={i} />
    ))}
  </div>
);

// ============================================================================
// PROGRESS INDICATORS
// ============================================================================

/**
 * Linear progress bar
 */
export const ProgressBar: React.FC<{ progress: number; label?: string }> = ({
  progress,
  label
}) => (
  <div className="space-y-2">
    {label && <p className="text-sm text-slate-400">{label}</p>}
    <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
      <div
        className="bg-blue-500 h-full transition-all duration-300"
        style={{ width: `${Math.min(100, progress)}%` }}
      />
    </div>
    <p className="text-xs text-slate-500 text-right">{Math.round(progress)}%</p>
  </div>
);

/**
 * Circular progress (for attendance marking)
 */
export const CircleProgress: React.FC<{ progress: number; size?: 'sm' | 'md' | 'lg' }> = ({
  progress,
  size = 'md'
}) => {
  const sizeMap = { sm: 60, md: 100, lg: 140 };
  const radius = sizeMap[size] / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress / 100);

  return (
    <div className="flex flex-col items-center">
      <svg width={sizeMap[size]} height={sizeMap[size]}>
        <circle
          cx={sizeMap[size] / 2}
          cy={sizeMap[size] / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={4}
          fill="none"
          className="text-slate-700"
        />
        <circle
          cx={sizeMap[size] / 2}
          cy={sizeMap[size] / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={4}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-blue-500 transition-all duration-500"
          style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
        />

        {/* Center text */}
        <text
          x={sizeMap[size] / 2}
          y={sizeMap[size] / 2 + 2}
          textAnchor="middle"
          dy=".3em"
          className="text-xl font-bold fill-white"
        >
          {Math.round(progress)}%
        </text>
      </svg>
    </div>
  );
};

/**
 * Step progress (e.g., attendance workflow: marking → submitting → locked)
 */
export interface ProgressStep {
  label: string;
  status: 'completed' | 'current' | 'pending';
}

export const StepProgress: React.FC<{ steps: ProgressStep[] }> = ({ steps }) => (
  <div className="flex items-center justify-between gap-2">
    {steps.map((step, index) => (
      <React.Fragment key={index}>
        {/* Step circle */}
        <div className="flex flex-col items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs transition-colors ${
              step.status === 'completed'
                ? 'bg-green-500 text-white'
                : step.status === 'current'
                ? 'bg-blue-500 text-white'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            {step.status === 'completed' ? '✓' : index + 1}
          </div>
          <p
            className={`text-xs mt-2 text-center ${
              step.status === 'current' ? 'text-blue-400 font-semibold' : 'text-slate-400'
            }`}
          >
            {step.label}
          </p>
        </div>

        {/* Connector (except last) */}
        {index < steps.length - 1 && (
          <div className="flex-1 h-0.5 mb-8 mx-1 bg-slate-700" />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ============================================================================
// LOADING STATES FOR SPECIFIC COMPONENTS
// ============================================================================

/**
 * Loading state for a button
 */
export const LoadingButton: React.FC<{
  isLoading: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}> = ({ isLoading, children, onClick, disabled, className, variant = 'primary' }) => {
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-slate-600 hover:bg-slate-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white'
  };

  return (
    <button
      onClick={onClick}
      disabled={isLoading || disabled}
      className={`flex items-center justify-center gap-2 px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
    >
      {isLoading && <LoadingSpinner size="sm" />}
      {children}
    </button>
  );
};

/**
 * Loading state for an input/textarea
 */
export const LoadingInput: React.FC<{
  isLoading: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ isLoading, value, onChange, placeholder, disabled }) => (
  <input
    type="text"
    value={value}
    onChange={e => onChange(e.target.value)}
    disabled={isLoading || disabled}
    placeholder={placeholder}
    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
  />
);

export default LoadingSpinner;
