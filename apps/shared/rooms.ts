// Room- and plan-level measures, door orientation and door-swing clashes. Pure geometry, no AI.
import { type Plan, type Pt, type Room, type Opening, type Fixture, area, dist, perimeter, round } from './plan';
import { wallFootprints } from './walls';

export const inside = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const polyArea = (q: Pt[]) => Math.abs(q.reduce((s, p, i) => s + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0)) / 2;

/** Length × width of the room's minimum bounding rectangle (rotating calipers over its edges). */
export function roomDims(poly: Pt[]): { length: number; width: number } {
  let best = { length: 0, width: Infinity };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], L = dist(a, b);
    if (L < 1e-6) return;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    for (const p of poly) {
      const s = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], t = (p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0];
      lo = Math.min(lo, s); hi = Math.max(hi, s); lo2 = Math.min(lo2, t); hi2 = Math.max(hi2, t);
    }
    const [x, y] = [hi - lo, hi2 - lo2].sort((m, n) => n - m);
    if (x * y < best.length * best.width || best.width === Infinity) best = { length: x, width: y };
  });
  return { length: round(best.length, 2), width: round(best.width, 2) };
}

/** Openings on a room's boundary. */
export function openingsOfRoom(r: Room, openings: Opening[]) {
  return openings.filter((o) => {
    const m: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    return r.polygon.some((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length];
      const L2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((m[0] - p[0]) * (q[0] - p[0]) + (m[1] - p[1]) * (q[1] - p[1])) / L2));
      return dist(m, [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]) < 0.4;
    });
  });
}

export const ceilingOf = (plan: Plan) => plan.levels?.ceiling ?? plan.wallHeight;
/** Window glass assumed from 0.9 m sill to 2.1 m head where the drawing gives no heights. */
export const WINDOW_SILL = 0.9, WINDOW_HEAD = 2.1;

export function roomInfo(plan: Plan, r: Room) {
  const ops = openingsOfRoom(r, plan.openings);
  const windows = ops.filter((o) => o.kind === 'window'), doors = ops.filter((o) => o.kind === 'door');
  const a = area(r.polygon), h = ceilingOf(plan);
  const glazed = windows.reduce((s, o) => s + dist(o.a, o.b) * (Math.min(WINDOW_HEAD, h) - WINDOW_SILL), 0);
  return {
    id: r.id, name: r.name, type: r.type,
    net_area_m2: round(a), perimeter_m: round(perimeter(r.polygon)), ...roomDims(r.polygon),
    ceiling_height_m: round(h), volume_m3: round(a * h, 1),
    doors: doors.length, windows: windows.length, glazed_area_m2: round(glazed), glazing_ratio: a ? round(glazed / a, 3) : 0,
    fixtures: (plan.fixtures ?? []).filter((f) => f.room_id === r.id).map((f) => ({ id: f.id, kind: f.kind, source: f.source ?? 'drawing' })),
  };
}

/** Net = sum of room areas (to the inside faces of walls); gross = net + area of the walls themselves (DIN 277 NRF/BGF style). */
export function planAreas(plan: Plan) {
  const net = plan.rooms.reduce((s, r) => s + area(r.polygon), 0);
  const walls = wallFootprints(plan.walls).reduce((s, f) => s + polyArea(f.poly), 0);
  const h = ceilingOf(plan);
  return {
    net_floor_area_m2: round(net), wall_area_m2: round(walls), gross_floor_area_m2: round(net + walls),
    net_to_gross: net + walls ? round(net / (net + walls), 3) : 0,
    ceiling_height_m: round(h), ceiling_source: plan.levels?.ceiling != null ? plan.levels.source : 'assumed',
    floor_level_m: plan.levels?.floor ?? null, net_volume_m3: round(net * h, 1),
    rooms: plan.rooms.length, doors: plan.openings.filter((o) => o.kind === 'door').length, windows: plan.openings.filter((o) => o.kind === 'window').length,
  };
}

// ---- doors: which way they swing ----
const PRIVACY: Record<string, number> = { bedroom: 5, bathroom: 4, wc: 4, office: 3, kitchen: 2, dining: 1, living: 1, utility: 2, garage: 0, plant: 0, stair: -1, lift: -1, circulation: -2, outdoor: -3, other: 0, storage: -5 };

/** Leaf sweep of a door as sample points (quarter disc on the swing side, hinge at a). */
export function doorSweep(o: Opening): Pt[] {
  const L = dist(o.a, o.b), u: Pt = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], s = o.swing ?? 1, n: Pt = [-u[1] * s, u[0] * s];
  const pts: Pt[] = [];
  for (let r = 0.15; r <= L; r += 0.12) for (let k = 0; k <= 6; k++) {
    const t = (k / 6) * (Math.PI / 2), c = Math.cos(t) * r, d = Math.sin(t) * r;
    pts.push([o.a[0] + u[0] * c + n[0] * d, o.a[1] + u[1] * c + n[1] * d]);
  }
  return pts;
}

export function fixtureContains(f: Fixture, p: Pt, pad = 0) {
  const dx = p[0] - f.center[0], dy = p[1] - f.center[1], c = Math.cos(-f.angle), s = Math.sin(-f.angle);
  const x = dx * c - dy * s, y = dx * s + dy * c;
  return Math.abs(x) <= f.size[0] / 2 + pad && Math.abs(y) <= f.size[1] / 2 + pad;
}

export const doorClashes = (o: Opening, fixtures: Fixture[]) => {
  const sweep = doorSweep(o);
  return fixtures.filter((f) => sweep.some((p) => fixtureContains(f, p)));
};

/**
 * Sets each door's swing: into rooms rather than corridors, out of cupboards, inward at the entrance, otherwise into
 * the more private room; hinge at the end nearer a corner so the open leaf rests against the wall, avoiding furniture.
 */
export function orientDoors(plan: Plan): Opening[] {
  const roomAt = (p: Pt) => plan.rooms.find((r) => inside(p, r.polygon)) ?? null;
  return plan.openings.map((o) => {
    if (o.kind !== 'door') return o;
    const L = dist(o.a, o.b) || 1, u: Pt = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], n: Pt = [-u[1], u[0]];
    const mid: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    let left: Room | null = null, right: Room | null = null;
    for (const k of [0.25, 0.45, 0.7]) {
      left = roomAt([mid[0] + n[0] * k, mid[1] + n[1] * k]); right = roomAt([mid[0] - n[0] * k, mid[1] - n[1] * k]);
      if (left && right) break;
    }
    const score = (r: Room | null) => (r ? PRIVACY[r.type] ?? 0 : -10); // outside scores lowest: entrance doors open inward
    const into = score(left) >= score(right) ? left : right;
    const side: 1 | -1 = into === left ? 1 : -1;
    // hinge candidates: either end; prefer no furniture clash, then the end nearer a corner of the room it opens into
    const cands = ([[o.a, o.b], [o.b, o.a]] as [Pt, Pt][]).map(([a, b]) => {
      // keep the leaf on the chosen side: swapping ends flips leftNormal, so flip swing too
      const flipped = a !== o.a;
      const d: Opening = { ...o, a, b, swing: (flipped ? -side : side) as 1 | -1 };
      const clash = doorClashes(d, (plan.fixtures ?? []).filter((f) => f.source !== 'suggested')).length;
      const corner = into ? Math.min(...into.polygon.map((v) => dist(v, a))) : 0;
      return { d, clash, corner };
    });
    cands.sort((x, y) => x.clash - y.clash || x.corner - y.corner);
    return cands[0].d;
  });
}
