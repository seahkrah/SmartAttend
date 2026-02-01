# Shared Types System - SMARTATTEND Monorepo

## Overview

The `@smartattend/types` package provides a centralized, shared type system for the entire SMARTATTEND monorepo. This ensures type consistency across frontend, backend, and any other packages in the ecosystem.

**Benefits:**
- ✅ Single source of truth for all API contracts
- ✅ Type-safe development across monorepo
- ✅ Eliminates duplicate type definitions
- ✅ Easier refactoring and maintenance
- ✅ Better IDE autocomplete and error detection
- ✅ Seamless API integration

## Architecture

```
packages/types/
├── src/
│   ├── auth.ts              # Authentication & user types
│   ├── attendance.ts        # Attendance tracking types
│   ├── school.ts            # School platform entities
│   ├── corporate.ts         # Corporate platform entities
│   ├── common.ts            # Common API types & utilities
│   └── index.ts             # Main export point
├── dist/                    # Compiled JavaScript & TypeScript declarations
│   ├── *.d.ts              # Type declaration files
│   ├── *.js                # JavaScript output
│   └── *.d.ts.map          # Source maps for debugging
├── tsconfig.json           # TypeScript configuration
├── package.json            # Package metadata
└── README.md              # Package documentation
```

## Type Modules

### 1. Authentication (`auth.ts`)

```typescript
// User type - represents logged-in user
export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  platformId: string;
  roleId: string;
  platform: 'school' | 'corporate';
  profileImageUrl?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// API response types
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  platform: 'school' | 'corporate';
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  platform: 'school' | 'corporate';
  phone?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface LogoutResponse {
  message: string;
}
```

**Usage:**
```typescript
// Frontend - Auth Store
import { User, AuthResponse } from '@smartattend/types';

const useAuthStore = create<AuthState>((set) => ({
  user: null as User | null,
  // ...
}));

// Frontend - API Client
async login(email: string, password: string, platform: 'school' | 'corporate'): Promise<AuthResponse> {
  // ...
}
```

### 2. Attendance (`attendance.ts`)

```typescript
// Attendance status types
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

// Individual attendance record
export interface AttendanceRecord {
  id: string;
  userId?: string;
  studentId?: string;
  employeeId?: string;
  status: AttendanceStatus;
  date: string;
  notes?: string;
  markedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Request to mark attendance
export interface MarkAttendanceRequest {
  userId?: string;
  studentId?: string;
  employeeId?: string;
  status: AttendanceStatus;
  date: string;
  notes?: string;
}

// Dashboard statistics
export interface AttendanceStats {
  totalAttendance: number;    // Percentage (0-100)
  presentDays: number;        // Count of present days
  absentDays: number;         // Count of absent days
  lateDays: number;           // Count of late days
  excusedDays: number;        // Count of excused days
  totalMembers: number;       // Total team/class size
  trend: 'up' | 'down' | 'stable';  // Trend indicator
}

// Attendance history with pagination
export interface AttendanceHistory {
  data: AttendanceRecord[];
  total: number;
  limit: number;
  offset: number;
}

// Detailed attendance report
export interface AttendanceReport {
  data: (AttendanceRecord & {
    userInfo?: {
      name: string;
      email: string;
      studentId?: string;
      employeeId?: string;
    };
  })[];
  total: number;
  limit: number;
  offset: number;
  generatedAt: string;
}
```

**Usage:**
```typescript
// Frontend - Dashboard Service
import { AttendanceStats, AttendanceRecord } from '@smartattend/types';

async getDashboardStats(userId: string): Promise<AttendanceStats> {
  return apiClient.getAttendanceStats(userId);
}

// Frontend - Component
const [stats, setStats] = useState<AttendanceStats | null>(null);
```

### 3. School Platform (`school.ts`)

```typescript
// Student entity
export interface Student {
  id: string;
  userId?: string;
  studentId: string;     // Student ID number
  firstName: string;
  lastName: string;
  email?: string;
  college?: string;
  department?: string;
  status: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';
  departmentId?: string;
  enrollmentYear?: number;
  isCurrentlyEnrolled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Request to create/update student
export interface StudentCreateRequest {
  firstName: string;
  lastName: string;
  email?: string;
  college?: string;
  status: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';
  departmentId?: string;
  enrollmentYear?: number;
}

// API response with list of students
export interface StudentListResponse {
  data: Student[];
  total: number;
  limit: number;
  offset: number;
}

// Department for school
export interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  headId?: string;
  createdAt?: string;
}

// Class/Section
export interface SchoolClass {
  id: string;
  name: string;
  code?: string;
  departmentId?: string;
  academicYear: number;
  semester: 'Spring' | 'Fall';
  totalSeats?: number;
  enrolledSeats?: number;
  createdAt?: string;
}
```

### 4. Corporate Platform (`corporate.ts`)

```typescript
// Employee entity
export interface Employee {
  id: string;
  userId?: string;
  employeeId: string;    // Employee ID number
  firstName: string;
  lastName: string;
  email?: string;
  department?: string;
  title?: string;
  department_id?: string;
  manager_id?: string;
  hire_date?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Request to create/update employee
export interface EmployeeCreateRequest {
  firstName: string;
  lastName: string;
  email?: string;
  title?: string;
  departmentId?: string;
  managerId?: string;
  hireDate?: string;
}

// API response with list of employees
export interface EmployeeListResponse {
  data: Employee[];
  total: number;
  limit: number;
  offset: number;
}

// Corporate Department
export interface CorporateDepartment {
  id: string;
  name: string;
  code?: string;
  description?: string;
  headId?: string;
  locationId?: string;
  createdAt?: string;
}

// Team within corporate
export interface Team {
  id: string;
  name: string;
  departmentId: string;
  leaderId: string;
  description?: string;
  createdAt?: string;
}
```

