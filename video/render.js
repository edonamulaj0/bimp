// node render.js <take>  → frames/NNNNN.jpg at 30 fps from film.html, then prints the film's cue times
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const f = path.join(__dirname, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
const FPS = 30, W = 4, take = process.argv[2] || 'take';
(async () => {
  await new Promise((ok) => srv.listen(8126, ok));
  fs.rmSync('frames', { recursive: true, force: true }); fs.mkdirSync('frames');
  const b = await chromium.launch(); let info;
  await Promise.all([...Array(W)].map(async (_, w) => {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.goto(`http://localhost:8126/film.html?take=${take}`); await p.waitForFunction('window.ready', null, { timeout: 60000 });
    info = await p.evaluate(() => ({ total: window.TOTAL, marks: window.marks }));
    const N = Math.round(info.total * FPS);
    for (let i = w; i < N; i += W) {
      await p.evaluate((t) => window.seek(t), i / FPS);
      await p.screenshot({ path: `frames/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 96 });
    }
  }));
  await b.close(); srv.close();
  fs.writeFileSync('cues.json', JSON.stringify(info)); console.log('done', info.total);
})();
