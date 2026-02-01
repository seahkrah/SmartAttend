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
