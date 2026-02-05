/**
 * API Latency Tracking Middleware
 * Records response time and status code for all API requests
 */

import { Request, Response, NextFunction } from 'express';
import { recordAPILatency } from '../services/metricsService.js';

// Extend Express Request to include custom properties
declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      tenantId?: string;
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

    // Extract tenant ID from request (from JWT or headers)
    const tenantId = _req.tenantId || _req.headers['x-tenant-id'] as string || 'system';

    // Skip metrics recording for health check endpoints
    if (!_req.path.includes('/health')) {
      // Record metrics asynchronously (fire and forget)
      recordAPILatency({
        endpoint: _req.path,
        http_method: _req.method,
        status_code: res.statusCode,
        response_time_ms: responseTimeMs,
        tenant_id: tenantId,
        created_by_user_id: (_req.user as any)?.id || undefined,
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
 * Middleware to extract and set tenant ID from JWT or headers
 * Used by latency tracking middleware
 */
export function tenantIdExtractorMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // Try to get tenant ID from JWT claims
  if ((req.user as any)?.tenant_id) {
    req.tenantId = (req.user as any).tenant_id;
  }
  // Fall back to x-tenant-id header
  else if (req.headers['x-tenant-id']) {
    req.tenantId = req.headers['x-tenant-id'] as string;
  }

  next();
}
