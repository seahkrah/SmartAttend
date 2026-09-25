/**
 * Corporate Admin Approvals Page
 * 
 * Approval workflow page for corporate tenant admins
 * Uses the existing AdminApprovalDashboard component
 */

import React from 'react'
import { AdminApprovalDashboard } from '../components/AdminApprovalDashboard'

const CorporateAdminApprovalsPage: React.FC = () => {
  return (
    <>
      <AdminApprovalDashboard />
    </>
  )
}

export default CorporateAdminApprovalsPage
