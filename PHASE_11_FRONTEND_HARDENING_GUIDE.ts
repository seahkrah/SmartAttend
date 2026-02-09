/**
 * PHASE 11: FRONTEND HARDENING GUIDE
 * 
 * NOW UI STARTS TO MATTER
 * 
 * Principles:
 * 1. Error Clarity: No silent failures. Users always know what happened.
 * 2. Confirmation Friction: Single-step modals for destructive actions (with reason field)
 * 3. Read-only vs Actionable: Visual distinction between data user can view vs edit
 * 4. Visual Hierarchy: Truth (attendance %) vs Metadata (created date)
 * 5. Role-Specific UX: Each role gets an optimized workflow
 * 
 * This phase focuses on production-grade UX, not design/marketing.
 */

// ============================================================================
// ERROR CLARITY SYSTEM
// ============================================================================

/**
 * NO SILENT FAILURES
 * 
 * Every action must provide feedback:
 * - Success: Toast "User created" or status change
 * - Error: AlertBox with user-friendly message + action recommendation
 * - Warning: Toast "Everyone marked absent. Is this expected?"
 * - Loading: Button disabled, spinner visible, progress bar
 */

export const ERROR_CLARITY_CHECKLIST = {
  'API Error Handling': [
    '✅ 401 → "Session expired, please log in again"',
    '✅ 403 → "You don\'t have permission for this action"',
    '✅ 404 → "This resource no longer exists or was deleted"',
    '✅ 409 → "This conflicts with existing data. Try a different value."',
    '✅ 400 → Field-level errors shown below each input',
    '✅ 5xx → "Server error. Please try again in a moment."',
    '✅ Network → "Connection lost. Check your internet."'
  ],

  'Action Feedback': [
    '✅ Every async action shows loading state during request',
    '✅ Success shows toast (auto-dismiss after 3-4s)',
    '✅ Error shows AlertBox (persistent, dismissible)',
    '✅ Warning shows toast (6s, prominent)',
    '✅ Long operations show progress bar + eta'
  ],

  'Silent Failure Prevention': [
    '✅ "Mark all absent" → Toast "All 25 students marked absent. OK?"',
    '✅ Attendance future date → Warning "You are marking tomorrow"',
    '✅ Bulk import 50 records, 12 fail → Warning "38 succeeded, 12 failed"',
    '✅ Tenant suspended with active users → Warning "X users will be logged out"'
  ],

  'Field Validation': [
    '✅ Invalid email → Below field: "Please enter a valid email"',
    '✅ Password too short → Below field: "At least 8 characters required"',
    '✅ Duplicate email → Form-level alert + suggestion to edit existing'
  ]
};

// ============================================================================
// CONFIRMATION FRICTION
// ============================================================================

/**
 * DESTRUCTIVE ACTIONS: SINGLE-STEP CONFIRMATION
 * 
 * Pattern:
 * 1. User clicks "Delete"
 * 2. Modal appears
 * 3. Modal shows: What? Why? How to undo?
 * 4. If needed: Reason field (required for Superadmin, optional for others)
 * 5. Buttons: "Cancel" (focused by default), "Delete" (red)
 * 6. After: Success toast + data refresh
 */

