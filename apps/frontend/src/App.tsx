import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';

// Pages
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SuperadminRegisterPage } from './pages/SuperadminRegisterPage';
import { SuperadminLoginPage } from './pages/SuperadminLoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import IncidentDetailPage from './pages/IncidentDetailPage';

// Superadmin Pages
import SuperadminConsolePage from './pages/SuperadminConsolePage';
import SuperadminDashboardPage from './pages/SuperadminDashboardPage';
import SuperadminAnalyticsPage from './pages/SuperadminAnalyticsPage';
import SuperadminManagementPage from './pages/SuperadminManagementPage';
import SuperadminAdminsPage from './pages/SuperadminAdminsPage';
import SuperadminAuditLogsPage from './pages/SuperadminAuditLogsPage';
import SuperadminSettingsPage from './pages/SuperadminSettingsPage';

// Phase 9 Page Wrappers (with HIERARCHY tokens + error/loading states)
import AdminTenantPanelPage from './pages/AdminTenantPanelPage';
import FacultyAttendanceWorkflowPage from './pages/FacultyAttendanceWorkflowPage';
import HREmployeeAttendanceDashboard from './pages/HREmployeeAttendanceDashboard';

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
import SchoolAdminUsersPage from './pages/SchoolAdminUsersPage';
import SchoolAdminApprovalsPage from './pages/SchoolAdminApprovalsPage';
import SchoolAdminSettingsPage from './pages/SchoolAdminSettingsPage';
import SchoolAdminStudentsPage from './pages/SchoolAdminStudentsPage';
import SchoolAdminFacultyPage from './pages/SchoolAdminFacultyPage';
import SchoolAdminCoursesPage from './pages/SchoolAdminCoursesPage';
import SchoolAdminRoomsPage from './pages/SchoolAdminRoomsPage';
import SchoolAdminSchedulesPage from './pages/SchoolAdminSchedulesPage';
import SchoolAdminEnrollmentPage from './pages/SchoolAdminEnrollmentPage';
import SchoolAdminAttendancePage from './pages/SchoolAdminAttendancePage';
import SchoolAdminReportsPage from './pages/SchoolAdminReportsPage';

// Corporate Admin Pages
import CorporateAdminDashboardPage from './pages/CorporateAdminDashboardPage';
import CorporateAdminUsersPage from './pages/CorporateAdminUsersPage';
import CorporateAdminApprovalsPage from './pages/CorporateAdminApprovalsPage';
import CorporateAdminSettingsPage from './pages/CorporateAdminSettingsPage';

// Components
import { RoleRoute, ProtectedRoute } from './components/routing/RoleRoute';
import { ToastContainer } from './components/Toast';

// Store
import { useAuthStore } from './store/authStore';

export default function App() {
  const loadUserFromToken = useAuthStore((state) => state.loadUserFromToken);
  const user = useAuthStore((state) => state.user);

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
                <Routes>
                  <Route path="/" element={<SuperadminConsolePage />} />
                  <Route path="/console" element={<SuperadminConsolePage />} />
                  <Route path="/dashboard" element={<SuperadminDashboardPage />} />
                  <Route path="/analytics" element={<SuperadminAnalyticsPage />} />
                  <Route path="/management" element={<SuperadminManagementPage />} />
                  <Route path="/entities" element={<SuperadminManagementPage />} />
                  <Route path="/tenants" element={<SuperadminManagementPage />} />
                  <Route path="/admins" element={<SuperadminAdminsPage />} />
                  <Route path="/audit" element={<SuperadminAuditLogsPage />} />
                  <Route path="/settings" element={<SuperadminSettingsPage />} />
                  <Route path="/incident/:incidentId" element={<IncidentDetailPage />} />
                </Routes>
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
                <Routes>
                  <Route path="/" element={<Navigate to="/admin/school/dashboard" replace />} />
                  <Route path="/dashboard" element={<SchoolAdminDashboardPage />} />
                  <Route path="/users" element={<SchoolAdminUsersPage />} />
                  <Route path="/students" element={<SchoolAdminStudentsPage />} />
                  <Route path="/faculty" element={<SchoolAdminFacultyPage />} />
                  <Route path="/courses" element={<SchoolAdminCoursesPage />} />
                  <Route path="/rooms" element={<SchoolAdminRoomsPage />} />
                  <Route path="/schedules" element={<SchoolAdminSchedulesPage />} />
                  <Route path="/enrollment" element={<SchoolAdminEnrollmentPage />} />
                  <Route path="/attendance" element={<SchoolAdminAttendancePage />} />
                  <Route path="/reports" element={<SchoolAdminReportsPage />} />
                  <Route path="/approvals" element={<SchoolAdminApprovalsPage />} />
                  <Route path="/settings" element={<SchoolAdminSettingsPage />} />
                </Routes>
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
                <Routes>
                  <Route path="/" element={<Navigate to="/admin/corporate/dashboard" replace />} />
                  <Route path="/dashboard" element={<CorporateAdminDashboardPage />} />
                  <Route path="/users" element={<CorporateAdminUsersPage />} />
                  <Route path="/approvals" element={<CorporateAdminApprovalsPage />} />
                  <Route path="/settings" element={<CorporateAdminSettingsPage />} />
                </Routes>
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
                <Routes>
                  <Route path="/" element={<AdminTenantPanelPage />} />
                  <Route path="/dashboard" element={<AdminTenantPanelPage />} />
                  <Route path="/tenants" element={<AdminTenantPanelPage />} />
                </Routes>
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
                <Routes>
                  <Route path="/" element={<FacultyDashboardPage />} />
                  <Route path="/students" element={<FacultyStudentsPage />} />
                  <Route path="/courses" element={<FacultyCoursesPage />} />
                  <Route path="/enrollment" element={<FacultyEnrollmentPage />} />
                  <Route path="/attendance" element={<FacultyAttendanceWorkflowPage />} />
                  <Route path="/schedules" element={<FacultySchedulesPage />} />
                  <Route path="/reports" element={<FacultyReportsPage />} />
                  <Route path="/settings" element={<FacultySettingsPage />} />
                </Routes>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* HR Routes */}
        <Route
          path="/hr/*"
          element={
            <ProtectedRoute>
              <RoleRoute requiredRole="hr">
                <Routes>
                  <Route path="/" element={<HREmployeeAttendanceDashboard />} />
                  <Route path="/analytics" element={<HREmployeeAttendanceDashboard />} />
                </Routes>
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
                <Routes>
                  <Route path="/" element={<StudentDashboardPage />} />
                  <Route path="/courses" element={<StudentCoursesPage />} />
                  <Route path="/attendance" element={<StudentAttendancePage />} />
                  <Route path="/schedule" element={<StudentSchedulePage />} />
                  <Route path="/settings" element={<StudentSettingsPage />} />
                </Routes>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Default Dashboard Route (legacy) */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
