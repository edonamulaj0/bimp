// Mitered wall footprints: every wall becomes a polygon whose ends meet its neighbours exactly (L-corners,
// T-junctions, crossings, mixed thicknesses), so 2D fills and 3D extrusions show one continuous wall mass.
// Technique after neonplan3d (MIT, © 2026 Mastershort): sort walls by angle at each node and intersect each wall's
// left face line with the next wall's right face line.
import { type Pt, type Wall, dist } from './plan';

export type Footprint = { wall: Wall; poly: Pt[] };

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const unit = (a: Pt, b: Pt): Pt => { const L = dist(a, b) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
const leftN = (d: Pt): Pt => [-d[1], d[0]];

/** Joins wall ends that nearly touch and splits walls where another wall ends against their side (T-junctions). */
export function cleanWalls(input: Wall[]): Wall[] {
  let walls = input.filter((w) => dist(w.a, w.b) > 0.02).map((w) => ({ ...w, a: [...w.a] as Pt, b: [...w.b] as Pt }));
  // 1. cluster end points (tolerance grows with wall thickness: face-derived walls may stop short of each other)
  const nodes: { p: Pt; t: number }[] = [];
  const snap = (p: Pt, t: number): Pt => {
    for (const n of nodes) if (dist(p, n.p) < Math.max(0.05, 0.6 * Math.max(t, n.t))) return n.p;
    nodes.push({ p, t }); return p;
  };
  walls.forEach((w) => { w.a = snap(w.a, w.thickness); w.b = snap(w.b, w.thickness); });
  // 2. T-junctions: an end lying against another wall's side moves onto that wall's centre line, which is split there
  for (let guard = 0, changed = true; changed && guard < 500; guard++) {
    changed = false;
    outer: for (const x of walls) for (const end of ['a', 'b'] as const) {
      const p = x[end], dx = unit(x.a, x.b);
      for (let k = 0; k < walls.length; k++) {
        const y = walls[k];
        if (y === x || y.a === p || y.b === p) continue;
        const L = dist(y.a, y.b), u = unit(y.a, y.b);
        if (Math.abs(cross(dx, u)) < 0.3) continue; // parallel: not a T
        const t = (p[0] - y.a[0]) * u[0] + (p[1] - y.a[1]) * u[1];
        if (t < 0.05 || t > L - 0.05) continue;
        const q: Pt = [y.a[0] + u[0] * t, y.a[1] + u[1] * t];
        if (dist(p, q) > y.thickness / 2 + 0.6 * x.thickness + 0.02) continue;
        x[end] = q;
        walls.splice(k, 1, { ...y, id: `${y.id}a`, b: q }, { ...y, id: `${y.id}b`, a: q });
        changed = true;
        break outer;
      }
    }
  }
  return walls.filter((w) => dist(w.a, w.b) > 0.02);
}

export function wallFootprints(input: Wall[]): Footprint[] {
  const walls = cleanWalls(input);
  const key = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  type End = { w: number; at: 'a' | 'b'; d: Pt; h: number; left: Pt; right: Pt };
  const ends = new Map<string, End[]>();
  const corner = walls.map(() => ({} as Record<'a' | 'b', End>));
  walls.forEach((w, i) => {
    for (const at of ['a', 'b'] as const) {
      const p = w[at], d = at === 'a' ? unit(w.a, w.b) : unit(w.b, w.a), h = w.thickness / 2;
      const e: End = { w: i, at, d, h, left: add(p, mul(leftN(d), h)), right: add(p, mul(leftN(d), -h)) };
      corner[i][at] = e;
      const k = key(p);
      ends.set(k, [...(ends.get(k) ?? []), e]);
    }
  });
  for (const [k, list] of ends) {
    if (list.length < 2) continue; // free end: square
    const p = walls[list[0].w][list[0].at];
    list.sort((x, y) => Math.atan2(x.d[1], x.d[0]) - Math.atan2(y.d[1], y.d[0]));
    const limit = 4 * Math.max(...list.map((e) => e.h));
    for (let i = 0; i < list.length; i++) {
      const o = list[i], n = list[(i + 1) % list.length];
      const c = cross(o.d, n.d);
      if (Math.abs(c) < 1e-4) continue; // straight continuation: square ends already meet
      const po = add(p, mul(leftN(o.d), o.h)), pn = add(p, mul(leftN(n.d), -n.h));
      const t = cross(sub(pn, po), n.d) / c;
      const x = add(po, mul(o.d, t));
      if (dist(x, p) > limit) continue; // too sharp: keep square ends
      o.left = x; n.right = x;
    }
    void k;
  }
  return walls.map((w, i) => {
    const A = corner[i].a, B = corner[i].b;
    // A.right and B.left run along one face, B.right and A.left along the other; centre points close the joints.
    return { wall: w, poly: [A.right, B.left, w.b, B.right, A.left, w.a] };
  });
}

/** Point inside a polygon farthest from its edges (grid search): where a label sits best, even in L- and U-shaped rooms. */
export function labelPoint(poly: Pt[]): Pt {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const inside = (p: Pt) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const edgeDist = (p: Pt) => Math.min(...poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], u = sub(b, a), L2 = u[0] ** 2 + u[1] ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]) / L2));
    return dist(p, add(a, mul(u, t)));
  }));
  let best: Pt = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = -1;
  const N = 24;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p: Pt = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N];
    if (!inside(p)) continue;
    // prefer points near the centre when several are equally far from the walls
    const d = edgeDist(p) - 0.02 * dist(p, [(x0 + x1) / 2, (y0 + y1) / 2]);
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Sutherland–Hodgman clip of a polygon to the half-plane where (p - o)·u >= c (keep = 1) or <= c (keep = -1). */
export function clipHalf(poly: Pt[], o: Pt, u: Pt, c: number, keep: 1 | -1): Pt[] {
  const f = (p: Pt) => keep * ((p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1] - c);
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
