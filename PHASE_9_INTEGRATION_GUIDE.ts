/**
 * PHASE 9 - API SERVICE & ROUTING SCAFFOLDING GUIDE
 * 
 * Complete integration reference for Phase 9 Frontend Components
 * 
 * This document explains:
 * 1. API Service Layer Architecture
 * 2. Zustand Store Setup
 * 3. Component Integration Pattern
 * 4. Role-Based Routing
 * 5. Error Handling & Loading States
 */

// ============================================================================
// PART 1: API SERVICE LAYER
// ============================================================================

/**
 * Location: apps/frontend/src/services/
 * 
 * Services Created:
 * - authService.ts          Main authentication & user management
 * - superadminService.ts    System diagnostics, tenant mgmt, audit
 * - adminService.ts         User/course CRUD, approvals, analytics
 * - facultyService.ts       Roster, attendance marking, reporting
 * - attendanceService.ts    Self-service metrics & discrepancies
 * - hrService.ts            Organization-wide analytics & campaigns
 * 
 * Base Configuration:
 * - axiosClient.ts          Pre-configured Axios with interceptors
 *                            - Auto-injects Bearer token
 *                            - Handles 401/403 responses
 *                            - Dev logging
 * 
 * Usage Pattern:
 * ```
 * import superadminService from '../services/superadminService';
 * 
 * const diagnostics = await superadminService.getSystemDiagnostics();
 * const tenants = await superadminService.listTenants();
 * await superadminService.createTenant({ name: 'School A', type: 'SCHOOL' });
 * ```
 */

// ============================================================================
// PART 2: ZUSTAND STATE MANAGEMENT
// ============================================================================

/**
 * Location: apps/frontend/src/store/
 * 
 * Stores Created:
 * - authStore.ts            Current user, authentication, role/permission checks
 * - superadminStore.ts      Diagnostics, tenants, locked users, audit
 * - adminStore.ts           Users, courses, approvals, analytics
 * - facultyStore.ts         Courses, roster, attendance draft, reporting
 * - attendanceStore.ts      Profile, metrics, courses, discrepancies (+ HR endpoints)
 * - hrStore.ts              Overview, members, patterns, campaigns
 * 
 * Design Pattern:
 * - Each store = 1 role's operational domain
 * - Auto-loading on fetch() calls
 * - Error states for UI feedback
 * - Actions trigger dependent data refreshes
 * 
 * Usage Pattern:
 * ```
 * import { useSuperadminStore } from '../store/superadminStore';
 * 
 * export const SystemDashboard = () => {
 *   const { diagnostics, isLoading, error, fetchDiagnostics } = useSuperadminStore();
 *   
 *   useEffect(() => {
 *     fetchDiagnostics();
 *   }, [fetchDiagnostics]);
 *   
 *   if (isLoading) return <LoadingSpinner />;
 *   if (error) return <ErrorAlert message={error} />;
 *   
 *   return (
 *     <div>
 *       <h1>System Health</h1>
 *       <p>DB Response: {diagnostics.database_health.response_time_ms}ms</p>
 *     </div>
 *   );
 * };
 * ```
 */

// ============================================================================
// PART 3: COMPONENT INTEGRATION PATTERN
// ============================================================================

export const COMPONENT_INTEGRATION_EXAMPLE = `
import React, { useEffect } from 'react';
import { useSuperadminStore } from '../store/superadminStore';
import { SystemHealthPanel } from '../PHASE_9_SUPERADMIN_CONSOLE';

export const SuperadminPage = () => {
  // 1. Get store state & actions
  const {
    diagnostics,
    tenants,
    isLoading,
    error,
    fetchDiagnostics,
    fetchTenants,
    createTenant
  } = useSuperadminStore();

  // 2. Fetch data on mount
  useEffect(() => {
    fetchDiagnostics();
    fetchTenants();
  }, [fetchDiagnostics, fetchTenants]);

  // 3. Handle user actions
  const handleCreateTenant = async (name, type) => {
    try {
      await createTenant(name, type);
      // Success - store auto-refreshes & re-renders
    } catch (err) {
      console.error('Failed to create tenant:', err);
    }
  };

  // 4. Render with loading/error states
  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorAlert message={error} />;
  
  return (
    <div>
      <SystemHealthPanel diagnostics={diagnostics} />
      {/* Pass tenants, handlers, etc to components */}
    </div>
  );
};
`;

// ============================================================================
// PART 4: ROLE-BASED ROUTING
// ============================================================================

/**
 * Location: apps/frontend/src/App.tsx (Updated)
 * 
 * Routing Structure:
 * /login           → Login page (public)
 * /dashboard       → Default dashboard (legacy, protected)
 * /admin/*         → Admin dashboard (role-gated: ADMIN)
 * /faculty/*       → Faculty panel (role-gated: FACULTY)
 * /hr/*            → HR analytics (role-gated: HR)
 * /student/*       → Student/Employee view (role-gated: STUDENT|EMPLOYEE)
 * /superadmin/*    → Superadmin console (role-gated: SUPERADMIN)
 * 
 * Components:
 * - ProtectedRoute (checks authentication)
 * - RoleRoute (checks specific role)
 * - PermissionRoute (checks permission)
 * 
 * Usage in App.tsx:
 * ```
 * <Route
 *   path="/admin/*"
 *   element={
 *     <ProtectedRoute>
 *       <RoleRoute requiredRole="ADMIN">
 *         <AdminTenantPanel />
 *       </RoleRoute>
 *     </ProtectedRoute>
 *   }
 * />
 * ```
 */

