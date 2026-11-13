import { useEffect, useRef, useState } from 'preact/hooks';
import { type Plan, type Pt, area, centroid, dist, round } from '../../../shared/plan';
import { hoverRoom, selectedRooms } from '../state';
import { ROOM_COLORS } from './colors';

type Props = { plan: Plan; compact?: boolean; sourceUrl?: string | null };

export function Plan2D({ plan, compact, sourceUrl }: Props) {
  const pad = Math.max(plan.width, plan.height) * 0.06;
  const home = { x: -pad, y: -pad, w: plan.width + 2 * pad, h: plan.height + 2 * pad };
  const [vb, setVb] = useState(home);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: typeof vb; moved: boolean } | null>(null);
  useEffect(() => setVb(home), [plan]);

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
  const fs = Math.max(plan.width, plan.height) / 45;

  return (
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
}
