# Superadmin Dashboard - Implementation Guide

## Overview

The Superadmin Dashboard provides **platform-wide system oversight and management** for SmartAttend. It gives superadmin users complete visibility into all schools, corporate entities, users, pending approvals, and system activities.

## Features

### 1. Dashboard Overview
- **Real-time Statistics**: Total schools, corporates, users, and pending approvals
- **Entity Distribution**: Pie chart showing schools vs corporate entities
- **User Activity**: Active vs inactive user counts
- **Pending Approvals Alert**: Quick-access alert when approvals are pending

### 2. Entity Management
- **Schools Tab**: View all school entities with user counts and pending approvals
- **Corporate Entities Tab**: View all corporate entities with details
- **Status Indicators**: Visual indicators for active/inactive entities
- **User Count Display**: See how many users each entity has

### 3. Approval Management
- **Centralized View**: All pending approvals from all schools and corporates in one place
- **Sortable List**: Shows entity, user, role, request date, and entity type
- **Cross-Platform**: Manages both school and corporate approval requests

### 4. User Statistics
- **Platform Breakdown**: Statistics per platform (school and corporate)
- **Role Distribution**: Count of each role type (admin, student, faculty, employee, IT, HR)
- **Activity Status**: Active vs inactive users per platform
- **Visual Charts**: Bar charts for easy comparison

### 5. Audit Logs
- **Action History**: Complete log of all superadmin actions
- **Pagination**: View up to 50 actions at a time
- **Details**: Action type, entity type, timestamp, and metadata
- **Security**: Track who did what and when

## Database Schema

### Core Tables

#### `superadmin_action_logs`
Tracks all superadmin actions for security and audit purposes.

