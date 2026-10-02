/**
 * The default axios instance, which several admin pages call directly with
 * same-origin '/api/...' paths, gets the same session handling as the
 * configured clients: the session cookies are sent, state-changing requests
 * carry the CSRF token, and a 401 renews the session once and retries.
 *
 * Imported once, from main.tsx, before anything makes a request.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { csrfHeader, endSession, isSessionlessAuthCall, recoverSession, redirectForMfaSetup } from './sessionRefresh';
import { frontendConfig } from '../config/environment';
import { isStepUpRequired, requestStepUp } from './stepUp';

axios.defaults.withCredentials = true;

axios.interceptors.request.use((config) => {
  Object.entries(csrfHeader(config.method)).forEach(([k, v]) => config.headers.set(k, v));
  return config;
}, undefined, { synchronous: true });

axios.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _steppedUp?: boolean };
    if (isStepUpRequired(error) && original && !original._steppedUp) {
      original._steppedUp = true;
      if (await requestStepUp()) return axios(original);
      return Promise.reject(error);
    }
    if (error.response?.status === 401 && original && !original._retry && !isSessionlessAuthCall(original.url)) {
      original._retry = true;
      if (await recoverSession(frontendConfig.apiBaseUrl)) {
        Object.entries(csrfHeader(original.method)).forEach(([k, v]) => original.headers.set(k, v));
        return axios(original);
      }
      endSession();
    }
    redirectForMfaSetup(error);
    return Promise.reject(error);
  }
);
