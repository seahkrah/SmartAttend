/**
 * School Admin Approvals Page
 * 
 * Approval workflow page for school tenant admins
 * Uses the existing AdminApprovalDashboard component
 */

import React from 'react'
import { AdminApprovalDashboard } from '../components/AdminApprovalDashboard'

const SchoolAdminApprovalsPage: React.FC = () => {
  return (
    <>
      <AdminApprovalDashboard />
    </>
  )
}

export default SchoolAdminApprovalsPage
