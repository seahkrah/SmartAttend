/**
 * School Admin Approvals Page
 * 
 * Approval workflow page for school tenant admins
 * Uses the existing AdminApprovalDashboard component
 */

import React from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import { AdminApprovalDashboard } from '../components/AdminApprovalDashboard'

const SchoolAdminApprovalsPage: React.FC = () => {
  return (
    <TenantAdminLayout currentPage="approvals" platform="school">
      <AdminApprovalDashboard />
    </TenantAdminLayout>
  )
}

export default SchoolAdminApprovalsPage
