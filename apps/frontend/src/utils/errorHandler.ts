/**
 * Frontend Error Handler Utility
 * 
 * Processes errors from backend and displays user-friendly messages
 */

import { useToastStore } from '../components/Toast';

/**
 * Extract user-friendly error message from axios error response
 */
export function getErrorMessage(error: any): string {
  // Check if it's an axios error with response
  if (error?.response?.data?.error) {
    return error.response.data.error;
  }
  
  // Check for network errors
  if (error?.message === 'Network Error' || error?.code === 'ERR_NETWORK') {
    return 'Unable to connect to the server. Please check your internet connection';
  }
  
  // Check for timeout
  if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
    return 'The request took too long. Please try again';
  }
  
  // Check for specific HTTP status codes
  if (error?.response?.status) {
    switch (error.response.status) {
      case 400:
        return 'Invalid request. Please check your input and try again';
      case 401:
        return 'Your session has expired. Please log in again';
      case 403:
        return "You don't have permission to perform this action";
      case 404:
        return 'The requested resource was not found';
      case 409:
        return 'This item already exists';
      case 413:
        return 'The file is too large. Please upload a smaller file';
      case 422:
        return 'The data provided is invalid';
      case 429:
        return 'Too many requests. Please wait a moment and try again';
      case 500:
        return 'A server error occurred. Please try again later';
      case 502:
        return 'Server is temporarily unavailable. Please try again later';
      case 503:
        return 'Service is under maintenance. Please try again later';
      default:
        return 'An unexpected error occurred. Please try again';
    }
  }
  
  // Fallback for unknown errors
  return error?.message || 'An unexpected error occurred';
}

/**
 * Handle and display error with toast notification
 */
export function handleError(error: any, context?: string): void {
  const message = getErrorMessage(error);
  const title = context || 'Error';
  
  const addToast = useToastStore.getState().addToast;
  addToast({
    type: 'error',
    title,
    message,
    duration: 8000 // 8 seconds for errors (longer than success)
  });
  
  // Log sanitized error for debugging (in development only)
  if (import.meta.env.DEV) {
    console.error(`[${context || 'Error'}]`, error);
  }
}

/**
 * Handle API errors with automatic toast notification
 * Use this in catch blocks for API calls
 */
export function handleApiError(error: any, operationName: string): void {
  handleError(error, operationName);
}

/**
 * Show success toast
 */
export function showSuccess(message: string, title: string = 'Success'): void {
  const addToast = useToastStore.getState().addToast;
  addToast({
    type: 'success',
    title,
    message
  });
}

/**
 * Show info toast
 */
export function showInfo(message: string, title: string = 'Info'): void {
  const addToast = useToastStore.getState().addToast;
  addToast({
    type: 'info',
    title,
    message
  });
}

/**
 * Show warning toast
 */
export function showWarning(message: string, title: string = 'Warning'): void {
  const addToast = useToastStore.getState().addToast;
  addToast({
    type: 'warning',
    title,
    message,
    duration: 6000
  });
}
