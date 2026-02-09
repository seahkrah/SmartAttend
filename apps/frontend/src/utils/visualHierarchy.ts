/**
 * PHASE 11: VISUAL HIERARCHY & UX PATTERNS
 * 
 * Design system for:
 * - Truth vs Metadata distinction
 * - Role-specific optimizations
 * - Clear data hierarchy
 * - Read-only vs Actionable separation
 */

// ============================================================================
// VISUAL HIERARCHY TOKENS
// ============================================================================

/**
 * Data Hierarchy Levels
 * 
 * PRIMARY: The main fact the user needs (attendance %, student name, etc)
 * SECONDARY: Supporting context (course name, date, email)
 * TERTIARY: Metadata (ID, timestamp, tooltip info)
 * MUTED: Less important (helper text, counts)
 */

export const HIERARCHY = {
  PRIMARY: {
    className: 'text-white font-semibold text-lg',
    description: 'Main data point (attendance %, user name, status)'
  },
  SECONDARY: {
    className: 'text-slate-200 text-sm',
    description: 'Supporting context (course, date, email)'
  },
  TERTIARY: {
    className: 'text-slate-400 text-xs',
    description: 'Metadata only (ID, created date)'
  },
  MUTED: {
    className: 'text-slate-500 text-xs',
    description: 'Least important (hints, counts, suggestions)'
  }
};

// ============================================================================
// COLOR MEANINGS (Status, not just aesthetics)
// ============================================================================

export const STATUS_COLORS = {
  EXCELLENT: 'bg-green-500/20 border-green-500/30 text-green-300',
  GOOD: 'bg-blue-500/20 border-blue-500/30 text-blue-300',
  AT_RISK: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300',
  CRITICAL: 'bg-red-500/20 border-red-500/30 text-red-300',
  NEUTRAL: 'bg-slate-500/20 border-slate-500/30 text-slate-300',
};

/**
 * Attendance percentage to status badge
 */
export function getAttendanceStatus(percentage: number): keyof typeof STATUS_COLORS {
  if (percentage >= 80) return 'EXCELLENT';
  if (percentage >= 60) return 'GOOD';
  if (percentage >= 40) return 'AT_RISK';
  return 'CRITICAL';
}

/**
 * User role to badge color
 */
export function getRoleColor(role: string): keyof typeof STATUS_COLORS {
  const roleMap: Record<string, keyof typeof STATUS_COLORS> = {
    SUPERADMIN: 'CRITICAL',
    ADMIN: 'GOOD',
    FACULTY: 'GOOD',
    HR: 'GOOD',
    STUDENT: 'NEUTRAL',
    EMPLOYEE: 'NEUTRAL'
  };
  return roleMap[role] || 'NEUTRAL';
}

// ============================================================================
// READ-ONLY VS ACTIONABLE
// ============================================================================

/**
 * Visual distinction: Is this data editable or read-only?
 */
export const READ_ONLY_STYLES = {
  // Data that user can view but not edit
  container: 'bg-slate-900/50 border border-slate-700',
  text: 'text-slate-300',
  label: 'text-slate-400 text-xs'
};

export const ACTIONABLE_STYLES = {
  // Data that user can interact with
  container: 'bg-slate-800 border border-slate-600 hover:border-slate-500 transition-colors',
  text: 'text-white',
  label: 'text-slate-300 text-xs'
};

// ============================================================================
// ROLE-SPECIFIC UX PATTERNS
// ============================================================================

/**
 * Superadmin: Safety-first, confirmation-heavy, audit-focused
 */
export const SUPERADMIN_PATTERNS = {
  // All destructive actions require reason field
  destructiveActions: {
    requiresReason: true,
    confirmationModal: true,
    auditLogged: true,
    backupAvailable: true
  },

  // Displays show both current data + change history
  dataDisplay: {
    showAuditTrail: true,
    showLastModifiedBy: true,
    showChangeHistory: 'always'
  },

  // Actions are grouped by impact level
  actionLayout: {
    orderBy: 'impact', // Highest risk first
    colorCode: true, // Red for destructive
    confirmationLevel: 'strict' // Always confirm
  }
};

/**
 * Admin: Efficiency-focused, bulk operations allowed, approval workflows
 */
export const ADMIN_PATTERNS = {
  // Bulk operations available
  bulkOperations: {
    enabled: true,
    maxBulkSize: 100,
    previewBeforeSend: true
  },

  // Approvals are streamlined
  approvalWorkflow: {
    quickApprove: true, // Approve with one click
    bulkApprove: true,
    preloadCommonReasons: true
  },

  // Analytics summarized, drill-down available
  analyticsDisplay: {
    summaryFirst: true, // Show totals before details
    filterControls: true,
    exportEnabled: true
  }
};

/**
 * Faculty: Workflow-focused, progress clear, state machine enforced
 */
export const FACULTY_PATTERNS = {
  // Attendance workflow is linear: Mark → Submit → Lock
  workflowState: {
    isStateManaged: true,
    stateTransitionsExplicit: true,
    currentStateProminent: true
  },

  // Multi-mode marking is clearly switched
  markingModes: {
    modeDisplayed: 'above_roster', // Always visible
    modeSwitch: 'prominent',
    progressByMode: true
  },

  // Progress is always visible
  progressDisplay: {
    percentageMarked: true,
    itemCount: true,
    estimatedTimeRemaining: false // Too optimistic
  }
};

/**
 * Student/Employee: Self-service, read-mostly, limited actions
 */
