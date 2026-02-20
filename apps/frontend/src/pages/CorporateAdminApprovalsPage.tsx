/**
 * Corporate Admin Approvals Page
 * 
 * Approval workflow page for corporate tenant admins
 * Uses the existing AdminApprovalDashboard component
 */

import React from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import { AdminApprovalDashboard } from '../components/AdminApprovalDashboard'

const CorporateAdminApprovalsPage: React.FC = () => {
  return (
    <TenantAdminLayout currentPage="approvals" platform="corporate">
      <AdminApprovalDashboard />
    </TenantAdminLayout>
  )
}

export default CorporateAdminApprovalsPage
