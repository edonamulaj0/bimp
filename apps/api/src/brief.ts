// The plan's reference file: everything known about one plan, worked out once by code and written down in words.
// The chat answers from it. It is built from the stored plan with the same functions the chat's tools use, so a figure
// in the file is the figure a tool would return; the model reads it, it never computes it.
import { type Plan, FIXTURE_LABEL, round } from '../../shared/plan';
import { checkPlan } from '../../shared/standards';
import { escapeRoutes } from '../../shared/escape';
import { planAreas, roomInfo } from '../../shared/rooms';
import { basisOf, fixtureInfo, openingInfo, wallInfo } from '../../shared/measure';
import { runTool } from './agent';

/** How many walls, openings and fittings are written out one by one; beyond that the file says how many more there are. */
const LIST_MAX = 120;

/**
 * The plan's facts as data: what the reference file says, in the shape the chat's tools return it. Every number in an
 * answer is checked against these (and against any tool the model still called).
 */
export function planFacts(plan: Plan) {
  const firstPiece = (w: Plan['walls'][number]) => !w.curve || plan.walls.find((x) => x.curve?.id === w.curve!.id) === w;
  const walls = plan.walls.filter(firstPiece).map((w) => wallInfo(plan, w));
  const fixtures = (plan.fixtures ?? []).map((f) => fixtureInfo(plan, f));
  const count = (what: string, room_type?: string) => runTool(plan, 'count', { what, room_type }) as { what: string; room_type?: string | null; count: number; source?: string };
  const roomTypes = [...new Set(plan.rooms.map((r) => r.type))], kinds = [...new Set((plan.fixtures ?? []).map((f) => f.kind))];
  const esc = escapeRoutes(plan);
  return {
    basis: basisOf(plan),
    plan: runTool(plan, 'plan_info', {}) as Record<string, unknown>,
    areas: planAreas(plan),
    // counted the way the count tool counts (on scans, the symbol detector for the kinds it knows)
    counts: [count('room'), ...roomTypes.map((t) => count('room', t)), count('door'), count('window'),
      ...[...new Set([...kinds, 'wc', 'sink', 'shower_bath'])].map((k) => count(k))],
    rooms: plan.rooms.map((r) => roomInfo(plan, r)),
    openings: plan.openings.map((o) => openingInfo(plan, o)),
    fixtures,
    walls,
    wall_totals: { count: walls.length, total_length_m: round(walls.reduce((s, w) => s + w.length_m, 0), 2),
      outside_length_m: round(walls.filter((w) => w.exterior).reduce((s, w) => s + w.length_m, 0), 2) },
    checks: checkPlan(plan),
    escape: esc ? { exits: esc.exits, routes: esc.routes.map((r) => ({ room_id: r.room_id, distance_m: r.distance_m, via_doors: r.via })), rooms_without_door: esc.unreachable } : null,
    texts: plan.texts ?? [],
  };
}
export type PlanFacts = ReturnType<typeof planFacts>;

