// Plan model shared by API and web. All geometry is in metres, origin top-left, y down.
export type Pt = [number, number];
export const ROOM_TYPES = ['living', 'dining', 'bedroom', 'kitchen', 'bathroom', 'wc', 'utility', 'circulation', 'stair', 'lift', 'storage', 'office', 'garage', 'plant', 'outdoor', 'other'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** Where on the source drawing an item was read: the page of the file and its box in render pixels [x0, y0, x1, y1]. */
export type Src = { page: number; box: [number, number, number, number] };
/**
 * A curved wall of a room: the `n` corners of its polygon from corner `from` on lie on a circle (centre, radius in
 * metres). The polygon itself stays a plain run of short edges along the curve, close enough that areas, lengths and
 * everything drawn from it are right; this says which of its edges are one curved wall, and of what radius.
 */
export interface Arc { from: number; n: number; center: Pt; radius: number }
export interface Room { id: string; name: string; type: RoomType; polygon: Pt[]; src?: Src; arcs?: Arc[] }
/** curve: this wall is one piece of a curved wall; all pieces of that wall carry the same curve id. */
export interface Wall { id: string; a: Pt; b: Pt; thickness: number; curve?: { id: string; center: Pt; radius: number } }
/** a = hinge for doors; the leaf swings toward swing × leftNormal(a→b) (swing defaults to 1). */
export interface Opening { id: string; kind: 'door' | 'window'; a: Pt; b: Pt; swing?: 1 | -1; src?: Src; /** thickness of the drawn wall it sits in, when that was measured on the drawing */ t?: number }

/** Fittings and furniture drawn on the plan. Read from the drawing, never invented. */
export const FIXTURE_KINDS = ['wc', 'sink', 'bathtub', 'shower', 'sauna_stove', 'stove', 'fridge', 'washer', 'bed', 'sofa', 'table', 'desk', 'wardrobe',
  // sanitary and services
  'bidet', 'urinal', 'dryer', 'dishwasher', 'oven', 'water_heater', 'radiator', 'fireplace',
  // kitchen and loose furniture
  'counter', 'chair', 'armchair', 'tv', 'bookshelf', 'bedside', 'plant', 'column',
  // drawn on the plan but not recognised: shown with a "?" until someone says what it is
  'unknown'] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
/** center/size in metres; size[0] runs along the wall it backs onto, size[1] away from it; angle in radians (local +y = front). */
export interface Fixture { id: string; kind: FixtureKind; center: Pt; size: Pt; angle: number; room_id: string | null; src?: Src;
  /** A name given by a person, for something that is not one of the known kinds ("piano", "safe"). */
  label?: string;
  /** 'suggested' = placed by bimp (feng shui layout), not read from the drawing. */
  source?: 'drawing' | 'suggested' }
export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  wc: 'toilet', sink: 'sink / wash basin', bathtub: 'bathtub', shower: 'shower', sauna_stove: 'sauna stove', stove: 'cooker / hob',
  fridge: 'fridge', washer: 'washing machine', bed: 'bed', sofa: 'sofa', table: 'table', desk: 'desk', wardrobe: 'wardrobe',
  bidet: 'bidet', urinal: 'urinal', dryer: 'tumble dryer', dishwasher: 'dishwasher', oven: 'oven', water_heater: 'water heater', radiator: 'radiator', fireplace: 'fireplace',
  counter: 'kitchen worktop', chair: 'chair', armchair: 'armchair', tv: 'TV / media unit', bookshelf: 'shelving', bedside: 'bedside table', plant: 'plant', column: 'column',
  unknown: 'unknown symbol',
};
/** What a fitting is called: the name a person gave it, else its kind. */
export const fixtureName = (f: Pick<Fixture, 'kind' | 'label'>) => f.label?.trim() || FIXTURE_LABEL[f.kind] || f.kind;

