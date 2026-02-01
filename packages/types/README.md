# @smartattend/types

Shared TypeScript types and interfaces for the SmartAttend monorepo.

## Usage

### In Frontend

```typescript
import { User, AuthResponse, AttendanceStats } from '@smartattend/types';
```

### In Backend

```typescript
import { LoginRequest, RegisterRequest, Student } from '@smartattend/types';
```

## Type Categories

- **auth.ts** - Authentication types (User, AuthResponse, LoginRequest, etc.)
- **attendance.ts** - Attendance tracking types
- **school.ts** - School platform types (Student, Department, etc.)
- **corporate.ts** - Corporate platform types (Employee, Department, etc.)
- **common.ts** - Common API types (responses, pagination, etc.)

## Building

```bash
npm run build
```

This generates TypeScript declaration files in the `dist/` directory that can be imported by other packages.
