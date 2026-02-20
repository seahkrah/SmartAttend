/**
 * Authentication Types
 */

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  platform: 'school' | 'corporate';
  role: string;
  permissions?: string[];
  isActive?: boolean;
  profileImage?: string | null;
  mustResetPassword?: boolean;
  lastLogin?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  message: string;
  user: User;
  accessToken: string;
  refreshToken?: string;
}

export interface LoginRequest {
  platform: 'school' | 'corporate';
  email: string;
  password: string;
}

export interface RegisterRequest {
  platform: 'school' | 'corporate';
  email: string;
  fullName: string;
  password: string;
  confirmPassword: string;
  phone?: string;
  role?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface LogoutResponse {
  message: string;
}
