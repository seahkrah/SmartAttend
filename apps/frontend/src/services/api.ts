import axios, { AxiosInstance, AxiosError } from 'axios';
import { frontendConfig } from '../config/environment';
import {
  recoverSession, clearStoredSession, isSessionlessAuthCall, redirectForMfaSetup, csrfHeader, rememberCsrfToken, markSignedIn,
} from '../utils/sessionRefresh';
import { isStepUpRequired, requestStepUp } from '../utils/stepUp';
import {
  AuthResponse,
  User,
} from '@jjelotech/types';

const API_BASE_URL = frontendConfig.apiBaseUrl;

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      // The session is in httpOnly cookies (the API sets them because every
      // request says X-Auth-Transport: cookie); the page never holds a token.
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Transport': 'cookie',
      },
    });

    // `synchronous: true` is load-bearing: see utils/axiosClient.ts.
    this.client.interceptors.request.use((config) => {
      Object.entries(csrfHeader(config.method)).forEach(([k, v]) => config.headers.set(k, v));
      return config;
    }, undefined, { synchronous: true });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;
        if (isStepUpRequired(error) && originalRequest && !originalRequest._steppedUp) {
          originalRequest._steppedUp = true;
          if (await requestStepUp()) return this.client(originalRequest);
          return Promise.reject(error);
        }
        if (error.response?.status === 401 && originalRequest && !originalRequest._retry
            && !isSessionlessAuthCall(originalRequest.url)) {
          originalRequest._retry = true;
          if (await recoverSession(API_BASE_URL)) {
            Object.entries(csrfHeader(originalRequest.method)).forEach(([k, v]) => originalRequest.headers.set(k, v));
            return this.client(originalRequest);
          }
          clearStoredSession();
        }
        redirectForMfaSetup(error);
        return Promise.reject(error);
      }
    );
  }

  /** Records a finished sign-in: the CSRF token it returned, and that there is a session. */
  signedIn(response: { csrfToken?: string }) {
    rememberCsrfToken(response.csrfToken);
    markSignedIn();
  }

  clearSession() {
    clearStoredSession();
  }

  // Generic HTTP methods (use these instead of raw axios to get refresh interceptor)
  async get<T = any>(url: string, config?: any) {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: any) {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: any) {
    return this.client.put<T>(url, data, config);
  }

  async patch<T = any>(url: string, data?: any, config?: any) {
    return this.client.patch<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: any) {
    return this.client.delete<T>(url, config);
  }

  // ===== Auth Endpoints =====
  
  async login(platform: 'school' | 'corporate', email: string, password: string): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/login', {
      platform,
      email,
      password,
    });
    
    return response.data;
  }

  /** The code step of a sign-in; the API sets the session cookies. */
  async verifyMfa(mfaToken: string, answer: { code?: string; recoveryCode?: string }): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/mfa/verify', { mfaToken, ...answer });
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    console.log('[API] Fetching /auth/me');
    try {
      const response = await this.client.get<{ user: User; csrfToken?: string }>('/auth/me');
      rememberCsrfToken(response.data.csrfToken);
      console.log('[API] /auth/me success:', {
        id: response.data.user.id,
        email: response.data.user.email,
        role: response.data.user.role,
        platform: response.data.user.platform,
      });
      return response.data.user;
    } catch (error) {
      console.error('[API] /auth/me failed:', error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } finally {
      this.clearSession();
    }
  }

  // Domain calls live in their own services (hrService, workforceService,
  // biometricsService ...). The ones that were here were unused, and most
  // named endpoints the server does not have.
}

// Export singleton instance
export const apiClient = new ApiClient();
