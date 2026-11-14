// The animated bimp wordmark and the launch splash (from bimp_animation.html and bimp_splashscreen.html), as plain
// DOM code so both the app and the marketing site use the same timing. The b's door leaf swings open on its hinge,
// the i's target spins in, m and p are drawn, and on the splash a floor plan drafts itself behind a scale rule.

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeFallBounce = (t: number) => {
  if (t < 0.72) { const p = t / 0.72; return p * p; }
  if (t < 0.88) return 1 - 0.065 * Math.sin(((t - 0.72) / 0.16) * Math.PI);
  return 1 - 0.018 * Math.sin(((t - 0.88) / 0.12) * Math.PI);
};
const progress = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const ORANGE = '#f86a24';

/** The wordmark's SVG body. ink: stroke colour; disc: the colour behind the i's target (the background). */
export function wordmarkSvg(id: string, { ink = '#ffffff', disc = '#1d1d1d', guide = '#6b6b6b', viewBox = '120 140 780 480', label = 'bimp' } = {}) {
  return `<svg class="wordmark-anim" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" overflow="visible">
  <defs><mask id="${id}-arc"><path data-k="arcMask" d="M 184 320 A 144 144 0 0 1 328 464" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round"/></mask></defs>
  <g data-k="wordmark">
    <g>
      <line data-k="bGuide" x1="184" y1="316" x2="184" y2="464" stroke="${guide}" stroke-width="3" stroke-linecap="round" opacity="0"/>
      <path d="M 184 320 A 144 144 0 0 1 328 464" fill="none" stroke="${ink}" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="16 15" mask="url(#${id}-arc)"/>
      <line data-k="bUpper" x1="184" y1="194" x2="184" y2="311" stroke="${ink}" stroke-width="19" stroke-linecap="round"/>
      <line data-k="bHinge" x1="184" y1="464" x2="184" y2="320" stroke="${ink}" stroke-width="19" stroke-linecap="round"/>
      <circle data-k="bDot" cx="184" cy="464" r="12.5" fill="${ORANGE}"/>
    </g>
    <g>
      <line data-k="iStem" x1="392" y1="464" x2="392" y2="316" stroke="${ink}" stroke-width="19" stroke-linecap="round"/>
      <g data-k="iTarget" transform="translate(392, 238)">
        <circle cx="0" cy="0" r="34" fill="${disc}"/>
        <path d="M 0 0 L 0 -34 A 34 34 0 0 1 34 0 Z" fill="${ORANGE}"/>
        <path d="M 0 0 L 0 34 A 34 34 0 0 1 -34 0 Z" fill="${ORANGE}"/>
        <circle cx="0" cy="0" r="34" fill="none" stroke="${ink}" stroke-width="6.5"/>
        <line x1="0" y1="-45" x2="0" y2="45" stroke="${ink}" stroke-width="6.5" stroke-linecap="round"/>
        <line x1="-45" y1="0" x2="45" y2="0" stroke="${ink}" stroke-width="6.5" stroke-linecap="round"/>
      </g>
    </g>
    <path data-k="m" d="M 464 464 L 464 357.5 A 41.5 41.5 0 0 1 547 357.5 L 547 464 L 547 357.5 A 41.5 41.5 0 0 1 630 357.5 L 630 464" fill="none" stroke="${ink}" stroke-width="19" stroke-linecap="round" stroke-linejoin="round"/>
    <g>
      <line data-k="pStem" x1="702" y1="316" x2="702" y2="576" stroke="${ink}" stroke-width="19" stroke-linecap="round"/>
      <path data-k="pBowl" d="M 702 316 L 766 316 A 74 74 0 0 1 766 464 L 702 464" fill="none" stroke="${ink}" stroke-width="19" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>
</svg>`;
}