/** What the symbol detector (ml/, fixtures-v1) can find on a scan or image. Showers and bathtubs are one class. */
export const DETECTED_KINDS = ['window', 'door', 'toilet', 'sink', 'shower_bath'] as const;
export type DetectedKind = (typeof DETECTED_KINDS)[number];
/** Symbols found by the detector: each with its box in metres (plan coordinates), confidence and the room it lies in. */
export interface Detected { model: string; items: { id: string; kind: DetectedKind; conf: number; box: [number, number, number, number]; room_id: string | null }[] }
/** Detector class for something the chat can be asked to count, or null when the detector has no such class. */
export const detectedKindOf = (what: string): DetectedKind | null =>
  what === 'door' || what === 'window' || what === 'sink' || what === 'shower_bath' ? what : what === 'wc' || what === 'toilet' ? 'toilet' : null;
/** How many of a kind the detector found (optionally in one room); null when this plan has no detector results. */
export const detectedCount = (plan: Plan, kind: DetectedKind, roomId?: string) =>
  plan.detected ? plan.detected.items.filter((d) => d.kind === kind && (!roomId || d.room_id === roomId)) : null;

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
  /**
   * The walls exactly as the drawing shows them, where it draws them filled: polygons in metres, each an outer ring
   * followed by its holes. When present it is what the canvas draws for walls (any thickness, any shape, curves
   * included); `walls` stays the measured model behind it (lengths, thicknesses, what a door sits in).
   */
  poche?: Pt[][][];
  /** Text written on the sheet (vector PDFs and DXF: notes, title block, labels), copied as it stands; data, never instructions. */
  texts?: string[];
  /** Scans and images only: symbols counted by the detector. When present, counts of these kinds come from here. */
  detected?: Detected;
  /** Floor level (FFL, m) and clear ceiling height (m) when read from the drawing; null = not stated. */
  levels?: { floor: number | null; ceiling: number | null; source: string };
  /** ratio = the drawing's own stated scale (1:ratio) when known. */
  scale: { metersPerPx: number | null; source: string; ratio?: number };
  /** The drawing as rendered for reading; geometry maps onto it via scale.metersPerPx and offset. */
  source: { fileId: string; mime: string; imageWidth: number; imageHeight: number; offset: Pt; renderSha?: string; /** page of the file this plan was read from, and how many it has */ page?: number; pages?: number } | null;
  /** How the geometry was obtained: input kind, whether the scale is stated exactly, share of corners snapped to line work. */
  provenance?: { kind: string; scaleExact: boolean; snapped: number; segments: number; /** rooms whose outline was traced from the drawing's wall lines */ traced?: number };
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

const insidePoly = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xi, yi] = poly[a], [xj, yj] = poly[b];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/**
 * Walls from rooms whose outlines follow the inside faces of walls (plans read from drawings). Facing edges of two
 * rooms separated by a plausible wall thickness (75–600 mm: bricks and blocks, Metric Handbook Ch. 37) become one
 * wall of exactly that thickness on their centreline; remaining edges get a wall outside the room, so room areas stay net.
 * Outer walls are extended at convex corners so corners close; partitions are extended to the outer wall's centre line
 * so they meet it as a T. `paired` says whether any facing pair was found (if not, the outlines are centre lines).
 */
