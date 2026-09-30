/**
 * An address inside a workspace that no page answers.
 *
 * Each workspace's router used to have no catch-all, so a mistyped or stale
 * link rendered the shell around an empty page, with nothing to say what had
 * happened or where to go. This says so, and offers the way home.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/states/PageStates';
import { useAuthStore } from '../store/authStore';
import { navFor } from '../navigation/navConfig';

const NotFoundPage: React.FC = () => {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const home = navFor(user?.role, user?.platform as any)?.home ?? '/dashboard';
  return (
    <div className="p-4 sm:p-6">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description={<>Nothing here answers <span className="font-mono break-all">{pathname}</span>. The link may be out of date, or the page may have moved.</>}
      >
        <Link to={home} className="btn btn-primary">Go to your home page</Link>
      </EmptyState>
    </div>
  );
};

export default NotFoundPage;
