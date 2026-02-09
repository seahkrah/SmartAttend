/**
 * Admin Tenant Panel Page
 * 
 * Wrapper for AdminApprovalDashboard with role-based routing
 * Applies HIERARCHY tokens and error/loading states
 */

import React, { useEffect } from 'react';
import { useAdminStore } from '../store/adminStore';
import { AdminApprovalDashboard } from '../components/AdminApprovalDashboard';
import { ErrorAlert } from '../components/ErrorDisplay';
import { LoadingOverlay } from '../components/LoadingStates';

export const AdminTenantPanelPage: React.FC = () => {
  const { isLoading, error, clearError, fetchPendingApprovals } = useAdminStore();

  useEffect(() => {
    fetchPendingApprovals();
  }, []);

  if (isLoading) {
    return <LoadingOverlay message="Loading approvals..." />;
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      {error && (
        <ErrorAlert
          title="Failed to load approvals"
          message={error}
          action={{ label: 'Retry', onClick: () => fetchPendingApprovals() }}
          onDismiss={clearError}
        />
      )}
      <AdminApprovalDashboard />
    </div>
  );
};

export default AdminTenantPanelPage;