export function wallsFromFaces(rooms: Room[], exterior = 0.3, interior = 0.12, minT = 0.075, maxT = 0.6): { walls: Wall[]; paired: boolean } {
  type E = { a: Pt; u: Pt; n: Pt; L: number; room: string; used: [number, number][]; prev: number; next: number; free: { a: number; b: number; T: number }[]; curve?: Wall['curve'] };
  const edges: E[] = [];
  for (const r of rooms) {
    let sgn = 0;
    r.polygon.forEach((p, i) => { const q = r.polygon[(i + 1) % r.polygon.length]; sgn += p[0] * q[1] - q[0] * p[1]; });
    const first = edges.length;
    r.polygon.forEach((a, i) => {
      const b = r.polygon[(i + 1) % r.polygon.length], L = dist(a, b);
      // an edge between two corners of one arc is a piece of that curved wall: short, and still a wall
      const k = (r.arcs ?? []).findIndex((c) => i >= c.from && i + 1 < c.from + c.n);
      const curve = k >= 0 ? { id: `${r.id}c${k + 1}`, center: r.arcs![k].center, radius: r.arcs![k].radius } : undefined;
      if (L < (curve ? 0.03 : 0.1)) return;
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      edges.push({ a, u, L, room: r.id, n: sgn > 0 ? [u[1], -u[0]] : [-u[1], u[0]], used: [], prev: -1, next: -1, free: [], curve });
    });
    const k = edges.length - first;
    for (let i = 0; i < k; i++) { edges[first + i].prev = first + ((i - 1 + k) % k); edges[first + i].next = first + ((i + 1) % k); }
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
  const chosen: { i: number; d: number; s: number; t: number }[] = [];
  for (const { i, j, d, s, t } of pairs) {
    const ei = edges[i], ej = edges[j];
    const pj = [proj(ej, [ei.a[0] + ei.u[0] * s, ei.a[1] + ei.u[1] * s]), proj(ej, [ei.a[0] + ei.u[0] * t, ei.a[1] + ei.u[1] * t])].sort((x, y) => x - y) as [number, number];
    if (covered(ei, s, t) > 0.5 || covered(ej, pj[0], pj[1]) > 0.5) continue;
    chosen.push({ i, d, s, t });
    ei.used.push([s, t]); ej.used.push(pj);
  }
  const insideAny = (p: Pt) => rooms.some((r) => insidePoly(p, r.polygon));
  // free (unpaired) stretches of each edge, with the thickness their wall gets
  for (const e of edges) {
    e.used.sort((x, y) => x[0] - y[0]);
    let cur = 0;
    const spans: [number, number][] = [];
    for (const [a, b] of e.used) { if (a > cur) spans.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < e.L) spans.push([cur, e.L]);
    for (const [a, b] of spans) {
      if (b - a < (e.curve ? 0.03 : 0.2)) continue;
      const mid = (a + b) / 2;
      const probe: Pt = [e.a[0] + e.u[0] * mid + e.n[0] * 1.0, e.a[1] + e.u[1] * mid + e.n[1] * 1.0];
      e.free.push({ a, b, T: insideAny(probe) ? interior : exterior });
    }
  }
  const freeEnd = (e: E) => e.free.find((f) => f.b >= e.L - 1e-6);
  const freeStart = (e: E) => e.free.find((f) => f.a <= 1e-6);
  const convex = (p: E, q: E) => q.u[0] * -p.n[0] + q.u[1] * -p.n[1] > 0.1; // q turns into the room after p
  // Along a curved wall the pieces meet at a slight angle: each runs on (or stops short) by just what makes their
  // centre lines meet, so the pieces join into one wall. undefined where neither edge is curved or the turn is sharp.
  const bend = (p: E, q: E, T: number): number | undefined => {
    if (!p.curve && !q.curve) return undefined;
    const cos = p.u[0] * q.u[0] + p.u[1] * q.u[1], sin = q.u[0] * -p.n[0] + q.u[1] * -p.n[1];
    return cos > 0.5 ? (T / 2) * Math.tan(Math.atan2(sin, cos) / 2) : undefined;
  };
  const walls: Wall[] = [];
  const add = (a: Pt, b: Pt, thickness: number, curve?: Wall['curve']) => walls.push({ id: `w${walls.length + 1}`, a, b, thickness: round(thickness, 3), ...(curve ? { curve } : {}) });
  for (const { i, d, s, t } of chosen) {
    const e = edges[i], T = d >= minT ? d : interior;
    // a partition that ends at a room corner against an outer wall reaches that wall's centre line
    const pe = edges[e.prev], ne = edges[e.next];
    const ext0 = s <= 1e-6 && Math.abs(pe.u[0] * e.u[0] + pe.u[1] * e.u[1]) < 0.5 ? (freeEnd(pe)?.T ?? 0) / 2 : 0;
    const ext1 = t >= e.L - 1e-6 && Math.abs(ne.u[0] * e.u[0] + ne.u[1] * e.u[1]) < 0.5 ? (freeStart(ne)?.T ?? 0) / 2 : 0;
    const off = (k: number): Pt => [e.a[0] + e.u[0] * k + e.n[0] * d / 2, e.a[1] + e.u[1] * k + e.n[1] * d / 2];
    add(off(s - ext0), off(t + ext1), T);
  }
  for (const e of edges) for (const f of e.free) {
    const pe = edges[e.prev], ne = edges[e.next];
    // outer walls continue past convex room corners by half their thickness, so neighbouring walls meet and miter
    const x0 = f.a <= 1e-6 && freeEnd(pe) ? bend(pe, e, f.T) ?? (convex(pe, e) ? f.T / 2 : 0) : 0;
    const x1 = f.b >= e.L - 1e-6 && freeStart(ne) ? bend(e, ne, f.T) ?? (convex(e, ne) ? f.T / 2 : 0) : 0;
    const at = (k: number): Pt => [e.a[0] + e.u[0] * k + e.n[0] * f.T / 2, e.a[1] + e.u[1] * k + e.n[1] * f.T / 2];
    add(at(f.a - x0), at(f.b + x1), f.T, e.curve);
  }
  return { walls, paired: chosen.some((c) => c.d >= minT) };
}

/**
 * Walls from room edges drawn on wall centrelines (the sample plan): collinear overlapping edges are merged, lines
 * within 2 cm of each other count as one, and each stretch is exterior only where a room lies on one side of it alone.
 */
export function wallsFromRooms(rooms: Room[], exterior = 0.3, interior = 0.12): Wall[] {
  type Seg = { key: number; dir: Pt; off: number; s: number; e: number };
  const segs: Seg[] = [];
  for (const r of rooms) {
    r.polygon.forEach((a, i) => {
      const b = r.polygon[(i + 1) % r.polygon.length], len = dist(a, b);
      if (len < 0.05) return;
      let dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      if (dir[0] < -1e-6 || (Math.abs(dir[0]) < 1e-6 && dir[1] < 0)) dir = [-dir[0], -dir[1]];
      const off = a[0] * -dir[1] + a[1] * dir[0]; // signed distance of the line from the origin
      const t = (p: Pt) => p[0] * dir[0] + p[1] * dir[1];
      const [s, e] = [t(a), t(b)].sort((m, n) => m - n);
      segs.push({ key: Math.round(Math.atan2(dir[1], dir[0]) * 100), dir, off, s, e });
    });
  }
  // cluster by direction, then by offset with a tolerance (not by rounding, which splits lines 1 mm apart)
  segs.sort((x, y) => x.key - y.key || x.off - y.off);
  const groups: Seg[][] = [];
  for (const g of segs) {
    const last = groups[groups.length - 1];
    if (last && last[0].key === g.key && Math.abs(g.off - last[last.length - 1].off) < 0.02) last.push(g); else groups.push([g]);
  }
  const insideAny = (p: Pt) => rooms.some((r) => insidePoly(p, r.polygon));
  const walls: Wall[] = [];
  for (const grp of groups) {
    const dir = grp[0].dir, off = grp.reduce((s, g) => s + g.off, 0) / grp.length, origin: Pt = [-dir[1] * off, dir[0] * off];
    const spans = grp.map((g) => [g.s, g.e] as [number, number]).sort((m, n) => m[0] - n[0]);
    const merged: [number, number][] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + 0.02) last[1] = Math.max(last[1], sp[1]); else merged.push([...sp]);
    }
    const at = (k: number): Pt => [origin[0] + dir[0] * k, origin[1] + dir[1] * k];
    const n: Pt = [-dir[1], dir[0]];
    // exterior where only one side of the wall is inside a room; split the span where that changes
    const cls = (k: number) => { const p = at(k), l = insideAny([p[0] + n[0] * 0.15, p[1] + n[1] * 0.15]), r = insideAny([p[0] - n[0] * 0.15, p[1] - n[1] * 0.15]); return l && r ? interior : exterior; };
    for (const [s, e] of merged) {
      const step = 0.1, cuts: [number, number, number][] = [];
      for (let k = s; k < e - 1e-9; k += step) {
        const k1 = Math.min(e, k + step), T = cls((k + k1) / 2), last = cuts[cuts.length - 1];
        if (last && last[2] === T) last[1] = k1; else cuts.push([k, k1, T]);
      }
      for (const [a, b, T] of cuts) walls.push({ id: `w${walls.length + 1}`, a: at(a), b: at(b), thickness: T });
    }
  }
  // the pieces of a curved wall stay marked as one wall
  for (const r of rooms) (r.arcs ?? []).forEach((c, k) => {
    for (let i = c.from; i + 1 < c.from + c.n; i++) {
      const a = r.polygon[i], b = r.polygon[i + 1], mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const w = walls.find((x) => !x.curve && dist([(x.a[0] + x.b[0]) / 2, (x.a[1] + x.b[1]) / 2], mid) < 0.005 && Math.abs(dist(x.a, x.b) - dist(a, b)) < 0.01);
      if (w) w.curve = { id: `${r.id}c${k + 1}`, center: c.center, radius: c.radius };
    }
  });
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
    if (h.kind === 'window') pieces.push({ s: h.s, e: h.e, z0: 0, z1: Math.min(0.9, H) }); // sill, never above a lowered wall
    cur = Math.max(cur, h.e);
  }
  if (cur < len) pieces.push({ s: cur, e: len, z0: 0, z1: H });
  return { dir, pieces: pieces.filter((p) => p.z1 > p.z0 && p.e - p.s > 0.01) };
}

