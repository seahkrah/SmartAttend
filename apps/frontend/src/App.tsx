import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import React, { useEffect } from 'react';

// Pages
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SuperadminRegisterPage } from './pages/SuperadminRegisterPage';
import { SuperadminLoginPage } from './pages/SuperadminLoginPage';
import { DashboardPage } from './pages/DashboardPage';
import IncidentDetailPage from './pages/IncidentDetailPage';

// Phase 9 Page Wrappers (with HIERARCHY tokens + error/loading states)
import SuperadminConsolePage from './pages/SuperadminConsolePage';
import AdminTenantPanelPage from './pages/AdminTenantPanelPage';
import FacultyAttendanceWorkflowPage from './pages/FacultyAttendanceWorkflowPage';
import EmployeeSelfServiceAttendancePage from './pages/EmployeeSelfServiceAttendancePage';
import HREmployeeAttendanceDashboard from './pages/HREmployeeAttendanceDashboard';

// Components
import SuperadminDashboard from './components/SuperadminDashboard';
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
                  <Route path="/incident/:incidentId" element={<IncidentDetailPage />} />
                </Routes>
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Admin Routes */}
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
                  <Route path="/" element={<FacultyAttendanceWorkflowPage />} />
                  <Route path="/attendance" element={<FacultyAttendanceWorkflowPage />} />
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
                  <Route path="/" element={<EmployeeSelfServiceAttendancePage />} />
                  <Route path="/attendance" element={<EmployeeSelfServiceAttendancePage />} />
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
