/**
 * Common API Types
 */

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
  status?: number;
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: Record<string, any>;
}

export interface SuccessResponse<T> {
  message: string;
  data?: T;
}

export interface ErrorResponse {
  message: string;
  status: number;
  error?: string;
}
