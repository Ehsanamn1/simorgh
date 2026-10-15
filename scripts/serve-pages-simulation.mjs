/* global process, URL */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const prefix = '/simorgh';
const port = Number(process.env.PORT ?? 4173);
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
  '.ttf': 'font/ttf',
};

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!(decoded === prefix || decoded.startsWith(prefix + '/'))) return null;
  let relative = decoded.slice(prefix.length) || '/';
  if (relative === '/' || relative.endsWith('/')) relative += 'index.html';
  const target = path.resolve(root, '.' + relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(target);
    if (info.isFile()) return target;
  } catch {
    // Missing files are handled by the caller as a 404 or SPA fallback.
  }
  // Match single-page application hosting: only non-file-looking paths fall back to index.
  if (!path.extname(relative)) return path.join(root, 'index.html');
  return null;
}

const server = createServer(async (req, res) => {
  const origin = 'http://127.0.0.1:' + port;
  const url = new URL(req.url ?? '/', origin);
  const file = await resolveFile(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    const type = mimeTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Could not read built asset');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Simorgh Pages simulation serving /simorgh/ at http://127.0.0.1:${port}/simorgh/\n`);
});
