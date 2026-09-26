import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';

// Pages
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SuperadminRegisterPage } from './pages/SuperadminRegisterPage';
import { SuperadminLoginPage } from './pages/SuperadminLoginPage';
import HomeRedirect from './components/routing/HomeRedirect';
import NotFoundPage from './pages/NotFoundPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import TenantIncidentsPage from './pages/TenantIncidentsPage';
import SchoolAdminDepartmentsPage from './pages/SchoolAdminDepartmentsPage';
import SchoolAdminResultsPage from './pages/SchoolAdminResultsPage';
import IncidentDetailPage from './pages/IncidentDetailPage';

// Superadmin Pages
import SuperadminConsolePage from './pages/SuperadminConsolePage';
import SuperadminDashboardPage from './pages/SuperadminDashboardPage';
import SuperadminIncidentsPage from './pages/SuperadminIncidentsPage';
import SuperadminManagementPage from './pages/SuperadminManagementPage';
import SuperadminAdminsPage from './pages/SuperadminAdminsPage';
import SuperadminAuditLogsPage from './pages/SuperadminAuditLogsPage';
import SuperadminSettingsPage from './pages/SuperadminSettingsPage';

// Phase 9 Page Wrappers (with HIERARCHY tokens + error/loading states)
import AdminTenantPanelPage from './pages/AdminTenantPanelPage';
import FacultyAttendanceWorkflowPage from './pages/FacultyAttendanceWorkflowPage';
import HRTodayPage from './pages/HRTodayPage';
import { HRAnalyticsPanelPage } from './pages/HRAnalyticsPanelPage';

// Faculty Portal Pages
import FacultyDashboardPage from './pages/FacultyDashboardPage';
import FacultyStudentsPage from './pages/FacultyStudentsPage';
import FacultyCoursesPage from './pages/FacultyCoursesPage';
import FacultyEnrollmentPage from './pages/FacultyEnrollmentPage';
import FacultySchedulesPage from './pages/FacultySchedulesPage';
import FacultyReportsPage from './pages/FacultyReportsPage';
import FacultySettingsPage from './pages/FacultySettingsPage';

// Student Portal Pages
import StudentDashboardPage from './pages/StudentDashboardPage';
import StudentCoursesPage from './pages/StudentCoursesPage';
import StudentAttendancePage from './pages/StudentAttendancePage';
import StudentSchedulePage from './pages/StudentSchedulePage';
import StudentSettingsPage from './pages/StudentSettingsPage';

// School Admin Pages
import SchoolAdminDashboardPage from './pages/SchoolAdminDashboardPage';
import FaceMatchingAdminPage from './pages/FaceMatchingAdminPage';
import SchoolAdminUsersPage from './pages/SchoolAdminUsersPage';
import SchoolAdminApprovalsPage from './pages/SchoolAdminApprovalsPage';
import SchoolAdminSettingsPage from './pages/SchoolAdminSettingsPage';
import SchoolAdminStudentsPage from './pages/SchoolAdminStudentsPage';
import SchoolAdminFacultyPage from './pages/SchoolAdminFacultyPage';
import SchoolAdminCoursesPage from './pages/SchoolAdminCoursesPage';
import SchoolAdminProgrammesPage from './pages/SchoolAdminProgrammesPage';
import SchoolAdminAdmissionsPage from './pages/SchoolAdminAdmissionsPage';
import SchoolAdminFinancePage from './pages/SchoolAdminFinancePage';
import AdminNotificationsPage from './pages/AdminNotificationsPage';
import FacultyGradebookPage from './pages/FacultyGradebookPage';
import StudentResultsPage from './pages/StudentResultsPage';
import StudentFeesPage from './pages/StudentFeesPage';
import EmployeeLeavePage from './pages/EmployeeLeavePage';
import HRLeavePage from './pages/HRLeavePage';
import HRPayrollPage from './pages/HRPayrollPage';
import HRContractsPage from './pages/HRContractsPage';
import HRRosterPage from './pages/HRRosterPage';
import HRTimesheetsPage from './pages/HRTimesheetsPage';
import EmployeeWorkPage from './pages/EmployeeWorkPage';
import EmployeeSelfServiceAttendancePage from './pages/EmployeeSelfServiceAttendancePage';
import EmployeePayslipsPage from './pages/EmployeePayslipsPage';
import SchoolAdminRoomsPage from './pages/SchoolAdminRoomsPage';
import SchoolAdminSchedulesPage from './pages/SchoolAdminSchedulesPage';
import SchoolAdminEnrollmentPage from './pages/SchoolAdminEnrollmentPage';
import SchoolAdminAttendancePage from './pages/SchoolAdminAttendancePage';
import SchoolAdminReportsPage from './pages/SchoolAdminReportsPage';
import SchoolAdminGuardiansPage from './pages/SchoolAdminGuardiansPage';

// Parent portal
import GuardianHomePage from './pages/GuardianHomePage';
import GuardianChildPage from './pages/GuardianChildPage';

// Corporate Admin Pages
import CorporateAdminDashboardPage from './pages/CorporateAdminDashboardPage';
import CorporateAdminUsersPage from './pages/CorporateAdminUsersPage';
import CorporateAdminApprovalsPage from './pages/CorporateAdminApprovalsPage';
import CorporateAdminSettingsPage from './pages/CorporateAdminSettingsPage';
import CorporateAdminDepartmentsPage from './pages/CorporateAdminDepartmentsPage';
import CorporateAdminAttendancePage from './pages/CorporateAdminAttendancePage';
import CorporateAdminReportsPage from './pages/CorporateAdminReportsPage';

// Components
import { RoleRoute, ProtectedRoute } from './components/routing/RoleRoute';
import { AppShell } from './components/shell/AppShell';
import { ToastContainer } from './components/Toast';

// Store
import { useAuthStore } from './store/authStore';

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
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login-superadmin" element={<SuperadminLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register-superadmin" element={<SuperadminRegisterPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
        <Route path="/activate" element={<SetPasswordPage mode="activate" />} />

        {/* Unauthorized */}
        <Route
          path="/unauthorized"
          element={
            <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
              <div className="text-center">
                <h1 className="text-4xl font-bold mb-4">403</h1>
                <p className="text-xl mb-4">Not Authorized</p>
                <p className="text-slate-400 mb-6">Your role does not have access to this page.</p>
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
                    <Route path="/audit" element={<SuperadminAuditLogsPage />} />
                    <Route path="/settings" element={<SuperadminSettingsPage />} />
                    <Route path="/incident/:incidentId" element={<IncidentDetailPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </AppShell>
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
                    <Route path="/attendance" element={<FacultyAttendanceWorkflowPage />} />
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
    </Router>
  );
}
