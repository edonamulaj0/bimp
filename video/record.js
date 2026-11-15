// Records the real bimp app, step by step: every mouse step, keystroke and wait is a screenshot with a nominal
// duration, so the film can be assembled at a steady 30 fps whatever the capture speed was.
// node take.js <project name> [scenes…]
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://bimp.edonaamulaj.workers.dev/app/';
const OUT = process.env.OUT || 'take';
const NAME = process.argv[2] || 'Apartment A';
const FPS = 30;
const Q1 = 'Where are the corridors, and how big are they in total?';
const Q2 = 'How many 50 × 50 cm tiles (0.25 m² each) do I need for the floor of Schlafzimmer 0.11?';
const Q3 = 'How wide is this door, and which rooms does it connect?';

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, storageState: 'state.json' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  const frames = []; let seg = 'pre', mx = 1500, my = 980, n = 0;
  const save = () => fs.writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames));
  const shot = async (dur, extra = {}) => {
    const f = String(n++).padStart(5, '0') + '.jpg';
    await p.screenshot({ path: `${OUT}/${f}`, type: 'jpeg', quality: 92 });
    frames.push({ f, dur, x: mx, y: my, seg, ...extra });
  };
  const mark = (s) => { seg = s; console.log(`[${new Date().toISOString().slice(14, 19)}] ${s} (frame ${n})`); save(); };
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const move = async (x, y, secs = .8) => {
    const k = Math.max(2, Math.round(secs * FPS)), x0 = mx, y0 = my;
    for (let i = 1; i <= k; i++) { const e = ease(i / k); mx = x0 + (x - x0) * e; my = y0 + (y - y0) * e; await p.mouse.move(mx, my); await shot(1 / FPS); }
  };
  const hold = async (secs, steps = 1) => { for (let i = 0; i < steps; i++) { if (i) await p.waitForTimeout(120); await shot(secs / steps); } };
  const click = async () => { await p.mouse.down(); await shot(2 / FPS, { click: 1 }); await p.mouse.up(); await p.waitForTimeout(250); await shot(4 / FPS); };
  const to = async (loc, secs = .8, dx = 0, dy = 0) => { const r = await loc.boundingBox(); if (!r) throw new Error('no box for ' + loc); await move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, secs); return r; };
  const type = async (text, per = .045) => { for (const ch of text) { await p.keyboard.type(ch); await shot(per); } };
  const waitFor = async (cond, max = 120) => { // real-time capture while waiting; durations are the real gaps
    let t = Date.now(); const t0 = t;
    while (Date.now() - t0 < max * 1000) { if (await cond()) return true; await p.waitForTimeout(60); const now = Date.now(); await shot((now - t) / 1000, { wait: 1 }); t = now; }
    console.log('TIMEOUT in', seg); return false;
  };
  const text = () => p.evaluate(() => document.body.innerText);
  const answers = async () => ((await text()).match(/model calls?/g) || []).length;
  const scrollChatToLastQuestion = async () => {
    const [from, target] = await p.evaluate(() => { const m = document.querySelector('.msgs'), u = [...m.querySelectorAll('.msg.user')].pop(); return [m.scrollTop, Math.max(0, u.offsetTop - m.offsetTop - 10)]; });
    for (let i = 1; i <= 16; i++) { const e = ease(i / 16); await p.evaluate((y) => { document.querySelector('.msgs').scrollTop = y; }, from + (target - from) * e); await shot(1 / FPS); }
  };
  const ask = async (q, tag) => {
    mark(tag + '_type'); const inp = p.getByPlaceholder(/Ask about the plan/);
    await to(inp, .8); await click(); await type(q); await hold(.3);
    const n0 = await answers(); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    mark(tag + '_think'); await shot(.2); await waitFor(async () => (await answers()) > n0);
    mark(tag + '_answer'); await p.waitForTimeout(700); console.log('  unverified note:', await p.locator('.note-card .unverified').count(), 'chat:', await p.locator('.msg.bot:last-child .unverified').count()); await shot(.3); await scrollChatToLastQuestion(); await hold(.4);
  };

  // ---------- new project ----------
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /New project/ }).first().click();
  await p.getByPlaceholder(/Riverside/).fill(NAME); await p.getByRole('button', { name: 'Create project' }).click(); await p.waitForTimeout(3500);
  const skip = p.getByRole('button', { name: /skip tour/i }); if (await skip.count()) { await skip.click(); await p.waitForTimeout(600); }
  console.log('project', p.url()); fs.writeFileSync(`${OUT}/url.txt`, p.url());
  await p.mouse.move(mx, my);

  // ---------- 1. upload ----------
  mark('empty'); await hold(1.0);
  mark('drag'); await move(940, 560, 1.1);
  mark('drop'); await p.setInputFiles('input[type=file]', 'plan-with-piano.webp'); await p.waitForTimeout(150); await shot(.15);
  mark('reading'); await waitFor(async () => /rooms ·/.test(await text()), 180);
  mark('read'); await p.waitForTimeout(1500); await hold(.6, 2);
  // look around: hover three rooms
  mark('hover'); await move(600, 700, .8); await hold(.5); await move(1060, 740, .7); await hold(.5); await move(790, 500, .7); await hold(.4);

  // ---------- 2. ask ----------
  await ask(Q1, 'q1'); mark('q1_show'); await move(900, 480, .9); await hold(1.0);
  await ask(Q2, 'q2'); mark('q2_show'); await move(1150, 760, .9); await hold(1.0);
  // close the note on the sheet, if it has a close button
  const nx = p.locator('.note-card button').first();
  if (await nx.count()) { mark('note_close'); await to(nx, .6); await click(); }

  // ---------- 3. comment ----------
  mark('c_tool'); await to(p.getByRole('button', { name: /^Comment$/ }).first(), .9); await click();
  mark('c_pin'); await move(790, 402, .9); await hold(.2); await click(); await p.waitForTimeout(400); await shot(.3);
  mark('c_type'); await to(p.locator('#pin-text'), .4, -40, -8); await click(); await type(Q3); await hold(.25);
  await to(p.locator('.pin-composer input[type=checkbox]'), .5); await click();
  await to(p.locator('.pin-composer button.btn.sm:not(.ghost)'), .5); await hold(.15); await click();
  mark('c_think'); await waitFor(async () => !(await p.locator('.pin-composer, .cm.ai.pending').count()), 150);
  mark('c_answer'); await p.waitForTimeout(900); console.log('  comment unverified:', /Unverified/.test(await p.locator('.tabpanel').first().innerText().catch(() => ''))); await hold(.5, 2); await move(1740, 330, .9); await hold(1.0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  mark('c_done'); await to(p.getByRole('button', { name: /^Select$/ }).first(), .8); await click();

  // ---------- 4. unknown symbol ----------
  const q = p.locator('.q-pin').first();
  if (await q.count()) {
    mark('s_hover'); await to(q, 1.0); await p.waitForTimeout(400); await hold(.9, 2);
    mark('s_open'); await click(); await p.waitForTimeout(500); await shot(.5);
    mark('s_type'); const name = p.locator('.name-pop input[type=text]'); await to(name, .5); await click(); await type('Grand piano', .07); await hold(.4);
    mark('s_save'); await to(p.locator('.name-pop button.btn'), .5); await hold(.15); await click();
    await waitFor(async () => !(await p.locator('.name-pop').count()), 30);
    mark('s_saved'); await p.waitForTimeout(700); await shot(.3);
    await move(mx + 90, my + 60, .4); await p.waitForTimeout(200); await shot(.1);
    const r = await p.evaluate(() => { const els = [...document.querySelectorAll('svg .fixtures *, svg .hits *')]; return null; });
    await move(498, 640, .6); await p.waitForTimeout(500); await hold(1.2, 2);
  } else console.log('NO q-pin');

  // ---------- 5. checks, escape, dimensions ----------
  mark('ov_tab'); await to(p.getByRole('tab', { name: /Overview/ }).or(p.getByRole('button', { name: /^Overview$/ })).first(), .9); await click(); await p.waitForTimeout(500); await hold(1.2, 2);
  mark('escape'); await to(p.getByRole('button', { name: /^Escape$/ }).first(), .9); await click(); await p.waitForTimeout(700); await shot(.3); await move(900, 620, .8); await hold(1.2, 2);
  mark('dims'); await to(p.getByRole('button', { name: /^Dimensioned$/ }).first(), .8); await click(); await p.waitForTimeout(800); await shot(.3); await move(1250, 930, .8); await hold(1.5, 2);
  mark('end'); save();
  await b.close();
  const tot = frames.reduce((a, f) => a + f.dur, 0); console.log('frames', frames.length, 'nominal seconds', tot.toFixed(1));
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