type Frame = (t: number) => void;
/** Binds the wordmark timeline to an SVG made by wordmarkSvg. `lead` shifts the timeline (the splash starts 0.03 s later). */
export function wordmarkFrame(svg: SVGSVGElement, lead = 0): Frame {
  const q = <T extends SVGGeometryElement | SVGGElement>(k: string) => svg.querySelector(`[data-k="${k}"]`) as T;
  const bUpper = q<SVGGeometryElement>('bUpper'), bHinge = q<SVGGeometryElement>('bHinge'), bGuide = q<SVGGeometryElement>('bGuide'), bDot = q<SVGGeometryElement>('bDot');
  const arc = q<SVGGeometryElement>('arcMask'), iStem = q<SVGGeometryElement>('iStem'), iTarget = q<SVGGElement>('iTarget');
  const m = q<SVGGeometryElement>('m'), pStem = q<SVGGeometryElement>('pStem'), pBowl = q<SVGGeometryElement>('pBowl');
  const L = new Map<Element, number>();
  for (const el of [bUpper, bHinge, arc, iStem, m, pStem, pBowl]) { const len = el.getTotalLength(); L.set(el, len); el.style.strokeDasharray = `${len}`; el.style.strokeDashoffset = `${len}`; }
  const draw = (el: SVGGeometryElement, p: number) => { el.style.opacity = p > 0 ? '1' : '0'; el.style.strokeDashoffset = `${L.get(el)! * (1 - p)}`; };
  const s = (a: number) => a + lead;
  return (t) => {
    const bDraw = easeOutCubic(progress(t, s(0.05), s(0.42)));
    draw(bUpper, bDraw); draw(bHinge, bDraw);
    bDot.setAttribute('r', `${Math.max(0, 12.5 * easeOutBack(progress(t, s(0.18), s(0.48))))}`);
    const fallT = progress(t, s(0.48), s(1.25)), angle = 90 * easeFallBounce(fallT);
    bHinge.setAttribute('transform', `rotate(${angle} 184 464)`);
    bGuide.style.opacity = fallT > 0.03 ? `${clamp01((fallT - 0.03) / 0.12)}` : '0';
    arc.style.strokeDashoffset = `${L.get(arc)! * (1 - clamp01(angle / 90))}`;
    draw(iStem, easeOutCubic(progress(t, s(0.45), s(0.92))));
    const tp = progress(t, s(0.72), s(1.28));
    iTarget.setAttribute('transform', `translate(392, 238) scale(${Math.max(0, easeOutBack(tp))}) rotate(${-90 * (1 - easeOutCubic(tp))})`);
    draw(m, easeInOutCubic(progress(t, s(0.68), s(1.42))));
    draw(pStem, easeOutCubic(progress(t, s(0.92), s(1.32))));
    draw(pBowl, easeInOutCubic(progress(t, s(1.52), s(2.22))));
  };
}

