/**
 * Superadmin Console Page
 * 
 * Redirects to the main superadmin dashboard
 */

import React from 'react';
import { Navigate } from 'react-router-dom';

export const SuperadminConsolePage: React.FC = () => {
  return <Navigate to="/superadmin/dashboard" replace />;
};

export default SuperadminConsolePage;
