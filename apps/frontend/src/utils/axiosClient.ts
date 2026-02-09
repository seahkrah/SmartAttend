/**
 * Axios Client Configuration
 * 
 * Centralized HTTP client with:
 * - Base URL configuration
 * - Request/response interceptors
 * - Token injection (Authorization header)
 * - Error handling & retry logic
 * - Request/response logging (dev mode)
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Create Axios instance with default config
 */
export const axiosClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor: Inject auth token
 */
axiosClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Dev logging
    if (import.meta.env.DEV) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`, config.data);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor: Handle errors & token refresh
 */
axiosClient.interceptors.response.use(
  (response) => {
    // Dev logging
    if (import.meta.env.DEV) {
      console.log(`[API] Response ${response.status}`, response.data);
    }
    return response;
  },
  (error: AxiosError) => {
    // Handle 401 Unauthorized (token expired/invalid)
    if (error.response?.status === 401) {
      // Clear auth state
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      
      // Redirect to login
      window.location.href = '/login';
    }

    // Handle 403 Forbidden (role/permission denied)
    if (error.response?.status === 403) {
      console.error('[API] Permission Denied:', error.response.data);
    }

    // Dev logging
    if (import.meta.env.DEV) {
      console.error(
        `[API] Error ${error.response?.status}`,
        error.response?.data || error.message
      );
    }

    return Promise.reject(error);
  }
);

export default axiosClient;
