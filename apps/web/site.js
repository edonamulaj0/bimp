// Marketing site motion. Lines draft themselves as they enter the view (each stroke's dash set to its measured length,
// which works the same in Chromium, Firefox and Safari), the wireframe follows the scroll, and the hero's P-word is
// redrafted every few seconds. Without motion (.js missing) everything is shown as is.
const root = document.documentElement;
const motion = root.classList.contains('js');

// 1. measure strokes
const shapes = 'path, rect, circle, line';
const lens = new Map();
for (const svg of document.querySelectorAll('svg.anim')) {
  for (const el of svg.querySelectorAll(shapes)) {
    let L = 0;
    try { L = el.getTotalLength(); } catch { /* not rendered (display: none) */ }
    if (!(L > 0)) { el.style.strokeDasharray = 'none'; continue; }
    L = Math.ceil(L + 1);
    lens.set(el, L);
    el.style.transition = 'none'; // the hidden state is set instantly; only the drawing in animates
    el.style.strokeDasharray = `${L}px ${L}px`;
    el.style.strokeDashoffset = `${L}px`;
  }
}

// 2. reveal on scroll. The hidden state must be computed (and painted) before .in is added, or browsers skip the
// transition and lines just appear: flush styles now, then start observing two frames later.
const els = document.querySelectorAll('.draft, .register, .rise, .stroke, .ah-build, [data-in]');
if (!motion || !('IntersectionObserver' in window)) { for (const el of lens.keys()) el.style.transition = ''; els.forEach((e) => e.classList.add('in')); }
else {
  for (const el of lens.keys()) getComputedStyle(el).strokeDashoffset;
  void document.body.offsetHeight;
  for (const el of lens.keys()) el.style.transition = '';
  const start = () => {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    els.forEach((e) => io.observe(e));
  };
  requestAnimationFrame(() => requestAnimationFrame(start));
}

// 3. construction sequence: layers draw in turn while the pinned box crosses the viewport
const build = document.querySelector('.ah-build');
if (build) {
  const steps = [...build.querySelectorAll('.steps li')];
  const layers = [['floor', 0, 4], ['up', 0.22, 4], ['top', 0.44, 4], ['roof', 0.66, 3.4]].map(([k, at, rate]) => ({ at, rate, paths: [...build.querySelectorAll(`.${k} path`)] }));
  const pinned = () => getComputedStyle(build.querySelector('.pin-box')).position === 'sticky';
  let raf = 0, last = -1;
  const update = () => {
    raf = 0;
    const r = build.getBoundingClientRect(), span = r.height - innerHeight;
    // not pinned (narrow screens): draw the whole model once it is on screen
    const p = !motion ? 1 : pinned() && span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : r.top < innerHeight * 0.8 ? Math.min(1, last < 0 ? 0.02 : last + 0.03) : 0;
    if (Math.abs(p - last) < 0.0005) return;
    last = p;
    build.style.setProperty('--p', p.toFixed(4));
    for (const { at, rate, paths } of layers) {
      const t = Math.min(1, Math.max(0, (p - at) * rate));
      for (const el of paths) { const L = lens.get(el); if (L) el.style.strokeDashoffset = `${(L * (1 - t)).toFixed(1)}px`; }
    }
    const k = Math.min(steps.length - 1, Math.floor(p * steps.length * 0.999));
    steps.forEach((s, i) => s.classList.toggle('on', i === k));
    if (!pinned() && p < 1 && p > 0) raf = requestAnimationFrame(update); // narrow screens: keep drawing to the end
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', on, { passive: true });
  addEventListener('resize', on);
  update();
}

// 4. "Your Building Information Modeling P…": the P stays, the rest of the word is erased and redrafted
const pw = document.querySelector('.ptag .pw b');
if (pw) {
  const words = (pw.dataset.words || 'Pilot').split(',').map((w) => w.trim()).filter(Boolean);
  let i = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const type = async (to) => {
    let cur = pw.textContent;
    while (cur.length > 1) { cur = cur.slice(0, -1); pw.textContent = cur; await sleep(45); }
    await sleep(160);
    for (let k = 2; k <= to.length; k++) { pw.textContent = to.slice(0, k); await sleep(70); }
  };
  (async () => {
    for (;;) {
      await sleep(2600);
      if (document.hidden) continue;
      i = (i + 1) % words.length;
      if (motion) await type(words[i]);
      else pw.textContent = words[i];
    }
  })();
}

// header: mark the current page
document.querySelectorAll(`[data-nav="${document.body.dataset.page}"]`).forEach((a) => a.setAttribute('aria-current', 'page'));
root.classList.add('ready');
