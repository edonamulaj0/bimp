import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const r = (p: string) => resolve(__dirname, p);

// Marketing pages share a header and footer: <!-- @include header.html --> is replaced at build and dev time.
const partials = {
  name: 'bimp-partials',
  transformIndexHtml: {
    order: 'pre' as const,
    handler: (html: string) => html.replace(/<!--\s*@include\s+([\w.-]+)\s*-->/g, (_: string, f: string) => readFileSync(r(`apps/web/partials/${f}`), 'utf8')),
  },
};

export default defineConfig({
  root: 'apps/web',
  plugins: [partials, preact(), cloudflare({ configPath: r('wrangler.jsonc'), auxiliaryWorkers: [{ configPath: r('ingest/wrangler.jsonc') }], persistState: { path: r('.wrangler/state') } })],
  environments: {
    client: { build: { chunkSizeWarningLimit: 700, rollupOptions: { input: { main: r('apps/web/index.html'), product: r('apps/web/product/index.html'), method: r('apps/web/method/index.html'), about: r('apps/web/about/index.html'), app: r('apps/web/app/index.html') } } } },
  },
});
