import { neon } from '@neondatabase/serverless';

type NeonSql = ReturnType<typeof neon>;
type MedarSqlFactory = (url: string) => NeonSql;

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
 * Keep the existing Neon type at the application boundary so strict typechecking
 * remains useful for both runtimes; the Node adapter implements the same used API.
 */
export function sqlForUrl(url: string): NeonSql {
  if (typeof globalThis.__MEDAR_SQL_FACTORY__ === 'function') {
    return globalThis.__MEDAR_SQL_FACTORY__(url);
  }
  return neon(url);
}
