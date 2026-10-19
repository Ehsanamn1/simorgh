import { neon } from '@neondatabase/serverless';

export type MedarSqlClient = {
  query(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};

type MedarSqlFactory = (url: string) => MedarSqlClient;

declare global {
  // Injected by the Node.js hosting adapter before the Worker entrypoint is imported.
  // Cloudflare Worker deployments do not define this hook and continue using Neon.
  var __MEDAR_SQL_FACTORY__: MedarSqlFactory | undefined;
}

/**
 * Shared SQL boundary:
 * - Cloudflare Worker: Neon serverless driver.
 * - Node.js shared hosting: postgres.js adapter injected before worker/index.ts is loaded.
 *
 * Keeping the selection at this boundary avoids leaking host-specific database code into routes.
 */
export function sqlForUrl(url: string): MedarSqlClient {
  if (typeof globalThis.__MEDAR_SQL_FACTORY__ === 'function') {
    return globalThis.__MEDAR_SQL_FACTORY__(url);
  }
  return neon(url) as unknown as MedarSqlClient;
}
