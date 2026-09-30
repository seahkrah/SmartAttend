/**
 * API Latency Tracking Middleware
 * Records response time and status code for all API requests
 */

import { Request, Response, NextFunction } from 'express';
import { recordAPILatency } from '../services/metricsService.js';
import type { TenantRequest } from '../auth/tenantContextMiddleware.js';

// Extend Express Request to include custom properties
declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      /**
       * Telemetry label only, never an authorisation input.
       *
       * This used to be set from the X-Tenant-Id header by the middleware
       * below, which runs app-wide before authentication. Routes then read it
       * as though it identified the caller's tenant, so naming another
       * tenant in a header was enough to read that tenant's data. It is now
       * derived from the resolved context after the handler has run, and the
       * name says what it is for.
       */
      telemetryTenantId?: string;
    }
  }
}

/**
 * Middleware to track API latency
 * Records endpoint, method, status code, and response time
 */
export function apiLatencyTrackingMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  // Store start time on request
  _req.startTime = startTime;

  // Override res.send to capture response
  const originalSend = res.send;
  res.send = function (data: any) {
    // Calculate response time
    const endTime = Date.now();
    const responseTimeMs = endTime - startTime;

    // res.send runs after the route handler, so the server-resolved context
    // is available here. A request with no resolved tenant is not recorded:
    // the metrics are per tenant, and the caller's word is not taken for it.
    // (It used to be recorded against the literal 'system', which is not a
    // tenant id, so every such write failed the foreign key.)
    const tenantId = (_req as TenantRequest).ctx?.tenantId;

    // Skip metrics recording for health check endpoints
    if (tenantId && !_req.path.includes('/health')) {
      // Record metrics asynchronously (fire and forget)
      recordAPILatency({
        endpoint: _req.path,
        http_method: _req.method,
        status_code: res.statusCode,
        response_time_ms: responseTimeMs,
        tenant_id: tenantId,
        created_by_user_id: (_req as TenantRequest).ctx?.userId || undefined,
      }).catch((err) => {
        // Log but don't throw - metrics recording failures shouldn't break the API
        console.error('Failed to record API latency metric:', err);
      });
    }

    // Call original send
    return originalSend.call(this, data);
  };

  next();
}

/**
 * Records the caller's stated tenant for telemetry, and nothing more.
 *
 * This middleware is mounted app-wide, ahead of authentication, so at the
 * point it runs there is no authenticated identity to derive a tenant from.
 * It used to copy the X-Tenant-Id header onto req.tenantId anyway, and the
 * metrics and simulation routes then filtered their queries on that value:
 * an authenticated caller could name any tenant in a header and read its
 * failure rates, clock drift and verification mismatches.
 *
 * What the client asserts is kept under a name that cannot be mistaken for an
 * authorisation input, and it is used only to label a request before the real
 * tenant is known. The latency recorder above prefers the resolved context.
 *
 * Nothing should read telemetryTenantId to decide what data to return. Use
 * resolveTenantContext and req.ctx.tenantId for that.
 */
export function tenantIdExtractorMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const asserted = req.headers['x-tenant-id'];
  if (typeof asserted === 'string' && asserted.length <= 64) {
    req.telemetryTenantId = asserted;
  }

  next();
}
