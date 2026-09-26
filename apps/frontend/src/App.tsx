import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';

// Pages
import HomeRedirect from './components/routing/HomeRedirect';

// Superadmin Pages

// Phase 9 Page Wrappers (with HIERARCHY tokens + error/loading states)

// Faculty Portal Pages

// Student Portal Pages

// School Admin Pages

// Parent portal

// Corporate Admin Pages

// Components
import { RoleRoute, ProtectedRoute } from './components/routing/RoleRoute';
import { AppShell } from './components/shell/AppShell';
import { ToastContainer } from './components/Toast';
import { DarkSurface } from './theme/DarkSurface';

// Store
import { useAuthStore } from './store/authStore';

// Every page is loaded on demand: a visitor downloads the shell and the pages they open,
// not all of them. See docs/CHANGE_NOTES.md (foundation step 3).
const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const SuperadminRegisterPage = lazy(() => import('./pages/SuperadminRegisterPage').then((m) => ({ default: m.SuperadminRegisterPage })));
const SuperadminLoginPage = lazy(() => import('./pages/SuperadminLoginPage').then((m) => ({ default: m.SuperadminLoginPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage').then((m) => ({ default: m.SetPasswordPage })));
const TenantIncidentsPage = lazy(() => import('./pages/TenantIncidentsPage'));
const SchoolAdminDepartmentsPage = lazy(() => import('./pages/SchoolAdminDepartmentsPage'));
const SchoolAdminResultsPage = lazy(() => import('./pages/SchoolAdminResultsPage'));
const IncidentDetailPage = lazy(() => import('./pages/IncidentDetailPage'));
const SuperadminConsolePage = lazy(() => import('./pages/SuperadminConsolePage'));
const SuperadminDashboardPage = lazy(() => import('./pages/SuperadminDashboardPage'));
const SuperadminIncidentsPage = lazy(() => import('./pages/SuperadminIncidentsPage'));
const SuperadminManagementPage = lazy(() => import('./pages/SuperadminManagementPage'));
const SuperadminAdminsPage = lazy(() => import('./pages/SuperadminAdminsPage'));
const SuperadminAuditLogsPage = lazy(() => import('./pages/SuperadminAuditLogsPage'));
const SuperadminSettingsPage = lazy(() => import('./pages/SuperadminSettingsPage'));
const SuperadminAccessRequestsPage = lazy(() => import('./pages/SuperadminAccessRequestsPage'));
const AdminTenantPanelPage = lazy(() => import('./pages/AdminTenantPanelPage'));
const FacultyAttendanceWorkflowPage = lazy(() => import('./pages/FacultyAttendanceWorkflowPage'));
const HRTodayPage = lazy(() => import('./pages/HRTodayPage'));
const HRAnalyticsPanelPage = lazy(() => import('./pages/HRAnalyticsPanelPage').then((m) => ({ default: m.HRAnalyticsPanelPage })));
const FacultyDashboardPage = lazy(() => import('./pages/FacultyDashboardPage'));
const FacultyStudentsPage = lazy(() => import('./pages/FacultyStudentsPage'));
const FacultyCoursesPage = lazy(() => import('./pages/FacultyCoursesPage'));
const FacultyEnrollmentPage = lazy(() => import('./pages/FacultyEnrollmentPage'));
const FacultySchedulesPage = lazy(() => import('./pages/FacultySchedulesPage'));
const FacultyReportsPage = lazy(() => import('./pages/FacultyReportsPage'));
const FacultySettingsPage = lazy(() => import('./pages/FacultySettingsPage'));
const StudentDashboardPage = lazy(() => import('./pages/StudentDashboardPage'));
const StudentCoursesPage = lazy(() => import('./pages/StudentCoursesPage'));
const StudentAttendancePage = lazy(() => import('./pages/StudentAttendancePage'));
const StudentSchedulePage = lazy(() => import('./pages/StudentSchedulePage'));
const StudentSettingsPage = lazy(() => import('./pages/StudentSettingsPage'));
const SchoolAdminDashboardPage = lazy(() => import('./pages/SchoolAdminDashboardPage'));
const FaceMatchingAdminPage = lazy(() => import('./pages/FaceMatchingAdminPage'));
const SchoolAdminUsersPage = lazy(() => import('./pages/SchoolAdminUsersPage'));
const SchoolAdminApprovalsPage = lazy(() => import('./pages/SchoolAdminApprovalsPage'));
const SchoolAdminSettingsPage = lazy(() => import('./pages/SchoolAdminSettingsPage'));
const SchoolAdminStudentsPage = lazy(() => import('./pages/SchoolAdminStudentsPage'));
const SchoolAdminFacultyPage = lazy(() => import('./pages/SchoolAdminFacultyPage'));
const SchoolAdminCoursesPage = lazy(() => import('./pages/SchoolAdminCoursesPage'));
const SchoolAdminProgrammesPage = lazy(() => import('./pages/SchoolAdminProgrammesPage'));
const SchoolAdminAdmissionsPage = lazy(() => import('./pages/SchoolAdminAdmissionsPage'));
const SchoolAdminFinancePage = lazy(() => import('./pages/SchoolAdminFinancePage'));
const AdminNotificationsPage = lazy(() => import('./pages/AdminNotificationsPage'));
const FacultyGradebookPage = lazy(() => import('./pages/FacultyGradebookPage'));
const StudentResultsPage = lazy(() => import('./pages/StudentResultsPage'));
const StudentFeesPage = lazy(() => import('./pages/StudentFeesPage'));
const EmployeeLeavePage = lazy(() => import('./pages/EmployeeLeavePage'));
const HRLeavePage = lazy(() => import('./pages/HRLeavePage'));
const HRPayrollPage = lazy(() => import('./pages/HRPayrollPage'));
const HRContractsPage = lazy(() => import('./pages/HRContractsPage'));
const HRRosterPage = lazy(() => import('./pages/HRRosterPage'));
const HRTimesheetsPage = lazy(() => import('./pages/HRTimesheetsPage'));
const EmployeeWorkPage = lazy(() => import('./pages/EmployeeWorkPage'));
const EmployeeSelfServiceAttendancePage = lazy(() => import('./pages/EmployeeSelfServiceAttendancePage'));
const EmployeePayslipsPage = lazy(() => import('./pages/EmployeePayslipsPage'));
const SchoolAdminRoomsPage = lazy(() => import('./pages/SchoolAdminRoomsPage'));
const SchoolAdminSchedulesPage = lazy(() => import('./pages/SchoolAdminSchedulesPage'));
const SchoolAdminEnrollmentPage = lazy(() => import('./pages/SchoolAdminEnrollmentPage'));
const SchoolAdminAttendancePage = lazy(() => import('./pages/SchoolAdminAttendancePage'));
const SchoolAdminReportsPage = lazy(() => import('./pages/SchoolAdminReportsPage'));
const SchoolAdminGuardiansPage = lazy(() => import('./pages/SchoolAdminGuardiansPage'));
const GuardianHomePage = lazy(() => import('./pages/GuardianHomePage'));
const AccountSecurityPage = lazy(() => import('./pages/AccountSecurityPage'));
const GuardianChildPage = lazy(() => import('./pages/GuardianChildPage'));
const CorporateAdminDashboardPage = lazy(() => import('./pages/CorporateAdminDashboardPage'));
const CorporateAdminUsersPage = lazy(() => import('./pages/CorporateAdminUsersPage'));
const CorporateAdminApprovalsPage = lazy(() => import('./pages/CorporateAdminApprovalsPage'));
const CorporateAdminSettingsPage = lazy(() => import('./pages/CorporateAdminSettingsPage'));
const CorporateAdminDepartmentsPage = lazy(() => import('./pages/CorporateAdminDepartmentsPage'));
const CorporateAdminAttendancePage = lazy(() => import('./pages/CorporateAdminAttendancePage'));
const CorporateAdminReportsPage = lazy(() => import('./pages/CorporateAdminReportsPage'));

export default function App() {
  const loadUserFromToken = useAuthStore((state) => state.loadUserFromToken);
  const user = useAuthStore((state) => state.user);
  // The two actions the API reserves for a director: ending somebody's
  // employment, and spending money by sending hours to payroll.
  const isDirector = user?.role === 'hr_director' || user?.role === 'admin';

  // Load user from stored token on mount
  useEffect(() => {
    console.log('[App] 🚀 useEffect fired on mount, checking if user already loaded...');
    console.log('[App] Current user:', user ? { id: user.id, email: user.email, role: user.role } : null);
    
    // Only load if we don't already have a user
    if (!user) {
      console.log('[App] 📥 No user in store, calling loadUserFromToken()');
      loadUserFromToken();
    } else {
      console.log('[App] ✅ User already in store, skipping load');
    }
  }, []); // Empty array - only run once on mount

  return (
    <Router>
      <ToastContainer />
      <Suspense fallback={<div className="min-h-screen bg-page" aria-busy="true" />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<DarkSurface><LandingPage /></DarkSurface>} />
        <Route path="/login" element={<DarkSurface><LoginPage /></DarkSurface>} />
        <Route path="/login-superadmin" element={<DarkSurface><SuperadminLoginPage /></DarkSurface>} />
        <Route path="/register" element={<DarkSurface><RegisterPage /></DarkSurface>} />
        <Route path="/register-superadmin" element={<DarkSurface><SuperadminRegisterPage /></DarkSurface>} />
        <Route path="/change-password" element={<DarkSurface><ChangePasswordPage /></DarkSurface>} />
        <Route path="/forgot-password" element={<DarkSurface><ForgotPasswordPage /></DarkSurface>} />
        <Route path="/reset-password" element={<DarkSurface><SetPasswordPage mode="reset" /></DarkSurface>} />
        <Route path="/activate" element={<DarkSurface><SetPasswordPage mode="activate" /></DarkSurface>} />

        {/* Unauthorized */}
        <Route
          path="/unauthorized"
          element={
            <div className="flex items-center justify-center h-screen bg-card text-primary">
              <div className="text-center">
                <h1 className="text-4xl font-bold mb-4">403</h1>
                <p className="text-xl mb-4">Not Authorized</p>
                <p className="text-secondary mb-6">Your role does not have access to this page.</p>
                <a href="/login" className="text-blue-500 hover:underline">
                  Return to Login
                </a>
              </div>
            </div>
          }
        />

        {/* Superadmin Routes */}
        <Route
          path="/superadmin/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="superadmin">
                <DarkSurface>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<SuperadminConsolePage />} />
                    <Route path="/console" element={<SuperadminConsolePage />} />
                    <Route path="/dashboard" element={<SuperadminDashboardPage />} />
                    <Route path="/incidents" element={<SuperadminIncidentsPage />} />
                    <Route path="/management" element={<SuperadminManagementPage />} />
                    <Route path="/entities" element={<SuperadminManagementPage />} />
                    <Route path="/tenants" element={<SuperadminManagementPage />} />
                    <Route path="/admins" element={<SuperadminAdminsPage />} />
                    <Route path="/access-requests" element={<SuperadminAccessRequestsPage />} />
                    <Route path="/audit" element={<SuperadminAuditLogsPage />} />
                    <Route path="/settings" element={<SuperadminSettingsPage />} />
                    <Route path="/incident/:incidentId" element={<IncidentDetailPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
                </DarkSurface>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* School Admin Routes */}
        <Route
          path="/admin/school/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="admin">
                <AppShell>
                  <Routes>
                    <Route path="/" element={<Navigate to="/admin/school/dashboard" replace />} />
                    <Route path="/dashboard" element={<SchoolAdminDashboardPage />} />
                    <Route path="/users" element={<SchoolAdminUsersPage />} />
                    <Route path="/students" element={<SchoolAdminStudentsPage />} />
                    <Route path="/guardians" element={<SchoolAdminGuardiansPage />} />
                    <Route path="/faculty" element={<SchoolAdminFacultyPage />} />
                    <Route path="/courses" element={<SchoolAdminCoursesPage />} />
                    <Route path="/programmes" element={<SchoolAdminProgrammesPage />} />
                    <Route path="/admissions" element={<SchoolAdminAdmissionsPage />} />
                    <Route path="/finance" element={<SchoolAdminFinancePage />} />
                    <Route path="/departments" element={<SchoolAdminDepartmentsPage />} />
                    <Route path="/results" element={<SchoolAdminResultsPage />} />
                    <Route path="/notifications" element={<AdminNotificationsPage />} />
                    <Route path="/incidents" element={<TenantIncidentsPage />} />
                    <Route path="/rooms" element={<SchoolAdminRoomsPage />} />
                    <Route path="/schedules" element={<SchoolAdminSchedulesPage />} />
                    <Route path="/enrollment" element={<SchoolAdminEnrollmentPage />} />
                    <Route path="/attendance" element={<SchoolAdminAttendancePage />} />
                    <Route path="/face-matching" element={<FaceMatchingAdminPage subjectType="student" />} />
                    <Route path="/reports" element={<SchoolAdminReportsPage />} />
                    <Route path="/approvals" element={<SchoolAdminApprovalsPage />} />
                    <Route path="/settings" element={<SchoolAdminSettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Corporate Admin Routes */}
        <Route
          path="/admin/corporate/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="admin">
                <AppShell>
                  <Routes>
                    <Route path="/" element={<Navigate to="/admin/corporate/dashboard" replace />} />
                    <Route path="/dashboard" element={<CorporateAdminDashboardPage />} />
                    <Route path="/employees" element={<CorporateAdminUsersPage />} />
                    <Route path="/departments" element={<CorporateAdminDepartmentsPage />} />
                    <Route path="/attendance" element={<CorporateAdminAttendancePage />} />
                    <Route path="/reports" element={<CorporateAdminReportsPage />} />
                    <Route path="/approvals" element={<CorporateAdminApprovalsPage />} />
                    <Route path="/notifications" element={<AdminNotificationsPage />} />
                    <Route path="/incidents" element={<TenantIncidentsPage />} />
                    <Route path="/settings" element={<CorporateAdminSettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Legacy Admin Routes (redirect to platform-specific) */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="admin">
                <AppShell>
                  <Routes>
                    <Route path="/" element={<AdminTenantPanelPage />} />
                    <Route path="/dashboard" element={<AdminTenantPanelPage />} />
                    <Route path="/tenants" element={<AdminTenantPanelPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Faculty Routes */}
        <Route
          path="/faculty/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="faculty">
                <AppShell>
                  <Routes>
                    <Route path="/" element={<FacultyDashboardPage />} />
                    <Route path="/students" element={<FacultyStudentsPage />} />
                    <Route path="/courses" element={<FacultyCoursesPage />} />
                    <Route path="/enrollment" element={<FacultyEnrollmentPage />} />
                    <Route path="/attendance" element={<DarkSurface><FacultyAttendanceWorkflowPage /></DarkSurface>} />
                    <Route path="/schedules" element={<FacultySchedulesPage />} />
                    <Route path="/gradebook" element={<FacultyGradebookPage />} />
                    <Route path="/reports" element={<FacultyReportsPage />} />
                    <Route path="/settings" element={<FacultySettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* HR Routes */}
        <Route
          path="/hr/*"
          element={
            <ProtectedRoute>
              {/* Managers are admitted for rosters, timesheets and leave
                  decisions, which the API already permits them; their
                  navigation offers nothing else, and the API refuses the rest
                  regardless. Before this they had no reachable page at all. */}
              <RoleRoute requiredRole={['hr', 'hr_director', 'admin', 'manager']}>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<HRTodayPage />} />
                    <Route path="/analytics" element={<HRAnalyticsPanelPage />} />
                    <Route path="/leave" element={<HRLeavePage />} />
                    <Route path="/face-matching" element={<FaceMatchingAdminPage subjectType="employee" />} />
                    <Route path="/payroll" element={<HRPayrollPage />} />
                    {/* Ending a contract and sending hours to payroll both need a
                        director; the pages withhold those controls rather than
                        offering them and having the API refuse. */}
                    <Route path="/contracts" element={
                      <HRContractsPage canEnd={isDirector} />} />
                    <Route path="/shifts" element={<HRRosterPage />} />
                    {/* HR staff and managers are employees too and check in like
                        anybody; the page resolves the employee from the signed-in
                        identity and says so plainly when there is none. */}
                    <Route path="/check-in" element={<EmployeeSelfServiceAttendancePage />} />
                    <Route path="/timesheets" element={
                      <HRTimesheetsPage canExport={isDirector} />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Student/Employee Routes */}
        <Route
          path="/student/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole={['student', 'employee']}>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<StudentDashboardPage />} />
                    <Route path="/courses" element={<StudentCoursesPage />} />
                    <Route path="/attendance" element={<StudentAttendancePage />} />
                    <Route path="/schedule" element={<StudentSchedulePage />} />
                    <Route path="/results" element={<StudentResultsPage />} />
                    <Route path="/fees" element={<StudentFeesPage />} />
                    <Route path="/leave" element={<EmployeeLeavePage />} />
                    <Route path="/payslips" element={<EmployeePayslipsPage />} />
                    <Route path="/work" element={<EmployeeWorkPage />} />
                    <Route path="/check-in" element={<EmployeeSelfServiceAttendancePage />} />
                    <Route path="/settings" element={<StudentSettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Parent portal: a guardian reads what the school shares about the
            students linked to them. */}
        <Route
          path="/guardian/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="guardian">
                <AppShell>
                  <Routes>
                    <Route path="/" element={<GuardianHomePage />} />
                    <Route path="/children/:studentId" element={<GuardianChildPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Every signed-in person's own account: two-factor sign-in and the
            way to the password change. Reached from the account area of the
            sidebar, and forced for a role that must use two-factor. */}
        <Route
          path="/account/security"
          element={
            <ProtectedRoute>
              <AppShell>
                <AccountSecurityPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Where a signed-in user belongs: their audience's home, or a plain
            statement that their role has none. */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <HomeRedirect />
            </ProtectedRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Router>
  );
}
