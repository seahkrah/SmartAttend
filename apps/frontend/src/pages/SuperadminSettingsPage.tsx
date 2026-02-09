import React, { useState } from 'react'
import { Bell, Shield, Database, Save } from 'lucide-react'
import SuperadminLayout from '../components/SuperadminLayout'

const SuperadminSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState({
    twoFactorEnabled: false,
    auditLoggingEnabled: true,
    backupPolicy: 'daily',
    emailNotifications: true,
    securityAlerts: true,
    maintenanceMode: false,
  })
  const [saved, setSaved] = useState(false)

  const handleToggleSetting = (key: keyof typeof settings) => {
    if (typeof settings[key] === 'boolean') {
      setSettings({ ...settings, [key]: !settings[key] })
      setSaved(false)
    }
  }

  const handleSelectChange = (key: string, value: string) => {
    setSettings({ ...settings, [key]: value })
    setSaved(false)
  }

  const handleSave = async () => {
    try {
      // Save to backend
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Error saving settings:', error)
    }
  }

  const SettingToggle = ({
    title,
    description,
    icon: Icon,
    value,
    onChange,
  }: {
    title: string
    description: string
    icon: React.ReactNode
    value: boolean
    onChange: () => void
  }) => (
    <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 flex items-center justify-between group hover:border-slate-600 transition-colors">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-slate-900/50">{Icon}</div>
        <div>
          <h4 className="font-semibold text-white">{title}</h4>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
      </div>

      <button
        onClick={onChange}
        className={`relative w-14 h-8 rounded-full transition-all ${
          value ? 'bg-blue-600' : 'bg-slate-700'
        }`}
      >
        <div
          style={{ transform: value ? 'translateX(28px)' : 'translateX(4px)' }}
          className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform"
        />
      </button>
    </div>
  )

  return (
    <SuperadminLayout currentPage="settings">
      <div className="space-y-8 max-w-3xl">
        {/* Security Settings */}
        <div>
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" />
            Security Settings
          </h3>

          <div className="space-y-3">
            <SettingToggle
              title="Two-Factor Authentication"
              description="Require 2FA for all superadmin accounts"
              icon={<Shield className="w-5 h-5 text-blue-400" />}
              value={settings.twoFactorEnabled}
              onChange={() => handleToggleSetting('twoFactorEnabled')}
            />

            <SettingToggle
              title="Audit Logging"
              description="Enable detailed audit logging of all admin actions"
              icon={<Database className="w-5 h-5 text-cyan-400" />}
              value={settings.auditLoggingEnabled}
              onChange={() => handleToggleSetting('auditLoggingEnabled')}
            />

            <SettingToggle
              title="Security Alerts"
              description="Receive alerts for suspicious activities"
              icon={<Bell className="w-5 h-5 text-red-400" />}
              value={settings.securityAlerts}
              onChange={() => handleToggleSetting('securityAlerts')}
            />
          </div>
        </div>

        {/* Backup & Maintenance */}
        <div>
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Database className="w-6 h-6 text-purple-400" />
            Backup & Maintenance
          </h3>

          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Backup Policy
              </label>
              <select
                value={settings.backupPolicy}
                onChange={(e) => handleSelectChange('backupPolicy', e.target.value)}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-purple-500 outline-none"
              >
                <option value="hourly">Hourly Backup</option>
                <option value="daily">Daily Backup</option>
                <option value="weekly">Weekly Backup</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">
                {settings.backupPolicy === 'hourly' && 'Backups every hour'}
                {settings.backupPolicy === 'daily' && 'Backups daily at 2 AM UTC'}
                {settings.backupPolicy === 'weekly' && 'Backups every Sunday at 2 AM UTC'}
              </p>
            </div>

            <SettingToggle
              title="Maintenance Mode"
              description="Temporarily disable user access for maintenance"
              icon={<Database className="w-5 h-5 text-yellow-400" />}
              value={settings.maintenanceMode}
              onChange={() => handleToggleSetting('maintenanceMode')}
            />
          </div>
        </div>

        {/* Notifications */}
        <div>
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Bell className="w-6 h-6 text-green-400" />
            Notifications
          </h3>

          <div className="space-y-3">
            <SettingToggle
              title="Email Notifications"
              description="Receive email notifications for important events"
              icon={<Bell className="w-5 h-5 text-green-400" />}
              value={settings.emailNotifications}
              onChange={() => handleToggleSetting('emailNotifications')}
            />
          </div>
        </div>

        {/* System Information */}
        <div className="p-6 rounded-lg bg-slate-800/50 border border-slate-700">
          <h4 className="font-semibold text-white mb-4">System Information</h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">System Version</span>
              <span className="text-white font-mono">v1.0.0</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">API Version</span>
              <span className="text-white font-mono">v1.0.0</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Last Updated</span>
              <span className="text-white font-mono">
                {new Date().toLocaleDateString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Database Status</span>
              <span className="text-green-400 font-semibold flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Connected
              </span>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg transition-all shadow-lg font-medium"
          >
            <Save className="w-5 h-5" />
            Save Changes
          </button>

          {saved && (
            <div className="flex items-center gap-2 px-4 py-3 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
              <span>✓ Settings saved successfully</span>
            </div>
          )}
        </div>
      </div>
    </SuperadminLayout>
  )
}

export default SuperadminSettingsPage
