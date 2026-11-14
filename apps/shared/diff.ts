// Comparing two revisions of a plan (a = older, b = newer), both in metres in the same frame.
// Rooms are matched by name and type first, then by overlap; walls by their centre lines (within 10 cm).
import { type Plan, type Room, type Wall, area, bounds, dist, round } from './plan';
import { planAreas } from './rooms';

export type RoomDiff = { status: 'added' | 'removed' | 'changed' | 'same'; a: Room | null; b: Room | null; name: string; area_a: number | null; area_b: number | null; delta: number };
export type PlanDiff = { rooms: RoomDiff[]; walls: { added: Wall[]; removed: Wall[] }; doors: [number, number]; windows: [number, number]; net: [number, number]; gross: [number, number]; summary: string[] };

const box = (r: Room) => bounds(r.polygon);
/** Overlap of two rooms' bounding boxes over their union (0..1): enough to pair a room with its revised self. */
function overlap(a: Room, b: Room) {
  const p = box(a), q = box(b);
  const w = Math.max(0, Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0)), h = Math.max(0, Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0));
  const i = w * h, u = (p.x1 - p.x0) * (p.y1 - p.y0) + (q.x1 - q.x0) * (q.y1 - q.y0) - i;
  return u > 0 ? i / u : 0;
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sameWall = (u: Wall, v: Wall, tol = 0.1) =>
  (dist(u.a, v.a) < tol && dist(u.b, v.b) < tol) || (dist(u.a, v.b) < tol && dist(u.b, v.a) < tol);
/** Is wall u covered by some wall of `ws` (same line, overlapping)? Handles walls split differently in two revisions. */
function covered(u: Wall, ws: Wall[], tol = 0.1) {
  if (ws.some((v) => sameWall(u, v, tol))) return true;
  const L = dist(u.a, u.b) || 1, d = [(u.b[0] - u.a[0]) / L, (u.b[1] - u.a[1]) / L];
  const along = (p: [number, number]) => (p[0] - u.a[0]) * d[0] + (p[1] - u.a[1]) * d[1];
  const off = (p: [number, number]) => Math.abs((p[0] - u.a[0]) * -d[1] + (p[1] - u.a[1]) * d[0]);
  let got = 0;
  for (const v of ws) {
    if (off(v.a) > tol || off(v.b) > tol) continue;
    const [s, e] = [along(v.a), along(v.b)].sort((m, n) => m - n);
    got += Math.max(0, Math.min(L, e) - Math.max(0, s));
  }
  return got >= L - tol;
}

export function diffPlans(a: Plan, b: Plan): PlanDiff {
  const rooms: RoomDiff[] = [], usedA = new Set<string>();
  const pair = (rb: Room) => {
    const free = a.rooms.filter((r) => !usedA.has(r.id));
    const named = free.filter((r) => norm(r.name) === norm(rb.name) && r.type === rb.type);
    const pool = named.length ? named : free.filter((r) => r.type === rb.type || overlap(r, rb) > 0.5);
    let best: Room | null = null, bo = named.length ? -1 : 0.3;
    for (const r of pool) { const o = overlap(r, rb); if (o > bo) { bo = o; best = r; } }
    return best;
  };
  for (const rb of b.rooms) {
    const ra = pair(rb);
    const ab = round(area(rb.polygon), 2);
    if (!ra) { rooms.push({ status: 'added', a: null, b: rb, name: rb.name, area_a: null, area_b: ab, delta: ab }); continue; }
    usedA.add(ra.id);
    const aa = round(area(ra.polygon), 2), delta = round(ab - aa, 2);
    rooms.push({ status: Math.abs(delta) >= 0.05 || overlap(ra, rb) < 0.95 ? 'changed' : 'same', a: ra, b: rb, name: rb.name, area_a: aa, area_b: ab, delta });
  }
  for (const ra of a.rooms) if (!usedA.has(ra.id)) { const aa = round(area(ra.polygon), 2); rooms.push({ status: 'removed', a: ra, b: null, name: ra.name, area_a: aa, area_b: null, delta: -aa }); }

  const walls = { added: b.walls.filter((w) => !covered(w, a.walls)), removed: a.walls.filter((w) => !covered(w, b.walls)) };
  const count = (p: Plan, k: 'door' | 'window') => p.openings.filter((o) => o.kind === k).length;
  const A = planAreas(a), B = planAreas(b);
  const diff: PlanDiff = {
    rooms, walls,
    doors: [count(a, 'door'), count(b, 'door')], windows: [count(a, 'window'), count(b, 'window')],
    net: [A.net_floor_area_m2, B.net_floor_area_m2], gross: [A.gross_floor_area_m2, B.gross_floor_area_m2], summary: [],
  };
  const sgn = (n: number, u = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(round(n, 2))}${u}`;
  const by = (s: RoomDiff['status']) => rooms.filter((r) => r.status === s);
  const s = diff.summary;
  if (by('added').length) s.push(`Added: ${by('added').map((r) => `${r.name} (${r.area_b} m²)`).join(', ')}`);
  if (by('removed').length) s.push(`Removed: ${by('removed').map((r) => `${r.name} (${r.area_a} m²)`).join(', ')}`);
  for (const r of by('changed')) s.push(`${r.name}: ${r.area_a} → ${r.area_b} m² (${sgn(r.delta, ' m²')})${r.a && r.a.name !== r.name ? `, was ${r.a.name}` : ''}`);
  if (walls.added.length || walls.removed.length) s.push(`Walls: ${walls.added.length} added, ${walls.removed.length} removed`);
  if (diff.doors[0] !== diff.doors[1]) s.push(`Doors: ${diff.doors[0]} → ${diff.doors[1]}`);
  if (diff.windows[0] !== diff.windows[1]) s.push(`Windows: ${diff.windows[0]} → ${diff.windows[1]}`);
  s.push(`Net floor area: ${diff.net[0]} → ${diff.net[1]} m² (${sgn(round(diff.net[1] - diff.net[0], 2), ' m²')})`);
  if (s.length === 1 && !by('changed').length) s.unshift('No changes to rooms, walls or openings');
  return diff;
}