// ============================================================================
// PART 5: ERROR HANDLING & LOADING STATES
// ============================================================================

export const ERROR_HANDLING_EXAMPLE = `
import { useSuperadminStore } from '../store/superadminStore';

export const TenantList = () => {
  const { tenants, isLoading, error, clearError } = useSuperadminStore();

  return (
    <div>
      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500 rounded p-4 mb-4">
          <p className="text-red-400">{error}</p>
          <button onClick={clearError} className="text-red-300 hover:text-red-200 mt-2">
            Dismiss
          </button>
        </div>
      )}

      {/* Success State */}
      {!isLoading && !error && (
        <div>
          {tenants.map(tenant => (
            <div key={tenant.id} className="p-4 border rounded mb-2">
              <h3>{tenant.name}</h3>
              <p className="text-sm text-slate-400">{tenant.type}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
`;

// ============================================================================
// PART 6: INTEGRATION CHECKLIST
// ============================================================================

export const INTEGRATION_CHECKLIST = {
  'API Services': [
    '✅ axiosClient.ts - Base HTTP client with interceptors',
    '✅ authService.ts - Login, logout, token management',
    '✅ superadminService.ts - Diagnostics, tenants, audit',
    '✅ adminService.ts - User/course CRUD, approvals',
    '✅ facultyService.ts - Roster, marking, reporting',
    '✅ attendanceService.ts - Self-service metrics',
    '✅ hrService.ts - Organization analytics'
  ],
  
  'Zustand Stores': [
    '✅ authStore.ts - Authentication state',
    '✅ superadminStore.ts - Superadmin operations',
    '✅ adminStore.ts - Admin tenant operations',
    '✅ facultyStore.ts - Faculty attendance workflow',
    '✅ attendanceStore.ts - Student/Employee self-service',
    '✅ hrStore.ts - HR organization-wide analytics'
  ],

  'Routing': [
    '✅ RoleRoute.tsx - Role-based route guarding',
    '✅ App.tsx updated - Complete role-based routing structure',
    '✅ /admin, /faculty, /hr, /student routes ready',
    '✅ 403 Unauthorized page'
  ],

  'Ready for Integration': [
    '⏳ Mount PHASE_9_SUPERADMIN_CONSOLE.tsx → /superadmin route',
    '⏳ Mount PHASE_9_ADMIN_TENANT_PANEL.tsx → /admin route',
    '⏳ Mount PHASE_9_FACULTY_ATTENDANCE_PANEL.tsx → /faculty route',
    '⏳ Mount PHASE_9_STUDENT_EMPLOYEE_VIEW.tsx → /student route',
    '⏳ Mount PHASE_9_HR_ANALYTICS_PANEL.tsx → /hr route',
    '⏳ Wire each component to its Zustand store',
    '⏳ Add form validation & error handling',
    '⏳ Implement real camera access (facial recognition + QR)',
    '⏳ Add PDF/XLSX/CSV export',
    '⏳ Real-time polling for updates (30-60s intervals)'
  ]
};

// ============================================================================
// PART 7: NEXT STEPS
// ============================================================================

export const NEXT_STEPS = `
=== PHASE 9B: COMPONENT INTEGRATION ===

1. CREATE PAGE WRAPPERS (5 files)
   - apps/frontend/src/pages/SuperadminConsolePage.tsx
   - apps/frontend/src/pages/AdminTenantPanelPage.tsx
   - apps/frontend/src/pages/FacultyAttendancePanelPage.tsx
   - apps/frontend/src/pages/StudentEmployeeViewPage.tsx
   - apps/frontend/src/pages/HRAnalyticsPanelPage.tsx
   
   Each wrapper should:
   - Import component from PHASE_9_*.tsx
   - Use Zustand store (e.g., useSuperadminStore)
   - Handle loading/error states
   - Pass store data to component

2. IMPORT PAGES INTO APP.TSX
   - Uncomment imports in App.tsx
   - Mount routes to page wrappers
   - Test role-based access control

3. VALIDATION & ERROR HANDLING
   - Add form validation (zod/yup)
   - Implement field-level error display
   - Add loading spinners
   - Implement retry logic for failed requests

4. REAL CAMERA INTEGRATION
   - QR Code: Install qr-scanner library
   - Facial Recognition: Install face-api.js or mediapipe
   - Camera permissions handling
   - Image capture & server submission

5. EXPORT FUNCTIONALITY
   - PDF: Install pdfkit or html2pdf
   - XLSX: Install xlsx library
   - CSV: Generate from JSON data
   - Add file download triggers

6. REAL-TIME UPDATES
   - Implement polling (30-60s intervals)
   - WebSocket (optional for real-time incidents)
   - Conflict resolution
   - Stale data indicators

7. TESTING
   - Unit tests for stores
   - Integration tests for workflows
   - E2E tests for role scenarios
   - Load testing for concurrent users

8. PRODUCTION DEPLOYMENT
   - Environment configuration (.env)
   - Build optimization
   - Error tracking (Sentry)
   - Performance monitoring
`;

export default COMPONENT_INTEGRATION_EXAMPLE;
