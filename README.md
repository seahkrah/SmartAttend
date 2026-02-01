# SMARTATTEND - Monorepo

A modern attendance tracking system with a React frontend, Express backend, and PostgreSQL database.

## Project Structure

```
smartattend/
├── apps/
│   ├── frontend/          # React 18 + Vite + TypeScript
│   │   └── src/
│   │       ├── pages/     # Landing, Login, Register, Dashboard
│   │       ├── components/# Reusable UI components & animations
│   │       ├── services/  # API client & dashboard service
│   │       └── store/     # Zustand auth state management
│   ├── backend/           # Express + TypeScript (31 endpoints)
│   │   └── src/
│   │       ├── routes/    # API routes (auth, school, corporate, attendance)
│   │       ├── auth/      # JWT auth & middleware
│   │       ├── db/        # PostgreSQL connection & migrations
│   │       └── types/     # Database type definitions
│   └── 
├── packages/
│   └── types/             # Shared TypeScript interfaces for entire monorepo
│       ├── src/
│       │   ├── auth.ts        # Auth types (User, AuthResponse, etc.)
│       │   ├── attendance.ts  # Attendance types
│       │   ├── school.ts      # School platform types
│       │   ├── corporate.ts   # Corporate platform types
│       │   ├── common.ts      # Common API types
│       │   └── index.ts       # Main exports
│       └── dist/              # Compiled types (auto-generated)
└── docs/                  # Documentation files

```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite 5, Tailwind CSS 3 |
| **UI/UX** | Framer Motion (animations), Lucide React (icons) |
| **State** | Zustand 4.4.0, React Router v6 |
| **HTTP** | Axios 1.6.0 with interceptors |
| **Backend** | Express.js, TypeScript, PostgreSQL 16 |
| **Auth** | JWT (24hr access, 7d refresh), bcryptjs |
| **Shared Types** | TypeScript interfaces in `@smartattend/types` |

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 16+
- npm or yarn

### Installation

```bash
# Install dependencies for all packages
npm install

# In apps/frontend
cd apps/frontend && npm install

# In apps/backend
cd apps/backend && npm install

# Build types package (if needed)
cd packages/types && npm run build
```

### Development

**Terminal 1 - Frontend (port 5174)**
```bash
cd apps/frontend
npm run dev
```

**Terminal 2 - Backend (port 5000)**
```bash
cd apps/backend
npm run dev
```

### Build for Production

```bash
# Build frontend
cd apps/frontend && npm run build

# Build backend
cd apps/backend && npm run build

# Run backend
cd apps/backend && npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account (school or corporate)
- `POST /api/auth/login` - Login with email & password
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Current user (protected)
- `POST /api/auth/logout` - Logout

### School Platform
- `GET /api/school/students` - List students
- `GET /api/school/students/{id}` - Student details
- `POST /api/school/students` - Create student
- `PUT /api/school/students/{id}` - Update student
- `GET /api/school/faculty` - List faculty
- And 6+ more endpoints...

### Corporate Platform
- `GET /api/corporate/employees` - List employees
- `POST /api/corporate/employees` - Create employee
- `POST /api/corporate/checkins` - Record check-in
- And 9+ more endpoints...

### Attendance
- `GET /api/attendance` - All attendance records
- `POST /api/attendance/mark` - Mark attendance
- `GET /api/attendance/stats/{userId}` - User statistics
- `GET /api/attendance/report` - Generate report

See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for complete endpoint reference.

## Shared Types

The `packages/types` package provides TypeScript interfaces used across frontend and backend:

```typescript
// Frontend usage
import { User, AuthResponse, AttendanceStats } from '@smartattend/types';

// Api Service
class ApiClient {
  async login(email: string, password: string): Promise<AuthResponse> { }
  async getAttendanceStats(userId: string): Promise<AttendanceStats> { }
}

// Auth Store
const useAuthStore = create<AuthState>((set) => ({
  user: null as User | null,
  // ...
}));
```

## Features

✅ **Authentication**
- Platform selection (school/corporate)
- Email & password login/register
- JWT token management with auto-refresh
- Secure password hashing

✅ **UI/UX**
- Modern Tailwind CSS design
- Smooth Framer Motion animations
- Responsive layouts
- Real-time data loading states
- Error handling with user feedback

✅ **Dashboard**
- Real attendance statistics
- Attendance trends
- User profile management
- Attendance history

✅ **Backend**
- 31 REST API endpoints
- PostgreSQL with connection pooling
- Comprehensive error handling
- Request/response validation
- Audit logging

## Current Status

| Component | Status | Build |
|-----------|--------|-------|
| Frontend | ✅ Complete | 111.42 kB (gzipped) |
| Backend | ✅ Complete | All endpoints working |
| Types Package | ✅ Complete | 24 files compiled |
| E2E Integration | ✅ API connected | Real data flow |
| Favicon | ✅ Visible | platform-logo.png |
| Animations | ✅ Working | 7+ components |

## Development Notes

- Frontend uses Axios with automatic token refresh interceptor
- Dashboard has graceful fallback to mock data if API unavailable
- All TypeScript code type-safe with zero implicit any
- CORS enabled for local development
- Database migrations auto-run on startup

## Documentation

- [Backend Status](BACKEND_STATUS.md) - Backend implementation details
- [API Documentation](API_DOCUMENTATION.md) - Complete API reference
- [Schema](SCHEMA_REFACTOR_SUMMARY.md) - Database schema details
- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Production deployment

## Future Enhancements

- [ ] Real-time notifications (WebSockets)
- [ ] Employee/Student management pages
- [ ] Advanced attendance reports
- [ ] Mobile app (React Native)
- [ ] Biometric attendance
- [ ] Analytics dashboard
