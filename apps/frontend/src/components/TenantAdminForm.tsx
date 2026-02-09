import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, User, Mail, Building2, Lock, Check, AlertCircle, Loader } from 'lucide-react'
import axios from 'axios'

interface Tenant {
  id: string
  name: string
  code: string
  type: 'school' | 'corporate'
}

interface FormData {
  email: string
  name: string
  tenantId: string
  tenantType: 'school' | 'corporate'
  password?: string
  confirmPassword?: string
}

interface TenantAdminFormProps {
  onClose: () => void
  onSuccess?: () => void
}

const TenantAdminForm: React.FC<TenantAdminFormProps> = ({ onClose, onSuccess }) => {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [formData, setFormData] = useState<FormData>({
    email: '',
    name: '',
    tenantId: '',
    tenantType: 'school',
    password: '',
    confirmPassword: ''
  })

  useEffect(() => {
    loadTenants()
  }, [])

  const loadTenants = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const response = await axios.get('/api/auth/superadmin/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      const data = response.data.data
      const allTenants: Tenant[] = [
        ...data.entities.schools.map((s: any) => ({ ...s, type: 'school' as const })),
        ...data.entities.corporates.map((c: any) => ({ ...c, type: 'corporate' as const }))
      ]
      setTenants(allTenants)
    } catch (err) {
      setError('Failed to load tenants')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    // Email validation
    if (!formData.email) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format'
    }

    // Name validation
    if (!formData.name) {
      errors.name = 'Name is required'
    } else if (formData.name.length < 2) {
      errors.name = 'Name must be at least 2 characters'
    }

    // Tenant validation
    if (!formData.tenantId) {
      errors.tenantId = 'Please select a tenant'
    }

    // Password validation
    if (!formData.password) {
      errors.password = 'Password is required'
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    } else if (!/[A-Z]/.test(formData.password)) {
      errors.password = 'Password must contain at least one uppercase letter'
    } else if (!/[0-9]/.test(formData.password)) {
      errors.password = 'Password must contain at least one number'
    } else if (!/[!@#$%^&*]/.test(formData.password)) {
      errors.password = 'Password must contain at least one special character (!@#$%^&*)'
    }

    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm password'
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
    // Clear validation error for this field
    if (validationErrors[name]) {
      setValidationErrors(prev => ({
        ...prev,
        [name]: ''
      }))
    }
  }

  const handleTenantChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedTenant = tenants.find(t => t.id === e.target.value)
    if (selectedTenant) {
      setFormData(prev => ({
        ...prev,
        tenantId: selectedTenant.id,
        tenantType: selectedTenant.type
      }))
      if (validationErrors.tenantId) {
        setValidationErrors(prev => ({
          ...prev,
          tenantId: ''
        }))
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      setError('Please fix the errors above')
      return
    }

    try {
      setSubmitting(true)
      setError('')
      const token = localStorage.getItem('accessToken')

      // Create tenant admin via API
      await axios.post(
        '/api/superadmin/tenant-admins',
        {
          email: formData.email,
          name: formData.name,
          tenantId: formData.tenantId,
          password: formData.password
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )

      setSuccess(true)
      setFormData({
        email: '',
        name: '',
        tenantId: '',
        tenantType: 'school',
        password: '',
        confirmPassword: ''
      })

      // Show success message for 2 seconds then close
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 2000)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create tenant admin')
      setSuccess(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="mb-6 p-6 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 shadow-xl"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <User className="w-6 h-6 text-blue-400" />
          Create New Tenant Admin
        </h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error Message */}
          {error && !success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-lg bg-red-900/20 border border-red-700/50 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </motion.div>
          )}

          {/* Success Message */}
          {success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-lg bg-green-900/20 border border-green-700/50 flex items-start gap-3"
            >
              <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-300">Tenant admin created successfully!</p>
            </motion.div>
          )}

          {/* Form Fields Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Full Name
                </div>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="John Doe"
                className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.name ? 'border-red-500/50' : 'border-slate-600'
                } text-white placeholder-slate-500`}
              />
              {validationErrors.name && (
                <p className="mt-1 text-xs text-red-400">{validationErrors.name}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email Address
                </div>
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="admin@school.local"
                className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.email ? 'border-red-500/50' : 'border-slate-600'
                } text-white placeholder-slate-500`}
              />
              {validationErrors.email && (
                <p className="mt-1 text-xs text-red-400">{validationErrors.email}</p>
              )}
            </div>

            {/* Tenant Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Select Tenant
                </div>
              </label>
              <select
                name="tenantId"
                value={formData.tenantId}
                onChange={handleTenantChange}
                className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.tenantId ? 'border-red-500/50' : 'border-slate-600'
                } text-white`}
              >
                <option value="">-- Choose a tenant --</option>
                <optgroup label="Schools">
                  {tenants.filter(t => t.type === 'school').map(tenant => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.code})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Corporates">
                  {tenants.filter(t => t.type === 'corporate').map(tenant => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.code})
                    </option>
                  ))}
                </optgroup>
              </select>
              {validationErrors.tenantId && (
                <p className="mt-1 text-xs text-red-400">{validationErrors.tenantId}</p>
              )}
            </div>

            {/* Tenant Type (Display Only) */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Tenant Type
                </div>
              </label>
              <input
                type="text"
                value={formData.tenantType.charAt(0).toUpperCase() + formData.tenantType.slice(1)}
                disabled
                className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-400 cursor-not-allowed"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Password
                </div>
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Min 8 chars, uppercase, number, special char"
                className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.password ? 'border-red-500/50' : 'border-slate-600'
                } text-white placeholder-slate-500 text-sm`}
              />
              {validationErrors.password && (
                <p className="mt-1 text-xs text-red-400">{validationErrors.password}</p>
              )}
              <p className="mt-2 text-xs text-slate-400">
                Password must contain: uppercase letter, number, and special character (!@#$%^&*)
              </p>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Confirm Password
                </div>
              </label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                placeholder="Re-enter password"
                className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.confirmPassword ? 'border-red-500/50' : 'border-slate-600'
                } text-white placeholder-slate-500`}
              />
              {validationErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-400">{validationErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 transition-colors font-medium"
            >
              Cancel
            </button>
            <motion.button
              type="submit"
              disabled={submitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Create Admin
                </>
              )}
            </motion.button>
          </div>
        </form>
      )}
    </motion.div>
  )
}

export default TenantAdminForm
