import React from 'react';
import { JjeloTechLogo } from '../BrandLogo';

/** The frame the sign-in, reset and activation pages share. */
export const AuthShell: React.FC<{ subtitle?: string; children: React.ReactNode }> = ({ subtitle, children }) => (
  <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4">
    <div className="relative z-10 w-full max-w-md">
      <div className="text-center mb-8">
        <JjeloTechLogo size="lg" className="justify-center text-white" />
        {subtitle && <p className="text-slate-400 mt-4">{subtitle}</p>}
      </div>
      <div className="card mb-6">{children}</div>
    </div>
  </div>
);

/** What the server requires of a password, said before anyone gets it wrong. */
export const PasswordRules: React.FC = () => (
  <p className="text-xs text-slate-400">
    At least 10 characters. A few ordinary words strung together is strong and easy to remember.
    Very common passwords and ones containing your email name are refused.
  </p>
);

export const FormProblems: React.FC<{ error: string | null; problems?: string[] }> = ({ error, problems }) =>
  error ? (
    <div role="alert" className="p-3 bg-red-500/15 border border-red-500/40 rounded-lg text-red-200 text-sm">
      <p>{error}</p>
      {problems && problems.length > 0 && (
        <ul className="list-disc ml-5 mt-1">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  ) : null;
