import React from 'react';
import { LogIn, Lock, Mail } from 'lucide-react';
import { SmartAttendLogo } from '../components/BrandLogo';
import { PasswordInput } from '../components/PasswordInput';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '../store/authStore';

export const SuperadminLoginPage: React.FC = () => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const navigate = useNavigate();
  const { superadminLogin } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      await superadminLogin(email, password);

      // Clear form
      setEmail('');
      setPassword('');

      // Redirect to superadmin dashboard
      navigate('/superadmin');
    } catch (err: any) {
      const errorMessage = err.message || 'Login failed. Please try again.';
      setError(errorMessage);
      console.error('Superadmin login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

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
          <p className="text-slate-400 mt-4">Superadmin Portal</p>
        </div>

        {/* Form Card */}
        <div className="card mb-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Input */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Mail className="inline w-4 h-4 mr-2" />
                Email Address
              </label>
              <input
                type="email"
                placeholder="Enter your superadmin email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                disabled={isLoading}
                required
                autoComplete="email"
              />
            </div>

            {/* Password Input */}
            <PasswordInput
              id="password"
              name="password"
              label={<><Lock className="inline w-4 h-4 mr-2" />Password</>}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4"
              disabled={isLoading}
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
              {isLoading ? 'Signing in...' : 'Sign In as Superadmin'}
            </button>
          </form>

          {/* Security Notice */}
          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-blue-300 text-sm">
              <span className="font-semibold">lock:</span> This is a restricted superadmin portal. All actions are logged and audited.
            </p>
          </div>
        </div>

        {/* Links */}
        <div className="space-y-3 text-center text-slate-400 text-sm">
          <div>
            Don't have a superadmin account?{' '}
            <a href="/register-superadmin" className="text-primary-400 hover:text-primary-300 font-semibold">
              Create one
            </a>
          </div>
          <div>
            <a href="/login" className="text-slate-500 hover:text-slate-400">
              Back to regular login
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