export const CONFIRMATION_FLOWS = {
  DELETE_USER: {
    trigger: 'Delete button in user row',
    modal: {
      title: 'Delete User?',
      message: 'alice@example.com will be permanently deleted. All records archived.',
      reasonField: true,
      severity: 'danger'
    },
    buttons: {
      cancel: 'focused by default',
      delete: 'red, rightmost'
    },
    afterwards: 'Toast "User deleted" + user removed from list'
  },

  SUSPEND_TENANT: {
    trigger: 'Suspend button in tenant row (Superadmin only)',
    modal: {
      title: 'Suspend Organization?',
      message: 'School A will be suspended. All active users will be logged out immediately.',
      reasonField: true,
      severity: 'danger'
    },
    buttons: {
      cancel: 'focused',
      suspend: 'red'
    },
    afterwards: 'Toast "Organization suspended" + refresh tenant list'
  },

  LOCK_ATTENDANCE: {
    trigger: 'Finalize button after submission (Faculty)',
    modal: {
      title: 'Finalize Attendance?',
      message: 'Once finalized, no edits allowed. Check that all absences and lates are correct.',
      reasonField: false,
      severity: 'warning' // Not destructive, reversible
    },
    buttons: {
      cancel: 'focused',
      lock: 'blue'
    },
    afterwards: 'Toast "Attendance finalized" + state change to LOCKED'
  },

  SEND_BULK_NOTIFICATION: {
    trigger: 'Send button in notification campaign (HR)',
    modal: {
      title: 'Send Notification to 12 Employees?',
      message: 'Employees with attendance below 60% will receive your message.',
      reasonField: false,
      severity: 'info'
    },
    buttons: {
      cancel: 'focused',
      send: 'blue'
    },
    afterwards: 'Toast "Notification sent to 12 employees"'
  }
};

/**
 * CHECKLIST: Confirmation Modals
 */
export const CONFIRMATION_CHECKLIST = {
  'Modal Content': [
    '✅ Title clearly states what is being deleted/changed',
    '✅ Message explains consequences (no undo? users logged out?)',
    '✅ Reason field (only for Superadmin destructive actions)',
    '✅ Helper text: "This will be recorded in audit logs"'
  ],

  'Modal Buttons': [
    '✅ "Cancel" button receives focus (safe default)',
    '✅ Destructive action button is red (#dc2626 or red-600)',
    '✅ Non-destructive buttons are blue',
    '✅ Loading state during submission (spinner + disabled)'
  ],

  'Error Handling in Modal': [
    '✅ If action fails, error shown in modal (not dismissed)',
    '✅ Retry button available if error is retryable',
    '✅ Non-retryable errors show "Contact support"'
  ]
};

// ============================================================================
// READ-ONLY VS ACTIONABLE SEPARATION
// ============================================================================

/**
 * VISUAL DISTINCTION: Is this field editable?
 * 
 * Read-Only (Student viewing own attendance):
 * - Container: Darker background (slate-900/50)
 * - Border: Subtle (slate-700)
 * - Text: Slate-300 (dimmer)
 * - No hover effects
 * - Icon: Lock or eye icon optional
 * 
 * Actionable (Admin editing user role):
 * - Container: Lighter (slate-800)
 * - Border: Visible (slate-600)
 * - Text: White (brighter)
 * - Hover: Border brightens, cursor changes
 * - Cursor: "text" or "pointer"
 */

export const READ_ONLY_VS_ACTIONABLE = {
  'Read-Only Display': {
    component: 'div or span (not input)',
    styling: 'bg-slate-900/50 border border-slate-700 p-3 rounded',
    textColor: 'text-slate-300',
    labelStyle: 'text-slate-400 text-xs uppercase',
    cursor: 'default (no change)',
    hover: 'none',
    example: 'Student viewing "Attendance: 85%"'
  },

  'Actionable Input': {
    component: 'input or select or textarea',
    styling: 'bg-slate-800 border border-slate-600 p-3 rounded',
    textColor: 'text-white',
    labelStyle: 'text-slate-200 text-xs',
    cursor: 'text or pointer',
    hover: 'border-slate-500',
    example: 'Admin editing "Course name"'
  },

  'Read-Only But Copyable': {
    component: 'div + copy button',
    styling: 'bg-slate-900/50 with copy icon',
    textColor: 'text-slate-300 font-mono (for IDs)',
    example: 'Tenant ID: "tenant_abc123def456"'
  },

  'Disabled Input': {
    component: 'input disabled',
    styling: 'bg-slate-700 border border-slate-700 opacity-50',
    textColor: 'text-slate-400',
    cursor: 'not-allowed',
    example: 'Previously submitted field, awaiting approval'
  }
};

