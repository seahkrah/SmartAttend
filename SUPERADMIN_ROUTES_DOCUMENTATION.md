# Superadmin Routes Documentation

## Overview
Created dedicated superadmin routes for login and dashboard functionality, separate from the regular platform login. This provides a clean separation of concerns for superadmin-specific operations.

---

## New Endpoints

### 1. POST `/api/auth/login-superadmin`
**Superadmin-specific login endpoint**

#### Request Body
```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```

#### Response (Success - 200)
```json
{
  "message": "Superadmin login successful",
  "user": {
    "id": "uuid-here",
    "email": "admin@example.com",
    "fullName": "Admin Name",
    "role": "superadmin",
    "permissions": [
      "manage_all_entities",
      "manage_all_users",
      "view_all_data",
      "view_all_approvals",
      "approve_all_requests",
      "manage_roles",
      "view_audit_logs",
      "system_settings",
      "view_analytics",
      "manage_platforms"
    ]
  },
  "accessToken": "jwt-token-here",
  "refreshToken": "jwt-refresh-token-here"
}
```

#### Response (Error - 401)
```json
{
  "error": "Invalid email or password"
}
```

#### Error Codes
- `400` - Missing required fields
- `401` - Invalid email or password
- `500` - System platform not configured

#### Implementation Details
- Uses the `system` platform for superadmin accounts
- Validates superadmin role specifically
- Checks account is active
- Updates `last_login` timestamp
- Generates both access and refresh tokens
- Token expiration: 24 hours (access), 7 days (refresh)

---

### 2. GET `/api/auth/superadmin/dashboard`
**Comprehensive superadmin dashboard endpoint (all data in one call)**

#### Headers Required
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

#### Response (Success - 200)
```json
{
  "success": true,
  "message": "Dashboard data fetched successfully",
  "data": {
    "stats": {
      "total_schools": 5,
      "active_schools": 4,
      "total_corporates": 3,
      "active_corporates": 3,
      "total_users": 150,
      "active_users": 145,
      "pending_school_approvals": 12,
      "pending_corporate_approvals": 5
    },
    "entities": {
      "schools": [
        {
          "id": "uuid",
          "name": "School Name",
          "code": "SCHOOL001",
          "email": "admin@school.com",
          "is_active": true,
          "user_count": 45,
          "pending_approvals": 3
        }
      ],
      "corporates": [
        {
          "id": "uuid",
          "name": "Corporate Name",
          "code": "CORP001",
          "email": "admin@corp.com",
          "is_active": true,
          "user_count": 25,
          "pending_approvals": 1
        }
      ]
    },
    "pendingApprovals": {
      "list": [
        {
          "id": "uuid",
          "entity_type": "school",
          "entity_name": "School Name",
          "user_name": "Student Name",
          "user_email": "student@school.com",
          "role": "student",
          "requested_at": "2026-02-01T10:30:00Z"
        }
      ],
      "count": 17
    },
    "userStatistics": [
      {
        "platform_name": "school",
        "total_users": 120,
        "active_users": 115,
        "admin_count": 10,
        "student_count": 80,
        "faculty_count": 30,
        "employee_count": 0,
        "it_count": 0,
        "hr_count": 0
      }
    ],
    "recentActions": [
      {
        "id": "uuid",
        "action": "approve_registration",
        "entity_type": "school",
        "entity_id": "uuid",
        "details": { "approved_user_id": "uuid" },
        "created_at": "2026-02-01T10:15:00Z"
      }
    ],
    "currentUser": {
      "id": "uuid",
      "email": "admin@system.com",
      "fullName": "Admin Name",
      "profileImage": "url-to-image"
    }
  }
}
```

#### Response (Error - 401)
```json
{
  "error": "Not authenticated"
}
```

#### Response (Error - 403)
```json
{
  "error": "Superadmin access required"
}
```

#### Error Codes
- `401` - Not authenticated / Missing token
- `403` - Not a superadmin
- `500` - Failed to fetch dashboard data

#### Implementation Details
- Requires valid JWT access token
- Verifies superadmin role via `verifySuperadmin` middleware
- Fetches all dashboard data in parallel for performance
- Includes:
  - Platform statistics
  - All entities (schools & corporates)
  - All pending approvals
  - User statistics by platform
  - Recent superadmin action logs
  - Current user info
- Automatically logs the action to `superadmin_action_logs`

---

## Existing Superadmin Endpoints (Reference)

These endpoints continue to work and provide granular access to dashboard data:

### `GET /api/auth/superadmin/dashboard-stats`
Statistics about schools, corporates, users, and pending approvals

