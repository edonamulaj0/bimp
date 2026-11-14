// The answer note on the plan: which area an answer is about, and where its note goes so that it never covers that area.
import type { Plan, Pt } from '../../../shared/plan';
import type { Region } from '../../../shared/region';

export type Box = [number, number, number, number]; // x0, y0, x1, y1
/** An answer pinned beside the part of the plan it is about (set by the chat, shown by the 2D plan). */
export type AnswerNote = { key: number; planId: string | null; question: string; text: string; rooms: string[]; items: string[]; region: Region | null; verified?: boolean };

/** The area an answer is about, in plan metres: the marked region, else the cited items, else the cited rooms. */
export function noteArea(plan: Plan, n: Pick<AnswerNote, 'rooms' | 'items' | 'region'>): { polys: Pt[][]; marks: Box[]; box: Box } | null {
  const polys: Pt[][] = [], marks: Box[] = [];
  if (n.region) polys.push([[n.region.x0, n.region.y0], [n.region.x1, n.region.y0], [n.region.x1, n.region.y1], [n.region.x0, n.region.y1]]);
  for (const id of n.items) {
    const o = plan.openings.find((x) => x.id === id), f = plan.fixtures?.find((x) => x.id === id), d = plan.detected?.items.find((x) => x.id === id);
    const p = 0.2, w = id.startsWith('wall-') ? plan.walls.find((x) => `wall-${x.id}` === id) : undefined;
    if (w) { const t = w.thickness / 2 + 0.12; marks.push([Math.min(w.a[0], w.b[0]) - t, Math.min(w.a[1], w.b[1]) - t, Math.max(w.a[0], w.b[0]) + t, Math.max(w.a[1], w.b[1]) + t]); }
    else if (o) marks.push([Math.min(o.a[0], o.b[0]) - p, Math.min(o.a[1], o.b[1]) - p, Math.max(o.a[0], o.b[0]) + p, Math.max(o.a[1], o.b[1]) + p]);
    else if (f) { const r = Math.max(...f.size) / 2 + 0.1; marks.push([f.center[0] - r, f.center[1] - r, f.center[0] + r, f.center[1] + r]); }
    else if (d) marks.push([d.box[0] - 0.1, d.box[1] - 0.1, d.box[2] + 0.1, d.box[3] + 0.1]);
  }
  if (!n.region && !marks.length) for (const id of n.rooms) { const r = plan.rooms.find((x) => x.id === id); if (r) polys.push(r.polygon); }
  const pts: Pt[] = [...polys.flat(), ...marks.flatMap((b): Pt[] => [[b[0], b[1]], [b[2], b[3]]])];
  if (!pts.length) return null;
  return { polys, marks, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
}

/**
 * Where a note of w × h goes beside an area (both in the same screen coordinates, inside a W × H view): on the side
 * with the most room, centred on the area, kept inside the view. `clear` says it does not cover the area; when no
 * side has room for it (the area fills the view), the caller makes room by showing more of the plan.
 */
export function placeNote(area: Box, w: number, h: number, W: number, H: number, gap = 18, m = 8): { left: number; top: number; side: 'right' | 'left' | 'below' | 'above'; clear: boolean; from: Pt; to: Pt } {
  const [x0, y0, x1, y1] = area, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const fit = (v: number, size: number, max: number) => Math.max(m, Math.min(v, max - size - m));
  const sides = [
    { side: 'right' as const, room: W - m - (x1 + gap) - w, left: x1 + gap, top: fit(cy - h / 2, h, H) },
    { side: 'left' as const, room: x0 - gap - m - w, left: x0 - gap - w, top: fit(cy - h / 2, h, H) },
    { side: 'below' as const, room: H - m - (y1 + gap) - h, left: fit(cx - w / 2, w, W), top: y1 + gap },
    { side: 'above' as const, room: y0 - gap - m - h, left: fit(cx - w / 2, w, W), top: y0 - gap - h },
  ].sort((a, b) => b.room - a.room);
  const s = sides[0], clear = s.room >= 0;
  const left = clear ? s.left : fit(s.left, w, W), top = clear ? s.top : fit(s.top, h, H);
  // the leader: from the note's edge that faces the area to the nearest point of the area's edge
  const within = (v: number, a: number, b: number) => Math.max(a, Math.min(v, b));
  const from: Pt = s.side === 'right' ? [left, within(cy, top + 12, top + h - 12)] : s.side === 'left' ? [left + w, within(cy, top + 12, top + h - 12)]
    : s.side === 'below' ? [within(cx, left + 12, left + w - 12), top] : [within(cx, left + 12, left + w - 12), top + h];
  const to: Pt = s.side === 'right' ? [x1, within(from[1], y0, y1)] : s.side === 'left' ? [x0, within(from[1], y0, y1)] : s.side === 'below' ? [within(from[0], x0, x1), y1] : [within(from[0], x0, x1), y0];
  return { left, top, side: s.side, clear, from, to };
}
