import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Shield } from 'lucide-react';
import { JjeloTechLogo } from '../components/BrandLogo';
import { PasswordInput } from '../components/PasswordInput';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../components/Toast';
import { apiClient } from '../services/api';
import { FormProblems, PasswordRules } from '../components/auth/AuthShell';

export const ChangePasswordPage: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);

  const [problems, setProblems] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProblems([]);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      // The server applies the password policy and says what is wrong.
      const res = await apiClient.post('/auth/change-password', { currentPassword, newPassword, confirmPassword });
      const ended = Number(res.data?.otherSessionsEnded ?? 0);

      // Clear the mustResetPassword flag in the store
      if (user) {
        setUser({ ...user, mustResetPassword: false });
      }

      addToast({
        type: 'success',
        title: 'Password Changed',
        message: ended > 0
          ? `Your password has been updated and ${ended} other signed-in ${ended === 1 ? 'device was' : 'devices were'} signed out.`
          : 'Your password has been updated.',
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
        } else if (currentUser?.role === 'guardian') {
          navigate('/guardian');
        } else {
          navigate('/dashboard');
        }
      }, 0);
    } catch (err: any) {
      const data = err?.response?.data;
      setError(data?.error ?? 'Failed to change password');
      setProblems(Array.isArray(data?.problems) ? data.problems : []);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <JjeloTechLogo className="justify-center mb-4 text-white" size="lg" />
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-white">
              {user?.mustResetPassword ? 'Choose a new password' : 'Change password'}
            </h2>
          </div>
          <p className="text-sm text-slate-300 mb-6">
            {user?.mustResetPassword
              ? 'Your administrator has asked you to choose a new password before continuing.'
              : 'Other devices signed in to your account will be signed out.'}
          </p>

          <div className="mb-4"><FormProblems error={error} problems={problems} /></div>

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
                placeholder="At least 10 characters"
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

            <PasswordRules />

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