/** Which side of its own outline a fitting backs onto a wall with, when the outline is clearly longer one way. */
const BACK_ON_SHORT_SIDE = new Set<FixtureKind>(['bed', 'wc', 'bidet', 'urinal']);
const BACK_ON_LONG_SIDE = new Set<FixtureKind>(['sofa', 'counter', 'wardrobe', 'bookshelf', 'tv', 'desk', 'radiator', 'bathtub', 'fireplace', 'sink', 'stove']);

/**
 * A fitting from the box drawn for it: turned so its back is on the wall it stands against, and assigned to its room.
 * `w` and `h` are the box's sides along the frame's x and y; `frame` (radians) is the direction of the box's x side on
 * the plan, 0 for a box square to the sheet. The fitting keeps the box exactly: only which of its four sides is the
 * back is decided here, so it is never drawn at an angle the drawing does not show.
 * The back is the side with a wall right behind it; where two walls are as near (a bed in a corner), the kind decides
 * (a bed's head and a toilet's cistern are on a short side, a sofa's back and a worktop on a long one).
 */
export function placeFixture(kind: FixtureKind, center: Pt, w: number, h: number, walls: Wall[], rooms: Room[], id: string, frame = 0): Fixture {
  const ax: Pt = [Math.cos(frame), Math.sin(frame)], ay: Pt = [-ax[1], ax[0]];
  // the four sides: outward normal, the side's length, and the fitting's depth behind it
  const sides: { n: Pt; len: number; depth: number }[] = [
    { n: [-ay[0], -ay[1]], len: w, depth: h }, { n: ay, len: w, depth: h },
    { n: [-ax[0], -ax[1]], len: h, depth: w }, { n: ax, len: h, depth: w },
  ];
  const long = Math.max(w, h), short = Math.min(w, h), oblong = long >= 1.25 * short;
  let best: { score: number; s: (typeof sides)[number] } | null = null;
  for (const s of sides) {
    // the nearest wall face behind this side: a wall that runs along the side and that the fitting stands in front of
    let gap = Infinity;
    for (const wl of walls) {
      const L = dist(wl.a, wl.b);
      if (L < 1e-6) continue;
      const u: Pt = [(wl.b[0] - wl.a[0]) / L, (wl.b[1] - wl.a[1]) / L];
      if (Math.abs(u[0] * s.n[0] + u[1] * s.n[1]) > 0.5) continue; // the wall runs across this side, not along it
      const t = (center[0] - wl.a[0]) * u[0] + (center[1] - wl.a[1]) * u[1];
      if (t < -s.len / 2 || t > L + s.len / 2) continue; // the wall ends before it reaches the fitting
      const q: Pt = [wl.a[0] + u[0] * t, wl.a[1] + u[1] * t];
      const out = (q[0] - center[0]) * s.n[0] + (q[1] - center[1]) * s.n[1]; // how far the wall's centre lies behind this side's normal
      if (out <= 0) continue;
      gap = Math.min(gap, Math.abs(out - s.depth / 2 - wl.thickness / 2));
    }
    const isShort = s.len < s.depth;
    const wrongSide = oblong && ((BACK_ON_SHORT_SIDE.has(kind) && !isShort) || (BACK_ON_LONG_SIDE.has(kind) && isShort));
    const score = Math.min(gap, 5) + (wrongSide ? 0.3 : 0);
    if (!best || score < best.score - 1e-9) best = { score, s };
  }
  const back = best!.s, front: Pt = [-back.n[0], -back.n[1]];
  const angle = Math.atan2(-front[0], front[1]); // local +y (front) points away from the wall
  const inside = (p: Pt, poly: Pt[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return { id, kind, center, size: [back.len, back.depth], angle: round(angle, 4), room_id: rooms.find((r) => inside(center, r.polygon))?.id ?? null };
}

export const roomStats = (r: Room) => ({ id: r.id, name: r.name, type: r.type, area_m2: round(area(r.polygon)), perimeter_m: round(perimeter(r.polygon)) });

/** A box on the source drawing (render pixels) around points given in plan metres; null when the plan has no drawing. */
export function sourceBox(plan: Plan, pts: Pt[], pad = 0): [number, number, number, number] | null {
  const s = plan.source, mpp = plan.scale.metersPerPx;
  if (!s || !mpp || !pts.length) return null;
  const b = bounds(pts), k = (v: number, o: number, max: number) => Math.round(Math.min(max, Math.max(0, (v - o) / mpp)));
  return [k(b.x0 - pad, s.offset[0], s.imageWidth), k(b.y0 - pad, s.offset[1], s.imageHeight), k(b.x1 + pad, s.offset[0], s.imageWidth), k(b.y1 + pad, s.offset[1], s.imageHeight)];
}

/** What a citation shows of the source sheet: the crop (`box`), the cited items inside it (`marks`), on which page of which render. */
export type Evidence = { render: string; size: [number, number]; page: number; pages?: number; box: [number, number, number, number]; marks: [number, number, number, number][] };

/** The evidence for a claim: the boxes of the rooms and items it cites, and one crop that holds them all. */
export function evidenceFor(plan: Plan, roomIds: string[], itemIds: string[] = []): Evidence | null {
  const s = plan.source;
  if (!s?.renderSha) return null;
  const marks: [number, number, number, number][] = [];
  const add = (b: [number, number, number, number] | null | undefined) => { if (b && b[2] > b[0] && b[3] > b[1]) marks.push(b); };
  for (const id of itemIds) {
    const o = plan.openings.find((x) => x.id === id), f = plan.fixtures?.find((x) => x.id === id), d = plan.detected?.items.find((x) => x.id === id);
    const w = id.startsWith('wall-') ? plan.walls.find((x) => `wall-${x.id}` === id) : undefined;
    if (w) add(sourceBox(plan, [w.a, w.b], w.thickness / 2 + 0.25));
    else if (o) add(o.src?.box ?? sourceBox(plan, [o.a, o.b], 0.5));
    else if (f) add(f.src?.box ?? sourceBox(plan, [f.center], Math.max(...f.size) / 2 + 0.1));
    else if (d) add(sourceBox(plan, [[d.box[0], d.box[1]], [d.box[2], d.box[3]]], 0.1));
  }
  if (!marks.length) for (const id of roomIds) { const r = plan.rooms.find((x) => x.id === id); if (r) add(r.src?.box ?? sourceBox(plan, r.polygon, 0.15)); }
  if (!marks.length) return null;
  // the crop: everything cited, with a margin, never less than a tenth of the sheet so the surroundings are recognisable
  const x0 = Math.min(...marks.map((b) => b[0])), y0 = Math.min(...marks.map((b) => b[1])), x1 = Math.max(...marks.map((b) => b[2])), y1 = Math.max(...marks.map((b) => b[3]));
  const W = s.imageWidth, H = s.imageHeight, w = Math.max(x1 - x0, W * 0.1) * 1.25, h = Math.max(y1 - y0, H * 0.1) * 1.25, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bx = Math.max(0, Math.min(W - w, cx - w / 2)), by = Math.max(0, Math.min(H - h, cy - h / 2));
  return { render: s.renderSha, size: [W, H], page: s.page ?? 1, ...(s.pages ? { pages: s.pages } : {}),
    box: [Math.round(bx), Math.round(by), Math.round(Math.min(W, bx + w)), Math.round(Math.min(H, by + h))], marks: marks.slice(0, 60) };
}
