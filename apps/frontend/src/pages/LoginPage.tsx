import React from 'react';
import { LogIn, Lock, Mail } from 'lucide-react';
import { SmartAttendLogo } from '../components/BrandLogo';
import { PasswordInput } from '../components/PasswordInput';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [platform, setPlatform] = React.useState<'school' | 'corporate'>('school');
  const [platformMismatch, setPlatformMismatch] = React.useState<string | null>(null);
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlatformMismatch(null);
    try {
      await login(email, password, platform);
      
      // Route based on role after login
      setTimeout(() => {
        const currentUser = useAuthStore.getState().user;
        
        // Force password change for users with must_reset_password flag
        if (currentUser?.mustResetPassword) {
          navigate('/change-password');
          return;
        }
        
        if (currentUser?.role === 'superadmin') {
          navigate('/superadmin');
        } else if (currentUser?.role === 'admin') {
          // Navigate to platform-specific admin dashboard
          if (currentUser.platform === 'school') {
            navigate('/admin/school/dashboard');
          } else if (currentUser.platform === 'corporate') {
            navigate('/admin/corporate/dashboard');
          } else {
            navigate('/admin');
          }
        } else if (currentUser?.role === 'faculty') {
          navigate('/faculty');
        } else if (currentUser?.role === 'hr') {
          navigate('/hr');
        } else if (currentUser?.role === 'student' || currentUser?.role === 'employee') {
          navigate('/student');
        } else {
          navigate('/dashboard');
        }
      }, 0);
    } catch (err: any) {
      // Check for platform mismatch error
      const responseData = err?.response?.data;
      if (responseData?.code === 'PLATFORM_MISMATCH' && responseData?.correctPlatform) {
        setPlatformMismatch(responseData.correctPlatform);
      }
    }
  };

  React.useEffect(() => {
    return () => clearError();
  }, [clearError]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary-500/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-secondary-600/20 rounded-full filter blur-3xl animate-pulse-slow"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <SmartAttendLogo size="lg" showText={true} />
          <p className="text-slate-400 mt-4">Welcome back to your attendance hub</p>
        </div>

        {/* Form Card */}
        <div className="card mb-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Platform Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Platform Type
              </label>
              <div className="flex gap-3">
                <label className="flex-1 flex items-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer hover:bg-slate-800/50 transition" style={{ borderColor: platform === 'school' ? '#5d7fff' : undefined }}>
                  <input
                    type="radio"
                    value="school"
                    checked={platform === 'school'}
                    onChange={(e) => setPlatform(e.target.value as 'school' | 'corporate')}
                    className="w-4 h-4"
                  />
                  <span className="text-slate-300">School</span>
                </label>
                <label className="flex-1 flex items-center gap-2 p-3 border border-slate-700 rounded-lg cursor-pointer hover:bg-slate-800/50 transition" style={{ borderColor: platform === 'corporate' ? '#5d7fff' : undefined }}>
                  <input
                    type="radio"
                    value="corporate"
                    checked={platform === 'corporate'}
                    onChange={(e) => setPlatform(e.target.value as 'school' | 'corporate')}
                    className="w-4 h-4"
                  />
                  <span className="text-slate-300">Corporate</span>
                </label>
              </div>
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

            {/* Password Input */}
            <PasswordInput
              id="password"
              name="password"
              label={<><Lock className="inline w-4 h-4 mr-2" />Password</>}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4"
            />

            {/* Error Message */}
            {error && !platformMismatch && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Platform Mismatch Warning */}
            {platformMismatch && (
              <div className="p-4 bg-amber-500/15 border border-amber-500/50 rounded-lg">
                <p className="text-amber-300 text-sm font-medium mb-2">
                  ⚠️ Wrong platform selected
                </p>
                <p className="text-amber-200/80 text-sm mb-3">
                  Your account is registered under the <strong className="text-amber-100">{platformMismatch === 'school' ? 'School' : 'Corporate'}</strong> platform. Please switch to continue.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPlatform(platformMismatch as 'school' | 'corporate');
                    setPlatformMismatch(null);
                    clearError();
                  }}
                  className="w-full py-2 px-4 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 rounded-lg text-amber-200 text-sm font-medium transition-colors"
                >
                  Switch to {platformMismatch === 'school' ? 'School' : 'Corporate'} and retry
                </button>
              </div>
            )}

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center text-slate-300 hover:text-slate-200 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 mr-2 rounded border-slate-600 bg-slate-900" />
                Remember me
              </label>
              <a href="#" className="text-primary-400 hover:text-primary-300 font-medium">
                Forgot password?
              </a>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4" />
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Sign Up Link */}
        <div className="text-center text-slate-400">
          Don't have an account?{' '}
          <a href="/register" className="text-primary-400 hover:text-primary-300 font-semibold">
            Sign up here
          </a>
        </div>
      </div>
    </div>
  );
};