/** Draws the wordmark once (about 2.3 s), or on a loop of `cycle` ms with a fade at the end. Returns stop(). */
export function playWordmark(svg: SVGSVGElement, { loop = false, cycle = 6400 } = {}) {
  const frame = wordmarkFrame(svg), group = svg.querySelector('[data-k="wordmark"]') as SVGGElement;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { frame(10); return () => {}; }
  let raf = 0, t0: number | null = null;
  const tick = (now: number) => {
    if (t0 === null) t0 = now;
    const ms = loop ? (now - t0) % cycle : now - t0, t = ms / 1000;
    frame(t);
    if (loop) group.style.opacity = t > 5.85 ? `${1 - clamp01((t - 5.85) / 0.45)}` : '1';
    if (loop || t < 2.4) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ---- the launch splash: a courtyard plan drafted on charcoal, the wordmark, a scale rule; then it fades ----
const W = 'rgba(255,255,255,';
const PLAN = `
<g class="sp-dims" stroke="${W}0.055)" stroke-width="1">
  <path d="M 110 66 L 1490 66"/><path d="M 110 56 L 110 96 M 440 56 L 440 96 M 1160 56 L 1160 96 M 1490 56 L 1490 96"/><path d="M 105 71 L 115 61 M 435 71 L 445 61 M 1155 71 L 1165 61 M 1485 71 L 1495 61" stroke-width="1.2"/>
  <path d="M 110 834 L 1490 834"/><path d="M 110 804 L 110 844 M 440 804 L 440 844 M 1160 804 L 1160 844 M 1490 804 L 1490 844"/><path d="M 105 839 L 115 829 M 435 839 L 445 829 M 1155 839 L 1165 829 M 1485 839 L 1495 829" stroke-width="1.2"/>
  <path d="M 66 110 L 66 790"/><path d="M 56 110 L 96 110 M 56 390 L 96 390 M 56 790 L 96 790"/><path d="M 61 115 L 71 105 M 61 395 L 71 385 M 61 795 L 71 785" stroke-width="1.2"/>
  <path d="M 1534 110 L 1534 790"/><path d="M 1504 110 L 1544 110 M 1504 340 L 1544 340 M 1504 620 L 1544 620 M 1504 790 L 1544 790"/><path d="M 1529 115 L 1539 105 M 1529 345 L 1539 335 M 1529 625 L 1539 615 M 1529 795 L 1539 785" stroke-width="1.2"/>
</g>
<g stroke="${W}0.075)" stroke-width="1.5">
  <path d="M 110 110 L 110 250 M 118 118 L 118 250"/><path d="M 110 360 L 110 520 M 118 360 L 118 520"/><path d="M 110 650 L 110 790 M 118 650 L 118 782"/>
  <path d="M 110 250 L 118 250 M 110 360 L 118 360 M 114 250 L 114 360" stroke="${W}0.045)" stroke-width="1"/><path d="M 110 520 L 118 520 M 110 650 L 118 650 M 114 520 L 114 650" stroke="${W}0.045)" stroke-width="1"/>
  <path d="M 110 110 L 210 110 M 118 118 L 210 118"/><path d="M 330 110 L 440 110 L 440 210 M 330 118 L 432 118 L 432 210"/><path d="M 210 110 L 210 118 M 330 110 L 330 118 M 210 114 L 330 114" stroke="${W}0.045)" stroke-width="1"/>
  <path d="M 110 790 L 200 790 M 118 782 L 200 782"/><path d="M 310 790 L 440 790 L 440 660 M 310 782 L 432 782 L 432 660"/><path d="M 200 782 L 200 790 M 310 782 L 310 790 M 200 786 L 310 786" stroke="${W}0.045)" stroke-width="1"/>
</g>
<path d="M 118 390 L 340 390 M 270 540 L 270 782" stroke="${W}0.055)" stroke-width="1.3"/>
<rect x="158" y="164" width="110" height="58" stroke="${W}0.04)" stroke-width="1"/>
<path d="M 176 154 L 198 154 M 228 154 L 250 154 M 176 232 L 198 232 M 228 232 L 250 232" stroke="${W}0.035)" stroke-width="1"/>
<rect x="148" y="694" width="90" height="44" stroke="${W}0.04)" stroke-width="1"/>
<line x1="340" y1="390" x2="340" y2="314" stroke="${W}0.085)" stroke-width="1.5"/><path d="M 340 314 A 76 76 0 0 1 416 390" stroke="${W}0.075)" stroke-width="1.2" stroke-dasharray="5 5"/><circle class="sp-dot" cx="340" cy="390" r="3" fill="${ORANGE}" opacity="0"/>
<line x1="270" y1="540" x2="340" y2="540" stroke="${W}0.085)" stroke-width="1.5"/><path d="M 340 540 A 70 70 0 0 0 270 470" stroke="${W}0.075)" stroke-width="1.2" stroke-dasharray="5 5"/><circle class="sp-dot" cx="270" cy="540" r="3" fill="${ORANGE}" opacity="0"/>
<line x1="432" y1="210" x2="362" y2="210" stroke="${W}0.085)" stroke-width="1.5"/><path d="M 362 210 A 70 70 0 0 0 432 280" stroke="${W}0.075)" stroke-width="1.2" stroke-dasharray="5 5"/><circle class="sp-dot" cx="432" cy="210" r="3" fill="${ORANGE}" opacity="0"/>
<g stroke="${W}0.075)" stroke-width="1.5">
  <path d="M 1160 220 L 1160 110 L 1250 110 M 1168 220 L 1168 118 L 1250 118"/><path d="M 1380 110 L 1490 110 L 1490 210 M 1380 118 L 1482 118 L 1482 210"/><path d="M 1250 110 L 1250 118 M 1380 110 L 1380 118 M 1250 114 L 1380 114" stroke="${W}0.045)" stroke-width="1"/>
  <path d="M 1490 310 L 1490 470 M 1482 310 L 1482 470"/><path d="M 1490 610 L 1490 790 L 1390 790 M 1482 610 L 1482 782 L 1390 782"/>
  <path d="M 1482 210 L 1490 210 M 1482 310 L 1490 310 M 1486 210 L 1486 310" stroke="${W}0.045)" stroke-width="1"/><path d="M 1482 470 L 1490 470 M 1482 610 L 1490 610 M 1486 470 L 1486 610" stroke="${W}0.045)" stroke-width="1"/>
  <path d="M 1270 790 L 1160 790 L 1160 710 M 1270 782 L 1168 782 L 1168 710"/><path d="M 1270 782 L 1270 790 M 1390 782 L 1390 790 M 1270 786 L 1390 786" stroke="${W}0.045)" stroke-width="1"/>
</g>
<path d="M 1240 340 L 1482 340 M 1168 620 L 1380 620 M 1320 118 L 1320 250" stroke="${W}0.055)" stroke-width="1.3"/>
<rect x="1364" y="156" width="84" height="106" stroke="${W}0.04)" stroke-width="1"/>
<path d="M 1374 166 L 1402 166 L 1402 186 L 1374 186 Z M 1412 166 L 1438 166 L 1438 186 L 1412 186 Z" stroke="${W}0.035)" stroke-width="1"/>
<rect x="1386" y="662" width="66" height="88" stroke="${W}0.04)" stroke-width="1"/>
<line x1="1240" y1="340" x2="1240" y2="266" stroke="${W}0.085)" stroke-width="1.5"/><path d="M 1240 266 A 74 74 0 0 0 1166 340" stroke="${W}0.075)" stroke-width="1.2" stroke-dasharray="5 5"/><circle class="sp-dot" cx="1240" cy="340" r="3" fill="${ORANGE}" opacity="0"/>
<line x1="1380" y1="620" x2="1380" y2="694" stroke="${W}0.085)" stroke-width="1.5"/><path d="M 1380 694 A 74 74 0 0 0 1454 620" stroke="${W}0.075)" stroke-width="1.2" stroke-dasharray="5 5"/><circle class="sp-dot" cx="1380" cy="620" r="3" fill="${ORANGE}" opacity="0"/>
<line x1="1168" y1="710" x2="1238" y2="710" stroke="${W}0.085)" stroke-width="1.5"/><path d="M 1238 710 A 70 70 0 0 0 1168 640" stroke="${W}0.075)" stroke-width="1.2" stroke-dasharray="5 5"/><circle class="sp-dot" cx="1168" cy="710" r="3" fill="${ORANGE}" opacity="0"/>
<path d="M 440 114 L 1160 114 M 440 786 L 1160 786" stroke="${W}0.035)" stroke-width="1" stroke-dasharray="6 8"/>
${[[182, 466], [1414, 412]].map(([x, y]) => `<g class="sp-datum" transform="translate(${x}, ${y})" opacity="0"><circle cx="0" cy="0" r="9" stroke="${W}0.085)" stroke-width="1"/><path d="M 0 0 L 0 -9 A 9 9 0 0 1 9 0 Z" fill="rgba(248,106,36,0.22)"/><path d="M 0 0 L 0 9 A 9 9 0 0 1 -9 0 Z" fill="rgba(248,106,36,0.22)"/><line x1="-14" y1="0" x2="14" y2="0" stroke="${W}0.085)" stroke-width="1"/><line x1="0" y1="-14" x2="0" y2="14" stroke="${W}0.085)" stroke-width="1"/></g>`).join('')}`;

const SPLASH_HTML = `
<svg class="sp-bg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <pattern id="sp-grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M 80 0 L 0 0 0 80" fill="none" stroke="${W}0.022)" stroke-width="1"/></pattern>
    <radialGradient id="sp-clear" cx="50%" cy="50%" r="46%"><stop offset="0%" stop-color="#1d1d1d" stop-opacity="0.96"/><stop offset="58%" stop-color="#1d1d1d" stop-opacity="0.55"/><stop offset="100%" stop-color="#1d1d1d" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sp-grid)"/>
  <g class="sp-plan" fill="none" stroke-linecap="round" stroke-linejoin="round">${PLAN}</g>
  <ellipse cx="800" cy="450" rx="510" ry="300" fill="url(#sp-clear)"/>
</svg>
<div class="sp-stage">
  ${wordmarkSvg('sp')}
  <svg class="sp-rule" viewBox="0 0 240 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="none" stroke-linecap="round">
      <line x1="16" y1="12" x2="224" y2="12" stroke="${W}0.13)" stroke-width="1"/>
      <line x1="68" y1="9" x2="68" y2="15" stroke="${W}0.16)" stroke-width="1"/><line x1="120" y1="8" x2="120" y2="16" stroke="${W}0.18)" stroke-width="1"/><line x1="172" y1="9" x2="172" y2="15" stroke="${W}0.16)" stroke-width="1"/>
      <line x1="16" y1="6" x2="16" y2="18" stroke="${W}0.22)" stroke-width="1"/><line x1="224" y1="6" x2="224" y2="18" stroke="${W}0.22)" stroke-width="1"/>
      <line x1="12" y1="16" x2="20" y2="8" stroke="${W}0.35)" stroke-width="1.2"/><line x1="220" y1="16" x2="228" y2="8" stroke="${W}0.35)" stroke-width="1.2"/>
      <line class="sp-active" x1="16" y1="12" x2="224" y2="12" stroke="#ffffff" stroke-width="1.6"/>
      <circle cx="16" cy="12" r="2.4" fill="${ORANGE}"/>
      <line class="sp-head" x1="16" y1="7.5" x2="16" y2="16.5" stroke="${ORANGE}" stroke-width="1.5"/>
    </g>
  </svg>
</div>`;

const SPLASH_CSS = `
#bimp-splash{position:fixed;inset:0;z-index:2147483000;background:#1d1d1d;display:flex;align-items:center;justify-content:center;transition:opacity .7s cubic-bezier(.22,1,.36,1);visibility:visible!important}
#bimp-splash.is-dismissed{opacity:0;pointer-events:none}
#bimp-splash .sp-bg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
#bimp-splash .sp-stage{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;width:clamp(230px,34vw,420px)}
#bimp-splash .wordmark-anim{width:100%;height:auto;display:block;overflow:visible}
#bimp-splash .sp-rule{margin-top:20px;width:min(190px,58%);height:auto;display:block;overflow:visible}`;

/**
 * The launch splash. Plays the drafting plan, the wordmark and the scale rule, then fades out once the animation has
 * run (about 3 s) and `ready` has resolved. Removes the html.splashing class that hides the page underneath.
 */
export function showSplash({ ready = Promise.resolve() as Promise<unknown>, minMs = 3100 } = {}) {
  const root = document.documentElement;
  const done = () => root.classList.remove('splashing');
  if (document.getElementById('bimp-splash')) return;
  const style = document.createElement('style');
  style.textContent = SPLASH_CSS;
  const el = document.createElement('div');
  el.id = 'bimp-splash';
  el.setAttribute('role', 'presentation');
  el.innerHTML = SPLASH_HTML;
  document.head.appendChild(style);
  document.body.appendChild(el);

  const frame = wordmarkFrame(el.querySelector('.wordmark-anim') as SVGSVGElement, 0.03);
  const planEls = [...el.querySelectorAll<SVGGeometryElement>('.sp-plan path, .sp-plan line, .sp-plan rect')].filter((p) => !p.closest('.sp-datum'));
  const plan = planEls.map((p, i) => {
    const len = p.getTotalLength(), dashed = p.hasAttribute('stroke-dasharray');
    if (dashed) p.style.opacity = '0'; else { p.style.strokeDasharray = `${len}`; p.style.strokeDashoffset = `${len}`; }
    return { p, len, dashed, d: i * 0.032 };
  });
  const dots = [...el.querySelectorAll<SVGElement>('.sp-dot')], datums = [...el.querySelectorAll<SVGElement>('.sp-datum')];
  const active = el.querySelector('.sp-active') as SVGGeometryElement, head = el.querySelector('.sp-head') as SVGLineElement;
  const ruleLen = active.getTotalLength();
  active.style.strokeDasharray = `${ruleLen}`; active.style.strokeDashoffset = `${ruleLen}`;

  let isReady = false, dismissed = false, t0: number | null = null;
  ready.then(() => (isReady = true), () => (isReady = true));
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    done();
    el.classList.add('is-dismissed');
    setTimeout(() => { el.remove(); style.remove(); }, 800);
  };
  const tick = (now: number) => {
    if (t0 === null) t0 = now;
    const t = (now - t0) / 1000;
    for (const { p, len, dashed, d } of plan) {
      const k = easeOutCubic(progress(t, d, d + 0.85));
      if (dashed) p.style.opacity = `${k}`; else p.style.strokeDashoffset = `${len * (1 - k)}`;
    }
    const dotFade = easeOutCubic(progress(t, 0.5, 1.2));
    for (const dot of dots) dot.style.opacity = `${dotFade * 0.42}`;
    const datumFade = easeOutCubic(progress(t, 0.8, 1.4));
    for (const g of datums) g.style.opacity = `${datumFade}`;
    frame(t);
    const sp = easeInOutCubic(progress(t, 0.08, 2.28));
    active.style.strokeDashoffset = `${ruleLen * (1 - sp)}`;
    const x = 16 + ruleLen * sp;
    head.setAttribute('x1', `${x}`); head.setAttribute('x2', `${x}`);
    if (t * 1000 >= minMs && isReady) return dismiss();
    if (t > 12) return dismiss(); // never keep the page hidden for long, whatever happens
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Show the splash once per browser session (decided before paint by js.js, which sets html.splashing). */
export const splashPending = () => document.documentElement.classList.contains('splashing');
