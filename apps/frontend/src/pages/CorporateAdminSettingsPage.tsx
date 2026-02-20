/**
 * Corporate Admin Settings Page
 * 
 * Organization profile management, admin info
 */

import React, { useState, useEffect } from 'react'
import { TenantAdminLayout } from '../components/TenantAdminLayout'
import {
  Save, Building2, Mail, Phone, MapPin,
  Briefcase, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react'
import axios from 'axios'

interface OrgSettings {
  id: string
  name: string
  code: string
  contact_email: string
  contact_phone: string | null
  headquarters_address: string | null
  industry: string | null
  created_at: string
}

const CorporateAdminSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<OrgSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({
    name: '', contact_email: '', contact_phone: '', headquarters_address: '', industry: '',
  })

  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true)
        const res = await axios.get('/api/corporate/admin/settings', { headers })
        const s = res.data.entity
        setSettings(s)
        setForm({
          name: s.name || '',
          contact_email: s.email || '',
          contact_phone: s.phone || '',
          headquarters_address: s.headquarters_address || '',
          industry: s.industry || '',
        })
      } catch (err) {
        console.error('Failed to load settings:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.contact_email.trim()) {
      setMessage({ type: 'error', text: 'Organization name and email are required.' })
      return
    }
    try {
      setSaving(true)
      setMessage(null)
      await axios.put('/api/corporate/admin/settings', {
        name: form.name.trim(),
        email: form.contact_email.trim(),
        phone: form.contact_phone.trim() || null,
        headquarters_address: form.headquarters_address.trim() || null,
        industry: form.industry.trim() || null,
      }, { headers })
      setMessage({ type: 'success', text: 'Settings saved successfully.' })
      setTimeout(() => setMessage(null), 4000)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save settings.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <TenantAdminLayout currentPage="settings" platform="corporate">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </TenantAdminLayout>
    )
  }

  return (
    <TenantAdminLayout currentPage="settings" platform="corporate">
      <div className="space-y-6 max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Organization Settings</h1>
          <p className="text-slate-400 mt-1">Manage your corporate organization profile</p>
        </div>

        {/* Message */}
        {message && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-teal-500/10 border border-teal-500/30 text-teal-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            {message.type === 'success'
              ? <CheckCircle2 className="w-4 h-4" />
              : <AlertCircle className="w-4 h-4" />}
            {message.text}
          </div>
        )}

        {/* Organization Info Card */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
            <div className="p-3 bg-indigo-500/20 rounded-lg">
              <Building2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Organization Profile</h3>
              <p className="text-xs text-slate-500">
                Code: {settings?.code} · Created: {settings?.created_at ? new Date(settings.created_at).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-400 mb-1">
                <Building2 className="w-3.5 h-3.5" /> Organization Name *
              </label>
              <input type="text" required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 text-sm text-slate-400 mb-1">
                  <Mail className="w-3.5 h-3.5" /> Contact Email *
                </label>
                <input type="email" required value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-slate-400 mb-1">
                  <Phone className="w-3.5 h-3.5" /> Contact Phone
                </label>
                <input type="text" value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-400 mb-1">
                <MapPin className="w-3.5 h-3.5" /> Headquarters Address
              </label>
              <textarea value={form.headquarters_address} rows={2}
                onChange={(e) => setForm({ ...form, headquarters_address: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-400 mb-1">
                <Briefcase className="w-3.5 h-3.5" /> Industry
              </label>
              <input type="text" value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                placeholder="e.g. Healthcare, Technology, Finance..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </TenantAdminLayout>
  )
}

export default CorporateAdminSettingsPage
