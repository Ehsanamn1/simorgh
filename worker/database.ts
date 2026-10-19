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
 * The factory is intentionally structurally typed because Neon and postgres.js
 * expose different result types while both implement the query interface used here.
 */
export function sqlForUrl(url: string): any {
  if (typeof globalThis.__MEDAR_SQL_FACTORY__ === 'function') {
    return globalThis.__MEDAR_SQL_FACTORY__(url);
  }
  return neon(url);
}
