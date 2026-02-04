import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SuperadminRegisterPage } from './pages/SuperadminRegisterPage';
import { SuperadminLoginPage } from './pages/SuperadminLoginPage';
import { DashboardPage } from './pages/DashboardPage';
import SuperadminDashboard from './components/SuperadminDashboard';
import IncidentDetailPage from './pages/IncidentDetailPage';
import { useAuthStore } from './store/authStore';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  return token ? <>{children}</> : <Navigate to="/login" />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login-superadmin" element={<SuperadminLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register-superadmin" element={<SuperadminRegisterPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/superadmin"
          element={
            <ProtectedRoute>
              <SuperadminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/superadmin/incident/:incidentId"
          element={
            <ProtectedRoute>
              <IncidentDetailPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}
