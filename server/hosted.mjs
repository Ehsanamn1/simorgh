import { serve } from '@hono/node-server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { env, loadWorker, closeDatabaseClients } from './bootstrap.mjs';
import { privateFileStore } from './private-file-store.mjs';

const assetsRoot = path.resolve(process.env.MEDAR_ASSETS_DIR || './dist');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveAsset(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('\\0')) return new Response('Bad request', { status: 400 });
  const candidate = path.resolve(assetsRoot, '.' + pathname);
  if (candidate !== assetsRoot && !candidate.startsWith(assetsRoot + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  let file = candidate;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    // SPA routes use index.html; API routes are handled by Hono before this fallback.
    file = path.join(assetsRoot, 'index.html');
  }
  try {
    const bytes = await readFile(file);
    const headers = new Headers({
      'content-type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

env.FILE_STORE = privateFileStore;
env.ASSETS = { fetch: serveAsset };

const worker = await loadWorker();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.HOST || '0.0.0.0';
const server = serve({
  fetch: (request) => worker.fetch(request, env, { waitUntil: (promise) => { void promise.catch((error) => console.error('[medar:waitUntil]', error)); } }),
  port,
  hostname,
});

console.log(`Medar hosted runtime listening on ${hostname}:${port}`);

async function shutdown() {
  server.close();
  await closeDatabaseClients();
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
