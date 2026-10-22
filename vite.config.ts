import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';


function offlineCorePrecachePlugin() {
  let outputDir = '';
  return {
    name: 'medar-offline-core-precache',
    apply: 'build' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outputDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const manifestPath = resolve(outputDir, '.vite', 'manifest.json');
      const serviceWorkerPath = resolve(outputDir, 'sw.js');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, {
        file?: string;
        imports?: string[];
        css?: string[];
        assets?: string[];
      }>;
      const homeEntry = Object.keys(manifest).find(key => key === 'src/WorkspaceHome.tsx' || key.endsWith('/WorkspaceHome.tsx'));
      if (!homeEntry) throw new Error('Offline precache could not find the WorkspaceHome Vite manifest entry.');
      const files = new Set<string>();
      const visited = new Set<string>();
      const addAsset = (file: string) => {
        if (/\.(?:js|css|svg|webmanifest|woff2?|png|jpe?g|webp)$/i.test(file)) files.add(file);
      };
      const visit = (key: string) => {
        if (visited.has(key)) return;
        visited.add(key);
        const entry = manifest[key];
        if (!entry) return;
        if (entry.file) addAsset(entry.file);
        for (const file of entry.css ?? []) addAsset(file);
        for (const file of entry.assets ?? []) addAsset(file);
        for (const dependency of entry.imports ?? []) visit(dependency);
      };
      visit(homeEntry);
      const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
      const marker = 'const PRECACHE_ASSETS = [];';
      if (!serviceWorker.includes(marker)) throw new Error('Service worker precache marker is missing.');
      await writeFile(serviceWorkerPath, serviceWorker.replace(marker, 'const PRECACHE_ASSETS = ' + JSON.stringify([...files]) + ';'));
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineCorePrecachePlugin()],
  build: {
    outDir: 'dist',
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) return 'vendor-react';
          if (id.includes('/node_modules/@neondatabase/')) return 'vendor-neon';
          if (
            id.includes('/node_modules/recharts/') ||
            id.includes('/node_modules/d3-')
          ) return 'vendor-charts';
        },
      },
    },
  },
  test: { environment: 'node', exclude: [...configDefaults.exclude, 'domestic-api/**'] },
});
