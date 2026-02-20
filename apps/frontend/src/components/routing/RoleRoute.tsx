/**
 * Role-Based Route Guard
 * 
 * Protects routes based on user role and permissions
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface RoleRouteProps {
  children: React.ReactNode;
  requiredRole: string | string[];
  fallbackPath?: string;
}

/**
 * RoleRoute Component
 * 
 * Checks if current user has required role(s)
 * If not, redirects to fallbackPath or /unauthorized
 */
export const RoleRoute: React.FC<RoleRouteProps> = ({
  children,
  requiredRole,
  fallbackPath = '/unauthorized'
}) => {
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const token = useAuthStore((state) => state.token);

  console.log('[RoleRoute] Checking route protection', {
    requiredRole,
    userRole: user?.role,
    userExists: !!user,
    isLoading,
    hasToken: !!token,
  });

  // Show spinner only if we have a token but no user AND we're actively loading
  if (token && !user && isLoading) {
    console.log('[RoleRoute] Loading user data, showing spinner');
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!user) {
    console.log('[RoleRoute] No user, redirecting to login');
    return <Navigate to="/login" replace />;
  }

  const hasRole = Array.isArray(requiredRole)
    ? requiredRole.includes(user.role)
    : user.role === requiredRole;

  console.log('[RoleRoute] Role check result', { hasRole, userRole: user.role, requiredRole });

  if (!hasRole) {
    console.log('[RoleRoute] Role mismatch, redirecting to', fallbackPath);
    return <Navigate to={fallbackPath} replace />;
  }

  console.log('[RoleRoute] Authorization passed, rendering children');
  return <>{children}</>;
};

/**
 * ProtectedRoute Component
 * 
 * Checks if user is authenticated
 * If not, redirects to login
 */
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const token = useAuthStore((state) => state.token);
  const location = useLocation();

  console.log('[ProtectedRoute]', { hasUser: !!user, hasToken: !!token, isLoading });

  // Show spinner only if we have a token but no user AND we're actively loading
  if (token && !user && isLoading) {
    console.log('[ProtectedRoute] Waiting for user to load from token');
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!user) {
    console.log('[ProtectedRoute] No user and no token, redirecting to /login');
    return <Navigate to="/login" replace />;
  }

  // Block access to all protected routes if password reset is required
  if (user.mustResetPassword && location.pathname !== '/change-password') {
    console.log('[ProtectedRoute] Password reset required, redirecting to /change-password');
    return <Navigate to="/change-password" replace />;
  }

  console.log('[ProtectedRoute] User authenticated, showing protected content');
  return <>{children}</>;
};

interface PermissionRouteProps {
  children: React.ReactNode;
  requiredPermission: string | string[];
  fallbackPath?: string;
}

/**
 * PermissionRoute Component
 * 
 * Checks if user has specific permission(s)
 * Useful for fine-grained access control
 */
export const PermissionRoute: React.FC<PermissionRouteProps> = ({
  children,
  requiredPermission,
  fallbackPath = '/unauthorized'
}) => {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const hasPermission = Array.isArray(requiredPermission)
    ? requiredPermission.some((perm) => user.permissions.includes(perm))
    : user.permissions.includes(requiredPermission);

  if (!hasPermission) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
};

export default RoleRoute;
