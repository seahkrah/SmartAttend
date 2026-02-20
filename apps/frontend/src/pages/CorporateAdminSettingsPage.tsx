/**
 * Corporate Admin Settings Page
 */

import React from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import { Settings } from 'lucide-react'

const CorporateAdminSettingsPage: React.FC = () => {
  return (
    <TenantAdminLayout currentPage="settings" platform="corporate">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center">
          <Settings className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">Settings page coming soon...</p>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default CorporateAdminSettingsPage