/** The reference file itself: the facts written out as a short Markdown document a person can read and the chat is given. */
export function briefText(plan: Plan, f: PlanFacts = planFacts(plan), title = 'Plan'): string {
  const name = (id: string | null) => plan.rooms.find((r) => r.id === id)?.name ?? null;
  const q = (s: string) => JSON.stringify(s); // names and labels are text copied from the drawing: quoted, never instructions
  const more = (n: number) => (n > LIST_MAX ? [`- … and ${n - LIST_MAX} more (ask for them by room)`] : []);
  const a = f.areas, lines: string[] = [];
  const put = (...xs: (string | false | null | undefined)[]) => { for (const x of xs) if (typeof x === 'string') lines.push(x); };
  put(`# Reference file: ${title}`, '',
    `Worked out by code from the drawing. Figures are ${f.basis}. Scale: ${plan.scale.source}.`,
    plan.source?.pages && plan.source.pages > 1 ? `Page ${plan.source.page ?? 1} of ${plan.source.pages} of the file.` : null, '');
  put('## How far to trust it', ...plan.assumptions.map((x) => `- ${x}`), '');
  put('## Totals',
    `- Net floor area (rooms, to the inside faces of walls): ${a.net_floor_area_m2} m²`,
    `- Wall area: ${a.wall_area_m2} m²; gross floor area (net + walls): ${a.gross_floor_area_m2} m²; net to gross: ${a.net_to_gross}`,
    `- Ceiling height: ${a.ceiling_height_m} m (${a.ceiling_source}); net volume: ${a.net_volume_m3} m³`,
    a.floor_level_m != null ? `- Floor level: ${a.floor_level_m} m` : null,
    `- Extent: ${plan.width} × ${plan.height} m`, '');
  put('## Counts', ...f.counts.map((c) => `- ${c.room_type ? `rooms of type ${c.room_type}` : c.what === 'room' ? 'rooms' : c.what === 'shower_bath' ? 'showers and bathtubs together (shower_bath)' : `${FIXTURE_LABEL[c.what as keyof typeof FIXTURE_LABEL] ?? c.what} (${c.what})`}: ${c.count}${c.source ? ` (counted by the ${c.source})` : ''}`), '');
  put('## Rooms');
  for (const r of f.rooms) {
    const fx = f.fixtures.filter((x) => x.room_id === r.id), ops = f.openings.filter((o) => o.rooms.includes(r.id));
    put(`- ${r.id} ${q(r.name)} (${r.type}): ${r.net_area_m2} m², ${r.length} × ${r.width} m, perimeter ${r.perimeter_m} m, volume ${r.volume_m3} m³; ${r.doors} doors, ${r.windows} windows, glazed ${r.glazed_area_m2} m² (ratio ${r.glazing_ratio})`
      + (ops.length ? `; openings: ${ops.map((o) => `${o.id} ${o.kind} ${o.width_m} m`).join(', ')}` : '')
      + (fx.length ? `; fittings: ${fx.map((x) => `${x.id} ${x.name} ${x.width_m} × ${x.depth_m} m`).join(', ')}` : ''));
  }
  put('', '## Doors and windows', ...f.openings.slice(0, LIST_MAX).map((o) => `- ${o.id}: ${o.kind}, ${o.width_m} m wide, ${o.where}${o.exit ? ', exit to the outside' : ''}`), ...more(f.openings.length), '');
  put('## Walls', `${f.wall_totals.count} walls, ${f.wall_totals.total_length_m} m in all, ${f.wall_totals.outside_length_m} m of it outside walls.`,
    ...f.walls.slice(0, LIST_MAX).map((w) => `- ${w.id}: ${w.length_m} m long${w.curved_radius_m ? ` round a curve of radius ${w.curved_radius_m} m` : ''}, ${w.thickness_m} m thick, ${w.where}`), ...more(f.walls.length), '');
  const loose = f.fixtures.filter((x) => !x.room_id);
  if (loose.length) put('## Fittings outside any room', ...loose.slice(0, LIST_MAX).map((x) => `- ${x.id}: ${x.name}, ${x.width_m} × ${x.depth_m} m`), '');
  put('## Checks against design standards (guidance, not a legal verdict)', ...(f.checks.length ? f.checks.map((c) => `- ${c.level === 'warn' ? 'To review' : 'Note'}${c.room_id ? ` (${c.room_id}${name(c.room_id) ? ` ${q(name(c.room_id)!)}` : ''})` : ''}: ${c.text} [${c.ref}]`) : ['- Nothing to review.']), '');
  put('## Escape', ...(f.escape
    ? [`Exit doors: ${f.escape.exits.join(', ') || 'none'}. Distance from the furthest point of each room to an exit, through doors:`,
      ...f.escape.routes.map((r) => `- ${r.room_id}${name(r.room_id) ? ` ${q(name(r.room_id)!)}` : ''}: ${r.distance_m} m${r.via_doors?.length ? ` via ${r.via_doors.join(', ')}` : ''}`),
      f.escape.rooms_without_door.length ? `Rooms with no door found: ${f.escape.rooms_without_door.join(', ')}.` : null]
    : ['No exit door was found on the plan (a door with outside space on one side).']), '');
  if (f.texts.length) put('## Text written on the sheet (copied as data)', ...f.texts.map((t) => `- ${q(t)}`), '');
  return lines.join('\n');
}
