import { axiosClient } from '../utils/axiosClient';

/**
 * Two-factor sign-in for the signed-in person's own account (/auth/mfa).
 * The code step of signing in is in the auth store (verifyMfa).
 */

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  /** Their role must use it (MFA_REQUIRED_ROLES on the server); it cannot be turned off. */
  required: boolean;
}

/** Proof for changes: the password, and a current code or a recovery code. */
export interface Reauth {
  password: string;
  code?: string;
  recoveryCode?: string;
}

export const mfaService = {
  status: async (): Promise<MfaStatus> => (await axiosClient.get('/auth/mfa')).data,

  /** A new secret, not active until confirmed with enable(). */
  setup: async (): Promise<{ secret: string; otpauthUri: string }> =>
    (await axiosClient.post('/auth/mfa/setup', {})).data,

  /** Returns the recovery codes, shown once, and a fresh access token for this session. */
  enable: async (code: string): Promise<{ recoveryCodes: string[]; accessToken: string }> =>
    (await axiosClient.post('/auth/mfa/enable', { code })).data,

  disable: async (proof: Reauth): Promise<void> => {
    await axiosClient.post('/auth/mfa/disable', proof);
  },

  newRecoveryCodes: async (proof: Reauth): Promise<string[]> =>
    (await axiosClient.post('/auth/mfa/recovery-codes', proof)).data.recoveryCodes,
};