```sql
CREATE TABLE superadmin_action_logs (
  id UUID PRIMARY KEY,
  superadmin_user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(255) NOT NULL,        -- 'view_dashboard_stats', 'approve_request', etc
  entity_type VARCHAR(100),             -- 'school_entity', 'user', 'approval', etc
  entity_id UUID,                       -- ID of affected entity
  details JSONB,                        -- Additional metadata
  ip_address VARCHAR(45),               -- IP address of request
  user_agent TEXT,                      -- Browser info
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `superadmin_statistics`
Cached statistics for performance (updated periodically).

```sql
CREATE TABLE superadmin_statistics (
  id UUID PRIMARY KEY,
  metric_name VARCHAR(255) NOT NULL,    -- 'total_users', 'active_schools', etc
  metric_value INTEGER DEFAULT 0,
  metric_data JSONB,                    -- Detailed breakdown
  calculated_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Helper Functions

#### `is_superadmin(user_id UUID) -> BOOLEAN`
Checks if a user has the superadmin role.

```sql
SELECT is_superadmin('user-uuid');  -- Returns TRUE/FALSE
```

#### `log_superadmin_action(...)`
Logs a superadmin action to the audit trail.

```sql
SELECT log_superadmin_action(
  superadmin_user_id,
  'action_name',
  'entity_type',
  entity_id,
  details_json,
  ip_address
);
```

### Views for Dashboard

#### `superadmin_entities_summary`
Provides entity counts by type (active/inactive).

#### `superadmin_all_pending_approvals`
Unified view of all pending approvals across both platforms.

#### `superadmin_user_statistics`
User statistics broken down by platform and role.

## Backend API Endpoints

All endpoints require superadmin authentication via JWT token.

### Base Path: `/api/auth/superadmin`

#### 1. Get Dashboard Statistics
```
GET /dashboard-stats
Response:
{
  stats: {
    total_schools: 2,
    active_schools: 2,
    total_corporates: 2,
    active_corporates: 2,
    total_users: 150,
    active_users: 145,
    pending_school_approvals: 3,
    pending_corporate_approvals: 2
  }
}
```

#### 2. Get All Entities
```
GET /entities
Response:
{
  schools: [
    {
      id: "uuid",
      name: "Primary University",
      code: "PU-001",
      email: "admin@university.edu",
      is_active: true,
      user_count: 75,
      pending_approvals: 1
    }
  ],
  corporates: [
    {
      id: "uuid",
      name: "Tech Corp Inc",
      code: "TC-001",
      email: "admin@techcorp.com",
      is_active: true,
      user_count: 50,
      pending_approvals: 2
    }
  ]
}
```

#### 3. Get All Pending Approvals
```
GET /pending-approvals
Response:
{
  approvals: [
    {
      id: "uuid",
      entity_type: "school",
      entity_name: "Primary University",
      user_name: "John Faculty",
      user_email: "john@university.edu",
      role: "faculty",
      requested_at: "2026-02-01T10:30:00Z"
    }
  ],
  count: 5
}
```

#### 4. Get Action Logs
```
GET /action-logs?limit=100&offset=0
Response:
{
  logs: [
    {
      id: "uuid",
      action: "view_dashboard_stats",
      entity_type: null,
      entity_id: null,
      details: null,
      created_at: "2026-02-01T10:30:00Z"
    }
  ],
  total: 150,
  limit: 100,
  offset: 0
}
```

#### 5. Get User Statistics
```
GET /user-statistics
Response:
{
  stats: [
    {
      platform_name: "school",
      total_users: 100,
      active_users: 95,
      admin_count: 2,
      student_count: 80,
      faculty_count: 15,
      employee_count: 0,
      it_count: 3,
      hr_count: 0
    },
    {
      platform_name: "corporate",
      total_users: 50,
      active_users: 48,
      admin_count: 1,
      student_count: 0,
      faculty_count: 0,
      employee_count: 40,
      it_count: 5,
      hr_count: 4
    }
  ]
}
```

#### 6. Get Entity-Specific Users
```
GET /entity-users?entityType=school&entityId=<uuid>
Response:
{
  users: [
    {
      id: "uuid",
      email: "user@university.edu",
      full_name: "John Doe",
      role: "student",
      status: "active",
      assigned_at: "2026-01-15T10:30:00Z"
    }
  ]
}
```

## Frontend Components

### SuperadminDashboard Component

Located at: `apps/frontend/src/components/SuperadminDashboard.tsx`

**Key Features:**
- Responsive multi-tab interface
- Real-time data refresh
- Interactive charts (Recharts)
- Smooth animations (Framer Motion)
- Error handling and loading states

**Tabs:**
1. **Overview** - Key metrics and visualizations
2. **Entities** - School and corporate entity listings
3. **Approvals** - Centralized approval management table
4. **Users** - User statistics and breakdown by platform
5. **Logs** - Audit trail of superadmin actions

**State Management:**
- Uses React hooks for local state
- Axios for API calls
- JWT token from localStorage for authentication

## Authentication & Authorization

### Superadmin Role

The superadmin role is defined in the `system` platform with comprehensive permissions:

```json
{
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
}
```

### Default Superadmin User

**Created automatically** by migration 004:
- Email: `superadmin@smartattend.local`
- Password: `smartattend123` (should be changed in production)
- Platform: `system`
- Role: `superadmin`

### Authorization Flow

1. **User logs in** to superadmin account
2. **JWT token contains** userId, platformId, roleId
3. **Frontend sends token** in Authorization header
4. **Backend middleware** verifies token and checks `isSuperadmin()`
5. **Access granted** if user has superadmin role in system platform

## Backend Service Functions

Located in: `apps/backend/src/auth/authService.ts`

### `isSuperadmin(userId: string): Promise<boolean>`
Verifies if a user is a superadmin.

### `getSuperadminDashboardStats(superadminUserId: string)`
Returns key platform statistics.

### `getSuperadminAllEntities(superadminUserId: string)`
Returns all schools and corporate entities with user counts.

### `getSuperadminAllPendingApprovals(superadminUserId: string)`
Returns all pending approvals across platforms, sorted by date.

### `getSuperadminActionLogs(superadminUserId: string, limit: number, offset: number)`
Returns paginated action logs.

### `logSuperadminAction(...)`
Logs a superadmin action for audit trail.

### `getSuperadminUserStatistics(superadminUserId: string)`
Returns user statistics broken down by platform.

### `getSuperadminEntityUsers(superadminUserId: string, entityType: 'school' | 'corporate', entityId: string)`
Returns all users in a specific entity.

## API Middleware

### `verifySuperadmin` Middleware

Protects all superadmin endpoints. Checks:
1. User is authenticated (has valid JWT)
2. User is a superadmin (has superadmin role)
3. Returns 403 if not authorized

```typescript
const verifySuperadmin = async (req: Request, res: Response, next: Function) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
  const superAdminCheck = await isSuperadmin(req.user.userId)
  if (!superAdminCheck) return res.status(403).json({ error: 'Superadmin access required' })
  next()
}
```

## Audit & Logging

### What Gets Logged

Every superadmin action is logged with:
- **User ID** - Who performed the action
- **Action** - What they did (view_dashboard_stats, etc)
- **Entity Type & ID** - What they acted upon
- **Details** - Additional metadata (JSON)
- **IP Address** - Where the request came from
- **Timestamp** - When it happened

### Viewing Logs

Access via the **Logs tab** in the superadmin dashboard, or via API:
```
GET /api/auth/superadmin/action-logs
```

## Accessing Superadmin Dashboard

### In Frontend

1. **Log in** with superadmin credentials
2. **Navigate to** `/superadmin` route
3. **Dashboard loads** with real-time data

### Default Credentials (Change Immediately in Production!)

```
Email: superadmin@smartattend.local
Password: smartattend123
```

## Data Isolation & Security

### Key Security Features

1. **Role-Based Access**: Only superadmin role can access
2. **Token-Based Auth**: JWT tokens with 24-hour expiry
3. **Audit Logging**: All actions logged for compliance
4. **Query-Level Isolation**: Database views ensure data separation
5. **Entity-Level Scoping**: Users can only see their entity's data

### Data Visibility

- **Superadmin**: Can see all data across all platforms and entities
- **Entity Admin**: Can see only their entity's data
- **Users**: Can see only their own data

## Monitoring & Maintenance

### Regular Tasks

1. **Monitor Pending Approvals**: Check the Approvals tab regularly
2. **Review Audit Logs**: Periodically review superadmin_action_logs
3. **Check User Statistics**: Monitor growth and activity trends
4. **Verify Entity Status**: Ensure all entities are active/maintained

### Performance Considerations

1. **Caching**: Dashboard stats could be cached for 5-10 minutes
2. **Pagination**: Audit logs support pagination for large datasets
3. **Indexes**: Database indexes on frequently queried columns
4. **Views**: SQL views optimize complex queries

## Troubleshooting

### Common Issues

**Problem**: "Superadmin access required" error
- **Solution**: Verify user has superadmin role in system platform

**Problem**: Dashboard shows no data
- **Solution**: Check API endpoints are responding (Network tab)
- **Solution**: Verify JWT token is valid (check localStorage)

**Problem**: Pending approvals not showing
- **Solution**: Check school_user_approvals and corporate_user_approvals tables
- **Solution**: Verify approval status is 'pending'

## Future Enhancements

1. **Advanced Filtering**: Filter entities by status, creation date, etc
2. **Export Functionality**: Export statistics and logs to CSV/PDF
3. **Real-time Notifications**: WebSocket updates for new approvals
4. **Approval Delegation**: Assign approvals to entity admins
5. **Custom Reports**: Create custom analytics dashboards
6. **Two-Factor Auth**: Additional security for superadmin accounts
7. **Superadmin Permissions Management**: Fine-grained permission control
8. **Bulk Operations**: Bulk approve/reject multiple requests

## Migration Details

### Migration 004: `004_superadmin_system.sql`

Creates:
- System platform (if not exists)
- Superadmin role with permissions
- Audit logging tables
- Helper functions and views
- Default superadmin user (email: superadmin@smartattend.local)

Run: `npm run migrate` (when migration system is set up)

## Integration Points

### With Existing Systems

1. **Authentication**: Uses same JWT/bcrypt as role-based system
2. **Database**: References existing users, roles, platforms
3. **Entities**: Monitors school_entities and corporate_entities
4. **Approvals**: Tracks school_user_approvals and corporate_user_approvals
5. **Users**: Manages users across all platforms

### API Base URL

Development: `http://localhost:3001/api`
Production: Configure via environment variables

## Environment Variables

```bash
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
REFRESH_TOKEN_SECRET=your_super_secret_refresh_token_key
DATABASE_URL=postgresql://user:password@localhost:5432/smartattend
```

## Testing the Superadmin System

### Manual Testing Steps

1. **Login as Superadmin**
   - Go to `/login`
   - Use `superadmin@smartattend.local` / `smartattend123`
   - Navigate to `/superadmin`

2. **Test Overview Tab**
   - Verify stats display correctly
   - Check charts render

3. **Test Entities Tab**
   - Verify schools and corporates listed
   - Check user counts are accurate

4. **Test Approvals Tab**
   - Create some pending approvals
   - Verify they appear in the list

5. **Test Users Tab**
   - Verify platform statistics
   - Check role breakdowns

6. **Test Logs Tab**
   - Perform actions in the dashboard
   - Verify logs appear with timestamps

## Support & Documentation

For questions or issues:
1. Check the troubleshooting section
2. Review API response codes and error messages
3. Check browser console for client-side errors
4. Check server logs for backend errors
5. Review database audit_logs table

---

**Last Updated**: February 1, 2026
**Version**: 1.0.0
**Status**: Production Ready