### `GET /api/auth/superadmin/entities`
List of all school and corporate entities

### `GET /api/auth/superadmin/pending-approvals`
All pending user registration approvals across all entities

### `GET /api/auth/superadmin/user-statistics`
User statistics broken down by platform and role

### `GET /api/auth/superadmin/action-logs`
Audit log of superadmin actions (paginated)

### `GET /api/auth/superadmin/entity-users?entityType=school&entityId={id}`
Users belonging to a specific entity

---

## Implementation Details

### Backend Route Changes
**File:** [src/routes/auth.ts](src/routes/auth.ts)

#### Added Imports
```typescript
import {
  generateRefreshToken,
  verifyPassword,
  // ... other imports
} from '../auth/authService.js'
```

#### New Route Handler
1. `POST /login-superadmin` - Lines 539-606
2. `GET /superadmin/dashboard` - Lines 749-805

### Authentication Flow
```
User submits credentials
    ↓
POST /api/auth/login-superadmin
    ↓
Verify system platform exists
    ↓
Find superadmin user by email + platform + role
    ↓
Verify password
    ↓
Generate access & refresh tokens
    ↓
Update last_login timestamp
    ↓
Return tokens to client
```

### Authorization Flow (Dashboard)
```
Client sends GET /api/auth/superadmin/dashboard + token
    ↓
authenticateToken middleware
    ↓
Verify JWT token validity
    ↓
verifySuperadmin middleware
    ↓
Check user is superadmin
    ↓
Fetch all dashboard data (parallel)
    ↓
Log action
    ↓
Return comprehensive dashboard data
```

---

## Frontend Integration

### Login Page (Update for Superadmin)
```typescript
import axios from 'axios'

const loginSuperadmin = async (email: string, password: string) => {
  const response = await axios.post('http://localhost:5000/api/auth/login-superadmin', {
    email,
    password
  })
  
  // Store tokens
  localStorage.setItem('accessToken', response.data.accessToken)
  localStorage.setItem('refreshToken', response.data.refreshToken)
  
  return response.data.user
}
```

### Dashboard Component (Update)
```typescript
const fetchDashboard = async () => {
  const token = localStorage.getItem('accessToken')
  
  const response = await axios.get('/api/auth/superadmin/dashboard', {
    headers: { Authorization: `Bearer ${token}` }
  })
  
  const { stats, entities, pendingApprovals, userStatistics, recentActions, currentUser } = response.data.data
  
  // Use data in component...
}
```

---

## Testing Commands

### Test Superadmin Login
```bash
curl -X POST http://localhost:5000/api/auth/login-superadmin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }'
```

### Test Superadmin Dashboard
```bash
curl -X GET http://localhost:5000/api/auth/superadmin/dashboard \
  -H "Authorization: Bearer {accessToken}" \
  -H "Content-Type: application/json"
```

---

## Database Dependencies

The endpoints depend on the following tables/views:
- `platforms` - System platform lookup
- `users` - Superadmin user lookup
- `roles` - Role information with permissions
- `school_entities` - School data
- `corporate_entities` - Corporate data
- `superadmin_action_logs` - Action audit log
- `superadmin_all_pending_approvals` - View of pending approvals
- `superadmin_user_statistics` - View of user statistics

---

## Migration Path

### From Old Login to New Superadmin Routes
If you had a mixed login system before:

**Old way:** Use `/api/auth/login` with `platform: 'system'`
**New way:** Use `/api/auth/login-superadmin` (clearer, dedicated endpoint)

Both continue to work, but the new endpoint is preferred.

---

## Security Considerations

1. **Token Storage**
   - Store access tokens in memory or secure HTTP-only cookies
   - Store refresh tokens securely
   - Tokens expire after 24 hours (access) / 7 days (refresh)

2. **Password Requirements**
   - Minimum 6 characters (enforced in registration)
   - Hashed with bcrypt (10 rounds)

3. **Audit Logging**
   - All superadmin actions logged to `superadmin_action_logs`
   - Includes timestamp, action type, entity info, IP address
   - Provides accountability trail

4. **Role Verification**
   - Every protected endpoint verifies superadmin role
   - Uses middleware chain: `authenticateToken` → `verifySuperadmin`

---

## Status

✅ Both endpoints implemented and tested  
✅ TypeScript compilation successful  
✅ Backend server running without errors  
✅ Database integration working  
✅ Logging functional  

---

## Next Steps

1. Create/update frontend login page for superadmin
2. Create/update frontend dashboard component
3. Update app routing to use new endpoints
4. Test full flow end-to-end
5. Deploy to production

