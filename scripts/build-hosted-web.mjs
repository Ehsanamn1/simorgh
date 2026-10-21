import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const rawApi = process.env.MEDAR_WEB_API_BASE_URL?.trim() || process.env.VITE_API_BASE_URL?.trim();
if (!rawApi) {
  throw new Error('Set MEDAR_WEB_API_BASE_URL to the HTTPS origin of the authenticated Medar API. Static hosting without an API is only a showcase.');
}

let parsedApi;
try { parsedApi = new URL(rawApi); } catch { throw new Error('MEDAR_WEB_API_BASE_URL must be a valid absolute URL.'); }
if (parsedApi.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedApi.hostname)) {
  throw new Error('The hosted operational app requires an HTTPS API origin.');
}
if (parsedApi.username || parsedApi.password || parsedApi.pathname !== '/' || parsedApi.search || parsedApi.hash) {
  throw new Error('Configure only the API origin (scheme + host + optional port), without credentials, path, query, or fragment.');
}
if (parsedApi.hostname === 'medar-api.dengxiao445.workers.dev') {
  throw new Error('The public medar-api demo is read-only; use the authenticated medar-ops API origin.');
}

const appVersion = process.env.VITE_APP_VERSION?.trim() || process.env.GITHUB_SHA || pkg.version || '0.1.0';
const env = {
  ...process.env,
  VITE_API_BASE_URL: parsedApi.origin,
  VITE_ENABLE_AUTH_UI: 'true',
  VITE_DISABLE_API_UI: 'false',
  VITE_APP_VERSION: appVersion,
};

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(command + ' ' + args.join(' ') + ' exited with code ' + (code ?? 'unknown')));
    });
  });
}

await run('npm', ['run', 'build']);

const dist = resolve(root, 'dist');
const requiredFiles = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  '.htaccess',
  'medar-icon-192.svg',
  'medar-icon-512.svg',
];
for (const relative of requiredFiles) {
  try {
    const info = await stat(resolve(dist, relative));
    if (!info.isFile() || info.size === 0) throw new Error('empty');
  } catch {
    throw new Error('Hosted build is missing required file dist/' + relative + '.');
  }
}

const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!html.includes('id="root"') || !html.includes('manifest.webmanifest')) {
  throw new Error('Built HTML is missing the app root or PWA manifest.');
}
if (html.includes('/src/main.tsx')) throw new Error('Build output still references the uncompiled development entry.');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== './app/home' || manifest.scope !== './') {
  throw new Error('PWA manifest must open the private app from the deployed origin root.');
}
for (const icon of manifest.icons ?? []) {
  const iconPath = resolve(dist, icon.src.replace(/^\.\//, ''));
  try { await stat(iconPath); } catch { throw new Error('PWA icon is missing: ' + icon.src); }
}

const assets = await stat(resolve(dist, 'assets'));
if (!assets.isDirectory()) throw new Error('Vite assets directory was not produced.');
const jsFiles = (await import('node:fs/promises')).readdir(resolve(dist, 'assets'));
const jsNames = (await jsFiles).filter(name => name.endsWith('.js'));
if (!jsNames.length) throw new Error('No JavaScript bundle was produced.');
const bundles = await Promise.all(jsNames.map(name => readFile(resolve(dist, 'assets', name), 'utf8')));
const allJavaScript = bundles.join('\n');
if (!allJavaScript.includes('simorgh-signin-layer') || !allJavaScript.includes('ثبت‌نام عمومی غیرفعال است')) {
  throw new Error('Hosted build does not contain the private sign-in UI with public self-registration disabled.');
}
if (!allJavaScript.includes(parsedApi.origin)) {
  throw new Error('The configured API origin was not embedded in the built JavaScript.');
}

await writeFile(resolve(dist, 'medar-deployment.json'), JSON.stringify({
  app: 'Medar',
  release: 'hosted-web',
  appVersion,
  apiOrigin: parsedApi.origin,
  builtAt: new Date().toISOString(),
  note: 'Public metadata only. Never place database URLs, API tokens, or credentials in this file.',
}, null, 2) + '\n', { mode: 0o644 });

console.log('Hosted Medar web bundle is ready in dist/.');
console.log('API origin: ' + parsedApi.origin);
console.log('PWA manifest, icons, service worker, Apache SPA fallback, sign-in gate, and API configuration verified.');
