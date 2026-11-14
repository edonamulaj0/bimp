import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PlanDiff } from '../../../shared/diff';
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
import { type Region, normRegion, regionSize } from '../../../shared/region';

/** Which parts of the drawing are shown (the canvas Layers menu). */
export type Layers = { fills: boolean; furniture: boolean; dims: boolean; labels: boolean; pins: boolean };
export const ALL_LAYERS: Layers = { fills: true, furniture: true, dims: true, labels: true, pins: true };
export type CanvasTool = 'select' | 'comment' | 'region' | 'measure';
/** A request for the canvas context menu: client position, the plan point under it and the room there. */
export type MenuAt = { x: number; y: number; p: Pt | null; roomId: string | null };
/** Imperative controls for the toolbar and the context menu. */
export type Plan2DApi = {
  fit(): void; zoom(k: number): void; mode(): PlanMode; setMode(m: PlanMode): void;
  escape(): boolean; toggleEscape(): void; measures(): number; clearMeasures(): void; print(): void;
};

/** CSS pixels per metre of screen (96 px per inch). Screens vary, so on-screen 1:x is nominal; print is exact. */
const SCREEN_PX_PER_M = 96 / 0.0254;
const STANDARD = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

/** A comment pinned to the plan (plan metres). */
export type PinMark = { id: string; n: number; x: number; y: number; resolved: boolean; label: string };
type Props = {
  plan: Plan; compact?: boolean; sourceUrl?: string | null; title?: string;
  /** Comment pins on this plan; drawn at a constant screen size. */
  pins?: PinMark[]; activePin?: string | null; onPin?(id: string): void;
  /** Comment tool: a click (or Enter on a room) drops a pin at that spot instead of selecting. */
  placing?: boolean; onPlace?(p: Pt, roomId?: string): void;
  /** A pin being written (not saved yet), and a popover (the composer) anchored next to it or to the active pin. */
  draft?: Pt | null; popover?: ComponentChildren;
  /** Comparing revisions: this plan is the newer one, the overlay shows what changed since the older. */
  diff?: PlanDiff | null;
  /** Pan to this point when key changes (e.g. a comment thread was chosen). */
  focusAt?: { p: Pt; key: number } | null;
  /** Active tool: region drags a rectangle (markup), measure clicks two points. Comment uses `placing`. */
  tool?: CanvasTool; region?: Region | null; onRegion?(r: Region | null): void;
  layers?: Layers; apiRef?: { current: Plan2DApi | null }; onMenu?(m: MenuAt): void;
};
/** plan: the drawing with overall sizes; dims: every wall, opening and room dimensioned in millimetres. */
export type PlanMode = 'plan' | 'dims';

