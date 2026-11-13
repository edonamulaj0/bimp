// Escape-route analysis on plan geometry (Metric Handbook Ch. 41, Fire).
// Doors link rooms; doors with open air on one side are exits. Travel distance = straight lines from the furthest
// point of a room through door centres to an exit (furniture ignored: an estimate, as the book allows for early plans).
import { type Plan, type Pt, type Room, dist, round } from './plan';

export type Route = { room_id: string; from: Pt; path: Pt[]; distance_m: number; via: string[] };
export type Escape = { exits: string[]; routes: Route[]; unreachable: string[] };

const inside = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const roomAt = (rooms: Room[], p: Pt) => rooms.find((r) => inside(p, r.polygon)) ?? null;

/** Which rooms each door joins: probe both sides of the door, beyond the wall. */
export function doorLinks(plan: Plan) {
  return plan.openings.filter((o) => o.kind === 'door').map((o) => {
    const L = dist(o.a, o.b) || 1;
    const n: Pt = [-(o.b[1] - o.a[1]) / L, (o.b[0] - o.a[0]) / L];
    const mid: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    let sides: (Room | null)[] = [null, null];
    for (const k of [0.25, 0.45, 0.7]) { // wall thickness unknown: probe progressively further
      sides = [roomAt(plan.rooms, [mid[0] + n[0] * k, mid[1] + n[1] * k]), roomAt(plan.rooms, [mid[0] - n[0] * k, mid[1] - n[1] * k])];
      if (sides[0] && sides[1]) break;
    }
    const rooms = [...new Set(sides.filter(Boolean).map((r) => r!.id))];
    return { id: o.id, mid, rooms, exit: rooms.length === 1 && sides.some((s) => !s) };
  });
}

export function escapeRoutes(plan: Plan): Escape | null {
  const doors = doorLinks(plan);
  const exits = doors.filter((d) => d.exit);
  if (!exits.length) return null;
  // Multi-source Dijkstra over doors; two doors are linked when they open into the same room.
  const D = new Map(doors.map((d) => [d.id, d.exit ? 0 : Infinity]));
  const prev = new Map<string, string | null>(doors.map((d) => [d.id, null]));
  const todo = new Set(doors.map((d) => d.id));
  while (todo.size) {
    let u: string | null = null;
    for (const id of todo) if (u === null || D.get(id)! < D.get(u)!) u = id;
    todo.delete(u!);
    const du = doors.find((d) => d.id === u)!;
    if (!Number.isFinite(D.get(u!)!)) break;
    for (const v of doors) {
      if (!todo.has(v.id) || !v.rooms.some((r) => du.rooms.includes(r))) continue;
      const alt = D.get(u!)! + dist(du.mid, v.mid);
      if (alt < D.get(v.id)!) { D.set(v.id, alt); prev.set(v.id, u); }
    }
  }
  const routes: Route[] = [], unreachable: string[] = [];
  for (const r of plan.rooms) {
    const own = doors.filter((d) => d.rooms.includes(r.id) && Number.isFinite(D.get(d.id)!));
    if (!own.length) { unreachable.push(r.id); continue; }
    let best: Route | null = null;
    for (const v of r.polygon) {
      // From this corner, the cheapest way out of the room...
      let cand: { d: number; door: (typeof own)[number] } | null = null;
      for (const d of own) { const t = dist(v, d.mid) + D.get(d.id)!; if (!cand || t < cand.d) cand = { d: t, door: d }; }
      // ...and the room's worst corner is the one whose cheapest way out is longest.
      if (cand && (!best || cand.d > best.distance_m)) {
        const path: Pt[] = [v], via: string[] = [];
        for (let id: string | null = cand.door.id; id; id = prev.get(id) ?? null) { const d = doors.find((x) => x.id === id)!; path.push(d.mid); via.push(id); }
        best = { room_id: r.id, from: v, path, distance_m: round(cand.d, 2), via };
      }
    }
    routes.push(best!);
  }
  return { exits: exits.map((e) => e.id), routes, unreachable };
}
