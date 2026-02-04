import React from 'react';
import { LogIn, Lock, Mail, User } from 'lucide-react';
import { SmartAttendLogo } from '../components/BrandLogo';
import { PasswordInput } from '../components/PasswordInput';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';

export const SuperadminRegisterPage: React.FC = () => {
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!fullName || !email || !password || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      await axios.post('http://localhost:5000/api/auth/register-superadmin', {
        fullName,
        email,
        password,
        confirmPassword
      });

      setSuccess(true);
      setFullName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');

      // Show success message for 3 seconds then redirect to superadmin login
      setTimeout(() => {
        navigate('/login-superadmin');
      }, 3000);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'Registration failed. Please try again.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md"
        >
          <div className="mb-8">
            <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-white mb-4">
            Superadmin Account Created!
          </h1>
          <p className="text-slate-400 mb-8">
            Your superadmin account has been successfully created.
          </p>
          <p className="text-slate-500 text-sm mb-6">
            Redirecting to login in a few seconds...
          </p>

          <button
            onClick={() => navigate('/login-superadmin')}
            className="btn-primary inline-flex items-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Go to Login
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary-500/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-secondary-600/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <SmartAttendLogo size="lg" showText={true} />
          <p className="text-slate-400 mt-4">Create Superadmin Account</p>
        </div>

        {/* Form Card */}
        <div className="card mb-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full Name Input */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <User className="inline w-4 h-4 mr-2" />
                Full Name
              </label>
              <input
                type="text"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field"
                disabled={isLoading}
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
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                disabled={isLoading}
                required
              />
            </div>

            {/* Password Input */}
            <PasswordInput
              id="password"
              name="password"
              label={<><Lock className="inline w-4 h-4 mr-2" />Password</>}
              placeholder="Enter your password (min 6 characters)"
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
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm"
              >
                {error}
              </motion.div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4" />
              {isLoading ? 'Creating Account...' : 'Create Superadmin Account'}
            </button>
          </form>

          {/* Info Box */}
          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-blue-300 text-sm">
              <span className="font-semibold">⚠️ Important:</span> This creates a superadmin account with full platform access. Use with caution.
            </p>
          </div>
        </div>

        {/* Back to Login Link */}
        <div className="text-center text-slate-400">
          Already have an account?{' '}
          <a href="/login" className="text-primary-400 hover:text-primary-300 font-semibold">
            Sign in here
          </a>
        </div>
      </motion.div>
    </div>
  );
};
