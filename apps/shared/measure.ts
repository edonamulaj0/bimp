// Measurements of everything on a plan that the drawing may not state: walls, doors and windows, fittings and furniture.
// Pure geometry on the plan model; used by the canvas (hover read-out) and by the chat's tools, so both say the same.
import { type Fixture, type Opening, type Plan, type Pt, type Wall, dist, fixtureName, round } from './plan';
import { inside } from './rooms';

const roomAt = (plan: Plan, p: Pt) => plan.rooms.find((r) => inside(p, r.polygon)) ?? null;
/** The rooms on either side of a segment (a wall or an opening), probed a little way off its middle. */
function sides(plan: Plan, a: Pt, b: Pt, reach: number) {
  const L = dist(a, b) || 1, n: Pt = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const at = (s: number) => { for (const k of [reach, reach + 0.2, reach + 0.45]) { const r = roomAt(plan, [m[0] + n[0] * k * s, m[1] + n[1] * k * s]); if (r) return r; } return null; };
  return [at(1), at(-1)] as const;
}
const where = (rs: readonly ({ name: string } | null)[]) => {
  const names = [...new Set(rs.filter((r): r is { name: string } => !!r).map((r) => r.name))];
  return names.length === 2 ? `between ${names[0]} and ${names[1]}` : names.length === 1 ? (rs.some((r) => !r) ? `${names[0]}, outside wall` : `in ${names[0]}`) : 'not beside a room';
};

export type WallInfo = { id: string; length_m: number; thickness_m: number; exterior: boolean; rooms: string[]; where: string };
export function wallInfo(plan: Plan, w: Wall): WallInfo {
  const s = sides(plan, w.a, w.b, w.thickness / 2 + 0.1);
  return { id: `wall-${w.id}`, length_m: round(dist(w.a, w.b), 2), thickness_m: round(w.thickness, 3), exterior: s.some((r) => !r), rooms: s.filter((r) => !!r).map((r) => r!.id), where: where(s) };
}
export type OpeningInfo = { id: string; kind: Opening['kind']; width_m: number; rooms: string[]; where: string; exit: boolean };
export function openingInfo(plan: Plan, o: Opening): OpeningInfo {
  const s = sides(plan, o.a, o.b, 0.3);
  return { id: o.id, kind: o.kind, width_m: round(dist(o.a, o.b), 2), rooms: s.filter((r) => !!r).map((r) => r!.id), where: where(s), exit: o.kind === 'door' && s.some((r) => !r) };
}
export type FixtureInfo = { id: string; kind: string; name: string; width_m: number; depth_m: number; room_id: string | null; room: string | null; from: string };
export function fixtureInfo(plan: Plan, f: Fixture): FixtureInfo {
  return { id: f.id, kind: f.kind, name: fixtureName(f), width_m: round(f.size[0], 2), depth_m: round(f.size[1], 2), room_id: f.room_id,
    room: plan.rooms.find((r) => r.id === f.room_id)?.name ?? null, from: f.source === 'suggested' ? 'suggested by bimp' : f.label ? 'named by a person' : 'read from the drawing' };
}

/** How far the figures can be trusted, said with every measurement. */
export const basisOf = (plan: Plan) => (plan.method === 'sample' ? 'exact design model' : plan.measured ? 'measured from the drawing' : 'from a preview, approximate');
const mm = (v: number) => `${Math.round(v * 1000)} mm`;

/** One line for the canvas read-out: what the thing is and its measurements. */
export function describe(plan: Plan, kind: 'wall' | 'opening' | 'fixture', id: string): { title: string; detail: string } | null {
  if (kind === 'wall') {
    const w = plan.walls.find((x) => x.id === id);
    if (!w) return null;
    const i = wallInfo(plan, w);
    return { title: i.exterior ? 'Outside wall' : 'Wall', detail: `${i.length_m.toFixed(2)} m long · ${mm(i.thickness_m)} thick · ${i.where}` };
  }
  if (kind === 'opening') {
    const o = plan.openings.find((x) => x.id === id);
    if (!o) return null;
    const i = openingInfo(plan, o);
    return { title: o.kind === 'door' ? (i.exit ? 'Outside door' : 'Door') : 'Window', detail: `${mm(i.width_m)} wide · ${i.where}` };
  }
  const f = plan.fixtures?.find((x) => x.id === id);
  if (!f) return null;
  const i = fixtureInfo(plan, f);
  return { title: f.kind === 'unknown' && !f.label ? 'Unknown symbol' : i.name.charAt(0).toUpperCase() + i.name.slice(1), detail: `${i.width_m.toFixed(2)} × ${i.depth_m.toFixed(2)} m${i.room ? ` · in ${i.room}` : ''} · ${i.from}` };
}
