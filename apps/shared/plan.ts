// Plan model shared by API and web. All geometry is in metres, origin top-left, y down.
export type Pt = [number, number];
export const ROOM_TYPES = ['living', 'dining', 'bedroom', 'kitchen', 'bathroom', 'wc', 'utility', 'circulation', 'stair', 'lift', 'storage', 'office', 'garage', 'plant', 'outdoor', 'other'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface Room { id: string; name: string; type: RoomType; polygon: Pt[] }
export interface Wall { id: string; a: Pt; b: Pt; thickness: number }
export interface Opening { id: string; kind: 'door' | 'window'; a: Pt; b: Pt }

/** Fittings and furniture drawn on the plan. Read from the drawing, never invented. */
export const FIXTURE_KINDS = ['wc', 'sink', 'bathtub', 'shower', 'sauna_stove', 'stove', 'fridge', 'washer', 'bed', 'sofa', 'table', 'desk', 'wardrobe'] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
/** center/size in metres; size[0] runs along the wall it backs onto, size[1] away from it; angle in radians (local +y = front). */
export interface Fixture { id: string; kind: FixtureKind; center: Pt; size: Pt; angle: number; room_id: string | null }
export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  wc: 'toilet', sink: 'sink / wash basin', bathtub: 'bathtub', shower: 'shower', sauna_stove: 'sauna stove', stove: 'cooker / hob',
  fridge: 'fridge', washer: 'washing machine', bed: 'bed', sofa: 'sofa', table: 'table', desk: 'desk', wardrobe: 'wardrobe',
};

