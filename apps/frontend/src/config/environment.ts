/**
 * Frontend Environment Configuration
 * 
 * Vite loads environment variables prefixed with VITE_ at build time.
 * This module provides type-safe access to frontend configuration.
 */

export interface FrontendConfig {
  apiBaseUrl: string;
  isDevelopment: boolean;
  isProduction: boolean;
  isStaging: boolean;
}

export const frontendConfig: FrontendConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api',
  isDevelopment: import.meta.env.MODE === 'development',
  isProduction: import.meta.env.MODE === 'production',
  isStaging: import.meta.env.MODE === 'staging',
};

// Validate configuration
if (!frontendConfig.apiBaseUrl) {
  throw new Error(
    '[FRONTEND CONFIG] Missing VITE_API_BASE_URL environment variable.\n' +
    'Set it in .env.local or .env file and restart dev server.'
  );
}

// Log configuration info (redact sensitive data)
console.log(`[FRONTEND CONFIG] Mode: ${import.meta.env.MODE.toUpperCase()}`);
console.log(`[FRONTEND CONFIG] API Base URL: ${frontendConfig.apiBaseUrl}`);

export default frontendConfig;
