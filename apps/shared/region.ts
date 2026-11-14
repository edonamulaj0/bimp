// A rectangular region of a plan (markup tool): clip the plan to it so questions are answered from what lies inside.
import { type Plan, type Pt, type Room, area, round } from './plan';

/** Axis-aligned region in plan metres (x0 < x1, y0 < y1). */
export type Region = { x0: number; y0: number; x1: number; y1: number };

export const normRegion = (a: Pt, b: Pt): Region => ({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
export const regionSize = (r: Region) => ({ w: round(r.x1 - r.x0, 2), h: round(r.y1 - r.y0, 2), area: round((r.x1 - r.x0) * (r.y1 - r.y0), 2) });
export const inRegion = (p: Pt, r: Region) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;

/** A region from untrusted input (the chat API), or null when it is not a usable rectangle on this plan. */
export function parseRegion(v: unknown, plan: Plan): Region | null {
  if (!v || typeof v !== 'object') return null;
  const n = ['x0', 'y0', 'x1', 'y1'].map((k) => Number((v as Record<string, unknown>)[k]));
  if (!n.every(Number.isFinite)) return null;
  const pad = Math.max(plan.width, plan.height) * 0.5;
  const c = (x: number, max: number) => round(Math.min(Math.max(x, -pad), max + pad), 3);
  const r = normRegion([c(n[0], plan.width), c(n[1], plan.height)], [c(n[2], plan.width), c(n[3], plan.height)]);
  return r.x1 - r.x0 >= 0.2 && r.y1 - r.y0 >= 0.2 ? r : null;
}

/** Sutherland–Hodgman against the four edges of the rectangle. */
export function clipPolygon(poly: Pt[], r: Region): Pt[] {
  const edges: [(p: Pt) => boolean, (p: Pt, q: Pt) => Pt][] = [
    [(p) => p[0] >= r.x0, (p, q) => [r.x0, p[1] + ((q[1] - p[1]) * (r.x0 - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= r.x1, (p, q) => [r.x1, p[1] + ((q[1] - p[1]) * (r.x1 - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= r.y0, (p, q) => [p[0] + ((q[0] - p[0]) * (r.y0 - p[1])) / (q[1] - p[1]), r.y0]],
    [(p) => p[1] <= r.y1, (p, q) => [p[0] + ((q[0] - p[0]) * (r.y1 - p[1])) / (q[1] - p[1]), r.y1]],
  ];
  let out = poly;
  for (const [ins, cut] of edges) {
    const src = out;
    out = [];
    src.forEach((p, i) => {
      const q = src[(i + 1) % src.length], pi = ins(p), qi = ins(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cut(p, q));
    });
    if (!out.length) break;
  }
  return out.map(([x, y]) => [round(x, 4), round(y, 4)] as Pt);
}

/** Liang–Barsky: the part of segment a–b inside the rectangle, or null. */
export function clipSegment(a: Pt, b: Pt, r: Region): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [[round(a[0] + dx * t0, 4), round(a[1] + dy * t0, 4)], [round(a[0] + dx * t1, 4), round(a[1] + dy * t1, 4)]];
}

export type RegionRoom = { id: string; name: string; type: Room['type']; area_in_region_m2: number; share_of_room: number };
/** What lies inside a region: rooms (with how much of each), openings and fittings. */
export function regionContents(plan: Plan, r: Region) {
  const rooms: RegionRoom[] = [];
  for (const room of plan.rooms) {
    const c = clipPolygon(room.polygon, r), a = c.length >= 3 ? area(c) : 0, full = area(room.polygon) || 1;
    if (a >= 0.05) rooms.push({ id: room.id, name: room.name, type: room.type, area_in_region_m2: round(a, 2), share_of_room: round(a / full, 2) });
  }
  const mid = (o: { a: Pt; b: Pt }): Pt => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  const openings = plan.openings.filter((o) => inRegion(mid(o), r));
  const fixtures = (plan.fixtures ?? []).filter((f) => inRegion(f.center, r));
  return { rooms, openings, fixtures };
}

/**
 * The plan cut down to a region: room outlines clipped to it (ids kept, so answers cite the same rooms), wall
 * stretches inside it, openings and fittings whose centre is inside. Extent becomes the region's; the scope is stated
 * in the assumptions so every answer carries it.
 */
export function clipPlan(plan: Plan, r: Region): Plan {
  const { rooms: inside, openings, fixtures } = regionContents(plan, r);
  const keep = new Set(inside.map((x) => x.id));
  const rooms = plan.rooms.filter((x) => keep.has(x.id)).map((x) => ({ ...x, polygon: clipPolygon(x.polygon, r) }));
  const walls = plan.walls.flatMap((w) => { const s = clipSegment(w.a, w.b, r); return s && Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 0.05 ? [{ ...w, a: s[0], b: s[1] }] : []; });
  const { w, h } = regionSize(r);
  const partial = inside.filter((x) => x.share_of_room < 0.98).map((x) => `${x.name} (${Math.round(x.share_of_room * 100)}% inside)`);
  return {
    ...plan,
    width: w, height: h, rooms, walls, openings, fixtures,
    assumptions: [
      ...plan.assumptions,
      `Scope: only the marked region, x ${round(r.x0, 2)} to ${round(r.x1, 2)} m, y ${round(r.y0, 2)} to ${round(r.y1, 2)} m (${w} × ${h} m, ${round(w * h, 2)} m²)`,
      ...(partial.length ? [`Rooms cut by the region boundary, areas are the part inside: ${partial.join(', ')}`] : []),
    ],
  };
}
