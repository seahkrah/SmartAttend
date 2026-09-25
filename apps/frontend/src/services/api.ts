import axios, { AxiosInstance, AxiosError } from 'axios';
import { frontendConfig } from '../config/environment';
import { recoverSession, clearStoredSession, isSessionlessAuthCall } from '../utils/sessionRefresh';
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
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // The token is read at each request, not cached: another client or tab
    // may have renewed it since.
    // `synchronous: true` is load-bearing: see utils/axiosClient.ts.
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    }, undefined, { synchronous: true });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;
        if (error.response?.status === 401 && originalRequest && !originalRequest._retry
            && !isSessionlessAuthCall(originalRequest.url)) {
          originalRequest._retry = true;
          const failedWith = String(originalRequest.headers?.Authorization ?? '').replace(/^Bearer /, '') || null;
          const accessToken = await recoverSession(API_BASE_URL, failedWith);
          if (accessToken) {
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return this.client(originalRequest);
          }
          clearStoredSession();
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    localStorage.setItem('accessToken', token);
  }

  clearToken() {
    clearStoredSession();
  }

  // Generic HTTP methods (use these instead of raw axios to get refresh interceptor)
  async get<T = any>(url: string, config?: any) {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: any) {
    return this.client.post<T>(url, data, config);
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
    
    if (response.data.accessToken) {
      this.setToken(response.data.accessToken);
      localStorage.setItem('accessToken', response.data.accessToken);
      if (response.data.refreshToken) {
        localStorage.setItem('refreshToken', response.data.refreshToken);
      }
    }
    
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    console.log('[API] Fetching /auth/me');
    try {
      const response = await this.client.get<{ user: User }>('/auth/me');
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
      this.clearToken();
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  }

  // Domain calls live in their own services (hrService, workforceService,
  // biometricsService ...). The ones that were here were unused, and most
  // named endpoints the server does not have.
}

// Export singleton instance
export const apiClient = new ApiClient();
