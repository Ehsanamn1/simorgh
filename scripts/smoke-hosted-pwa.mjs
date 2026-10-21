import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.MEDAR_PWA_SMOKE_PORT || 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MEDAR_PWA_SMOKE_PORT must be a valid non-privileged port.');
const origin = 'http://127.0.0.1:' + port;
const deployment = JSON.parse(await readFile(resolve('dist/medar-deployment.json'), 'utf8'));
const apiOrigin = new URL(process.env.MEDAR_WEB_API_BASE_URL || deployment.apiOrigin || 'https://medar-ops.dengxiao445.workers.dev').origin;
const viteCli = resolve('node_modules/vite/bin/vite.js');
const server = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  stdio: 'ignore',
  windowsHide: true,
});
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error('Vite preview exited before it became ready.');
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Retry until Vite preview is listening.
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for Vite preview at ' + origin);
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  // Keep the test independent of production identities and production data.
  await page.route(apiOrigin + '/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let payload = { ok: true };
    if (pathname === '/api/auth/me') payload = { user: null, memberships: [] };
    else if (pathname === '/api/workspace/memberships') payload = { memberships: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'cache-control': 'no-store',
      },
      body: JSON.stringify(payload),
    });
  });

  const rootResponse = await page.goto(origin + '/app/home', { waitUntil: 'networkidle', timeout: 30000 });
  expect(rootResponse?.status()).toBe(200);
  await page.locator('#app-boot-screen').waitFor({ state: 'detached', timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();

  const manifestResponse = await page.request.get(origin + '/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe('./app/home');
  expect(manifest.scope).toBe('./');
  expect(manifest.display).toBe('standalone');
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, origin + '/manifest.webmanifest');
    const response = await page.request.get(iconUrl.href);
    expect(response.status(), 'PWA icon should be served: ' + iconUrl.pathname).toBe(200);
  }

  const workerResponse = await page.request.get(origin + '/sw.js');
  expect(workerResponse.status()).toBe(200);
  expect(await workerResponse.text()).toContain('medar-shell-v5');

  // A nested React Router route must serve the SPA entry instead of a host 404.
  const membersResponse = await page.goto(origin + '/app/members', { waitUntil: 'networkidle', timeout: 30000 });
  expect(membersResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();

  let registrationFound = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    registrationFound = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration('/')));
    if (registrationFound) break;
    await sleep(250);
  }
  expect(registrationFound, 'Production PWA service worker should register on the secure-context localhost origin').toBe(true);
  expect(pageErrors, 'PWA navigation must not produce uncaught browser errors').toEqual([]);

  console.log('Hosted PWA smoke passed: direct SPA routes, private sign-in shell, manifest, icons, service worker asset and registration.');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await sleep(100);
  if (server.exitCode === null) server.kill('SIGKILL');
}
