/**
 * User-Friendly Error Message Mapper
 * 
 * Converts technical error messages into user-readable messages
 */

export interface ErrorResponse {
  error: string;
  details?: string; // Optional technical details for debugging (logged, not shown to user)
}

/**
 * Map technical errors to user-friendly messages
 */
export function getUserFriendlyError(error: any, fallbackMessage: string = 'Something went wrong'): ErrorResponse {
  const technicalMessage = error?.message || error?.toString() || 'Unknown error';
  
  // Database errors
  if (technicalMessage.includes('duplicate key') || technicalMessage.includes('unique constraint')) {
    if (technicalMessage.toLowerCase().includes('email')) {
      return { error: 'This email address is already registered', details: technicalMessage };
    }
    return { error: 'This record already exists', details: technicalMessage };
  }
  
  if (technicalMessage.includes('foreign key constraint')) {
    return { error: 'Cannot complete this action because related records exist', details: technicalMessage };
  }
  
  if (technicalMessage.includes('not null constraint')) {
    return { error: 'Required information is missing', details: technicalMessage };
  }
  
  if (technicalMessage.includes('syntax error') || technicalMessage.includes('invalid input syntax')) {
    return { error: 'Invalid data format provided', details: technicalMessage };
  }
  
  if (technicalMessage.includes('relation') && technicalMessage.includes('does not exist')) {
    return { error: 'System configuration error. Please contact support', details: technicalMessage };
  }
  
  if (technicalMessage.includes('connect ECONNREFUSED') || technicalMessage.includes('ENOTFOUND')) {
    return { error: 'Unable to connect to the database. Please try again later', details: technicalMessage };
  }
  
  if (technicalMessage.includes('timeout') || technicalMessage.includes('ETIMEDOUT')) {
    return { error: 'The operation took too long. Please try again', details: technicalMessage };
  }
  
  // Network errors
  if (technicalMessage.includes('ECONNRESET') || technicalMessage.includes('socket hang up')) {
    return { error: 'Connection interrupted. Please try again', details: technicalMessage };
  }
  
  // File/Upload errors
  if (technicalMessage.includes('file too large') || technicalMessage.includes('PayloadTooLargeError')) {
    return { error: 'The file is too large. Please upload a smaller file', details: technicalMessage };
  }
  
  if (technicalMessage.includes('ENOENT') || technicalMessage.includes('no such file')) {
    return { error: 'Required file not found', details: technicalMessage };
  }
  
  // Default fallback
  return { error: fallbackMessage, details: technicalMessage };
}

/**
 * Common user-friendly error messages
 */
