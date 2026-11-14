// Renders promo/index.html frame by frame with Playwright and pipes the frames to ffmpeg.
//   node promo/render.mjs                 full video (silent) -> promo/out/video.mp4
//   node promo/render.mjs --stills 3,12   PNG stills at those seconds -> promo/out/stills/
// Run from the repo root; it serves the repo on a local port so the page can load fonts and partials.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/promo/index.html`;

const args = process.argv.slice(2);
const stillsAt = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url);
await page.waitForFunction('window.ready === true', null, { timeout: 120000 });
const { DUR, FPS } = await page.evaluate(() => ({ DUR: window.DUR, FPS: window.FPS }));
mkdirSync('promo/out/stills', { recursive: true });

if (stillsAt) {
  for (const t of stillsAt) { await page.evaluate((t) => window.render(t), t); await page.screenshot({ path: `promo/out/stills/${t.toFixed(2).padStart(6, '0')}.png` }); }
} else {
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'promo/out/video.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(DUR * FPS);
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 97 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
}
await browser.close();
server.close();
