/**
 * Corporate Admin Users Page
 * 
 * User management page for corporate tenant admins (simplified version)
 */

import React from 'react'
import {  TenantAdminLayout } from '../components/TenantAdminLayout'
import { Users } from 'lucide-react'

const CorporateAdminUsersPage: React.FC = () => {
  return (
    <TenantAdminLayout currentPage="users" platform="corporate">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Employees</h1>
            <p className="text-slate-400 mt-1">Manage employees in your organization</p>
          </div>
        </div>
        
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center">
          <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">Employee management coming soon...</p>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default CorporateAdminUsersPage
