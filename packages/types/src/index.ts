/**
 * Export all shared types from a single entry point
 */

export * from './auth';
export * from './attendance';
export * from './school';
export * from './corporate';
export * from './common';

// Infrastructure exports - namespace to avoid ApiResponse conflict
export * as Infrastructure from './infrastructure';