### 5. Common Types (`common.ts`)

```typescript
// Pagination parameters for list endpoints
export interface PaginationParams {
  limit?: number;   // Items per page (default: 10, max: 100)
  offset?: number;  // Starting position (default: 0)
  search?: string;  // Search term for filtering
}

// Standard API response wrapper
export interface ApiResponse<T> {
  data: T;
  message?: string;
  timestamp: string;
}

// List response wrapper
export interface ListResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// Error response
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

// Success response
export interface SuccessResponse {
  message: string;
  timestamp: string;
}

// Error response
export interface ErrorResponse {
  error: string;
  statusCode: number;
  details?: any;
}
```

## Usage Patterns

### Frontend - API Client

```typescript
import { 
  User, 
  AuthResponse, 
  LoginRequest, 
  AttendanceStats 
} from '@smartattend/types';
import axios from 'axios';

class ApiClient {
  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await axios.post('/api/auth/login', data);
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await axios.get('/api/auth/me');
    return response.data;
  }

  async getAttendanceStats(userId: string): Promise<AttendanceStats> {
    const response = await axios.get(`/api/attendance/stats/${userId}`);
    return response.data;
  }
}
```

### Frontend - State Management

```typescript
import { create } from 'zustand';
import { User } from '@smartattend/types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string, platform: 'school' | 'corporate') => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,
  
  login: async (email, password, platform) => {
    try {
      const response = await apiClient.login({
        email,
        password,
        platform
      });
      set({ user: response.user });
    } catch (error) {
      set({ error: error.message });
    }
  },
  
  logout: async () => {
    await apiClient.logout();
    set({ user: null });
  }
}));
```

### Frontend - React Component

```typescript
import { useEffect, useState } from 'react';
import { AttendanceStats, Student } from '@smartattend/types';

export function DashboardPage() {
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await dashboardService.getDashboardStats(userId);
        setStats(data);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStats();
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (!stats) return <div>No data</div>;

  return (
    <div>
      <h1>Attendance: {stats.totalAttendance}%</h1>
      <p>Present: {stats.presentDays} days</p>
      <p>Trend: {stats.trend}</p>
    </div>
  );
}
```

### Backend - Type Mapping

While the backend uses its own database types with snake_case conventions, it can use the shared types for API responses:

```typescript
import { 
  User as ApiUser, 
  AttendanceStats, 
  Student as ApiStudent 
} from '@smartattend/types';
import type { User as DbUser, Student as DbStudent } from './types/database';

// Convert database user to API response
function toApiUser(dbUser: DbUser): ApiUser {
  return {
    id: dbUser.id,
    email: dbUser.email,
    fullName: dbUser.full_name,
    phone: dbUser.phone,
    platformId: dbUser.platform_id,
    roleId: dbUser.role_id,
    // ...
  };
}

// API endpoint using shared types
app.get('/api/auth/me', (req, res) => {
  const dbUser = getCurrentUser(req.userId);
  const apiUser: ApiUser = toApiUser(dbUser);
  res.json(apiUser);
});
```

## Building & Publishing

### Build the Types Package

```bash
cd packages/types

# Install dependencies
npm install

# Compile TypeScript to JavaScript
npm run build

# Output generated in dist/
```

### Using in Other Packages

**Update package.json:**
```json
{
  "dependencies": {
    "@smartattend/types": "file:../../packages/types"
  }
}
```

**Install:**
```bash
npm install
```

**Import:**
```typescript
import { User, AuthResponse } from '@smartattend/types';
```

## Best Practices

1. **Keep types synchronized** - When adding new API endpoints, add corresponding types immediately
2. **Use consistent naming** - Frontend uses camelCase (JavaScript convention), backend uses snake_case (database convention)
3. **Document complex types** - Add JSDoc comments for complex interfaces
4. **Version carefully** - Breaking changes to types should trigger frontend/backend updates
5. **Export from index** - All public types should be exported from `src/index.ts`
6. **Test imports** - After modifying types, rebuild and verify all imports work

## File Size Impact

- **Compiled types package:** ~15 KB (uncompressed)
- **Types in frontend build:** Minimal impact (type definitions removed at runtime)
- **No runtime overhead** - Types are completely stripped during compilation

## Troubleshooting

### Types not found after npm install

```bash
# Rebuild the types package
cd packages/types && npm run build

# Reinstall in dependent package
cd packages/frontend && rm -rf node_modules && npm install
```

### Module resolution issues

Ensure `tsconfig.json` has proper module resolution:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### Build errors with types

Verify TypeScript compilation:

```bash
cd packages/types && npx tsc --noEmit
```

## Future Enhancements

- [ ] Add Jest tests for type validation
- [ ] Generate API documentation from types
- [ ] Add OpenAPI/Swagger definitions
- [ ] Create type guards and validators
- [ ] Add versioning for types
- [ ] Generate client SDKs from types

## Related Documentation

- [Main README](README.md) - Project overview
- [Backend Status](BACKEND_STATUS.md) - Backend implementation
- [API Documentation](API_DOCUMENTATION.md) - Complete API reference
- [packages/types/README.md](packages/types/README.md) - Types package details
