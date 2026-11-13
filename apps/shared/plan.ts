// Plan model shared by API and web. All geometry is in metres, origin top-left, y down.
export type Pt = [number, number];
export const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'circulation', 'storage', 'office', 'outdoor', 'other'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface Room { id: string; name: string; type: RoomType; polygon: Pt[] }
export interface Wall { id: string; a: Pt; b: Pt; thickness: number }
export interface Opening { id: string; kind: 'door' | 'window'; a: Pt; b: Pt }

export interface Plan {
  version: 1;
  method: 'sample' | 'gemini';
  measured: boolean; // false = AI/sample preview; dimensions approximate
  width: number;
  height: number;
  wallHeight: number;
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  scale: { metersPerPx: number | null; source: string };
  source: { fileId: string; mime: string; imageWidth: number; imageHeight: number; offset: Pt } | null;
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

/** Walls from room edges: collinear overlapping edges are merged so no wall is drawn twice. */
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

export const roomStats = (r: Room) => ({ id: r.id, name: r.name, type: r.type, area_m2: round(area(r.polygon)), perimeter_m: round(perimeter(r.polygon)) });
