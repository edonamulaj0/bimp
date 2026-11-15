const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const f = path.join(__dirname, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
const FPS = 30, TOTAL = 64, N = FPS * TOTAL, W = 4;
(async () => {
  await new Promise((ok) => srv.listen(8124, ok));
  fs.rmSync('frames', { recursive: true, force: true }); fs.mkdirSync('frames');
  const b = await chromium.launch();
  await Promise.all([...Array(W)].map(async (_, w) => {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.goto('http://localhost:8124/index.html'); await p.waitForFunction('window.ready');
    for (let i = w; i < N; i += W) {
      await p.evaluate((t) => window.seek(t), i / FPS);
      await p.screenshot({ path: `frames/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 97 });
    }
  }));
  await b.close(); srv.close(); console.log('frames done');
})();
