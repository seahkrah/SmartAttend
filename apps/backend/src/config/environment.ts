/**
 * Environment Configuration
 * 
 * Manages environment-specific settings for development, staging, and production.
 * This file is source-controlled. Secrets are injected via environment variables.
 */

export interface EnvironmentConfig {
  nodeEnv: 'development' | 'staging' | 'production';
  backend: {
    port: number;
    databaseUrl: string;
    jwtSecret: string;
    sessionTimeoutMs: number;
  };
  frontend: {
    port: number;
    apiBaseUrl: string;
  };
  security: {
    mfaEnabled: boolean;
    ipAllowlistEnabled: boolean;
    rateLimitRequests: number;
    rateLimitWindowMs: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    toFile: boolean;
  };
  superadmin: {
    bootstrapEnabled: boolean;
    forceBootstrap: boolean;
  };
}

const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'staging' | 'production';

function validateRequiredEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  
  if (!value && !defaultValue) {
    throw new Error(
      `[ENVIRONMENT] Missing required environment variable: ${key}\n` +
      `Ensure .env file exists and contains all required variables. See .env.example for template.`
    );
  }
  
  return value || defaultValue || '';
}

function validateDatabaseUrl(url: string): string {
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error(
      `[ENVIRONMENT] Invalid DATABASE_URL format.\n` +
      `Expected PostgreSQL connection string, got: ${url.substring(0, 50)}...\n` +
      `Format: postgresql://user:password@host:port/database`
    );
  }
  return url;
}

function validateApiUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(
      `[ENVIRONMENT] Invalid API Base URL format.\n` +
      `Expected http(s) URL, got: ${url}`
    );
  }
  return url;
}

// Load and validate configuration
export const config: EnvironmentConfig = {
  nodeEnv,

  backend: {
    port: parseInt(process.env.BACKEND_PORT || '3000', 10),
    databaseUrl: validateDatabaseUrl(
      validateRequiredEnvVar('DATABASE_URL')
    ),
    jwtSecret: validateRequiredEnvVar(
      'JWT_SECRET',
      nodeEnv === 'development' ? 'dev-secret-key-change-in-production' : undefined
    ),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000', 10),
  },

  frontend: {
    port: parseInt(process.env.FRONTEND_PORT || '5173', 10),
    apiBaseUrl: validateApiUrl(
      process.env.VITE_API_BASE_URL ||
      (nodeEnv === 'development' ? 'http://localhost:3000/api' : '')
    ),
  },

  security: {
    mfaEnabled: process.env.SUPERADMIN_MFA_ENABLED === 'true',
    ipAllowlistEnabled: process.env.SUPERADMIN_IP_ALLOWLIST_ENABLED === 'true',
    rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || '5', 10),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },

  logging: {
    level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
    toFile: process.env.LOG_TO_FILE === 'true',
  },

  superadmin: {
    bootstrapEnabled: nodeEnv === 'development',
    forceBootstrap: process.env.FORCE_BOOTSTRAP === 'true' && nodeEnv === 'development',
  },
};

// Validate environment consistency
if (nodeEnv === 'production') {
  if (config.backend.jwtSecret === 'dev-secret-key-change-in-production') {
    throw new Error(
      '[ENVIRONMENT] Production environment detected but JWT_SECRET is not set.\n' +
      'Set a unique JWT_SECRET environment variable before deploying to production.'
    );
  }

  if (config.frontend.apiBaseUrl.includes('localhost')) {
    throw new Error(
      '[ENVIRONMENT] Production environment detected but API URL points to localhost.\n' +
      'Set VITE_API_BASE_URL to production server URL.'
    );
  }
}

// Log environment info (redact secrets)
console.log(`[ENVIRONMENT] Node environment: ${nodeEnv.toUpperCase()}`);
console.log(`[ENVIRONMENT] Database: ${config.backend.databaseUrl.substring(0, 30)}...`);
console.log(`[ENVIRONMENT] Backend port: ${config.backend.port}`);
console.log(`[ENVIRONMENT] API Base URL: ${config.frontend.apiBaseUrl}`);
console.log(`[ENVIRONMENT] Security: MFA=${config.security.mfaEnabled}, IP Allowlist=${config.security.ipAllowlistEnabled}`);
console.log(`[ENVIRONMENT] Superadmin Bootstrap: Enabled=${config.superadmin.bootstrapEnabled}, Force=${config.superadmin.forceBootstrap}`);

export default config;
