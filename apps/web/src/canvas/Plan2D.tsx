import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { doorLinks, escapeRoutes } from '../../../shared/escape';
import { type Plan, type Pt, area, centroid, dist, round } from '../../../shared/plan';
import { hoverRoom, selectedRooms } from '../state';
import { ROOM_COLORS } from './colors';
import { printPlan } from './print';

/** CSS pixels per metre of screen (96 px per inch). Screens vary, so on-screen 1:x is nominal; print is exact. */
const SCREEN_PX_PER_M = 96 / 0.0254;
const STANDARD = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

type Props = { plan: Plan; compact?: boolean; sourceUrl?: string | null; title?: string };

export function Plan2D({ plan, compact, sourceUrl, title = 'Plan' }: Props) {
  const pad = Math.max(plan.width, plan.height) * 0.06;
  const home = { x: -pad, y: -pad, w: plan.width + 2 * pad, h: plan.height + 2 * pad };
  const [vb, setVb] = useState(home);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: typeof vb; moved: boolean } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [typed, setTyped] = useState<string | null>(null);
  const [showEscape, setShowEscape] = useState(false);
  const escape = useMemo(() => (showEscape ? escapeRoutes(plan) : null), [plan, showEscape]);
  const exits = useMemo(() => (showEscape ? doorLinks(plan).filter((d) => d.exit) : []), [plan, showEscape]);
  useEffect(() => setVb(home), [plan]);
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
      const [px, py] = toPlan(e.clientX, e.clientY);
      const k = Math.exp(e.deltaY * 0.0015);
      setVb((v) => {
        const w = Math.min(Math.max(v.w * k, 1), home.w * 4);
        const f = w / v.w;
        return { x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: v.h * f };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const hovered = hoverRoom.value, selected = selectedRooms.value;
  const focusId = hovered ?? selected[0];
  const route = escape && (escape.routes.find((r) => r.room_id === focusId) ?? escape.routes.reduce((a, b) => (b.distance_m > a.distance_m ? b : a), escape.routes[0]));
  const fs = Math.max(plan.width, plan.height) / 45;

  const drawing = (
    <svg
      ref={svg}
      class={`plan2d${compact ? ' compact' : ''}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={compact ? undefined : (e) => { drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }; }}
      onPointerMove={compact ? undefined : (e) => {
        const d = drag.current;
        if (!d || !(e.buttons & 1)) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }
        const s = scale();
        setVb({ ...d.vb, x: d.vb.x - dx * s, y: d.vb.y - dy * s });
      }}
      onPointerUp={() => { setTimeout(() => (drag.current = null)); }}
      onPointerLeave={() => (hoverRoom.value = null)}
      onDblClick={() => setVb(home)}
      role="img"
      aria-label="2D floor plan"
    >
      {sourceUrl && plan.source && (
        <image href={sourceUrl} x={plan.source.offset[0]} y={plan.source.offset[1]}
          width={plan.source.imageWidth * (plan.scale.metersPerPx ?? 1)} height={plan.source.imageHeight * (plan.scale.metersPerPx ?? 1)}
          opacity={0.45} preserveAspectRatio="none" />
      )}
      {plan.rooms.map((r) => {
        const on = hovered === r.id || selected.includes(r.id);
        return (
          <polygon key={r.id} points={r.polygon.map((p) => p.join(',')).join(' ')}
            fill={ROOM_COLORS[r.type]} fill-opacity={on ? 0.85 : sourceUrl ? 0.3 : 0.5}
            stroke={on ? 'var(--accent)' : 'none'} stroke-width={fs * 0.15} class="room"
            onPointerEnter={() => (hoverRoom.value = r.id)}
            onClick={() => { if (!drag.current?.moved) selectedRooms.value = selected.includes(r.id) ? [] : [r.id]; }} />
        );
      })}
      <g stroke="var(--wall)" stroke-linecap="square" pointer-events="none">
        {plan.walls.map((w) => <line key={w.id} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke-width={w.thickness} />)}
      </g>
      <g pointer-events="none" fill="none">
        {plan.openings.map((o) => {
          const len = dist(o.a, o.b);
          const n: Pt = [-(o.b[1] - o.a[1]) / len, (o.b[0] - o.a[0]) / len];
          const tip: Pt = [o.a[0] + n[0] * len, o.a[1] + n[1] * len];
          return (
            <g key={o.id}>
              <line x1={o.a[0]} y1={o.a[1]} x2={o.b[0]} y2={o.b[1]} stroke="var(--paper)" stroke-width={0.34} />
              {o.kind === 'door'
                ? <path d={`M${o.b[0]},${o.b[1]} A${len},${len} 0 0 1 ${tip[0]},${tip[1]} L${o.a[0]},${o.a[1]}`} stroke="var(--wall)" stroke-width={0.03} />
                : [-0.07, 0, 0.07].map((k) => <line key={k} x1={o.a[0] + n[0] * k} y1={o.a[1] + n[1] * k} x2={o.b[0] + n[0] * k} y2={o.b[1] + n[1] * k} stroke="var(--wall)" stroke-width={0.025} />)}
            </g>
          );
        })}
      </g>
      {route && (
        <g pointer-events="none" class="escape">
          <polyline points={route.path.map((p) => p.join(',')).join(' ')} fill="none" stroke="#dc2626" stroke-width={fs * 0.18} stroke-dasharray={`${fs * 0.6} ${fs * 0.35}`} stroke-linejoin="round" />
          <circle cx={route.from[0]} cy={route.from[1]} r={fs * 0.35} fill="#dc2626" />
          <text x={(route.path[0][0] + route.path[1][0]) / 2} y={(route.path[0][1] + route.path[1][1]) / 2 - fs * 0.5} font-size={fs * 1.1} text-anchor="middle" fill="#dc2626" font-weight="700" stroke="var(--paper)" stroke-width={fs * 0.25} paint-order="stroke">{route.distance_m} m to exit</text>
        </g>
      )}
      {exits.map((d) => <g key={d.id} pointer-events="none"><circle cx={d.mid[0]} cy={d.mid[1]} r={fs * 0.6} fill="#15803d" /><text x={d.mid[0]} y={d.mid[1] + fs * 0.35} font-size={fs * 0.8} text-anchor="middle" fill="#fff" font-weight="700">EXIT</text></g>)}
      {!compact && (
        <g pointer-events="none" text-anchor="middle" class="labels">
          {plan.rooms.map((r) => {
            const [x, y] = centroid(r.polygon);
            return (
              <text key={r.id} x={x} y={y} font-size={fs}>
                <tspan x={x} font-weight="600">{r.name}</tspan>
                <tspan x={x} dy={fs * 1.2} font-size={fs * 0.85}>{round(area(r.polygon), 1)} m²</tspan>
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
  if (compact) return drawing;

  const apply = () => { if (typed !== null) setRatio(Number(typed)); setTyped(null); };
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
        <datalist id="std-scales">{STANDARD.map((x) => <option key={x} value={x} />)}</datalist>
        {plan.scale.ratio && <button class="link small" onClick={() => setRatio(plan.scale.ratio!)} title="The drawing's own scale">Drawing 1:{plan.scale.ratio}</button>}
        <button class="link small" onClick={() => setVb(home)}>Fit</button>
        <button class="link small" aria-pressed={showEscape} onClick={() => setShowEscape(!showEscape)}
          title="Escape routes: travel distance from the furthest point of the room to an exit (Metric Handbook Ch. 41). Hover a room.">
          {showEscape ? '✓ ' : ''}Escape</button>
        {showEscape && !escape && <span class="small muted">No exit door found</span>}
        <button class="link small" title={`Print to scale at 1:${printRatio}`}
          onClick={() => printPlan(svg.current!, plan, Number(prompt('Print at scale 1:', String(printRatio))) || printRatio, pad, title)}>Print…</button>
      </div>
      {pxPerM > 0 && (
        <div class="scalebar" aria-label={`Scale bar ${barM} m`}>
          <div class="sb-bar" style={{ width: `${barM * pxPerM}px` }}><i /><i /><i /><i /></div>
          <span>0</span><span style={{ left: `${barM * pxPerM}px` }}>{barM} m</span>
        </div>
      )}
    </div>
  );
}
