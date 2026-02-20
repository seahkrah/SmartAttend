/**
 * Faculty Settings Page
 *
 * Two sections:
 *  1. Edit Personal Information (name, phone)
 *  2. Change Password
 */

import React, { useState, useEffect } from 'react'
import { FacultyLayout } from '../components/FacultyLayout'
import { axiosClient } from '../utils/axiosClient'
import { useToastStore } from '../components/Toast'
import { useAuthStore } from '../store/authStore'

export const FacultySettingsPage: React.FC = () => {
  const addToast = useToastStore((s) => s.addToast)
  const { user, setUser } = useAuthStore()

  // ── Profile state ──
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)

  // ── Password state ──
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const res = await axiosClient.get('/auth/me')
      const u = res.data.user
      setFullName(u.fullName || '')
      setPhone(u.phone || '')
      setEmail(u.email || '')
    } catch {
      addToast({ type: 'error', title: 'Error', message: 'Failed to load profile' })
    } finally {
      setProfileLoading(false)
    }
  }

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) {
      addToast({ type: 'error', title: 'Error', message: 'Full name is required' })
      return
    }
    setProfileSaving(true)
    try {
      await axiosClient.put('/auth/me', { fullName: fullName.trim(), phone: phone || null })
      if (user) {
        setUser({ ...user, fullName: fullName.trim(), phone: phone || undefined })
      }
      addToast({ type: 'success', title: 'Saved', message: 'Profile updated successfully' })
    } catch (err: any) {
      addToast({ type: 'error', title: 'Error', message: err.response?.data?.error || 'Failed to save profile' })
    } finally {
      setProfileSaving(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentPassword || !newPassword || !confirmPassword) {
      addToast({ type: 'error', title: 'Error', message: 'All password fields are required' })
      return
    }
    if (newPassword.length < 8) {
      addToast({ type: 'error', title: 'Error', message: 'New password must be at least 8 characters' })
      return
    }
    if (newPassword !== confirmPassword) {
      addToast({ type: 'error', title: 'Error', message: 'New passwords do not match' })
      return
    }
    if (newPassword === currentPassword) {
      addToast({ type: 'error', title: 'Error', message: 'New password must differ from current' })
      return
    }

    setPasswordSaving(true)
    try {
      await axiosClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
        confirmPassword,
      })
      addToast({ type: 'success', title: 'Password Changed', message: 'Your password has been updated' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      addToast({ type: 'error', title: 'Error', message: err.response?.data?.error || 'Failed to change password' })
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <FacultyLayout currentPage="settings">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 mt-1">Manage your profile and security settings.</p>
        </div>

        {/* ═════════════════════════════════════ */}
        {/* PERSONAL INFORMATION                 */}
        {/* ═════════════════════════════════════ */}
        <div className="bg-slate-800 rounded-xl border border-slate-700">
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              👤 Personal Information
            </h2>
            <p className="text-xs text-slate-400 mt-1">Update your name and contact details.</p>
          </div>

          {profileLoading ? (
            <div className="p-6 flex items-center justify-center">
              <div className="w-6 h-6 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-slate-400 text-sm">Loading profile...</span>
            </div>
          ) : (
            <form onSubmit={handleProfileSave} className="p-6 space-y-5">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full bg-slate-900/50 border border-slate-700 text-slate-500 rounded-lg px-3 py-2 text-sm cursor-not-allowed"
                />
                <p className="text-xs text-slate-500 mt-1">Email cannot be changed. Contact admin if needed.</p>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 234 567 890"
                  className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {profileSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ═════════════════════════════════════ */}
        {/* CHANGE PASSWORD                      */}
        {/* ═════════════════════════════════════ */}
        <div className="bg-slate-800 rounded-xl border border-slate-700">
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              🔒 Change Password
            </h2>
            <p className="text-xs text-slate-400 mt-1">Update your login password. Must be at least 8 characters.</p>
          </div>

          <form onSubmit={handlePasswordChange} className="p-6 space-y-5">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Current Password</label>
              <div className="relative">
                <input
                  type={showCurrentPw ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 pr-10 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                  className="absolute right-3 top-2 text-slate-500 hover:text-white text-xs"
                >
                  {showCurrentPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">New Password</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                  className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 pr-10 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-3 top-2 text-slate-500 hover:text-white text-xs"
                >
                  {showNewPw ? 'Hide' : 'Show'}
                </button>
              </div>
              {newPassword && newPassword.length < 8 && (
                <p className="text-xs text-amber-400 mt-1">Must be at least 8 characters</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {passwordSaving ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </FacultyLayout>
  )
}

export default FacultySettingsPage
