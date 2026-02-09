/**
 * Superadmin Console Page
 * 
 * Wrapper for Superadmin Dashboard with state management
 * Shows: System diagnostics, tenants, locked users, audit trail
 */

import React from 'react';
import EnhancedSuperadminDashboard from '../components/EnhancedSuperadminDashboard';

export const SuperadminConsolePage: React.FC = () => {
  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-950">
      <EnhancedSuperadminDashboard />
    </div>
  );
};

export default SuperadminConsolePage;
