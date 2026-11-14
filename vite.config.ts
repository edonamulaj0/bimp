import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const r = (p: string) => resolve(import.meta.dirname, p);

// Marketing pages share a header and footer: <!-- @include header.html --> is replaced at build and dev time.
const partials = {
  name: 'bimp-partials',
  transformIndexHtml: {
    order: 'pre' as const,
    handler: (html: string) => html.replace(/<!--\s*@include\s+([\w.-]+)\s*-->/g, (_: string, f: string) => readFileSync(r(`apps/web/partials/${f}`), 'utf8')),
  },
};

// A plain `wrangler deploy` from the repo root (e.g. a Workers Builds deploy command without -c) must deploy the built
// `bimp` Worker, not the source wrangler.jsonc (which has no assets directory). Wrangler follows this redirect file.
const deployRedirect = {
  name: 'bimp-deploy-redirect',
  apply: 'build' as const,
  closeBundle() {
    if (!existsSync(r('apps/web/dist/bimp/wrangler.json'))) return;
    mkdirSync(r('.wrangler/deploy'), { recursive: true });
    writeFileSync(r('.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../apps/web/dist/bimp/wrangler.json' }) + '\n');
  },
};

export default defineConfig({
  root: 'apps/web',
  plugins: [partials, deployRedirect, preact(), cloudflare({ configPath: r('wrangler.jsonc'), auxiliaryWorkers: [{ configPath: r('ingest/wrangler.jsonc') }], persistState: { path: r('.wrangler/state') } })],
  environments: {
    client: { build: { chunkSizeWarningLimit: 700, rollupOptions: { input: { main: r('apps/web/index.html'), product: r('apps/web/product/index.html'), pricing: r('apps/web/pricing/index.html'), changelog: r('apps/web/changelog/index.html'), docs: r('apps/web/docs/index.html'), privacy: r('apps/web/privacy/index.html'), terms: r('apps/web/terms/index.html'), company: r('apps/web/company/index.html'), app: r('apps/web/app/index.html') } } } },
  },
});
