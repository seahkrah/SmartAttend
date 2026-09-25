# Superadmin Flow - Complete Frontend Implementation

## Routes Setup

### Authentication Routes
- **`/login`** - Regular user/admin login
- **`/login-superadmin`** - Superadmin login (NEW)
- **`/register`** - User registration
- **`/register-superadmin`** - Superadmin registration

### Protected Routes
- **`/dashboard`** - Regular user dashboard (protected)
- **`/superadmin`** - Superadmin control panel (protected)

---

## Complete Superadmin Flow

### 1. First Time Setup
```
1. Visit http://localhost:3000/register-superadmin
2. Fill form: Full Name, Email, Password
3. Click "Create Superadmin Account"
4. Get redirected to /login
```

### 2. Login
```
1. Visit http://localhost:3000/login-superadmin
2. Enter email & password
3. Click "Sign In as Superadmin"
4. Tokens stored in localStorage
5. Redirected to /superadmin dashboard
```

### 3. Dashboard
```
1. View all system stats
2. Manage tenants
3. Manage roles/users
4. View incidents
5. Access audit logs
```

---

## Files Created/Modified

### New Files
- **[SuperadminLoginPage.tsx](apps/frontend/src/pages/SuperadminLoginPage.tsx)** - Login component

### Modified Files
- **[App.tsx](apps/frontend/src/App.tsx)** - Added import + route

---

## Component Structure

### SuperadminLoginPage
```typescript
- Email input
- Password input (with visibility toggle)
- Error display
- Loading state
- Submit handler:
  * Validates fields
  * Calls POST /api/auth/login-superadmin
  * Stores tokens in localStorage
  * Updates auth store
  * Redirects to /superadmin
- Links to register & regular login
```

---

## Next Steps

1. **Frontend Build & Test**
   - Run `npm run dev` in apps/frontend
   - Navigate to http://localhost:3000/login-superadmin
   - Test login flow

2. **Backend Verification**
   - Ensure backend is running on port 5000
   - Verify `/api/auth/login-superadmin` endpoint responds

3. **End-to-End Flow**
   - Register superadmin at `/register-superadmin`
   - Login at `/login-superadmin`
   - Verify redirect to `/superadmin` dashboard

---

## API Integration

The SuperadminLoginPage calls:
```
POST /api/auth/login-superadmin
Body: { email, password }
Returns: { accessToken, refreshToken, user }
```

Token usage:
```typescript
// Stored in localStorage
localStorage.setItem('accessToken', token)
localStorage.setItem('refreshToken', refreshToken)

// Used in subsequent requests
headers: {
  'Authorization': `Bearer ${accessToken}`
}
```

---

## Security Notes

- Tokens stored in localStorage (consider HTTPOnly cookies for production)
- MFA not yet implemented (add to backend)
- Short session lifetime (24h access, 7d refresh from backend)
- All superadmin actions logged server-side
- Rate limiting on login attempts (server-side)

