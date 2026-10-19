import postgres from 'postgres';

const clients = new Map();

globalThis.__MEDAR_SQL_FACTORY__ = (url) => {
  let client = clients.get(url);
  if (!client) {
    client = postgres(url, {
      max: Number.parseInt(process.env.MEDAR_DB_POOL_MAX || '5', 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined,
    });
    clients.set(url, client);
  }

  // The existing Worker uses both Neon-style tagged templates and sql.query().
  // postgres.js supports tagged templates natively; bridge the query() form explicitly.
  const sql = (strings, ...values) => client(strings, ...values);
  sql.query = async (query, params = []) => {
    const rows = await client.unsafe(query, params);
    return Array.from(rows);
  };
  return sql;
};

export const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  MEDAR_MODE: process.env.MEDAR_MODE || 'operational',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  AI_ENCRYPTION_KEY: process.env.AI_ENCRYPTION_KEY,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
};

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the hosted Medar runtime.');
}

export async function loadWorker() {
  // Must be dynamically imported after the SQL factory has been registered.
  const mod = await import('../worker/index.ts');
  return mod.default;
}

export async function closeDatabaseClients() {
  await Promise.all([...clients.values()].map((client) => client.end({ timeout: 5 })));
  clients.clear();
}