/**
 * CHECKLIST: Read-Only vs Actionable
 */
export const READ_ONLY_CHECKLIST = {
  'Form Sections': [
    '✅ Read-only section labeled "View Only Information"',
    '✅ Editable fields grouped together',
    '✅ Clear visual separation between sections',
    '✅ No ambiguity about what can be changed'
  ],

  'Data Tables': [
    '✅ Status columns use color-coded badges',
    '✅ Action buttons always visible (don\'t hide in hover)',
    '✅ Action buttons disabled if user lacks permission',
    '✅ Read-only columns dimmed (slate-400 text)'
  ],

  'Feedback': [
    '✅ Edit attempt on read-only field → No cursor, no change',
    '✅ Edit attempt with missing permission → Error toast "You lack permission"',
    '✅ Successful edit → Success toast "Updated", field reflects change'
  ]
};

// ============================================================================
// VISUAL HIERARCHY: TRUTH VS METADATA
// ============================================================================

/**
 * DATA HIERARCHY IN COMPONENTS
 * 
 * PRIMARY (Main fact):
 * - Attendance: 85%
 * - User name: Alice Johnson
 * - Course: Introduction to Math
 * Size: 16-18px bold white
 * 
 * SECONDARY (Supporting context):
 * - Email: alice@school.edu
 * - Date: March 5, 2026
 * - Department: Engineering
 * Size: 14px slate-200
 * 
 * TERTIARY (Metadata, reference only):
 * - User ID: user_abc123
 * - Created: Feb 15, 2026 at 3:45pm
 * - Last modified by: Admin Name
 * Size: 12px slate-400
 */

export const HIERARCHY_EXAMPLES = {
  'Attendance Card': {
    PRIMARY: 'Attendance 85% ← main fact',
    SECONDARY: 'Present, math 403 ← supporting',
    TERTIARY: 'Last marked Feb 5 ← metadata'
  },

  'User Row in Table': {
    PRIMARY: 'Alice Johnson ← user identity',
    SECONDARY: 'alice@school.edu, Engineering ← context',
    TERTIARY: 'ID: user_abc, Created: Feb 1 ← reference'
  },

  'Incident Card': {
    PRIMARY: 'User locked (HIGH_VOLUME_AUTH_FAILURE) ← what happened',
    SECONDARY: 'bob@corp.edu, 2026-02-05 ← who and when',
    TERTIARY: 'Incident ID, trigger threshold, resolver ← technical'
  },

  'Course Row': {
    PRIMARY: 'Math 101 ← course name',
    SECONDARY: '45 students, Spring semester ← enrollment',
    TERTIARY: 'Code: M101, Instructor ID: faculty_xyz ← reference'
  }
};

/**
 * CHECKLIST: Visual Hierarchy
 */
export const HIERARCHY_CHECKLIST = {
  'Card Components': [
    '✅ Title (PRIMARY) is largest and boldest',
    '✅ Supporting text (SECONDARY) is medium gray',
    '✅ Metadata (TERTIARY) is small and very dim',
    '✅ User scans PRIMARY first without effort'
  ],

  'Table Rows': [
    '✅ First column is PRIMARY (name/title)',
    '✅ Middle columns are SECONDARY (email, date)',
    '✅ Last column is action (button)',
    '✅ Hover highlights entire row consistently'
  ],

  'Forms': [
    '✅ Main fields (required) are prominent',
    '✅ Helper text is small and gray',
    '✅ Validation errors are red and prominent',
    '✅ Optional fields are not emphasized'
  ],

  'Modals': [
    '✅ Title is PRIMARY and centered',
    '✅ Body text is SECONDARY',
    '✅ Footer buttons are actionable (blue or red)'
  ]
};

// ============================================================================
// ROLE-SPECIFIC UX FLOWS
// ============================================================================

