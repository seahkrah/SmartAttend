/**
 * Convert technical error codes and messages to user-friendly messages
 */

export function getUserFriendlyError(error: any): string {
  // If it's an axios error with response
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    // Check for backend error message first
    if (data?.error) {
      return formatErrorMessage(data.error);
    }
    if (data?.message) {
      return formatErrorMessage(data.message);
    }

    // Map HTTP status codes to user-friendly messages
    switch (status) {
      case 400:
        return 'Please check your information and try again';
      case 401:
        return 'Invalid email or password. Please try again';
      case 403:
        return 'You don\'t have permission to access this';
      case 404:
        return 'The requested information was not found';
      case 409:
        return 'This email is already registered';
      case 422:
        return 'Please check all fields are filled correctly';
      case 429:
        return 'Too many attempts. Please wait a moment and try again';
      case 500:
        return 'Server error. Please try again later';
      case 503:
        return 'Service unavailable. Please try again later';
      default:
        return 'Something went wrong. Please try again';
    }
  }

  // Network error
  if (error.message === 'Network Error') {
    return 'Network connection failed. Please check your internet connection';
  }

  // Timeout error
  if (error.code === 'ECONNABORTED') {
    return 'Request timed out. Please try again';
  }

  // Generic message error
  if (error.message) {
    return formatErrorMessage(error.message);
  }

  return 'Something went wrong. Please try again';
}

/**
 * Format technical error messages to be more user-friendly
 */