export function Plan2D({ plan, compact, sourceUrl, title = 'Plan', pins, activePin, onPin, placing, onPlace, draft, popover, diff, focusAt, tool = 'select', region, onRegion, layers = ALL_LAYERS, apiRef, onMenu }: Props) {
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
  // markup region being dragged; measurements (pairs of snapped points) and the one being drawn
  const [rubber, setRubber] = useState<[Pt, Pt] | null>(null);
  const [measures, setMeasures] = useState<[Pt, Pt][]>([]);
  const [mFrom, setMFrom] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const press = useRef<{ t: number; x: number; y: number } | null>(null);
  useEffect(() => { if (tool !== 'measure') { setMFrom(null); setCursor(null); } if (tool !== 'region') setRubber(null); }, [tool]);
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
    if (!focusAt) return;
    const [x, y] = focusAt.p;
    setVb((v) => (x > v.x + v.w * 0.1 && x < v.x + v.w * 0.9 && y > v.y + v.h * 0.1 && y < v.y + v.h * 0.9 ? v : { ...v, x: x - v.w / 2, y: y - v.h / 2 }));
  }, [focusAt?.key]);
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
  if (apiRef) apiRef.current = {
    fit: () => setVb(home), zoom, mode: () => mode, setMode: pickMode, escape: () => showEscape, toggleEscape: () => setShowEscape((v) => !v),
    measures: () => measures.length, clearMeasures: () => { setMeasures([]); setMFrom(null); },
    print: () => setPrinting(String(printRatio)),
  };
  // Snapping for the measure tool: room corners, wall footprint corners and opening ends within 10 px.
  const snapPts = useMemo(() => [
    ...plan.rooms.flatMap((r) => r.polygon), ...footprints.flatMap((f) => f.poly), ...plan.openings.flatMap((o) => [o.a, o.b]),
  ], [plan, footprints]);
  const snap = (p: Pt, from?: Pt | null, ortho?: boolean): Pt => {
    if (ortho && from) p = Math.abs(p[0] - from[0]) > Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]];
    const tol = pxPerM ? 10 / pxPerM : 0.15;
    let best: Pt | null = null, bd = tol;
    for (const q of snapPts) { const d = dist(p, q); if (d < bd && (!ortho || !from || Math.abs(q[0] - from[0]) < 1e-6 || Math.abs(q[1] - from[1]) < 1e-6)) { bd = d; best = q; } }
    return best ? [best[0], best[1]] : [round(p[0], 3), round(p[1], 3)];
  };
  const menuAt = (cx: number, cy: number) => {
    if (!onMenu) return;
    const p = toPlan(cx, cy);
    onMenu({ x: cx, y: cy, p, roomId: plan.rooms.find((r) => inside(p, r.polygon))?.id ?? null });
  };
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
      class={`plan2d${compact ? ' compact' : ''}${placing || tool === 'measure' || tool === 'region' ? ' placing' : ''}`}
      onClick={placing && onPlace ? (e) => { if (!drag.current?.moved) onPlace(toPlan(e.clientX, e.clientY)); }
        : tool === 'measure' ? (e) => {
          if (drag.current?.moved) return;
          const p = snap(toPlan(e.clientX, e.clientY), mFrom, e.shiftKey);
          if (!mFrom) setMFrom(p); else { if (dist(mFrom, p) > 0.01) setMeasures((m) => [...m, [mFrom, p]]); setMFrom(null); }
        } : undefined}
      onContextMenu={compact || !onMenu ? undefined : (e) => { e.preventDefault(); menuAt(e.clientX, e.clientY); }}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={compact ? undefined : (e) => {
        ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (ptrs.current.size === 2) { // two fingers: pinch zoom about their midpoint; no panning until both lift
          const [a, b] = [...ptrs.current.values()];
          pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, vb, mid: toPlan((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
          drag.current = { x: 0, y: 0, vb, moved: true, dead: true };
        } else if (!pinch.current) {
          drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
          if (tool === 'region' && e.button === 0) { const p = toPlan(e.clientX, e.clientY); setRubber([p, p]); drag.current.dead = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }
          if (e.pointerType === 'touch' && onMenu) press.current = { t: window.setTimeout(() => { press.current = null; drag.current = { ...drag.current!, moved: true, dead: true }; setRubber(null); menuAt(e.clientX, e.clientY); }, 550), x: e.clientX, y: e.clientY };
        }
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
        if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) { clearTimeout(press.current.t); press.current = null; }
        if (tool === 'measure') setCursor(snap(toPlan(e.clientX, e.clientY), mFrom, e.shiftKey));
        if (rubber && e.buttons & 1) { setRubber([rubber[0], toPlan(e.clientX, e.clientY)]); return; }
        const d = drag.current;
        if (!d || d.dead || !(e.buttons & 1)) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }
        const s = scale();
        setVb({ ...d.vb, x: d.vb.x - dx * s, y: d.vb.y - dy * s });
      }}
      onPointerUp={(e) => {
        ptrs.current.delete(e.pointerId); if (!ptrs.current.size) pinch.current = null;
        if (press.current) { clearTimeout(press.current.t); press.current = null; }
        if (rubber) {
          const r = normRegion(rubber[0], toPlan(e.clientX, e.clientY)), { w, h } = regionSize(r);
          setRubber(null);
          if (w >= 0.2 && h >= 0.2) onRegion?.(r);
          if (drag.current) drag.current.moved = true;
        }
        setTimeout(() => (drag.current = null));
      }}
      onPointerCancel={(e) => { ptrs.current.delete(e.pointerId); if (!ptrs.current.size) pinch.current = null; drag.current = null; setRubber(null); if (press.current) { clearTimeout(press.current.t); press.current = null; } }}
      onKeyDown={compact ? undefined : keys}
      onPointerLeave={() => (hoverRoom.value = null)}
      onDblClick={(e) => { if (onMenu) menuAt(e.clientX, e.clientY); else setVb(home); }}
      role={compact ? 'img' : 'group'}
      aria-label={compact ? '2D floor plan' : placing
        ? `2D floor plan. Comment tool: click a spot, or tab to a room and press Enter, to pin a comment there.`
        : tool === 'region' ? '2D floor plan. Markup tool: drag a rectangle over the area to ask about.'
        : tool === 'measure' ? '2D floor plan. Measure tool: click two points; hold Shift to keep the line straight.'
        : `2D floor plan, ${plan.rooms.length} rooms${pins?.length ? `, ${pins.length} comment pins` : ''}. Tab to a room; arrow keys pan, plus and minus zoom.`}
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
            fill={ROOM_COLORS[r.type]} fill-opacity={on ? 0.6 : sourceUrl ? 0.2 : mode === 'dims' || !layers.fills ? 0.0001 : 0.22}
            stroke={on ? 'var(--accent)' : 'none'} stroke-width={fs * 0.15} class="room"
            {...(compact ? {} : {
              tabIndex: 0, role: 'button', 'aria-label': `${r.name}, ${round(area(r.polygon), 1)} m²`, 'aria-pressed': selected.includes(r.id),
              onFocus: (e: FocusEvent) => { hoverRoom.value = r.id; if ((e.currentTarget as Element).matches(':focus-visible')) setKbd(r.id); },
              onBlur: () => { hoverRoom.value = null; setKbd(null); },
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (placing && onPlace) onPlace(labelAt.get(r.id) ?? centroid(r.polygon), r.id); else toggle(r.id);
              },
            })}
            onPointerEnter={() => (hoverRoom.value = r.id)}
            onClick={() => { if (!placing && tool === 'select' && !drag.current?.moved) toggle(r.id); }} />
        );
      })}
      {!compact && !sourceUrl && mode === 'plan' && layers.fills && (
        <g pointer-events="none" class="floor-patterns" aria-hidden="true">
          {plan.rooms.filter((r) => FLOOR_OF[r.type] !== 'plain').map((r) => (
            <polygon key={r.id} points={r.polygon.map((p) => p.join(',')).join(' ')} fill={`url(#fl-${FLOOR_OF[r.type]})`} />
          ))}
        </g>
      )}
      {layers.furniture && <g pointer-events="none" class="fixtures" aria-hidden="true">{(plan.fixtures ?? []).map((f) => <FixtureSymbol key={f.id} f={f} />)}</g>}
      <Walls footprints={footprints} />
      <Openings plan={plan} thick={openingT} u={pxPerM ? 1 / pxPerM : 0.03} />
      {!compact && layers.dims && <Dimensions plan={plan} fs={fs} mode={mode} footprints={footprints} thick={openingT} />}
      {diff && <DiffOverlay diff={diff} fs={fs} labelAt={labelAt} />}
      {kbd && (() => { const r = plan.rooms.find((x) => x.id === kbd); return r && <polygon class="focus-ring" aria-hidden="true" points={r.polygon.map((p) => p.join(',')).join(' ')} />; })()}
      {route && (
        <g pointer-events="none" class="escape" aria-hidden="true">
          <polyline points={route.path.map((p) => p.join(',')).join(' ')} fill="none" stroke="#dc2626" stroke-width={fs * 0.18} stroke-dasharray={`${fs * 0.6} ${fs * 0.35}`} stroke-linejoin="round" />
          <circle cx={route.from[0]} cy={route.from[1]} r={fs * 0.35} fill="#dc2626" />
          <text x={escLabel![0]} y={escLabel![1]} font-size={fs * 1.1} text-anchor="middle" fill="#dc2626" font-weight="700" stroke="var(--paper)" stroke-width={fs * 0.25} paint-order="stroke">{route.distance_m} m to exit</text>
        </g>
      )}
      {exits.map((d) => <g key={d.id} pointer-events="none" aria-hidden="true"><circle cx={d.mid[0]} cy={d.mid[1]} r={fs * 0.6} fill="#15803d" /><text x={d.mid[0]} y={d.mid[1] + fs * 0.35} font-size={fs * 0.8} text-anchor="middle" fill="#fff" font-weight="700">EXIT</text></g>)}
      {!compact && layers.labels && (
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
      {!compact && pxPerM > 0 && (region || rubber) && <RegionMark r={rubber ? normRegion(rubber[0], rubber[1]) : region!} live={!!rubber} u={1 / pxPerM} />}
      {!compact && pxPerM > 0 && (measures.length > 0 || mFrom) && (
        <g class="measures" pointer-events="none" aria-hidden="true">
          {[...measures, ...(mFrom && cursor ? [[mFrom, cursor] as [Pt, Pt]] : [])].map(([a, b], i) => <Measure key={i} a={a} b={b} u={1 / pxPerM} live={i === measures.length} />)}
          {mFrom && <circle cx={mFrom[0]} cy={mFrom[1]} r={4 / pxPerM} class="m-pt" />}
        </g>
      )}
      {!compact && tool === 'measure' && cursor && !mFrom && pxPerM > 0 && <circle cx={cursor[0]} cy={cursor[1]} r={4 / pxPerM} class="m-pt hover" aria-hidden="true" pointer-events="none" />}
      {!compact && pxPerM > 0 && layers.pins && (!!pins?.length || draft) && (
        <g class="pins">
          {pins?.map((p) => (
            <g key={p.id} transform={`translate(${p.x} ${p.y}) scale(${1 / pxPerM})`} class={`pin${p.resolved ? ' resolved' : ''}${activePin === p.id ? ' active' : ''}`}
              tabIndex={0} role="button" aria-label={p.label} aria-pressed={activePin === p.id} data-pin={p.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onPin?.(p.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPin?.(p.id); } }}>
              <path d={PIN_PATH} />
              <text y={-17.5} text-anchor="middle" dominant-baseline="central">{p.n}</text>
            </g>
          ))}
          {draft && (
            <g transform={`translate(${draft[0]} ${draft[1]}) scale(${1 / pxPerM})`} class="pin draft" aria-hidden="true">
              <path d={PIN_PATH} /><text y={-17.5} text-anchor="middle" dominant-baseline="central">+</text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
  if (compact) return drawing;
  // Screen position (in the wrapper) of a plan point; the SVG is letterboxed (xMidYMid meet).
  const toScreen = ([x, y]: Pt) => [(size.w - vb.w * pxPerM) / 2 + (x - vb.x) * pxPerM, (size.h - vb.h * pxPerM) / 2 + (y - vb.y) * pxPerM];
  const anchor = draft ?? (activePin ? pins?.find((p) => p.id === activePin) : null);
  const at = anchor && pxPerM ? toScreen(Array.isArray(anchor) ? anchor as Pt : [anchor.x, anchor.y]) : null;

  const apply = () => { if (typed !== null) setRatio(Number(typed)); setTyped(null); };
  const printN = Math.round(Number(printing));
  const doPrint = (e: Event) => { e.preventDefault(); if (!(printN >= 1)) return; setPrinting(null); printPlan(svg.current!, plan, printN, pad, title); };
  return (
    <div class="plan2d-wrap">
      {drawing}
      {popover && at && (
        <div class={`pin-pop${size.w < 560 ? ' sheet-bottom' : ''}`} onPointerDown={(e) => e.stopPropagation()}
          style={size.w < 560 ? undefined : { left: `${Math.max(8, Math.min(at[0] + 20, size.w - 328))}px`, top: `${Math.max(8, Math.min(at[1] - 40, size.h - 230))}px` }}>
          {popover}
        </div>
      )}
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

/** The markup region: a dashed rectangle with corner ticks and its size; u = metres per screen pixel. */
function RegionMark({ r, live, u }: { r: Region; live: boolean; u: number }) {
  const { w, h } = regionSize(r), t = 10 * u;
  const corners: [number, number, number, number][] = [[r.x0, r.y0, 1, 1], [r.x1, r.y0, -1, 1], [r.x1, r.y1, -1, -1], [r.x0, r.y1, 1, -1]];
  return (
    <g class={`region${live ? ' live' : ''}`} pointer-events="none" aria-hidden="true">
      <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} class="rg-fill" />
      <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} class="rg-line" />
      {corners.map(([x, y, sx, sy], i) => <path key={i} d={`M${x + sx * t},${y}H${x}V${y + sy * t}`} class="rg-tick" />)}
      <text x={r.x0} y={r.y0 - 6 * u} font-size={12 * u} stroke-width={3 * u} class="rg-label">{w.toFixed(2)} × {h.toFixed(2)} m</text>
    </g>
  );
}

/** A measured distance: the line with end ticks and its length in millimetres, drawn at screen size. */
function Measure({ a, b, u, live }: { a: Pt; b: Pt; u: number; live: boolean }) {
  const L = dist(a, b);
  if (L < 1e-6) return null;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * 6 * u, ny = ux * 6 * u;
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
  const mx = (a[0] + b[0]) / 2 + nx * 1.6, my = (a[1] + b[1]) / 2 + ny * 1.6;
  return (
    <g class={`measure${live ? ' live' : ''}`}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} class="m-line" />
      <line x1={a[0] - nx} y1={a[1] - ny} x2={a[0] + nx} y2={a[1] + ny} class="m-line" />
      <line x1={b[0] - nx} y1={b[1] - ny} x2={b[0] + nx} y2={b[1] + ny} class="m-line" />
      <text x={mx} y={my} font-size={12 * u} text-anchor="middle" dominant-baseline="middle" stroke-width={3 * u} transform={`rotate(${ang} ${mx} ${my})`} class="m-label">{mm(L)} mm</text>
    </g>
  );
}

/** A map-pin 22 px wide with its tip at (0, 0), in screen pixels. */
const PIN_PATH = 'M0,0 C-3,-6 -11,-10.5 -11,-17.5 A11,11 0 1 1 11,-17.5 C11,-10.5 3,-6 0,0Z';

const sgn = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(round(n, 2))}`;
/**
 * What changed since the older revision, over the newer plan: added rooms and walls green, removed walls (and rooms)
 * dashed red from the older plan, resized rooms tinted with their change in m². Strokes don't scale with zoom.
 */
function DiffOverlay({ diff, fs, labelAt }: { diff: PlanDiff; fs: number; labelAt: Map<string, Pt> }) {
  return (
    <g class="diff" pointer-events="none" aria-hidden="true">
      {diff.rooms.map((r, i) => {
        if (r.status === 'same') return null;
        const poly = (r.b ?? r.a)!.polygon;
        return <polygon key={`r${i}`} points={pts(poly)} class={`d-room d-${r.status}`} />;
      })}
      {diff.walls.removed.map((w) => <line key={`wr${w.id}`} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} class="d-wall-del" />)}
      {diff.walls.added.map((w) => <line key={`wa${w.id}`} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} class="d-wall-add" stroke-width={Math.max(w.thickness, 0.08)} />)}
      <g text-anchor="middle" font-size={fs * 0.9} font-weight="600" stroke="var(--sheet)" stroke-width={fs * 0.25} paint-order="stroke" stroke-linejoin="round">
        {diff.rooms.map((r, i) => {
          if (r.status === 'same') return null;
          const room = (r.b ?? r.a)!, [x, y] = (r.b && labelAt.get(r.b.id)) || labelPoint(room.polygon);
          const t = r.status === 'added' ? `New · ${r.area_b} m²` : r.status === 'removed' ? `Removed: ${r.name}` : `${sgn(r.delta)} m²`;
          return <text key={`t${i}`} x={x} y={r.status === 'removed' ? y : y - fs * 1.35} class={`d-label l-${r.status}`}>{t}</text>;
        })}
      </g>
    </g>
  );
}
