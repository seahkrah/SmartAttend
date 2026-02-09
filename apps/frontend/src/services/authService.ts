/**
 * Auth Service
 * 
 * Handles:
 * - User login/register
 * - Token management
 * - Session validation
 * - Current user profile
 */

import { axiosClient } from '../utils/axiosClient';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: 'SUPERADMIN' | 'ADMIN' | 'FACULTY' | 'HR' | 'STUDENT' | 'EMPLOYEE';
    tenant_id?: string;
    department?: string;
    permissions: string[];
  };
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role?: string;
}

export interface CurrentUserResponse {
  id: string;
  email: string;
  name: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'FACULTY' | 'HR' | 'STUDENT' | 'EMPLOYEE';
  tenant_id?: string;
  department?: string;
  permissions: string[];
  session_remaining_seconds?: number;
}

class AuthService {
  /**
   * User Login
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await axiosClient.post<LoginResponse>('/auth/login', credentials);
    
    if (response.data.token) {
      localStorage.setItem('accessToken', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    
    return response.data;
  }

  /**
   * User Register (if enabled)
   */
  async register(data: RegisterRequest) {
    const response = await axiosClient.post('/auth/register', data);
    return response.data;
  }

  /**
   * Get Current User
   */
  async getCurrentUser(): Promise<CurrentUserResponse> {
    const response = await axiosClient.get<CurrentUserResponse>('/auth/me');
    return response.data;
  }

  /**
   * Refresh Token
   */
  async refreshToken(): Promise<{ token: string }> {
    const response = await axiosClient.post<{ token: string }>('/auth/refresh');
    
    if (response.data.token) {
      localStorage.setItem('accessToken', response.data.token);
    }
    
    return response.data;
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      await axiosClient.post('/auth/logout');
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }

  /**
   * Get stored token
   */
  getToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  /**
   * Get stored user (client-side cache)
   */
  getStoredUser(): CurrentUserResponse | null {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /**
   * Check user role
   */
  hasRole(role: string | string[]): boolean {
    const user = this.getStoredUser();
    if (!user) return false;

    if (Array.isArray(role)) {
      return role.includes(user.role);
    }

    return user.role === role;
  }

  /**
   * Check permission
   */
  hasPermission(permission: string): boolean {
    const user = this.getStoredUser();
    if (!user) return false;
    return user.permissions.includes(permission);
  }
}

export default new AuthService();