function formatErrorMessage(message: string): string {
  // Remove "Error: " prefix if present
  message = message.replace(/^Error:\s*/i, '');

  // Map common technical messages to friendly ones
  const messageMaps: Record<string, string> = {
    'email_registered_different_platform': 'This email is registered for a different platform. Please select the correct platform or use a different email.',
    'request failed with status code 401': 'Invalid email or password',
    'request failed with status code 400': 'Please check your information',
    'request failed with status code 409': 'This email is already registered',
    'invalid or expired token': 'Your session has expired. Please log in again',
    'missing required fields': 'Please fill in all required fields',
    'email already registered': 'This email is already in use',
    'email already exists': 'This email is already in use',
    'user not found': 'Invalid email or password',
    'invalid credentials': 'Invalid email or password',
    'password must be at least': 'Password is too short',
    'passwords do not match': 'Passwords don\'t match',
    'network error': 'Network connection failed',
    'timeout': 'Request timed out',
  };

  const lowerMessage = message.toLowerCase();

  // Check for exact matches first
  for (const [key, value] of Object.entries(messageMaps)) {
    if (lowerMessage.includes(key)) {
      return value;
    }
  }

  // If message is already user-friendly, return it
  if (isUserFriendlyMessage(message)) {
    return message;
  }

  // Return formatted message with first letter capitalized
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * Check if a message is already user-friendly
 */
function isUserFriendlyMessage(message: string): boolean {
  // Messages that are already user-friendly (don't start with technical keywords)
  const friendlyPatterns = [
    /^(please|your|invalid|check|that|this|all|too)/i,
    /^[A-Z][^:]+ (success|failed|error|warning)$/i,
  ];

  return friendlyPatterns.some(pattern => pattern.test(message));
}

/**
 * Extract error details for debugging
 */
export function getErrorDetails(error: any): {
  status?: number;
  message: string;
  code?: string;
} {
  return {
    status: error.response?.status,
    message: error.message,
    code: error.code,
  };
}

// ============================================================================
// PHASE 11: ENHANCED ERROR CLARITY
// ============================================================================

/**
 * Context-specific error titles for different actions
 */
export const ACTION_ERROR_TITLES: Record<string, string> = {
  CREATE_USER: 'Could Not Create User',
  UPDATE_USER: 'Could Not Update User',
  DELETE_USER: 'Could Not Delete User',
  BULK_IMPORT_USERS: 'Could Not Import Users',
  CREATE_COURSE: 'Could Not Create Course',
  ASSIGN_FACULTY: 'Could Not Assign Faculty',
  MARK_ATTENDANCE: 'Could Not Save Attendance',
  SUBMIT_ATTENDANCE: 'Could Not Submit Attendance',
  LOCK_ATTENDANCE: 'Could Not Finalize Attendance',
  BULK_EDIT_ATTENDANCE: 'Could Not Bulk Edit Attendance',
  REPORT_DISCREPANCY: 'Could Not Report Issue',
  SUSPEND_TENANT: 'Could Not Suspend Organization',
  RESTORE_TENANT: 'Could Not Restore Organization',
  UNLOCK_USER: 'Could Not Unlock User',
  APPROVE_USER: 'Could Not Approve User',
  REJECT_USER: 'Could Not Reject User',
  SEND_NOTIFICATION: 'Could Not Send Notification',
  CREATE_CAMPAIGN: 'Could Not Create Campaign',
  SEND_CAMPAIGN: 'Could Not Send Campaign',
  EXPORT_REPORT: 'Could Not Generate Report',
  UPDATE_PROFILE: 'Could Not Update Profile',
};

/**
 * Get action-specific error context
 */
export function getActionContext(action: keyof typeof ACTION_ERROR_TITLES): string {
  return ACTION_ERROR_TITLES[action] || 'Action Failed';
}

/**
 * Warnings for "silent failures" - things that technically succeeded but might not be expected
 */
export const SILENT_FAILURE_WARNINGS: Record<string, string> = {
  ALL_ABSENT: 'Everyone is marked absent. Is this expected?',
  ALL_PRESENT: 'Everyone is marked present. Is this expected?',
  NO_LATE: 'No one is marked late. Most real attendance has some lates.',
  FUTURE_DATE: 'You are marking attendance for a future date. Did you mean today?',
  PAST_MONTH: 'You are marking attendance from a month ago. This may already be locked.',
  SUSPENSION_DURING_SESSION: 'This organization has active users online. Suspension may disrupt them.',
  BULK_DELETE_LARGE: 'You are about to delete many records. This cannot be undone.',
  PARTIAL_SUCCESS: (success: number, failed: number) => 
    `${success} succeeded, but ${failed} failed. Review the errors before trying again.`,
};

/**
 * Retry recommendations based on error status
 */
export function shouldRetry(statusCode?: number): boolean {
  if (!statusCode) return true;
  // Retryable: 408 (timeout), 429 (rate limit), 503 (service unavailable), 5xx (server)
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * Get action guidance for user (step-by-step)
 */
export function getErrorGuidance(errorCode: string, statusCode?: number): string[] {
  const steps: string[] = [];

  if (statusCode === 401) {
    steps.push('Your session has expired');
    steps.push('1. Click "Log in again"');
    steps.push('2. Enter your credentials');
  } else if (statusCode === 403) {
    steps.push('You don\'t have permission for this action');
    steps.push('1. Ask your administrator for access');
  } else if (statusCode === 400 || statusCode === 422) {
    steps.push('The information provided was invalid');
    steps.push('1. Check all required fields are filled');
    steps.push('2. Verify email addresses and dates');
    steps.push('3. Try again');
  } else if (statusCode === 404) {
    steps.push('The record was not found or has been deleted');
    steps.push('1. Refresh the page');
    steps.push('2. Try a different record');
  } else if (statusCode === 409) {
    steps.push('This action conflicts with existing data');
    steps.push('1. Check for duplicate entries');
    steps.push('2. Use a different value');
  } else if (shouldRetry(statusCode)) {
    steps.push('A temporary error occurred');
    steps.push('1. Wait a moment');
    steps.push('2. Click "Try Again"');
  }

  return steps;
}

/**
 * Translate common backend error codes to user messages
 */
export function translateErrorCode(errorCode: string): string {
  const translations: Record<string, string> = {
    // Authentication
    'INVALID_CREDENTIALS': 'The email or password is incorrect',
    'SESSION_EXPIRED': 'Your login has expired. Please log in again',
    'INVALID_TOKEN': 'Your session is invalid. Please log in again',
    'TOKEN_REVOKED': 'Your session was ended. Please log in again',
    
    // Authorization
    'INSUFFICIENT_PERMISSIONS': 'You don\'t have permission for this action',
    'ROLE_MISMATCH': 'This action is not allowed for your role',
    'TENANT_NOT_OWNER': 'You can only manage your own organization',
    
    // Validation
    'INVALID_EMAIL': 'Please enter a valid email address',
    'EMAIL_ALREADY_EXISTS': 'This email is already in use',
    'INVALID_PASSWORD': 'Password must be at least 8 characters with uppercase, lowercase, and numbers',
    'PASSWORD_MISMATCH': 'The passwords don\'t match',
    'INVALID_DATE': 'Please enter a valid date',
    'INVALID_ROLE': 'Please select a valid role',
    'MISSING_REQUIRED_FIELD': 'Please fill in all required fields',
    
    // Conflicts
    'DUPLICATE_COURSE_CODE': 'A course with this code already exists',
    'DUPLICATE_TENANT_NAME': 'This organization name is already taken',
    'ATTENDANCE_ALREADY_LOCKED': 'This attendance has already been finalized and cannot be edited',
    'USER_ALREADY_APPROVED': 'This user has already been approved',
    'TENANT_SUSPENDED': 'This organization is suspended and cannot accept new actions',
    
    // Not Found
    'USER_NOT_FOUND': 'This user no longer exists or has been deleted',
    'COURSE_NOT_FOUND': 'This course no longer exists or has been deleted',
    'TENANT_NOT_FOUND': 'This organization no longer exists',
    'ATTENDANCE_NOT_FOUND': 'This attendance record was not found',
    
    // Rate Limits
    'RATE_LIMITED': 'You\'re making requests too quickly. Wait a moment and try again',
    'TOO_MANY_ATTEMPTS': 'Too many attempts. Please wait before trying again',
    
    // Server
    'INTERNAL_ERROR': 'Something went wrong. Please try again or contact support',
    'SERVICE_UNAVAILABLE': 'The service is temporarily unavailable. Please try again later',
    'DATABASE_ERROR': 'A database error occurred. Your request was not processed',
    'EXTERNAL_SERVICE_ERROR': 'An external service is temporarily unavailable. Please try again later',
  };

  return translations[errorCode] || 'An error occurred. Please try again or contact support';
}
