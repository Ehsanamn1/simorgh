import { spawn } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const apiBase = '/api/medar';
const appBase = '/madar/';
const env = { ...process.env, VITE_API_BASE_URL: apiBase, VITE_ENABLE_AUTH_UI: 'true', VITE_DISABLE_API_UI: 'false', VITE_APP_VERSION: process.env.VITE_APP_VERSION || process.env.GITHUB_SHA || '0.1.0' };
function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(command + ' exited with code ' + (code ?? 'unknown'))));
  });
}
await run('npm', ['run', 'typecheck']);
await run('npx', ['vite', 'build', '--base=' + appBase]);
const dist = resolve(root, 'dist');
for (const file of ['index.html','manifest.webmanifest','sw.js','medar-icon-192.svg','medar-icon-512.svg']) {
  const info = await stat(resolve(dist, file)).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error('Missing hosted Madar build file: dist/' + file);
}
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!html.includes('id="root"') || html.includes('/src/main.tsx')) throw new Error('Madar HTML shell validation failed.');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== './app/home' || manifest.scope !== './') throw new Error('Madar PWA manifest has unexpected start_url or scope.');
const jsNames = (await readdir(resolve(dist, 'assets'))).filter(name => name.endsWith('.js'));
if (!jsNames.length) throw new Error('Madar JavaScript bundle missing.');
const js = (await Promise.all(jsNames.map(name => readFile(resolve(dist, 'assets', name), 'utf8')))).join('\n');
if (!js.includes('simorgh-signin-layer') || !js.includes('ثبت‌نام عمومی غیرفعال است')) throw new Error('Private sign-in gate is missing from Madar bundle.');
if (!js.includes(apiBase)) throw new Error('Same-origin Medar API proxy path was not embedded.');
await writeFile(resolve(dist, 'medar-deployment.json'), JSON.stringify({ app: 'Madar', release: 'raz-sahra-subpath', appBase, apiBase, appVersion: env.VITE_APP_VERSION, builtAt: new Date().toISOString(), note: 'No credentials or database secrets are included. Server must proxy /api/medar to the operational Medar API.' }, null, 2) + '\n');
console.log('Madar subpath build validated: /madar/ with API proxy ' + apiBase);
