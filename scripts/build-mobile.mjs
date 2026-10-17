import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const target = process.argv[2] || null;
if (target && !['android', 'ios'].includes(target)) throw new Error('Target must be android or ios.');

const configuredBase = process.env.MEDAR_OPS_API_BASE_URL?.trim() || process.env.VITE_API_BASE_URL?.trim() || 'https://medar-ops.dengxiao445.workers.dev';
let parsedBase;
try { parsedBase = new URL(configuredBase); } catch { throw new Error('MEDAR_OPS_API_BASE_URL must be a valid absolute URL.'); }
if (parsedBase.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedBase.hostname)) throw new Error('The mobile app API must use HTTPS.');
if (parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) throw new Error('Configure the API origin only, without a path, query or fragment.');
if (parsedBase.hostname === 'medar-api.dengxiao445.workers.dev') throw new Error('medar-api is the public demo. The mobile app must use the authenticated operational Worker.');

const env = {
  ...process.env,
  VITE_API_BASE_URL: parsedBase.origin,
  VITE_ENABLE_AUTH_UI: 'true',
  VITE_APP_VERSION: process.env.VITE_APP_VERSION || process.env.GITHUB_SHA || pkg.version || '0.1.0',
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
let platforms = target ? [target] : ['android', 'ios'].filter(platform => existsSync(resolve(root, platform)));
if (target && !existsSync(resolve(root, target))) await run('npx', ['cap', 'add', target]);
if (platforms.length === 0) {
  console.log('Web assets built with the canonical Medar API. Add Android or iOS with npm run mobile:android:prepare or npm run mobile:ios:prepare.');
} else {
  for (const platform of platforms) await run('npx', ['cap', 'sync', platform]);
}
console.log('Mobile build configured for ' + parsedBase.origin + '; all clients use the same Medar API and database.');
