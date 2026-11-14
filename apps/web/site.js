// Marketing site motion: drawings draft themselves when they scroll into view, and the construction sequence follows
// scroll position. Without JS (no .js class) or with reduced motion, everything is simply shown.
const root = document.documentElement;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const els = document.querySelectorAll('.draft, .register, .rise, .stroke, .ah-build, [data-in]');
if (still || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('in'));
else {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  els.forEach((e) => io.observe(e));
}
// construction sequence: --p runs 0 → 1 while the pinned box crosses the viewport
const build = document.querySelector('.ah-build');
if (build) {
  const steps = [...build.querySelectorAll('.steps li')];
  let raf = 0;
  const update = () => {
    raf = 0;
    const r = build.getBoundingClientRect(), span = r.height - innerHeight;
    const p = still ? 1 : span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1;
    build.style.setProperty('--p', p.toFixed(4));
    const k = Math.min(steps.length - 1, Math.floor(p * steps.length * 0.999));
    steps.forEach((s, i) => s.classList.toggle('on', i === k));
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', on, { passive: true });
  addEventListener('resize', on);
  update();
}
// header: mark the current page
const page = document.body.dataset.page;
document.querySelectorAll(`[data-nav="${page}"]`).forEach((a) => a.setAttribute('aria-current', 'page'));
root.classList.add('ready');
