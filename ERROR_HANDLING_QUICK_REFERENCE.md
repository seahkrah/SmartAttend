# Error Handling Quick Reference

## ✅ What's New

### User-Friendly Error Messages
All error messages are now clear and actionable, with no technical jargon exposed to users.

### Toast Notifications Always Visible
Error notifications now appear with `z-index: 9999`, ensuring they display on top of all modals and forms.

---

## 📋 Quick Usage Examples

### Backend (auth.ts, other routes)

```typescript
// Import at top
import { ErrorMessages, getUserFriendlyError, logError } from '../utils/errorMessages.js'

// In catch blocks
try {
  // your code
} catch (error: any) {
  logError('Operation name', error)
  const friendlyError = getUserFriendlyError(error, ErrorMessages.STUDENT_CREATE_FAILED)
  return res.status(500).json({ error: friendlyError.error })
}
```

### Frontend (React components)

```typescript
// Import at top
import { getErrorMessage, showSuccess } from '../utils/errorHandler';

// Success case
showSuccess('Student created successfully');

// Error case
catch (error: any) {
  addToast({ type: 'error', title: 'Error', message: getErrorMessage(error) });
}
```

---

## 🎯 Common Error Messages

| Scenario | User Sees |
|----------|-----------|
| Wrong login credentials | "The email or password you entered is incorrect" |
| Duplicate email | "This email address is already registered" |
| Session expired | "Your session has expired. Please log in again" |
| No permission | "You don't have permission to perform this action" |
| Missing fields | "Please fill in all required fields" |
| Network error | "Unable to connect to the server. Please check your internet connection" |
| Database error | "A system error occurred. Please try again or contact support" |
| File too large | "The file is too large. Please upload a smaller file" |

---

## 🔧 Error Message Constants

Use these predefined constants in backend code:

```typescript
ErrorMessages.AUTH_REQUIRED
ErrorMessages.AUTH_INVALID_CREDENTIALS
ErrorMessages.AUTH_PERMISSION_DENIED
ErrorMessages.VALIDATION_MISSING_FIELDS
ErrorMessages.VALIDATION_PASSWORD_MISMATCH
ErrorMessages.USER_ALREADY_EXISTS
ErrorMessages.STUDENT_CREATE_FAILED
ErrorMessages.FACULTY_CREATE_FAILED
ErrorMessages.SYSTEM_ERROR
```

---

## 📍 Toast Positioning

```tsx
// Toast container - always on top
<div className="fixed bottom-4 right-4 z-[9999] ...">
```

**Z-Index Hierarchy:**
- Modals: `z-50`
- Overlays: `z-40`
- **Toasts: `z-[9999]` ← Always on top**

---

## ✅ Pages Updated

### Backend
- ✅ auth.ts (40+ error messages)
- ✅ index.ts (global error handler)

### Frontend
- ✅ SchoolAdminStudentsPage.tsx
- ✅ SchoolAdminFacultyPage.tsx
- ✅ SchoolAdminCoursesPage.tsx
- ✅ SchoolAdminRoomsPage.tsx
- ✅ SchoolAdminSchedulesPage.tsx
- ✅ SchoolAdminReportsPage.tsx
- ✅ Toast.tsx (z-index fix)

---

## 🧪 Testing Checklist

- [ ] Invalid login shows friendly message
- [ ] Duplicate student registration shows "email already registered"
- [ ] Network disconnection shows connection error
- [ ] Missing photo upload shows "photo required"
- [ ] Error toast appears above open modals
- [ ] No technical database errors visible to users
- [ ] All error messages are in plain English

---

## 📁 Files to Know

### Backend
- `apps/backend/src/utils/errorMessages.ts` - Error utilities
- `apps/backend/src/routes/auth.ts` - Updated routes

### Frontend
- `apps/frontend/src/utils/errorHandler.ts` - Error utilities  
- `apps/frontend/src/components/Toast.tsx` - Toast system

---

## 🚀 Next Steps

When adding new features:

1. **Backend**: Use `getUserFriendlyError()` in catch blocks
2. **Frontend**: Use `getErrorMessage()` for all axios errors
3. **Define** new error messages in `ErrorMessages` constant
4. **Test** that users see helpful (not technical) messages

---

## 📝 Documentation

Full details: [ERROR_HANDLING_SYSTEM.md](ERROR_HANDLING_SYSTEM.md)