/**
 * SUPERADMIN: Safety-First Flow
 * 
 * Superadmin performs high-impact actions. Every action surfaces:
 * - What changed
 * - Why it changed (reason field required)
 * - Audit trail (logged immutably)
 * - Undo path (if reversible)
 * 
 * Best practices:
 * - Confirmation always required
 * - Reason field always required
 * - Audit trail visible on every entity
 * - All actions logged with timestamp + reason
 */

export const SUPERADMIN_UX_FLOW = {
  'Suspend Tenant': {
    steps: [
      '1. Superadmin navigates to /superadmin/tenants',
      '2. Sees list: School A, School B, etc.',
      '3. Hovers over row → "Suspend" button appears (red)',
      '4. Clicks "Suspend" → Modal appears',
      '5. Modal shows: "Suspend School A?" + consequences',
      '6. Superadmin enters reason: "Policy violation, abuse reported"',
      '7. Clicks "Suspend" (confirmed)',
      '8. Loading spinner appears in modal',
      '9. Success: Modal closes, toast "School A suspended"',
      '10. List refreshes, showing status = SUSPENDED'
    ]
  },

  'View Audit Trail': {
    steps: [
      '1. Superadmin opens /superadmin/audit-trail',
      '2. Sees table: Date, Action (SUSPEND, UNLOCK, CREATE), Target, Status, By',
      '3. Clicks row → Modal showing full details',
      '4. Can see: Exact tenant name, timestamp, reason, IP, result'
    ]
  }
};

/**
 * FACULTY: Linear Workflow Flow
 * 
 * Faculty attendance workflow is ALWAYS in one of these states:
 * - MARKING (selecting students)
 * - DRAFTING (before submit)
 * - SUBMITTED (can still edit)
 * - LOCKED (final)
 * 
 * Interface shows current state prominently, with progress bar.
 * Linear flow. No ambiguous states.
 */

export const FACULTY_UX_FLOW = {
  'Mark Attendance': {
    states: [
      'Step 1: Choose course (dropdown)',
      'Step 2: Choose marking mode (QR/Facial/Manual/Bulk)',
      'Step 3: Mark attendance (shows progress circle)',
      'Step 4: Review counts ("25 present, 3 absent, 2 late")',
      'Step 5: Submit (must be 100% marked)',
      'Step 6: Can still edit',
      'Step 7: Finalize (no edits after)'
    ],
    currentStateDisplay: 'Medium-sized banner at top: "Status: DRAFTING (17/25 marked)"',
    progressIndicator: 'Circle graph: 17/25 students',
    buttons: {
      marking: 'Save (always available)',
      draft: 'Submit',
      submitted: 'Edit or Finalize',
      locked: 'View only (all disabled)'
    }
  }
};

/**
 * STUDENT: Self-Service Read-Mostly Flow
 * 
 * Student interface is predominantly read-only.
 * Limited actions: Edit profile, Report discrepancy, Export data.
 * All data shown is self-service (not others' data).
 */

export const STUDENT_UX_FLOW = {
  'View Attendance': {
    sections: [
      'Profile card (name, email, enrollment ID)',
      'Attendance metric (85%, EXCELLENT, badge)',
      'Breakdown by course (table: course, %, status)',
      'Discrepancies (flagged issues, read-only)',
      'Export buttons (PDF, XLSX, CSV)'
    ],
    allowedActions: [
      'Edit profile (name, email, phone)',
      'Report discrepancy (attendance marked wrong?)',
      'Export data'
    ],
    deniedActions: [
      'Cannot edit attendance (read-only)',
      'Cannot see other students',
      'Cannot change role'
    ]
  }
};

/**
 * ADMIN: Efficiency-Focused Bulk Flow
 * 
 * Admin performs repetitive actions efficiently.
 * Bulk import users (CSV), bulk approve, quick filters.
 * Large datasets handled with pagination + search.
 */

