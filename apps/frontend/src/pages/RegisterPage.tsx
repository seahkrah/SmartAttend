import React from 'react';
import { UserPlus, Mail, Lock, Building2, AlertCircle, Check } from 'lucide-react';
import { SmartAttendLogo } from '../components/BrandLogo';
import { PasswordInput } from '../components/PasswordInput';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export const RegisterPage: React.FC = () => {
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [platform, setPlatform] = React.useState<'school' | 'corporate'>('school');
  const [role, setRole] = React.useState<'student' | 'faculty' | 'it' | 'employee' | 'hr' | ''>('');
  const [entityId, setEntityId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const [registrationStatus, setRegistrationStatus] = React.useState<'active' | 'pending_approval' | ''>('');
  const navigate = useNavigate();

  const schoolRoles = [
    { value: 'student', label: 'Student', requiresApproval: false },
    { value: 'faculty', label: 'Faculty', requiresApproval: true },
    { value: 'it', label: 'IT Administrator', requiresApproval: true }
  ];

  const corporateRoles = [
    { value: 'employee', label: 'Employee', requiresApproval: false },
    { value: 'it', label: 'IT Administrator', requiresApproval: true },
    { value: 'hr', label: 'HR Administrator', requiresApproval: true }
  ];

  const availableRoles = platform === 'school' ? schoolRoles : corporateRoles;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!fullName || !email || !password || !confirmPassword || !role || !entityId) {
      setError('Please fill in all required fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post('/api/auth/register-with-role', {
        platform,
        email,
        fullName,
        password,
        confirmPassword,
        phone: phone || undefined,
        role,
        entityId
      });

      setSuccess(true);
      setRegistrationStatus(response.data.user.status);

      // If requires approval, show message and redirect after delay
      if (response.data.requiresApproval) {
        setTimeout(() => {
          navigate('/login', { 
            state: { 
              message: 'Your registration is pending admin approval. You will be notified once approved.',
              email 
            } 
          });
        }, 3000);
      } else {
        // If auto-approved, redirect to login
        setTimeout(() => {
          navigate('/login', { 
            state: { 
              message: 'Registration successful! Please log in.',
              email 
            } 
          });
        }, 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Success screen
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-secondary-600/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
          <div className="absolute bottom-20 right-10 w-72 h-72 bg-primary-500/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
        </div>

        <div className="relative z-10 w-full max-w-md">
          <div className="card text-center">
            <div className="w-16 h-16 bg-green-500/20 border-2 border-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Registration Successful!</h2>
            <p className="text-slate-300 mb-6">
              {registrationStatus === 'pending_approval'
                ? `Your ${role} account is pending approval from the administrator. You'll receive a notification once approved.`
                : 'Your account has been created successfully. Redirecting to login...'}
            </p>
            <button
              onClick={() => navigate('/login')}
              className="btn-primary w-full"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4 py-8">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-secondary-600/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-primary-500/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <SmartAttendLogo size="lg" showText={true} />
          <h2 className="text-2xl font-bold text-white mt-4 mb-2">Create Account</h2>
          <p className="text-slate-400">Join SmartAttend with your role</p>
        </div>

        {/* Form Card */}
        <div className="card mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Platform Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Building2 className="inline w-4 h-4 mr-2" />
                Select Platform
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlatform('school');
                    setRole('');
                    setEntityId('');
                  }}
                  className={`p-2.5 rounded-lg border-2 transition-all text-sm font-medium ${
                    platform === 'school'
                      ? 'border-primary-500 bg-primary-500/20 text-primary-300'
                      : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  School
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlatform('corporate');
                    setRole('');
                    setEntityId('');
                  }}
                  className={`p-2.5 rounded-lg border-2 transition-all text-sm font-medium ${
                    platform === 'corporate'
                      ? 'border-primary-500 bg-primary-500/20 text-primary-300'
                      : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  Corporate
                </button>
              </div>
            </div>

            {/* Role Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Select Role
              </label>
              <div className="space-y-2">
                {availableRoles.map((r) => (
                  <label key={r.value} className="flex items-start gap-3 p-2.5 border border-slate-700 rounded-lg cursor-pointer hover:bg-slate-800/50 transition">
                    <input
                      type="radio"
                      value={r.value}
                      checked={role === r.value}
                      onChange={(e) => setRole(e.target.value as any)}
                      className="w-4 h-4 mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-300">{r.label}</p>
                      {r.requiresApproval && (
                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3" />
                          Requires admin approval
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Entity Selection (placeholder - would be dynamic) */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                {platform === 'school' ? 'School' : 'Company'}
              </label>
              <select
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                className="input-field"
                required
              >
                <option value="">Select {platform === 'school' ? 'school' : 'company'}...</option>
                {platform === 'school' ? (
                  <>
                    <option value="primary-university">Primary University</option>
                    <option value="secondary-university">Secondary University</option>
                  </>
                ) : (
                  <>
                    <option value="tech-corp">Tech Corp Inc</option>
                    <option value="finance-solutions">Finance Solutions Ltd</option>
                  </>
                )}
              </select>
            </div>

            {/* Full Name Input */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <UserPlus className="inline w-4 h-4 mr-2" />
                Full Name
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>

            {/* Email Input */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Mail className="inline w-4 h-4 mr-2" />
                Email Address
              </label>
              <input
                type="email"
                className="input-field"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {/* Phone Input */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Phone (Optional)
              </label>
              <input
                type="tel"
                className="input-field"
                placeholder="+1 (555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            {/* Password Input */}
            <PasswordInput
              id="password"
              name="password"
              label={<><Lock className="inline w-4 h-4 mr-2" />Password</>}
              placeholder="Create a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4"
            />

            {/* Confirm Password Input */}
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              label={<><Lock className="inline w-4 h-4 mr-2" />Confirm Password</>}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mb-4"
            />

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserPlus className="w-4 h-4" />
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
        </div>

        {/* Login Link */}
        <div className="text-center text-slate-400">
          Already have an account?{' '}
          <a href="/login" className="text-primary-400 hover:text-primary-300 font-semibold">
            Sign in here
          </a>
        </div>
      </div>
    </div>
  );
};
