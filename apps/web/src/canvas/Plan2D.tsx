import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { doorLinks, escapeRoutes } from '../../../shared/escape';
import { type Footprint, labelPoint, wallFootprints } from '../../../shared/walls';
import { type Plan, type Pt, area, centroid, dist, round } from '../../../shared/plan';
import { hoverRoom, selectedRooms } from '../state';
import { ROOM_COLORS } from './colors';
import { printPlan } from './print';
import { FixtureSymbol } from './symbols';
import { FLOOR_OF } from './floors-kind';
import { inside, roomDims } from '../../../shared/rooms';
import { W, ln, wallClass } from './weights';

/** CSS pixels per metre of screen (96 px per inch). Screens vary, so on-screen 1:x is nominal; print is exact. */
const SCREEN_PX_PER_M = 96 / 0.0254;
const STANDARD = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

type Props = { plan: Plan; compact?: boolean; sourceUrl?: string | null; title?: string };
/** plan: the drawing with overall sizes; dims: every wall, opening and room dimensioned in millimetres. */
export type PlanMode = 'plan' | 'dims';

export function Plan2D({ plan, compact, sourceUrl, title = 'Plan' }: Props) {
  const [mode, setMode] = useState<PlanMode>(() => { try { return localStorage.getItem('bimp.planMode') === 'dims' ? 'dims' : 'plan'; } catch { return 'plan'; } });
  // Dimension strings sit outside the building: three tiers on every side need about twice the margin.
  const pad = Math.max(plan.width, plan.height) * (mode === 'dims' && !compact ? 0.2 : 0.1), top = compact ? 0 : pad * 0.35; // room for the toolbar
  const home = { x: -pad, y: -pad - top, w: plan.width + 2 * pad, h: plan.height + 2 * pad + top };
  const [vb, setVb] = useState(home);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: typeof vb; moved: boolean; dead?: boolean } | null>(null);
  const ptrs = useRef(new Map<number, Pt>());
  const pinch = useRef<{ d: number; vb: typeof vb; mid: Pt } | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [kbd, setKbd] = useState<string | null>(null); // room with keyboard focus: ringed on top of the walls
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [typed, setTyped] = useState<string | null>(null);
  const [showEscape, setShowEscape] = useState(false);
  const pickMode = (m: PlanMode) => { setMode(m); try { localStorage.setItem('bimp.planMode', m); } catch { /* private mode */ } };
  const escape = useMemo(() => (showEscape ? escapeRoutes(plan) : null), [plan, showEscape]);
  const footprints = useMemo(() => wallFootprints(plan.walls), [plan]);
  const labelAt = useMemo(() => new Map(plan.rooms.map((r) => [r.id, labelPoint(r.polygon)])), [plan]);
  // wall thickness at each opening, for door jamb ticks and gap width
  const openingT = useMemo(() => new Map(plan.openings.map((o) => {
    const m = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    let best = 0.2, bd = Infinity;
    for (const w of plan.walls) {
      const L = dist(w.a, w.b) || 1, u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
      const t = Math.max(0, Math.min(L, (m[0] - w.a[0]) * u[0] + (m[1] - w.a[1]) * u[1]));
      const d = Math.hypot(m[0] - w.a[0] - u[0] * t, m[1] - w.a[1] - u[1] * t);
      if (d < bd) { bd = d; best = w.thickness; }
    }
    return [o.id, best];
  })), [plan]);
  const exits = useMemo(() => (showEscape ? doorLinks(plan).filter((d) => d.exit) : []), [plan, showEscape]);
  useEffect(() => setVb(home), [plan, mode]);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(svg.current!);
    return () => ro.disconnect();
  }, []);

  // Screen scale: CSS px per metre of plan, and the equivalent 1:x ratio.
  const pxPerM = size.w && size.h ? Math.min(size.w / vb.w, size.h / vb.h) : 0;
  const ratio = pxPerM ? Math.round(SCREEN_PX_PER_M / pxPerM) : 0;
  const setRatio = (x: number) => {
    if (!(x >= 1 && x <= 100000) || !pxPerM) return;
    const k = SCREEN_PX_PER_M / x;
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    const w = size.w / k, h = size.h / k;
    setVb({ x: cx - w / 2, y: cy - h / 2, w, h });
  };
  const barM = NICE.find((m) => m * pxPerM >= 70) ?? NICE[NICE.length - 1];
  const printRatio = plan.scale.ratio ?? STANDARD.find((x) => x >= ratio) ?? 1000;

  /** Zoom by factor k (>1 zooms out) about a plan point, default the view centre. */
  const zoom = (k: number, at?: Pt) => setVb((v) => {
    const [px, py] = at ?? [v.x + v.w / 2, v.y + v.h / 2];
    const w = Math.min(Math.max(v.w * k, 1), home.w * 4), f = w / v.w;
    return { x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: v.h * f };
  });
  const keys = (e: KeyboardEvent) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (d) { e.preventDefault(); setVb((v) => ({ ...v, x: v.x + d[0] * v.w * 0.1, y: v.y + d[1] * v.h * 0.1 })); }
    else if (e.key === '+' || e.key === '=') zoom(0.8);
    else if (e.key === '-') zoom(1.25);
  };
  const scale = () => { const r = svg.current!.getBoundingClientRect(); return Math.max(vb.w / r.width, vb.h / r.height); };
  const toPlan = (cx: number, cy: number): Pt => {
    const p = new DOMPoint(cx, cy).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  useEffect(() => {
    if (compact) return;
    const el = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0015), toPlan(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const hovered = hoverRoom.value, selected = selectedRooms.value;
  const focusId = hovered ?? selected[0];
  const route = escape && (escape.routes.find((r) => r.room_id === focusId) ?? escape.routes.reduce((a, b) => (b.distance_m > a.distance_m ? b : a), escape.routes[0]));
  const fs = Math.max(plan.width, plan.height) / 45;
  const toggle = (id: string) => { selectedRooms.value = selected.includes(id) ? [] : [id]; };
  // Escape distance label: at the route's start, moved clear of that room's own name/area label block.
  const escLabel = route && (() => {
    const L = labelAt.get(route.room_id) ?? route.from, top = L[1] - fs * 1.4, bot = L[1] + fs * 3.2;
    const x = route.from[0]; let y = route.from[1] - fs * 0.8;
    if (Math.abs(x - L[0]) < fs * 5 && y > top && y < bot) y = y - top < bot - y ? top : bot + fs * 0.9;
    return [x, y] as Pt;
  })();

  const drawing = (
    <svg
      ref={svg}
      class={`plan2d${compact ? ' compact' : ''}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={compact ? undefined : (e) => {
        ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (ptrs.current.size === 2) { // two fingers: pinch zoom about their midpoint; no panning until both lift
          const [a, b] = [...ptrs.current.values()];
          pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, vb, mid: toPlan((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
          drag.current = { x: 0, y: 0, vb, moved: true, dead: true };
        } else if (!pinch.current) drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
      }}
      onPointerMove={compact ? undefined : (e) => {
        if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
        const p = pinch.current;
        if (p && ptrs.current.size >= 2) {
          const [a, b] = [...ptrs.current.values()];
          const w = Math.min(Math.max(p.vb.w * p.d / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1), 1), home.w * 4), f = w / p.vb.w;
          setVb({ x: p.mid[0] - (p.mid[0] - p.vb.x) * f, y: p.mid[1] - (p.mid[1] - p.vb.y) * f, w, h: p.vb.h * f });
          return;
        }
        const d = drag.current;
        if (!d || d.dead || !(e.buttons & 1)) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }
        const s = scale();
        setVb({ ...d.vb, x: d.vb.x - dx * s, y: d.vb.y - dy * s });
      }}
      onPointerUp={(e) => { ptrs.current.delete(e.pointerId); if (!ptrs.current.size) pinch.current = null; setTimeout(() => (drag.current = null)); }}
      onPointerCancel={(e) => { ptrs.current.delete(e.pointerId); if (!ptrs.current.size) pinch.current = null; drag.current = null; }}
      onKeyDown={compact ? undefined : keys}
      onPointerLeave={() => (hoverRoom.value = null)}
      onDblClick={() => setVb(home)}
      role={compact ? 'img' : 'group'}
      aria-label={compact ? '2D floor plan' : `2D floor plan, ${plan.rooms.length} rooms. Tab to a room; arrow keys pan, plus and minus zoom.`}
    >
      <defs aria-hidden="true">
        {/* poché: 45° diagonal = brick / masonry (envelope), cross-hatch = blockwork (load-bearing) */}
        <pattern id="hatch-masonry" patternUnits="userSpaceOnUse" width="0.07" height="0.07" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.07" stroke="var(--wall)" stroke-width="0.007" />
        </pattern>
        <pattern id="hatch-block" patternUnits="userSpaceOnUse" width="0.1" height="0.1" patternTransform="rotate(45)">
          <path d="M0,0V0.1M0,0H0.1" stroke="var(--wall)" stroke-width="0.007" />
        </pattern>
        <pattern id="fl-wood" patternUnits="userSpaceOnUse" width="1.2" height="0.15">
          <path d="M0,0H1.2M0.45,0V0.15" stroke="var(--wall)" stroke-width="0.008" opacity="0.18" />
        </pattern>
        <pattern id="fl-tiles" patternUnits="userSpaceOnUse" width="0.3" height="0.3">
          <path d="M0,0H0.3M0,0V0.3" stroke="var(--wall)" stroke-width="0.008" opacity="0.22" />
        </pattern>
        <pattern id="fl-concrete" patternUnits="userSpaceOnUse" width="0.5" height="0.5">
          <circle cx="0.12" cy="0.18" r="0.012" fill="var(--wall)" opacity="0.15" /><circle cx="0.37" cy="0.41" r="0.009" fill="var(--wall)" opacity="0.15" />
        </pattern>
        <pattern id="fl-deck" patternUnits="userSpaceOnUse" width="1" height="0.12">
          <path d="M0,0H1" stroke="var(--wall)" stroke-width="0.012" opacity="0.25" />
        </pattern>
      </defs>
      {sourceUrl && plan.source && (
        <image aria-hidden="true" href={sourceUrl} x={plan.source.offset[0]} y={plan.source.offset[1]}
          width={plan.source.imageWidth * (plan.scale.metersPerPx ?? 1)} height={plan.source.imageHeight * (plan.scale.metersPerPx ?? 1)}
          opacity={0.45} preserveAspectRatio="none" />
      )}
      {plan.rooms.map((r) => {
        const on = hovered === r.id || selected.includes(r.id);
        return (
          <polygon key={r.id} points={r.polygon.map((p) => p.join(',')).join(' ')}
            fill={ROOM_COLORS[r.type]} fill-opacity={on ? 0.6 : sourceUrl ? 0.2 : mode === 'dims' ? 0.0001 : 0.22}
            stroke={on ? 'var(--accent)' : 'none'} stroke-width={fs * 0.15} class="room"
            {...(compact ? {} : {
              tabIndex: 0, role: 'button', 'aria-label': `${r.name}, ${round(area(r.polygon), 1)} m²`, 'aria-pressed': selected.includes(r.id),
              onFocus: (e: FocusEvent) => { hoverRoom.value = r.id; if ((e.currentTarget as Element).matches(':focus-visible')) setKbd(r.id); },
              onBlur: () => { hoverRoom.value = null; setKbd(null); },
              onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r.id); } },
            })}
            onPointerEnter={() => (hoverRoom.value = r.id)}
            onClick={() => { if (!drag.current?.moved) toggle(r.id); }} />
        );
      })}
      {!compact && !sourceUrl && mode === 'plan' && (
        <g pointer-events="none" class="floor-patterns" aria-hidden="true">
          {plan.rooms.filter((r) => FLOOR_OF[r.type] !== 'plain').map((r) => (
            <polygon key={r.id} points={r.polygon.map((p) => p.join(',')).join(' ')} fill={`url(#fl-${FLOOR_OF[r.type]})`} />
          ))}
        </g>
      )}
      <g pointer-events="none" class="fixtures" aria-hidden="true">{(plan.fixtures ?? []).map((f) => <FixtureSymbol key={f.id} f={f} />)}</g>
      <Walls footprints={footprints} />
      <Openings plan={plan} thick={openingT} u={pxPerM ? 1 / pxPerM : 0.03} />
      {!compact && <Dimensions plan={plan} fs={fs} mode={mode} footprints={footprints} thick={openingT} />}
      {kbd && (() => { const r = plan.rooms.find((x) => x.id === kbd); return r && <polygon class="focus-ring" aria-hidden="true" points={r.polygon.map((p) => p.join(',')).join(' ')} />; })()}
      {route && (
        <g pointer-events="none" class="escape" aria-hidden="true">
          <polyline points={route.path.map((p) => p.join(',')).join(' ')} fill="none" stroke="#dc2626" stroke-width={fs * 0.18} stroke-dasharray={`${fs * 0.6} ${fs * 0.35}`} stroke-linejoin="round" />
          <circle cx={route.from[0]} cy={route.from[1]} r={fs * 0.35} fill="#dc2626" />
          <text x={escLabel![0]} y={escLabel![1]} font-size={fs * 1.1} text-anchor="middle" fill="#dc2626" font-weight="700" stroke="var(--paper)" stroke-width={fs * 0.25} paint-order="stroke">{route.distance_m} m to exit</text>
        </g>
      )}
      {exits.map((d) => <g key={d.id} pointer-events="none" aria-hidden="true"><circle cx={d.mid[0]} cy={d.mid[1]} r={fs * 0.6} fill="#15803d" /><text x={d.mid[0]} y={d.mid[1] + fs * 0.35} font-size={fs * 0.8} text-anchor="middle" fill="#fff" font-weight="700">EXIT</text></g>)}
      {!compact && (
        <g pointer-events="none" aria-hidden="true" text-anchor="middle" class="labels" stroke="var(--paper)" stroke-width={fs * 0.22} paint-order="stroke" stroke-linejoin="round">
          {plan.rooms.map((r) => {
            const [x, y] = labelAt.get(r.id) ?? centroid(r.polygon);
            return (
              <text key={r.id} x={x} y={y} font-size={fs}>
                <tspan x={x} font-weight="600">{r.name}</tspan>
                <tspan x={x} dy={fs * 1.2} font-size={fs * 0.85}>{mode === 'dims' ? `A: ${area(r.polygon).toFixed(2).replace('.', ',')} m²` : `${round(area(r.polygon), 1)} m²`}</tspan>
                {mode === 'plan' && <tspan x={x} dy={fs * 1.05} font-size={fs * 0.72} opacity={0.75}>{(() => { const d = roomDims(r.polygon); return `${d.length.toFixed(2)} × ${d.width.toFixed(2)}`; })()}</tspan>}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
  if (compact) return drawing;

  const apply = () => { if (typed !== null) setRatio(Number(typed)); setTyped(null); };
  const printN = Math.round(Number(printing));
  const doPrint = (e: Event) => { e.preventDefault(); if (!(printN >= 1)) return; setPrinting(null); printPlan(svg.current!, plan, printN, pad, title); };
  return (
    <div class="plan2d-wrap">
      {drawing}
      <div class="scale-ctl" onPointerDown={(e) => e.stopPropagation()}>
        <label class="small" title="Screen scale, nominal: assumes 96 px per inch. Use Print for an exact paper scale.">
          1:<input type="number" min={1} list="std-scales" aria-label="Scale ratio"
            value={typed ?? String(ratio || '')}
            onInput={(e) => setTyped(e.currentTarget.value)}
            onChange={apply} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </label>
        <div class="seg sm" role="group" aria-label="Drawing">
          <button aria-pressed={mode === 'plan'} onClick={() => pickMode('plan')} title="The plan with overall sizes">Plan</button>
          <button aria-pressed={mode === 'dims'} onClick={() => pickMode('dims')} title="Every wall, opening and room dimensioned, in millimetres">Dimensioned</button>
        </div>
        <datalist id="std-scales">{STANDARD.map((x) => <option key={x} value={x} />)}</datalist>
        {plan.scale.ratio && <button class="link small" onClick={() => setRatio(plan.scale.ratio!)} title="The drawing's own scale">Drawing 1:{plan.scale.ratio}</button>}
        <button class="link small zoom" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out">−</button>
        <button class="link small zoom" onClick={() => zoom(0.8)} aria-label="Zoom in" title="Zoom in">+</button>
        <button class="link small" onClick={() => setVb(home)}>Fit</button>
        <button class="link small" aria-pressed={showEscape} onClick={() => setShowEscape(!showEscape)}
          title="Escape routes: travel distance from the furthest point of the room to an exit (Metric Handbook Ch. 41). Hover a room.">
          {showEscape && <span aria-hidden="true">✓ </span>}Escape</button>
        {showEscape && !escape && <span class="small muted">No exit door found</span>}
        <button class="link small" title={`Print to scale at 1:${printRatio}`} aria-expanded={printing !== null} aria-controls="print-form"
          onClick={() => setPrinting(printing === null ? String(printRatio) : null)}>Print…</button>
      </div>
      {printing !== null && (
        <form class="print-pop" id="print-form" onSubmit={doPrint} onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPrinting(null); } }}>
          <label class="small">Print at 1:<input type="number" min={1} step={1} list="std-scales" value={printing} autoFocus
            aria-invalid={!(printN >= 1)} aria-describedby="print-hint" onInput={(e) => setPrinting(e.currentTarget.value)} /></label>
          <button class="btn sm" disabled={!(printN >= 1)}>Print</button>
          <button type="button" class="link small" onClick={() => setPrinting(null)}>Cancel</button>
          <span class="small muted" id="print-hint">{printN >= 1 ? 'Exact paper scale, smallest ISO sheet that fits.' : 'Enter a whole number, 1 or more.'}</span>
        </form>
      )}
      {pxPerM > 0 && (
        <div class="scalebar" aria-label={`Scale bar ${barM} m`}>
          <div class="sb-bar" style={{ width: `${barM * pxPerM}px` }}><i /><i /><i /><i /></div>
          <span>0</span><span style={{ left: `${barM * pxPerM}px` }}>{barM} m</span>
        </div>
      )}
    </div>
  );
}

const pts = (poly: Pt[]) => poly.map((p) => p.join(',')).join(' ');

/**
 * Cut walls as poché at their real thickness. Outlines are drawn at double width first, then every fill on top,
 * so only the outer half of each outline shows and joints between wall pieces leave no seams.
 */
function Walls({ footprints }: { footprints: Footprint[] }) {
  const fill = { exterior: 'url(#hatch-masonry)', bearing: 'url(#hatch-block)', partition: null } as const;
  return (
    <g pointer-events="none" aria-hidden="true" class="walls">
      {footprints.map((f) => <polygon key={`o${f.wall.id}`} points={pts(f.poly)} fill="var(--sheet)" stroke-linejoin="miter" {...ln(W[wallClass(f.wall.thickness)] * 2)} />)}
      {footprints.map((f) => <polygon key={`f${f.wall.id}`} points={pts(f.poly)} fill="var(--sheet)" />)}
      {footprints.map((f) => { const h = fill[wallClass(f.wall.thickness)]; return h && <polygon key={`h${f.wall.id}`} points={pts(f.poly)} fill={h} />; })}
    </g>
  );
}

/** Openings cut through the wall: jambs at the wall's weight, door leaf and window frame at 0.35 mm, swing and glass thin. */
function Openings({ plan, thick, u }: { plan: Plan; thick: Map<string, number>; u: number }) {
  return (
    <g pointer-events="none" fill="none" aria-hidden="true">
      {plan.openings.map((o) => {
        const len = dist(o.a, o.b);
        if (len < 1e-6) return null;
        const T = thick.get(o.id) ?? 0.3, h = T / 2, e = W.exterior * 1.6 * u + 0.005; // cover the wall outlines too
        const ux = (o.b[0] - o.a[0]) / len, uy = (o.b[1] - o.a[1]) / len, nx = -uy, ny = ux;
        const P = (t: number, k: number): Pt => [o.a[0] + ux * t + nx * k, o.a[1] + uy * t + ny * k];
        const L = (p: Pt, q: Pt, w: number, key?: string) => <line key={key} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} {...ln(w)} />;
        const jw = W[wallClass(T)], sw = o.swing ?? 1, tip = P(0, sw * len);
        return (
          <g key={o.id}>
            <polygon points={pts([P(0, -h - e), P(len, -h - e), P(len, h + e), P(0, h + e)])} fill="var(--sheet)" />
            {L(P(0, -h), P(0, h), jw)}{L(P(len, -h), P(len, h), jw)}
            {o.kind === 'door'
              ? <>{L(o.a, tip, W.opening)}<path d={`M${o.b[0]},${o.b[1]} A${len},${len} 0 0 ${sw === 1 ? 1 : 0} ${tip[0]},${tip[1]}`} {...ln(W.thin)} /></>
              : <>{L(P(0, -h), P(len, -h), W.opening)}{L(P(0, h), P(len, h), W.opening)}{L(P(0, -0.015), P(len, -0.015), W.thin)}{L(P(0, 0.015), P(len, 0.015), W.thin)}</>}
          </g>
        );
      })}
    </g>
  );
}

const mm = (m: number) => String(Math.round(m * 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
type Side = 'top' | 'bottom' | 'left' | 'right';
const OUT: Record<Side, Pt> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Sorted, de-duplicated stops (within 5 mm). */
const stopsOf = (v: number[]) => v.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 0.005);

/**
 * One dimension string along a line: extension lines, 45° ticks, and each interval in millimetres (no unit).
 * `at` is the line's position across its axis; horizontal strings for top/bottom, vertical for left/right.
 */
function Chain({ stops, horizontal, at, out, fs, keyp }: { stops: number[]; horizontal: boolean; at: number; out: number; fs: number; keyp: string }) {
  if (stops.length < 2) return null;
  const P = (s: number, k = 0): Pt => (horizontal ? [s, at + k] : [at + k, s]);
  const t = fs * 0.22, ext = fs * 0.45, size = fs * 0.62;
  const line = (p: Pt, q: Pt, w: number, key: string) => <line key={key} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} {...ln(w)} />;
  return (
    <g>
      {line(P(stops[0]), P(stops[stops.length - 1]), W.thin, `${keyp}l`)}
      {stops.map((s, i) => { const [x, y] = P(s); return <g key={`${keyp}s${i}`}>{line(P(s, -out * ext), P(s, out * fs * 0.2), W.thin, 'e')}{line([x - t, y + t], [x + t, y - t], W.fixture, 't')}</g>; })}
      {stops.slice(1).map((b, i) => {
        const a = stops[i], d = b - a, tight = d < String(Math.round(d * 1000)).length * size * 0.62;
        const k = out * (tight && i % 2 ? -size * 0.75 : size * 0.35), [x, y] = P((a + b) / 2, k * (horizontal ? 1 : 1));
        return <text key={`${keyp}v${i}`} x={x} y={horizontal ? y + (out > 0 ? size * 0.7 : 0) : y} font-size={size} text-anchor="middle"
          transform={horizontal ? undefined : `rotate(-90 ${x + (out > 0 ? size * 0.7 : 0)} ${y})`} dx={horizontal ? 0 : 0}>{mm(d)}</text>;
      })}
    </g>
  );
}

/**
 * Dimensions. plan: overall sizes above and left. dims: on all four sides, outward from the building, (1) the facade's
 * openings, (2) every wall face across the building (wall thicknesses and clear room widths), (3) overall; inside,
 * each room's clear width and depth and interior door widths, all in millimetres.
 */
function Dimensions({ plan, fs, mode, footprints, thick }: { plan: Plan; fs: number; mode: PlanMode; footprints: Footprint[]; thick: Map<string, number> }) {
  if (!footprints.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of footprints) for (const [x, y] of f.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const inRoom = (p: Pt) => plan.rooms.some((r) => inside(p, r.polygon));
  const dims = mode === 'dims';
  const sides: Side[] = dims ? ['top', 'bottom', 'left', 'right'] : ['top', 'left'];
  const gap = fs * 1.5;
  const strings = sides.flatMap((side) => {
    const horizontal = side === 'top' || side === 'bottom', o = OUT[side], ax = horizontal ? 0 : 1;
    const [lo, hi] = horizontal ? [x0, x1] : [y0, y1];
    const edge = side === 'top' ? y0 : side === 'bottom' ? y1 : side === 'left' ? x0 : x1;
    const sign = side === 'top' || side === 'left' ? -1 : 1;
    const tiers: number[][] = [];
    if (dims) {
      // (1) facade: walls parallel to this side whose outside faces it, with the openings in them
      const facade: number[] = [];
      for (const f of footprints) {
        const w = f.wall, par = horizontal ? Math.abs(w.a[1] - w.b[1]) < 1e-3 : Math.abs(w.a[0] - w.b[0]) < 1e-3;
        if (!par) continue;
        const m: Pt = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], k = w.thickness / 2 + 0.2;
        if (inRoom([m[0] + o[0] * k, m[1] + o[1] * k]) || !inRoom([m[0] - o[0] * k, m[1] - o[1] * k])) continue;
        const span = f.poly.map((p) => p[ax]);
        facade.push(Math.min(...span), Math.max(...span));
        for (const op of plan.openings) {
          const om: Pt = [(op.a[0] + op.b[0]) / 2, (op.a[1] + op.b[1]) / 2];
          if (Math.abs(om[1 - ax] - m[1 - ax]) < w.thickness / 2 + 0.05 && om[ax] > Math.min(...span) && om[ax] < Math.max(...span)) facade.push(op.a[ax], op.b[ax]);
        }
      }
      tiers.push(stopsOf(facade));
      // (2) structure: both faces of every wall running across this side
      const faces = [lo, hi];
      for (const w of plan.walls) if (horizontal ? Math.abs(w.a[0] - w.b[0]) < 1e-3 : Math.abs(w.a[1] - w.b[1]) < 1e-3)
        faces.push(w.a[ax] - w.thickness / 2, w.a[ax] + w.thickness / 2);
      tiers.push(stopsOf(faces.filter((v) => v >= lo - 1e-6 && v <= hi + 1e-6)));
    }
    tiers.push([lo, hi]);
    return tiers.map((stops, level) => (
      <Chain key={`${side}${level}`} keyp={`${side}${level}`} stops={stops} horizontal={horizontal} at={edge + sign * (gap + level * gap * 1.1)} out={sign} fs={fs} />
    ));
  });

  // inside each room: clear width and depth near its top-left corner, interior door widths
  const rooms = dims ? plan.rooms.flatMap((r) => {
    const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
    const [rx0, rx1, ry0, ry1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (rx1 - rx0 < 1.6 || ry1 - ry0 < 1.6) return []; // small rooms: the facade and structure strings already give them
    const chord = (horizontal: boolean, at: number) => {
      const cuts: number[] = [];
      r.polygon.forEach((p, i) => {
        const q = r.polygon[(i + 1) % r.polygon.length], a = horizontal ? 1 : 0, b = 1 - a;
        if ((p[a] - at) * (q[a] - at) < 0) cuts.push(p[b] + ((at - p[a]) / (q[a] - p[a])) * (q[b] - p[b]));
      });
      cuts.sort((m, n) => m - n);
      let best: number[] = [];
      for (let i = 0; i + 1 < cuts.length; i += 2) if (cuts[i + 1] - cuts[i] > (best[1] ?? 0) - (best[0] ?? 0)) best = [cuts[i], cuts[i + 1]];
      return best;
    };
    const hy = ry0 + Math.min(0.5, (ry1 - ry0) * 0.2), vx = rx0 + Math.min(0.5, (rx1 - rx0) * 0.2);
    return [
      <Chain key={`${r.id}h`} keyp={`${r.id}h`} stops={chord(true, hy)} horizontal at={hy} out={1} fs={fs * 0.85} />,
      <Chain key={`${r.id}v`} keyp={`${r.id}v`} stops={chord(false, vx)} horizontal={false} at={vx} out={1} fs={fs * 0.85} />,
    ];
  }) : [];
  const doors = dims ? plan.openings.filter((o) => o.kind === 'door' && (thick.get(o.id) ?? 0.3) < 0.25).map((o) => {
    const len = dist(o.a, o.b), ux = (o.b[0] - o.a[0]) / len, uy = (o.b[1] - o.a[1]) / len, sw = o.swing ?? 1, k = (thick.get(o.id) ?? 0.12) / 2 + fs * 0.25;
    const x = (o.a[0] + o.b[0]) / 2 + uy * sw * k, y = (o.a[1] + o.b[1]) / 2 - ux * sw * k;
    let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (ang >= 90) ang -= 180; else if (ang < -90) ang += 180; // read from below or from the right
    return <text key={o.id} x={x} y={y} font-size={fs * 0.55} text-anchor="middle" dominant-baseline="middle" transform={`rotate(${ang} ${x} ${y})`}>{mm(len)}</text>;
  }) : [];
  const fl = plan.levels?.floor;
  const level = dims && fl != null && plan.rooms.length ? (() => {
    const big = plan.rooms.reduce((a, b) => (area(b.polygon) > area(a.polygon) ? b : a)), [x, y] = labelPoint(big.polygon);
    const t = `${fl === 0 ? '±' : fl > 0 ? '+' : '−'}${Math.abs(fl).toFixed(3).replace('.', ',')}`;
    return <text x={x} y={y + fs * 2.6} font-size={fs * 0.75} text-anchor="middle" stroke="var(--sheet)" stroke-width={fs * 0.2} paint-order="stroke">{t}</text>;
  })() : null;
  return <g pointer-events="none" aria-hidden="true" class="dims" fill="var(--fg)">{strings}{rooms}{doors}{level}</g>;
}
