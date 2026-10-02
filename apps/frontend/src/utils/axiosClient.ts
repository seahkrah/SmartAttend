/**
 * Axios Client Configuration
 * 
 * Centralized HTTP client with:
 * - Base URL configuration
 * - Request/response interceptors
 * - The session cookies, and the CSRF token on state-changing requests
 * - Error handling & retry logic
 * - Request/response logging (dev mode)
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { recoverSession, endSession, isSessionlessAuthCall, redirectForMfaSetup, csrfHeader } from './sessionRefresh';
import { isStepUpRequired, requestStepUp } from './stepUp';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

/**
 * Create Axios instance with default config
 */
export const axiosClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  // The session is in httpOnly cookies the page cannot read; send them.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor: the CSRF token on state-changing requests
 */
axiosClient.interceptors.request.use(
  (config) => {
    Object.entries(csrfHeader(config.method)).forEach(([k, v]) => config.headers.set(k, v));

    // The instance defaults to JSON, and axios turns a FormData body into
    // JSON when the content type says JSON — so every upload (documents,
    // face captures) arrived as a JSON object with no files in it. For
    // FormData the browser must set the type, because only it knows the
    // multipart boundary.
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete?.('Content-Type');
      delete (config.headers as any)['Content-Type'];
    }
    
    // Dev logging
    if (import.meta.env.DEV) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`, config.data);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
  // Load-bearing. With any asynchronous request interceptor, axios 1.13
  // chains the response interceptors as `.catch(handler).then(() => previous
  // result)`, discarding what an error handler returns. The retry after a
  // token refresh then resolved to the request's config instead of its
  // response, so every call that needed a refresh came back with no data.
  // Marked synchronous (it is), axios uses its other path, where a
  // recovering error handler's result is the call's result.
  { synchronous: true }
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
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _steppedUp?: boolean };

    // A sensitive action from a session that signed in a while ago: confirm
    // who you are, then try once more.
    if (isStepUpRequired(error) && originalRequest && !originalRequest._steppedUp) {
      originalRequest._steppedUp = true;
      if (await requestStepUp()) return axiosClient(originalRequest);
      return Promise.reject(error);
    }

    // A 401 means the access token expired or the session ended. Try to
    // renew it once; if that fails the session is over.
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry
        && !isSessionlessAuthCall(originalRequest.url)) {
      originalRequest._retry = true;
      if (await recoverSession(API_BASE_URL)) {
        Object.entries(csrfHeader(originalRequest.method)).forEach(([k, v]) => originalRequest.headers.set(k, v));
        return axiosClient(originalRequest);
      }
      endSession();
      return Promise.reject(error);
    }

    // Handle 403 Forbidden (role/permission denied)
    if (error.response?.status === 403 && !redirectForMfaSetup(error)) {
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
