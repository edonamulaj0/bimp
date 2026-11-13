import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { resolve } from 'node:path';

const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  root: 'apps/web',
  plugins: [preact(), cloudflare({ configPath: r('wrangler.jsonc'), persistState: { path: r('.wrangler/state') } })],
  environments: {
    client: { build: { chunkSizeWarningLimit: 700, rollupOptions: { input: { main: r('apps/web/index.html'), app: r('apps/web/app/index.html') } } } },
  },
});
