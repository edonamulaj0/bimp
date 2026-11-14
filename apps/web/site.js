// Marketing site motion. Scrolling is eased (Lenis) on pointer devices; headlines rise word by word from behind a
// mask; rules, guides and drawings draft themselves as they enter; plates drift slightly against the scroll; the
// construction sequence follows scroll position. Without JS (no .js class) or with reduced motion, everything is
// simply shown and the page scrolls natively.
import Lenis from 'lenis';

const root = document.documentElement;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

if (!still && fine) new Lenis({ autoRaf: true, anchors: { offset: -88 }, lerp: 0.085, wheelMultiplier: 0.9 });

// headlines: wrap each word in a mask so it can rise into place (line breaks and <em> are kept)
const heads = $$('main h1, .sec-head h2, .ah-head h2, .ah-build h2, .band h2').filter((h) => !h.closest('.doc, .plan, .entry'));
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
const sel = '.draft, .register, .rise, .stroke, .ah-build, .guides, .ah-rule, .sec-rule, .split, .pl, .ws-plate, .ah-list, .formats, .facts, .contact-grid, [data-in], .sec-head > p, .tile, .plan, .feature-row > *, .page-head .lead, .page-head .cta-row, .section .table-wrap, .formats > div, .section > .wrap > .frame, .faq details, .entry, .contact-grid > div, .ah-list li, .register > div, .cols3 > div';
const els = $$(sel);
$$('.guides').forEach((g) => [...g.children].forEach((i, n) => i.style.setProperty('--gi', n)));
$$('.grid3, .grid2, .plans, .formats, .contact-grid, .cols3, .draft .titleblock').forEach((g) => [...g.children].forEach((c, n) => { if (!c.style.getPropertyValue('--k')) c.style.setProperty('--k', n % 4); }));
if (still || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('in'));
else {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  els.forEach((e) => io.observe(e));
}

// one scroll loop: header, parallax, construction sequence
const head = document.querySelector('.site-head');
const drift = !still && fine ? $$('[data-parallax]').map((el) => ({ el, k: parseFloat(el.dataset.parallax) || 0, y: 0 })) : [];
const build = document.querySelector('.ah-build');
const steps = build ? $$('.steps li', build) : [];
let last = scrollY, raf = 0;
const update = () => {
  raf = 0;
  const y = scrollY, vh = innerHeight;
  if (head) { if (y < 120 || y < last - 4) head.classList.remove('away'); else if (y > last + 4) head.classList.add('away'); }
  last = y;
  for (const d of drift) {
    const r = d.el.getBoundingClientRect(), top = r.top - d.y;
    if (top > vh * 1.3 || top + r.height < -vh * 0.3) continue;
    d.y = ((top + r.height / 2 - vh / 2) / vh) * d.k * vh;
    d.el.style.transform = `translate3d(0, ${d.y.toFixed(1)}px, 0)`;
  }
  if (build) {
    const r = build.getBoundingClientRect(), span = r.height - vh;
    const p = still ? 1 : span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1;
    build.style.setProperty('--p', p.toFixed(4));
    const k = Math.min(steps.length - 1, Math.floor(p * steps.length * 0.999));
    steps.forEach((s, i) => s.classList.toggle('on', i === k));
  }
};
const on = () => { if (!raf) raf = requestAnimationFrame(update); };
addEventListener('scroll', on, { passive: true });
addEventListener('resize', on);
update();

// the hero plan answers for the room under the pointer, in its own title block
for (const plate of $$('[data-readout]')) {
  const name = plate.querySelector('[data-r="name"]'), area = plate.querySelector('[data-r="area"]');
  if (!name || !area) continue;
  const base = [name.textContent, area.textContent];
  let t = 0;
  const show = (a, b) => {
    clearTimeout(t);
    name.classList.add('swap'); area.classList.add('swap');
    t = setTimeout(() => { name.textContent = a; area.textContent = b; name.classList.remove('swap'); area.classList.remove('swap'); }, 140);
  };
  for (const room of $$('.room', plate)) {
    const enter = () => show(room.dataset.name, `${room.dataset.area} · ${room.dataset.size}`);
    const leave = () => show(...base);
    room.addEventListener('pointerenter', enter); room.addEventListener('pointerleave', leave);
    room.addEventListener('focus', enter); room.addEventListener('blur', leave);
  }
}

// header: mark the current page
const page = document.body.dataset.page;
$$(`[data-nav="${page}"]`).forEach((a) => a.setAttribute('aria-current', 'page'));
root.classList.add('ready');
