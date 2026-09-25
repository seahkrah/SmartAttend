import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { navFor } from '../../navigation/navConfig';
import { NoAccessState } from '../states/PageStates';

/**
 * Sends a signed-in user to their workspace.
 *
 * /dashboard used to render a generic dashboard that called an endpoint the
 * server does not have and, on the failure, showed invented figures. Roles
 * the login screen did not name (HR directors, managers, IT) all landed
 * there. Every role with a workspace now goes to it; a role without one is
 * told so, rather than shown a page of numbers that mean nothing.
 */
export const HomeRedirect: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  const nav = navFor(user.role, user.platform as any);
  if (nav) return <Navigate to={nav.home} replace />;
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-sunken">
      <NoAccessState
        title="No workspace for your role yet"
        description={`Your account's role (${user.role}) has no pages in this application. Ask your administrator to change your role if you need access.`}
      />
    </div>
  );
};

export default HomeRedirect;
