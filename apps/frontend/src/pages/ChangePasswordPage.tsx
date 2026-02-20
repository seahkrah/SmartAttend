import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Shield } from 'lucide-react';
import { SmartAttendLogo } from '../components/BrandLogo';
import { PasswordInput } from '../components/PasswordInput';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../components/Toast';
import { frontendConfig } from '../config/environment';

export const ChangePasswordPage: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, setUser, token } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${frontendConfig.apiBaseUrl}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to change password');
      }

      // Clear the mustResetPassword flag in the store
      if (user) {
        setUser({ ...user, mustResetPassword: false });
      }

      addToast({
        type: 'success',
        title: 'Password Changed',
        message: 'Your password has been updated successfully.',
        duration: 4000,
      });

      // Navigate to appropriate dashboard
      setTimeout(() => {
        const currentUser = useAuthStore.getState().user;
        if (currentUser?.role === 'admin') {
          if (currentUser.platform === 'school') {
            navigate('/admin/school/dashboard');
          } else {
            navigate('/admin/corporate/dashboard');
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
      setError(err.message || 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <SmartAttendLogo className="mx-auto mb-4" size="lg" />
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-white">Password Reset Required</h2>
          </div>
          <p className="text-sm text-slate-300 mb-6">
            Your account was created with a default password. Please set a new password to continue.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/40 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">
                Current Password
              </label>
              <PasswordInput
                id="currentPassword"
                name="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
              />
              <p className="text-xs text-slate-400 mt-1">
                Your default password was provided by your administrator.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">
                New Password
              </label>
              <PasswordInput
                id="newPassword"
                name="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min. 6 characters)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">
                Confirm New Password
              </label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Updating Password...
                </span>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  Set New Password
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