export const STUDENT_PATTERNS = {
  // Most displays are read-only
  readOnlyByDefault: true,

  // Limited actionable: profile edit, discrepancy report
  allowedActions: ['EDIT_PROFILE', 'REPORT_DISCREPANCY', 'EXPORT_DATA'],

  // Discrepancy workflow is simple (single submit)
  discrepancyWorkflow: {
    singleStep: true,
    requiresEvidence: false,
    auditableByAdmin: true
  }
};

/**
 * HR: Monitoring-focused, notifications prominent, patterns visualized
 */
export const HR_PATTERNS = {
  // Patterns are highlighted
  patternDetection: {
    alwaysVisible: true,
    confidence: true,
    suggestedAction: true
  },

  // Notifications are the main action
  primaryAction: 'SEND_NOTIFICATION',

  // Aggregate data is default view
  dataDisplay: {
    aggregateFirst: true,
    drillDownAvailable: true,
    comparisonMetrics: true
  }
};

// ============================================================================
// COMPONENT LAYOUT PATTERNS
// ============================================================================

/**
 * Card Component: Truth vs Metadata Distinction
 */
export const CARD_PATTERN = {
  header: {
    // PRIMARY data (what matters most)
    className: HIERARCHY.PRIMARY.className,
    content: 'Main title/status'
  },
  meta: {
    // TERTIARY (supporting info, smaller)
    className: HIERARCHY.TERTIARY.className,
    content: 'Created date, ID, last modified'
  },
  body: {
    // SECONDARY data
    className: HIERARCHY.SECONDARY.className,
    content: 'Details, descriptions'
  },
  actions: {
    // CTA buttons (right-aligned)
    positioning: 'top-right or bottom-right',
    styling: 'secondary buttons only (primary in modals)'
  }
};

/**
 * Table Row Pattern: Scanning-optimized
 */
export const TABLE_PATTERN = {
  columns: [
    {
      position: 'first',
      data: 'PRIMARY (name)',
      width: '30%'
    },
    {
      position: 'middle',
      data: 'SECONDARY (email, date)',
      width: 'flex'
    },
    {
      position: 'last',
      data: 'Actionable (status badge, buttons)',
      width: 'auto'
    }
  ],
  hoverState: {
    highlightRow: true,
    showActions: 'always' // Don't hide in cells
  },
  sortable: 'Primary, Secondary columns only'
};

/**
 * Form Pattern: Clear required vs optional
 */
export const FORM_PATTERN = {
  requiredIndicator: '*',
  requiredLabelStyle: 'text-white font-semibold',
  optionalLabelStyle: 'text-slate-400',
  helperText: {
    required: 'always below',
    optional: 'on focus'
  },
  validation: {
    realTime: true,
    onSubmitAlso: true,
    fieldErrorPlacement: 'below'
  }
};

// ============================================================================
// CONFIRMATION FRICTION MATRIX
// ============================================================================

/**
 * When to show confirmation dialogs
 */
export const CONFIRMATION_MATRIX = {
  DELETE_USER: {
    severity: 'CRITICAL',
    requiresReason: true,
    autoconfirm: false,
    modalVariant: 'danger'
  },
  DELETE_COURSE: {
    severity: 'HIGH',
    requiresReason: true,
    autoconfirm: false,
    modalVariant: 'danger'
  },
  SUSPEND_TENANT: {
    severity: 'CRITICAL',
    requiresReason: true,
    autoconfirm: false,
    modalVariant: 'danger'
  },
  LOCK_ATTENDANCE: {
    severity: 'MEDIUM',
    requiresReason: false, // Not destructive, reversible via unlock
    autoconfirm: false,
    modalVariant: 'warning'
  },
  SEND_BULK_NOTIFICATION: {
    severity: 'MEDIUM',
    requiresReason: false,
    autoconfirm: false,
    modalVariant: 'info'
  },
  APPROVE_USER: {
    severity: 'LOW',
    requiresReason: false,
    autoconfirm: false,
    modalVariant: 'info'
  }
};

// ============================================================================
// ERROR MESSAGE PLACEMENT RULES
// ============================================================================

/**
 * Where to show errors based on context
 */
export const ERROR_PLACEMENT = {
  FIELD_VALIDATION: {
    placement: 'below input',
    timing: 'onBlur or onChange',
    style: 'inline red text'
  },
  FORM_SUBMISSION: {
    placement: 'sticky top of form',
    timing: 'immediately',
    style: 'AlertBox with dismiss option'
  },
  ASYNC_ACTION: {
    placement: 'toast (bottom right)',
    timing: 'immediate',
    style: 'ErrorToast (persistent)',
    action: 'Retry button'
  },
  PERMISSION_DENIED: {
    placement: 'full page',
    timing: 'on navigation',
    style: '403 error page',
    action: 'Contact admin link'
  },
  SESSION_EXPIRED: {
    placement: 'modal overlay',
    timing: 'detected on next action',
    style: 'ConfirmationDialog',
    action: 'Log in again button'
  }
};

export default {
  HIERARCHY,
  STATUS_COLORS,
  READ_ONLY_STYLES,
  ACTIONABLE_STYLES,
  SUPERADMIN_PATTERNS,
  ADMIN_PATTERNS,
  FACULTY_PATTERNS,
  STUDENT_PATTERNS,
  HR_PATTERNS,
  CARD_PATTERN,
  TABLE_PATTERN,
  FORM_PATTERN,
  CONFIRMATION_MATRIX,
  ERROR_PLACEMENT
};
