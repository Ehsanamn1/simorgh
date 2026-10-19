import { neon } from '@neondatabase/serverless';

type MedarSqlFactory = (url: string) => any;

declare global {
  // Injected by the Node.js hosting adapter before the Worker entrypoint is imported.
  // Cloudflare Worker deployments do not define this hook and continue using Neon.
  var __MEDAR_SQL_FACTORY__: MedarSqlFactory | undefined;
}

/**
 * Shared SQL boundary:
 * - Cloudflare Worker: Neon serverless driver.
 * - Node.js hosting: postgres.js adapter injected before worker/index.ts is loaded.
 *
 * The runtime adapter intentionally returns a structural SQL client; row shapes
 * are annotated at their use sites to keep strict TypeScript checks deterministic.
 */
export function sqlForUrl(url: string): any {
  if (typeof globalThis.__MEDAR_SQL_FACTORY__ === 'function') {
    return globalThis.__MEDAR_SQL_FACTORY__(url);
  }
  return neon(url);
}
