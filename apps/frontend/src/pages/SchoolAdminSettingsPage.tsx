/**
 * School Admin Settings Page
 * 
 * Settings and configuration page for school tenant admins
 */

import React, { useState, useEffect } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import { useAuthStore } from '../store/authStore'
import axios from 'axios'
import {
  Settings,
  Bell,
  Shield,
  Clock,
  Users,
  Save,
  Check,
  CalendarDays,
} from 'lucide-react'

interface SettingsSection {
  id: string
  label: string
  icon: React.ReactNode
}

const SchoolAdminSettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('general')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  const [settings, setSettings] = useState({
    schoolName: 'My School',
    timezone: 'UTC',
    attendanceStartTime: '08:00',
    attendanceEndTime: '17:00',
    autoApproveStudents: false,
    requireEmailVerification: true,
    maxAbsencesBeforeAlert: 3,
    notifyOnNewRegistration: true,
    notifyOnAbsence: true,
    weeklyReportEnabled: true,
    scheduleDayFormat: '1',
  })

  useEffect(() => {
    fetchSchoolEntity()
    fetchPlatformSettings()
  }, [])

  const fetchSchoolEntity = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/auth/admin/school/stats', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.data.entity?.name) {
        setSettings(prev => ({ ...prev, schoolName: response.data.entity.name }))
      }
    } catch (error) {
      console.error('Failed to fetch school entity:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchPlatformSettings = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/auth/admin/school/settings', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const s = response.data.settings
      if (s.schedule_day_format) {
        setSettings(prev => ({ ...prev, scheduleDayFormat: s.schedule_day_format }))
      }
    } catch (error) {
      console.error('Failed to fetch platform settings:', error)
    }
  }

  const sections: SettingsSection[] = [
    { id: 'general', label: 'General', icon: <Settings className="w-5 h-5" /> },
    { id: 'scheduling', label: 'Scheduling', icon: <CalendarDays className="w-5 h-5" /> },
    { id: 'attendance', label: 'Attendance', icon: <Clock className="w-5 h-5" /> },
    { id: 'users', label: 'User Management', icon: <Users className="w-5 h-5" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-5 h-5" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-5 h-5" /> },
  ]

  const handleSave = async () => {
    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      // Save schedule day format to platform_settings
      await axios.put('/api/auth/admin/school/settings', 
        { key: 'schedule_day_format', value: settings.scheduleDayFormat },
        { headers: { Authorization: `Bearer ${token}` } }
      )
    } catch (error) {
      console.error('Error saving settings:', error)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const SettingRow: React.FC<{
    label: string
    description?: string
    children: React.ReactNode
  }> = ({ label, description, children }) => (
    <div className="flex items-center justify-between py-4 border-b border-slate-700 last:border-0">
      <div>
        <p className="font-medium text-white">{label}</p>
        {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
      </div>
      {children}
    </div>
  )

  const Toggle: React.FC<{
    checked: boolean
    onChange: (checked: boolean) => void
  }> = ({ checked, onChange }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-6 rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-slate-600'
      }`}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  )

  return (
    <TenantAdminLayout currentPage="settings" platform="school">
      <div className="flex gap-6">
        {/* Settings Navigation */}
        <div className="w-64 shrink-0">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Settings
            </h3>
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
                    activeSection === section.id
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {section.icon}
                  <span className="text-sm font-medium">{section.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            {/* General Settings */}
            {activeSection === 'general' && (
              <div>
                <h2 className="text-xl font-bold text-white mb-6">General Settings</h2>
                <SettingRow label="School Name" description="Display name for your school">
                  <input
                    type="text"
                    value={settings.schoolName}
                    onChange={(e) => setSettings({ ...settings, schoolName: e.target.value })}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 w-64"
                  />
                </SettingRow>
                <SettingRow label="Timezone" description="Default timezone for attendance tracking">
                  <select
                    value={settings.timezone}
                    onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Denver">Mountain Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                  </select>
                </SettingRow>
              </div>
            )}

            {/* Scheduling Settings */}
            {activeSection === 'scheduling' && (
              <div>
                <h2 className="text-xl font-bold text-white mb-6">Scheduling Settings</h2>
                <SettingRow 
                  label="Schedule Day Format" 
                  description="How many days per week each course meets. This controls the day picker when creating schedules."
                >
                  <select
                    value={settings.scheduleDayFormat}
                    onChange={(e) => setSettings({ ...settings, scheduleDayFormat: e.target.value })}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="1">1 Day (e.g. Monday)</option>
                    <option value="2">2 Days (e.g. Mon, Wed)</option>
                    <option value="3">3 Days (e.g. Mon, Wed, Fri)</option>
                    <option value="4">4 Days</option>
                    <option value="5">5 Days (Mon–Fri)</option>
                    <option value="6">6 Days (Mon–Sat)</option>
                  </select>
                </SettingRow>
                <div className="mt-4 bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                  <p className="text-sm text-slate-300">
                    <strong className="text-white">How it works:</strong> When creating a schedule, 
                    the admin will pick exactly <strong className="text-blue-400">{settings.scheduleDayFormat}</strong> day(s) 
                    from the week. The same time slot will apply to all selected days. 
                    Each day creates a separate schedule entry for attendance tracking.
                  </p>
                </div>
              </div>
            )}

            {/* Attendance Settings */}
            {activeSection === 'attendance' && (
              <div>
                <h2 className="text-xl font-bold text-white mb-6">Attendance Settings</h2>
                <SettingRow label="Start Time" description="When attendance tracking begins">
                  <input
                    type="time"
                    value={settings.attendanceStartTime}
                    onChange={(e) =>
                      setSettings({ ...settings, attendanceStartTime: e.target.value })
                    }
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                </SettingRow>
                <SettingRow label="End Time" description="When attendance tracking ends">
                  <input
                    type="time"
                    value={settings.attendanceEndTime}
                    onChange={(e) =>
                      setSettings({ ...settings, attendanceEndTime: e.target.value })
                    }
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                </SettingRow>
                <SettingRow
                  label="Max Absences Before Alert"
                  description="Number of absences before triggering an alert"
                >
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={settings.maxAbsencesBeforeAlert}
                    onChange={(e) =>
                      setSettings({ ...settings, maxAbsencesBeforeAlert: parseInt(e.target.value) })
                    }
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 w-24"
                  />
                </SettingRow>
              </div>
            )}

            {/* User Management Settings */}
            {activeSection === 'users' && (
              <div>
                <h2 className="text-xl font-bold text-white mb-6">User Management</h2>
                <SettingRow
                  label="Auto-Approve Students"
                  description="Automatically approve new student registrations"
                >
                  <Toggle
                    checked={settings.autoApproveStudents}
                    onChange={(checked) => setSettings({ ...settings, autoApproveStudents: checked })}
                  />
                </SettingRow>
                <SettingRow
                  label="Require Email Verification"
                  description="Users must verify their email before accessing the system"
                >
                  <Toggle
                    checked={settings.requireEmailVerification}
                    onChange={(checked) =>
                      setSettings({ ...settings, requireEmailVerification: checked })
                    }
                  />
                </SettingRow>
              </div>
            )}

            {/* Notification Settings */}
            {activeSection === 'notifications' && (
              <div>
                <h2 className="text-xl font-bold text-white mb-6">Notification Settings</h2>
                <SettingRow
                  label="New Registration Alerts"
                  description="Receive notifications when new users register"
                >
                  <Toggle
                    checked={settings.notifyOnNewRegistration}
                    onChange={(checked) =>
                      setSettings({ ...settings, notifyOnNewRegistration: checked })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Absence Alerts"
                  description="Receive notifications when users are marked absent"
                >
                  <Toggle
                    checked={settings.notifyOnAbsence}
                    onChange={(checked) => setSettings({ ...settings, notifyOnAbsence: checked })}
                  />
                </SettingRow>
                <SettingRow
                  label="Weekly Reports"
                  description="Receive weekly attendance summary reports"
                >
                  <Toggle
                    checked={settings.weeklyReportEnabled}
                    onChange={(checked) =>
                      setSettings({ ...settings, weeklyReportEnabled: checked })
                    }
                  />
                </SettingRow>
              </div>
            )}

            {/* Security Settings */}
            {activeSection === 'security' && (
              <div>
                <h2 className="text-xl font-bold text-white mb-6">Security Settings</h2>
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-4">
                  <p className="text-slate-300">
                    Security settings are managed by the superadmin. Contact your system
                    administrator for security-related changes.
                  </p>
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="flex justify-end mt-6 pt-6 border-t border-slate-700">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg transition-colors ${
                  saved
                    ? 'bg-emerald-500 text-white'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {saving ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="w-5 h-5" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default SchoolAdminSettingsPage
