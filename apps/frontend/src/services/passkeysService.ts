import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { axiosClient } from '../utils/axiosClient';
import { apiClient } from './api';

/**
 * Passkeys (/auth/passkeys): adding and removing them, signing in with one,
 * and confirming who you are with one. The browser and the device do the
 * cryptography; the API checks it.
 */

export interface Passkey {
  id: string;
  name: string;
  synced: boolean;
  deviceType: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export const passkeysSupported = (): boolean => browserSupportsWebAuthn();

export const passkeysService = {
  list: async (): Promise<Passkey[]> => (await axiosClient.get('/auth/passkeys')).data.passkeys,

  /** Asks the device for a new passkey and registers it. */
  add: async (name: string): Promise<Passkey> => {
    const options = (await axiosClient.post('/auth/passkeys/register/options', {})).data;
    const response = await startRegistration({ optionsJSON: options });
    return (await axiosClient.post('/auth/passkeys/register/verify', { response, name })).data.passkey;
  },

  remove: async (id: string): Promise<void> => {
    await axiosClient.delete(`/auth/passkeys/${id}`);
  },

  /** Signs in with a passkey the device offers; the API sets the session cookies. */
  signIn: async (): Promise<any> => {
    const { challengeId, options } = (await apiClient.post('/auth/passkeys/sign-in/options', {})).data;
    const response = await startAuthentication({ optionsJSON: options });
    return (await apiClient.post('/auth/passkeys/sign-in/verify', { challengeId, response })).data;
  },

  /** Confirms who you are for a sensitive action (step-up). */
  stepUp: async (): Promise<void> => {
    const options = (await axiosClient.post('/auth/passkeys/step-up/options', {})).data;
    const response = await startAuthentication({ optionsJSON: options });
    await axiosClient.post('/auth/passkeys/step-up/verify', { response });
  },
};
