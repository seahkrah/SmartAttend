import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  AuthResponse,
  RegisterRequest,
  User,
  AttendanceStats,
} from '@smartattend/types';

const API_BASE_URL = 'http://localhost:5000/api';

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
        if (error.response?.status === 401) {
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            try {
              const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
                refreshToken,
              });
              const newAccessToken = response.data.accessToken;
              this.setToken(newAccessToken);
              localStorage.setItem('accessToken', newAccessToken);
              
              // Retry original request with new token
              if (error.config) {
                error.config.headers.Authorization = `Bearer ${newAccessToken}`;
                return this.client(error.config);
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
    const response = await this.client.get<{ user: User }>('/auth/me');
    return response.data.user;
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

  // ===== School Platform Endpoints =====

  async getSchoolStudents(limit = 20, offset = 0, departmentId?: string) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (departmentId) {
      params.append('departmentId', departmentId);
    }
    
    const response = await this.client.get(`/school/students?${params}`);
    return response.data;
  }

  async getSchoolStudent(studentId: string) {
    const response = await this.client.get(`/school/students/${studentId}`);
    return response.data;
  }

  async createSchoolStudent(data: any) {
    const response = await this.client.post('/school/students', data);
    return response.data;
  }

  async updateSchoolStudent(studentId: string, data: any) {
    const response = await this.client.put(`/school/students/${studentId}`, data);
    return response.data;
  }

  async deleteSchoolStudent(studentId: string) {
    const response = await this.client.delete(`/school/students/${studentId}`);
    return response.data;
  }

  // ===== Corporate Platform Endpoints =====

  async getCorporateEmployees(limit = 20, offset = 0, departmentId?: string) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (departmentId) {
      params.append('departmentId', departmentId);
    }
    
    const response = await this.client.get(`/corporate/employees?${params}`);
    return response.data;
  }

  async getCorporateEmployee(employeeId: string) {
    const response = await this.client.get(`/corporate/employees/${employeeId}`);
    return response.data;
  }

  async createCorporateEmployee(data: any) {
    const response = await this.client.post('/corporate/employees', data);
    return response.data;
  }

  async updateCorporateEmployee(employeeId: string, data: any) {
    const response = await this.client.put(`/corporate/employees/${employeeId}`, data);
    return response.data;
  }

  async deleteCorporateEmployee(employeeId: string) {
    const response = await this.client.delete(`/corporate/employees/${employeeId}`);
    return response.data;
  }

  // ===== Attendance Endpoints =====

  async markAttendance(data: {
    userId?: string;
    studentId?: string;
    employeeId?: string;
    status: 'present' | 'absent' | 'late';
    date: string;
    notes?: string;
  }) {
    const response = await this.client.post('/attendance/mark', data);
    return response.data;
  }

  async getAttendanceHistory(
    userId: string,
    fromDate?: string,
    toDate?: string,
    limit = 50,
    offset = 0
  ) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    
    const response = await this.client.get(`/attendance/history/${userId}?${params}`);
    return response.data;
  }

  async getAttendanceStats(userId: string): Promise<AttendanceStats> {
    const response = await this.client.get(`/attendance/stats/${userId}`);
    return response.data;
  }

  async getAttendanceReport(
    startDate: string,
    endDate: string,
    platform?: 'school' | 'corporate',
    limit = 100,
    offset = 0
  ) {
    const params = new URLSearchParams({
      startDate,
      endDate,
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (platform) params.append('platform', platform);
    
    const response = await this.client.get(`/attendance/report?${params}`);
    return response.data;
  }

  // ===== User Management Endpoints =====

  async getAllUsers(limit = 20, offset = 0, platform?: 'school' | 'corporate') {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (platform) params.append('platform', platform);
    
    const response = await this.client.get(`/users?${params}`);
    return response.data;
  }

  async getUserProfile(userId: string) {
    const response = await this.client.get(`/users/${userId}`);
    return response.data;
  }

  async updateUserProfile(userId: string, data: any) {
    const response = await this.client.put(`/users/${userId}`, data);
    return response.data;
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const response = await this.client.post(`/users/${userId}/change-password`, {
      oldPassword,
      newPassword,
    });
    return response.data;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