export const ADMIN_UX_FLOW = {
  'Create Users': {
    option1: {
      title: 'Single User',
      steps: ['Click "Create User"', 'Fill form', 'Submit', 'Success toast']
    },
    option2: {
      title: 'Bulk Import',
      steps: ['Click "Bulk Import"', 'Upload CSV', 'Preview', 'Confirm', 'Results (success/fail count)']
    }
  },

  'Approval Queue': {
    steps: [
      'Admin sees badge: "3 Pending Approvals"',
      'Clicks "Approvals" tab',
      'Sees pending users with role, email, join date',
      'Can bulk approve or approve individually',
      'Success: Users moved to active, email sent'
    ]
  }
};

/**
 * HR: Monitoring-Focused Pattern Flow
 * 
 * HR monitors attendance patterns and sends notifications.
 * Aggregate data shown first (overview cards).
 * Drill-down to individual employees.
 * Patterns flagged with confidence scores + suggested actions.
 */

export const HR_UX_FLOW = {
  'Monitor Attendance': {
    steps: [
      '1. Open /hr/analytics',
      '2. See overview: Total members, avg attendance, at-risk count',
      '3. See patterns: "Bob marked chronically absent, 92% confidence"',
      '4. Click on pattern → View Bob\'s records',
      '5. Click "Send Notification" → Pre-filled with suggested message',
      '6. Customize + Send',
      '7. Toast: "Notification sent to Bob"'
    ]
  }
};

// ============================================================================
// INTEGRATION CHECKLIST: ALL ROLES
// ============================================================================

export const PHASE_11_CHECKLIST = {
  '1. Error Clarity': [
    '✅ All 7 error handlers implemented in axiosClient',
    '✅ Friendly error messages in errorMessages.ts',
    '✅ ErrorAlert component used in all pages',
    '✅ Toast system for async feedback'
  ],

  '2. Confirmation Modals': [
    '✅ ConfirmationDialog component built',
    '✅ Delete User, Suspend Tenant, Lock Attendance modals ready',
    '✅ Reason field present for destructive actions',
    '✅ Cancel button gets focus (safe default)'
  ],

  '3. Loading States': [
    '✅ LoadingSpinner in all async contexts',
    '✅ SkeletonScreens for table data',
    '✅ ProgressBar for multi-step workflows',
    '✅ Disabled buttons during submission'
  ],

  '4. Visual Hierarchy': [
    '✅ PRIMARY/SECONDARY/TERTIARY text classes applied',
    '✅ Card component follows hierarchy',
    '✅ Table rows use hierarchy',
    '✅ Color coding for status (EXCELLENT/GOOD/AT_RISK/CRITICAL)'
  ],

  '5. Read-Only Distinction': [
    '✅ Read-only sections styled darker',
    '✅ Actionable inputs styled brighter',
    '✅ Disabled inputs show "not-allowed" cursor',
    '✅ Permission denied shows error (not silent)'
  ],

  '6. Role-Specific Flows': [
    '✅ Superadmin: Confirmation + reason for all destructive actions',
    '✅ Faculty: Linear workflow (MARKING → SUBMITTED → LOCKED)',
    '✅ Admin: Bulk import + quick approve available',
    '✅ Student: Read-mostly, 3 allowed actions',
    '✅ HR: Patterns prominent, notifications easy'
  ],

  '7. Silent Failure Prevention': [
    '✅ Every async action shows loading',
    '✅ Every result shows toast (success, warning, or error)',
    '✅ Unusual states trigger warnings ("All marked absent?")',
    '✅ Bulk operations show success/fail counts'
  ]
};

export default {
  ERROR_CLARITY_CHECKLIST,
  CONFIRMATION_FLOWS,
  CONFIRMATION_CHECKLIST,
  READ_ONLY_VS_ACTIONABLE,
  READ_ONLY_CHECKLIST,
  HIERARCHY_EXAMPLES,
  HIERARCHY_CHECKLIST,
  SUPERADMIN_UX_FLOW,
  FACULTY_UX_FLOW,
  STUDENT_UX_FLOW,
  ADMIN_UX_FLOW,
  HR_UX_FLOW,
  PHASE_11_CHECKLIST
};