export interface Plan {
  version: 1;
  method: 'sample' | 'gemini' | 'hybrid';
  measured: boolean; // false = AI/sample preview; dimensions approximate
  width: number;
  height: number;
  wallHeight: number;
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  fixtures?: Fixture[];
  /** ratio = the drawing's own stated scale (1:ratio) when known. */
  scale: { metersPerPx: number | null; source: string; ratio?: number };
  /** The drawing as rendered for reading; geometry maps onto it via scale.metersPerPx and offset. */
  source: { fileId: string; mime: string; imageWidth: number; imageHeight: number; offset: Pt; renderSha?: string } | null;
  /** How the geometry was obtained: input kind, whether the scale is stated exactly, share of corners snapped to line work. */
  provenance?: { kind: string; scaleExact: boolean; snapped: number; segments: number };
  assumptions: string[];
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function area(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export const perimeter = (poly: Pt[]) => poly.reduce((s, p, i) => s + dist(p, poly[(i + 1) % poly.length]), 0);

export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function bounds(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/**
 * Walls from rooms whose outlines follow the inside faces of walls (plans read from drawings). Facing edges of two
 * rooms separated by a plausible wall thickness (75–600 mm: bricks and blocks, Metric Handbook Ch. 37) become one
 * wall of exactly that thickness on their centreline; remaining edges get a wall outside the room, so room areas stay net.
 */
export function wallsFromFaces(rooms: Room[], exterior = 0.3, interior = 0.12, minT = 0.075, maxT = 0.6): Wall[] {
  type E = { a: Pt; u: Pt; n: Pt; L: number; room: string; used: [number, number][] };
  const edges: E[] = [];
  for (const r of rooms) {
    let sgn = 0;
    r.polygon.forEach((p, i) => { const q = r.polygon[(i + 1) % r.polygon.length]; sgn += p[0] * q[1] - q[0] * p[1]; });
    r.polygon.forEach((a, i) => {
      const b = r.polygon[(i + 1) % r.polygon.length], L = dist(a, b);
      if (L < 0.1) return;
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      edges.push({ a, u, L, room: r.id, n: sgn > 0 ? [u[1], -u[0]] : [-u[1], u[0]], used: [] });
    });
  }
  const proj = (e: E, p: Pt) => (p[0] - e.a[0]) * e.u[0] + (p[1] - e.a[1]) * e.u[1];
  const pairs: { i: number; j: number; d: number; s: number; t: number }[] = [];
  edges.forEach((ei, i) => edges.forEach((ej, j) => {
    if (j <= i || ei.room === ej.room || ei.n[0] * ej.n[0] + ei.n[1] * ej.n[1] > -0.995) return;
    const d = (ej.a[0] - ei.a[0]) * ei.n[0] + (ej.a[1] - ei.a[1]) * ei.n[1];
    if (d < -0.1 || d > maxT) return; // closer than a real wall (or overlapping by a stroke width on raster scans): the same wall
    const p0 = proj(ei, ej.a), p1 = proj(ei, [ej.a[0] + ej.u[0] * ej.L, ej.a[1] + ej.u[1] * ej.L]);
    const s = Math.max(0, Math.min(p0, p1)), t = Math.min(ei.L, Math.max(p0, p1));
    if (t - s >= 0.2) pairs.push({ i, j, d, s, t });
  }));
  pairs.sort((x, y) => x.d - y.d); // the thinnest gap is the real wall
  const covered = (e: E, s: number, t: number) => e.used.reduce((c, [a, b]) => c + Math.max(0, Math.min(b, t) - Math.max(a, s)), 0) / (t - s);
  const walls: Wall[] = [];
  const add = (a: Pt, b: Pt, thickness: number) => walls.push({ id: `w${walls.length + 1}`, a, b, thickness: round(thickness, 3) });
  for (const { i, j, d, s, t } of pairs) {
    const ei = edges[i], ej = edges[j];
    const pj = [proj(ej, [ei.a[0] + ei.u[0] * s, ei.a[1] + ei.u[1] * s]), proj(ej, [ei.a[0] + ei.u[0] * t, ei.a[1] + ei.u[1] * t])].sort((x, y) => x - y) as [number, number];
    if (covered(ei, s, t) > 0.5 || covered(ej, pj[0], pj[1]) > 0.5) continue;
    const off = (k: number): Pt => [ei.a[0] + ei.u[0] * k + ei.n[0] * d / 2, ei.a[1] + ei.u[1] * k + ei.n[1] * d / 2];
    add(off(s), off(t), d >= minT ? d : interior);
    ei.used.push([s, t]); ej.used.push(pj);
  }
  const insideAny = (p: Pt) => rooms.some((r) => {
    let c = false;
    for (let a = 0, b = r.polygon.length - 1; a < r.polygon.length; b = a++) {
      const [xi, yi] = r.polygon[a], [xj, yj] = r.polygon[b];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  });
  for (const e of edges) {
    e.used.sort((x, y) => x[0] - y[0]);
    const free: [number, number][] = [];
    let cur = 0;
    for (const [a, b] of e.used) { if (a > cur) free.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < e.L) free.push([cur, e.L]);
    for (const [a, b] of free) {
      if (b - a < 0.2) continue;
      const mid = (a + b) / 2;
      const probe: Pt = [e.a[0] + e.u[0] * mid + e.n[0] * 1.0, e.a[1] + e.u[1] * mid + e.n[1] * 1.0];
      const T = insideAny(probe) ? interior : exterior;
      const at = (k: number): Pt => [e.a[0] + e.u[0] * k + e.n[0] * T / 2, e.a[1] + e.u[1] * k + e.n[1] * T / 2];
      add(at(a), at(b), T);
    }
  }
  return walls;
}

/** Walls from room edges drawn on wall centrelines (the sample plan): collinear overlapping edges are merged. */
export function wallsFromRooms(rooms: Room[], exterior = 0.3, interior = 0.12): Wall[] {
  const all = rooms.flatMap((r) => r.polygon);
  const bb = bounds(all);
  const groups = new Map<string, { dir: Pt; origin: Pt; spans: [number, number][] }>();
  for (const r of rooms) {
    r.polygon.forEach((a, i) => {
      const b = r.polygon[(i + 1) % r.polygon.length];
      const len = dist(a, b);
      if (len < 0.05) return;
      let dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      if (dir[0] < -1e-6 || (Math.abs(dir[0]) < 1e-6 && dir[1] < 0)) dir = [-dir[0], -dir[1]];
      const off = a[0] * -dir[1] + a[1] * dir[0]; // signed distance of the line from origin
      const key = `${Math.round(Math.atan2(dir[1], dir[0]) * 100)}:${Math.round(off * 20)}`;
      const g = groups.get(key) ?? { dir, origin: [-dir[1] * off, dir[0] * off] as Pt, spans: [] };
      const t = (p: Pt) => (p[0] - g.origin[0]) * g.dir[0] + (p[1] - g.origin[1]) * g.dir[1];
      const [s, e] = [t(a), t(b)].sort((m, n) => m - n);
      g.spans.push([s, e]);
      groups.set(key, g);
    });
  }
  const walls: Wall[] = [];
  const onEdge = (p: Pt) => Math.min(Math.abs(p[0] - bb.x0), Math.abs(p[0] - bb.x1), Math.abs(p[1] - bb.y0), Math.abs(p[1] - bb.y1)) < 0.05;
  for (const g of groups.values()) {
    g.spans.sort((m, n) => m[0] - n[0]);
    const merged: [number, number][] = [];
    for (const s of g.spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + 0.02) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    for (const [s, e] of merged) {
      const a: Pt = [g.origin[0] + g.dir[0] * s, g.origin[1] + g.dir[1] * s];
      const b: Pt = [g.origin[0] + g.dir[0] * e, g.origin[1] + g.dir[1] * e];
      walls.push({ id: `w${walls.length + 1}`, a, b, thickness: onEdge(a) && onEdge(b) ? exterior : interior });
    }
  }
  return walls;
}

/** Splits a wall into solid pieces around openings that lie on it. Heights in metres. */
export function wallPieces(w: Wall, openings: Opening[], H: number) {
  const len = dist(w.a, w.b);
  const dir: Pt = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const t = (p: Pt) => (p[0] - w.a[0]) * dir[0] + (p[1] - w.a[1]) * dir[1];
  const off = (p: Pt) => Math.abs((p[0] - w.a[0]) * -dir[1] + (p[1] - w.a[1]) * dir[0]);
  const holes = openings
    .filter((o) => off(o.a) < w.thickness + 0.15 && off(o.b) < w.thickness + 0.15)
    .map((o) => { const [s, e] = [t(o.a), t(o.b)].sort((m, n) => m - n); return { s: Math.max(0, s), e: Math.min(len, e), kind: o.kind }; })
    .filter((h) => h.e - h.s > 0.1)
    .sort((m, n) => m.s - n.s);
  const pieces: { s: number; e: number; z0: number; z1: number }[] = [];
  let cur = 0;
  for (const h of holes) {
    if (h.s > cur) pieces.push({ s: cur, e: h.s, z0: 0, z1: H });
    pieces.push({ s: h.s, e: h.e, z0: Math.min(2.1, H), z1: H }); // lintel
    if (h.kind === 'window') pieces.push({ s: h.s, e: h.e, z0: 0, z1: 0.9 }); // sill
    cur = Math.max(cur, h.e);
  }
  if (cur < len) pieces.push({ s: cur, e: len, z0: 0, z1: H });
  return { dir, pieces: pieces.filter((p) => p.z1 > p.z0 && p.e - p.s > 0.01) };
}

/** Rotates a fixture so its back faces the nearest wall, and assigns it to the room it stands in. */
export function placeFixture(kind: FixtureKind, center: Pt, w: number, h: number, walls: Wall[], rooms: Room[], id: string): Fixture {
  let best: { d: number; u: Pt; n: Pt } | null = null;
  for (const wl of walls) {
    const L = dist(wl.a, wl.b) || 1, u: Pt = [(wl.b[0] - wl.a[0]) / L, (wl.b[1] - wl.a[1]) / L];
    const t = Math.max(0, Math.min(L, (center[0] - wl.a[0]) * u[0] + (center[1] - wl.a[1]) * u[1]));
    const q: Pt = [wl.a[0] + u[0] * t, wl.a[1] + u[1] * t];
    const d = dist(center, q);
    if (!best || d < best.d) best = { d, u, n: d > 1e-6 ? [(center[0] - q[0]) / d, (center[1] - q[1]) / d] : [-u[1], u[0]] };
  }
  let angle = 0, size: Pt = [w, h];
  if (best) {
    angle = Math.atan2(-best.n[0], best.n[1]); // rotate local +y (front) onto the normal pointing away from the wall
    if (Math.abs(best.u[0]) < Math.abs(best.u[1])) size = [h, w]; // wall runs vertically: along-wall size is the box height
  }
  const inside = (p: Pt, poly: Pt[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return { id, kind, center, size, angle: round(angle, 4), room_id: rooms.find((r) => inside(center, r.polygon))?.id ?? null };
}

export const roomStats = (r: Room) => ({ id: r.id, name: r.name, type: r.type, area_m2: round(area(r.polygon)), perimeter_m: round(perimeter(r.polygon)) });
