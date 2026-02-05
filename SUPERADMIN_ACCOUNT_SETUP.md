# Superadmin Account Setup Guide

## Overview

The superadmin account is now independent and not tied to any user platform (school or corporate). It has full system-wide access and can manage all entities and users across the entire platform.

## Creating a Superadmin Account

### Step 1: Navigate to Superadmin Registration
Go to: `http://localhost:3000/register-superadmin`

### Step 2: Fill in the Registration Form
- **Full Name**: Your name (e.g., "System Administrator")
- **Email**: A unique email address (e.g., "admin@smartattend.local")
- **Password**: A strong password (minimum 6 characters)
- **Confirm Password**: Repeat the password

### Step 3: Submit
Click "Create Superadmin Account"

### Step 4: Login
You'll be redirected to the login page. Select any platform (school or corporate) and log in with your superadmin credentials.

## Superadmin Features

Once logged in as a superadmin:

1. **Navigate to Dashboard**: Go to `/dashboard` (normal dashboard)
2. **Access Superadmin Dashboard**: Go to `/superadmin` for full platform oversight
3. **View All Entities**: See all schools and corporate entities
4. **Manage All Users**: View users across all entities
5. **Review Pending Approvals**: See all pending registration approvals
6. **View Audit Logs**: Monitor all system activities
7. **Access Statistics**: Platform-wide analytics and metrics

## API Endpoints

### Register Superadmin
```
POST /api/auth/register-superadmin
Content-Type: application/json

{
  "fullName": "System Administrator",
  "email": "admin@smartattend.local",
  "password": "securePassword123",
  "confirmPassword": "securePassword123"
}
```

Response:
```json
{
  "message": "Superadmin account created successfully",
  "user": {
    "id": "uuid",
    "email": "admin@smartattend.local",
    "fullName": "System Administrator",
    "role": "superadmin"
  }
}
```

### Login (Works the Same for Superadmin)
```
POST /api/auth/login
Content-Type: application/json

{
  "platform": "school",  // Can be any platform
  "email": "admin@smartattend.local",
  "password": "securePassword123"
}
```

Response:
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "admin@smartattend.local",
    "fullName": "System Administrator",
    "platform": "system",
    "role": "superadmin",
    "permissions": [...]
  },
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token"
}
```

## Important Notes

### Platform Selection at Login
- Superadmins can select **any platform** (school or corporate) during login
- The selection doesn't matter - the system recognizes them as superadmin and logs them in
- They will be authenticated against the "system" platform

### Multiple Superadmin Accounts
- You can create multiple superadmin accounts
- Each has full system access
- All superadmin actions are logged in `superadmin_action_logs`

### Security Considerations
1. **Strong Passwords**: Use strong passwords for all superadmin accounts
2. **Email Unique**: Each superadmin must have a unique email
3. **Audit Logging**: All superadmin activities are logged
4. **No Deletion**: Superadmin accounts should be deactivated, not deleted
5. **Access Control**: Only grant superadmin access to trusted administrators

## Troubleshooting

### "Superadmin account already exists"
- A superadmin with that email already exists
- Use a different email or login with existing credentials

### "This email is already registered"
- That email is registered as a regular user
- Use a different email address

### "System platform not configured"
- The system platform hasn't been set up
- Run: `npm run setup-superadmin` in backend directory

### "Superadmin role not configured"
- The superadmin role hasn't been created
- Run: `npm run setup-superadmin` in backend directory

## Database Schema

### Users Table (For Superadmin)
```sql
users {
  id: UUID,
  platform_id: UUID (references system platform),
  email: VARCHAR,
  full_name: VARCHAR,
  role_id: UUID (references superadmin role),
  password_hash: VARCHAR,
  is_active: BOOLEAN,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP
}
```

### Roles Table
```sql
roles {
  id: UUID,
  platform_id: UUID (system platform),
  name: 'superadmin',
  permissions: JSONB [
    'manage_all_entities',
    'manage_all_users',
    'view_all_data',
    ...
  ]
}
```

## Frontend Routes

- **Registration**: `/register-superadmin`
- **Login**: `/login`
- **Dashboard**: `/dashboard`
- **Superadmin Panel**: `/superadmin`

## Backend Setup Commands

```bash
# Set up superadmin system tables and role
npm run setup-superadmin

# Delete existing superadmin user (for testing)
npm run delete-superadmin
```

## API Base URL

- Development: `http://localhost:3001/api`
- Production: Configure via environment variables

## Example Workflow

1. **First Time Setup**:
   ```bash
   npm run setup-superadmin
   ```

2. **Register Superadmin**:
   - Go to `/register-superadmin`
   - Fill in form and submit

3. **Login**:
   - Go to `/login`
   - Select any platform
   - Enter superadmin email and password

4. **Access Dashboard**:
   - Click `/superadmin` in navigation
   - View platform-wide statistics
   - Manage entities and users

## Next Steps

After creating a superadmin account:
1. Change the default password in production
2. Set up additional superadmin accounts if needed
3. Configure backup/disaster recovery procedures
4. Set up monitoring and alerting

---

**Last Updated**: February 1, 2026
**Version**: 1.0.0
**Status**: ✅ Production Ready
