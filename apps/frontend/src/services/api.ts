import axios, { AxiosInstance, AxiosError } from 'axios';
import { frontendConfig } from '../config/environment';
import {
  AuthResponse,
  RegisterRequest,
  User,
} from '@jjelotech/types';

const API_BASE_URL = frontendConfig.apiBaseUrl;

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('accessToken');
    
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Handle token refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;
        if (error.response?.status === 401 && !originalRequest?._retry) {
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            originalRequest._retry = true;
            try {
              const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
                refreshToken,
              });
              const newAccessToken = response.data.accessToken;
              this.setToken(newAccessToken);
              localStorage.setItem('accessToken', newAccessToken);
              
              // Retry original request with new token
              if (originalRequest) {
                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                return this.client(originalRequest);
              }
            } catch (refreshError) {
              // Refresh failed, clear tokens
              this.clearToken();
              localStorage.removeItem('accessToken');
              localStorage.removeItem('refreshToken');
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
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

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/register', data);
    
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