export const ErrorMessages = {
  // Authentication
  AUTH_REQUIRED: 'Please log in to continue',
  AUTH_INVALID: 'Your login session has expired. Please log in again',
  AUTH_INVALID_CREDENTIALS: 'The email or password you entered is incorrect',
  AUTH_ACCOUNT_LOCKED: 'Your account has been locked. Please contact support',
  AUTH_PERMISSION_DENIED: "You don't have permission to perform this action",
  
  // Validation
  VALIDATION_MISSING_FIELDS: 'Please fill in all required fields',
  VALIDATION_INVALID_EMAIL: 'Please enter a valid email address',
  VALIDATION_PASSWORD_MISMATCH: 'The passwords you entered do not match',
  VALIDATION_PASSWORD_TOO_SHORT: 'Password must be at least 6 characters long',
  VALIDATION_INVALID_FORMAT: 'The information you provided is not in the correct format',
  
  // User Management
  USER_NOT_FOUND: 'User account not found',
  USER_ALREADY_EXISTS: 'An account with this email already exists',
  USER_CREATE_FAILED: 'Unable to create user account. Please try again',
  USER_UPDATE_FAILED: 'Unable to update user information. Please try again',
  USER_DELETE_FAILED: 'Unable to delete user account. Please try again',
  
  // Student Management
  STUDENT_NOT_FOUND: 'Student record not found',
  STUDENT_CREATE_FAILED: 'Unable to add student. Please try again',
  STUDENT_UPDATE_FAILED: 'Unable to update student information. Please try again',
  STUDENT_DELETE_FAILED: 'Unable to remove student. Please try again',
  STUDENT_PHOTO_REQUIRED: 'Please upload a student photo',
  
  // Faculty Management
  FACULTY_NOT_FOUND: 'Faculty member not found',
  FACULTY_CREATE_FAILED: 'Unable to add faculty member. Please try again',
  FACULTY_UPDATE_FAILED: 'Unable to update faculty information. Please try again',
  FACULTY_DELETE_FAILED: 'Unable to remove faculty member. Please try again',
  
  // Course Management
  COURSE_NOT_FOUND: 'Course not found',
  COURSE_CREATE_FAILED: 'Unable to create course. Please try again',
  COURSE_UPDATE_FAILED: 'Unable to update course. Please try again',
  COURSE_DELETE_FAILED: 'Unable to delete course. Please try again',
  
  // Schedule Management
  SCHEDULE_NOT_FOUND: 'Schedule not found',
  SCHEDULE_CREATE_FAILED: 'Unable to create schedule. Please try again',
  SCHEDULE_UPDATE_FAILED: 'Unable to update schedule. Please try again',
  SCHEDULE_DELETE_FAILED: 'Unable to delete schedule. Please try again',
  SCHEDULE_CONFLICT: 'This schedule conflicts with an existing one',
  
  // Room Management
  ROOM_NOT_FOUND: 'Room not found',
  ROOM_CREATE_FAILED: 'Unable to add room. Please try again',
  ROOM_UPDATE_FAILED: 'Unable to update room. Please try again',
  ROOM_DELETE_FAILED: 'Unable to remove room. Please try again',
  
  // Entity Management
  ENTITY_NOT_FOUND: 'Organization not found',
  ENTITY_CREATE_FAILED: 'Unable to create organization. Please try again',
  ENTITY_UPDATE_FAILED: 'Unable to update organization. Please try again',
  ENTITY_DELETE_FAILED: 'Unable to delete organization. Please try again',
  
  // Tenant Management
  TENANT_NOT_FOUND: 'Tenant not found',
  TENANT_LOCKED: 'This tenant account is currently locked',
  TENANT_SUSPENDED: 'This tenant account has been suspended',
  
  // System
  SYSTEM_ERROR: 'A system error occurred. Please try again or contact support',
  SYSTEM_CONFIGURATION_ERROR: 'System is not configured properly. Please contact support',
  NETWORK_ERROR: 'Network connection problem. Please check your internet connection',
  DATABASE_ERROR: 'Database connection problem. Please try again later',
  
  // Generic
  OPERATION_FAILED: 'The operation could not be completed. Please try again',
  NOT_FOUND: 'The requested item was not found',
  ALREADY_EXISTS: 'This item already exists',
  INVALID_REQUEST: 'Invalid request. Please check your input and try again',
  
  // File/Upload
  FILE_TOO_LARGE: 'The file is too large. Maximum size is 5MB',
  FILE_INVALID_TYPE: 'Invalid file type. Please upload a valid image file',
  FILE_UPLOAD_FAILED: 'File upload failed. Please try again',
};

/**
 * Sanitize error for logging (remove sensitive data)
 */
export function sanitizeErrorForLogging(error: any): string {
  const message = error?.message || error?.toString() || 'Unknown error';
  
  // Remove potential sensitive data patterns
  return message
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]') // emails
    .replace(/\b\d{10,}\b/g, '[PHONE]') // phone numbers
    .replace(/password["\s:=]+[^\s"]+/gi, 'password=[REDACTED]') // passwords
    .replace(/token["\s:=]+[^\s"]+/gi, 'token=[REDACTED]'); // tokens
}

/**
 * Log error with sanitization
 */
export function logError(context: string, error: any): void {
  const sanitized = sanitizeErrorForLogging(error);
  console.error(`[${context}]`, sanitized);
  
  // If there's a stack trace, log it separately (in production, send to error tracking service)
  if (error?.stack && process.env.NODE_ENV === 'development') {
    console.error('Stack trace:', error.stack);
  }
}
