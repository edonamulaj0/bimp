// Marketing site motion. Scrolling is eased (Lenis) on pointer devices; headlines rise word by word from behind a
// mask; rules, guides and drawings draft themselves as they enter; photographs and plates drift slightly against the scroll. Without JS (no .js class) or with reduced motion, everything is
// simply shown and the page scrolls natively.
import Lenis from 'lenis';
import { showSplash, splashPending } from './src/brand/wordmark';

if (splashPending()) showSplash({ ready: document.fonts?.ready ?? Promise.resolve() });

const root = document.documentElement;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

if (!still && fine) new Lenis({ autoRaf: true, anchors: { offset: -88 }, lerp: 0.085, wheelMultiplier: 0.9 });

// headlines: wrap each word in a mask so it can rise into place (line breaks and <em> are kept)
const heads = $$('main h1, .sec-head h2, .ah-head h2, .bleed-text h2, .band h2').filter((h) => !h.closest('.doc, .plan, .entry'));
if (!still) for (const h of heads) {
  let n = 0;
  const walk = (node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 1) { walk(c); continue; }
      if (c.nodeType !== 3 || !c.textContent.trim()) continue;
      const frag = document.createDocumentFragment();
      for (const part of c.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(' '); continue; }
        const w = document.createElement('span'), wi = document.createElement('span');
        w.className = 'w'; wi.className = 'wi'; wi.style.setProperty('--w', n++); wi.textContent = part;
        w.append(wi); frag.append(w);
      }
      c.replaceWith(frag);
    }
  };
  walk(h);
  h.classList.add('split');
}

// reveal on entry; siblings that arrive together are staggered
const sel = '.draft, .register, .rise, .stroke, .guides, .ah-rule, .sec-rule, .split, .pl, .ws-plate, .ph, .sheet-plate, .ask, .ah-list, .formats, .facts, .contact-grid, [data-in], .sec-head > p, .tile, .plan, .feature-row > *, .page-head .lead, .page-head .cta-row, .section .table-wrap, .formats > div, .section > .wrap > .frame, .faq details, .entry, .contact-grid > div, .ah-list li, .register > div, .cols3 > div';
const els = $$(sel);
$$('.guides').forEach((g) => [...g.children].forEach((i, n) => i.style.setProperty('--gi', n)));
$$('.grid3, .grid2, .plans, .formats, .contact-grid, .cols3, .asks, .draft .titleblock').forEach((g) => [...g.children].forEach((c, n) => { if (!c.style.getPropertyValue('--k')) c.style.setProperty('--k', n % 4); }));
if (still || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('in'));
else {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  els.forEach((e) => io.observe(e));
}

// one scroll loop: header and parallax
const head = document.querySelector('.site-head');
const drift = !still && fine ? $$('[data-parallax]').map((el) => ({ el, k: parseFloat(el.dataset.parallax) || 0, sc: el.dataset.scale ? ` scale(${el.dataset.scale})` : '', y: 0 })) : [];
let last = scrollY, raf = 0;
const update = () => {
  raf = 0;
  const y = scrollY, vh = innerHeight;
  if (head) { if (y < 120 || y < last - 4) head.classList.remove('away'); else if (y > last + 4) head.classList.add('away'); }
  last = y;
  for (const d of drift) {
    const box = d.sc ? d.el.parentElement : d.el; // a scaled image drifts inside its own frame
    const r = box.getBoundingClientRect(), top = r.top - (d.sc ? 0 : d.y);
    if (top > vh * 1.3 || top + r.height < -vh * 0.3) continue;
    d.y = ((top + r.height / 2 - vh / 2) / vh) * d.k * vh;
    d.el.style.transform = `translate3d(0, ${d.y.toFixed(1)}px, 0)${d.sc}`;
  }
};
const on = () => { if (!raf) raf = requestAnimationFrame(update); };
addEventListener('scroll', on, { passive: true });
addEventListener('resize', on);
update();

// the hero plan answers for the room under the pointer, in its own title block: net area and the tiles to cover it
for (const plate of $$('[data-readout]')) {
  const q = (k) => document.querySelector(`[data-r="${k}"]`);
  const name = q('name'), area = q('area'), tiles = q('tiles'), label = q('tile-label');
  if (!name || !area) continue;
  const whole = { name: name.textContent, m2: parseFloat(plate.dataset.total), size: '' };
  let cur = whole, tile = [0.6, 0.6], t = 0;
  const count = (m2) => Math.ceil(Math.ceil(m2 / (tile[0] * tile[1]) - 1e-9) * 1.1 - 1e-9); // tiles to cover, plus 10 % waste
  const paint = () => {
    name.textContent = cur.name; area.textContent = `${cur.m2.toFixed(1)} m²${cur.size ? ` · ${cur.size}` : ''}`;
    if (tiles) tiles.textContent = count(cur.m2).toLocaleString('en');
    if (label) label.textContent = `${tile[0] * 1000} × ${tile[1] * 1000} tiles, +10 %`;
  };
  const show = (next) => {
    cur = next; clearTimeout(t);
    const bs = [name, area, tiles].filter(Boolean);
    bs.forEach((b) => b.classList.add('swap'));
    t = setTimeout(() => { paint(); bs.forEach((b) => b.classList.remove('swap')); }, 140);
  };
  for (const room of $$('.room', plate)) {
    const enter = () => show({ name: room.dataset.name, m2: parseFloat(room.dataset.m2), size: room.dataset.size });
    const leave = () => show(whole);
    room.addEventListener('pointerenter', enter); room.addEventListener('pointerleave', leave);
    room.addEventListener('focus', enter); room.addEventListener('blur', leave);
  }
  const segs = $$('[data-tile]');
  segs.forEach((b) => b.addEventListener('click', () => {
    tile = b.dataset.tile.split(',').map(Number);
    segs.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    show(cur);
  }));
  paint();
}

// header: mark the current page
const page = document.body.dataset.page;
$$(`[data-nav="${page}"]`).forEach((a) => a.setAttribute('aria-current', 'page'));
root.classList.add('ready');
