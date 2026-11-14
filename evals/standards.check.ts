// Run: npm test. Checks the drawing-convention and standards logic (Metric Handbook rules) on known cases.
import { parseDimension, nearestPreferredScale, checkPlan } from '../apps/shared/standards';
import { regularize, snapPolygon, parseLevel, parseCeiling, buildPlan } from '../apps/api/src/extract';
import { verify, runTool } from '../apps/api/src/agent';
import { calculate } from '../apps/api/src/calc';
import { diffPlans } from '../apps/shared/diff';
import { samplePlan } from '../apps/shared/sample-plan';
import { area, wallsFromFaces, wallPieces, type Plan } from '../apps/shared/plan';
import { escapeRoutes } from '../apps/shared/escape';
import { wallFootprints, cleanWalls, labelPoint } from '../apps/shared/walls';
import { doorClashes, doorSweep, fixtureContains, inside, planAreas, roomInfo } from '../apps/shared/rooms';
import { fengShui, suggestLayout } from '../apps/shared/fengshui';
import { escapeWidth } from '../apps/shared/standards';
import { clipPlan, clipSegment, parseRegion, regionContents } from '../apps/shared/region';
import { signParams, transformationFor } from '../apps/api/src/visuals';
import { cleanPrompt } from '../apps/shared/visual-styles';

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};
const near = (name: string, got: number, want: number, tol = 1e-6) => eq(name, Math.abs(got - want) <= tol, true);

// Ch. 1 §2 notation
eq('mm without decimals', parseDimension('2500'), 2.5);
eq('metres with point', parseDimension('12.00'), 12);
eq('continental comma', parseDimension('2,50'), 2.5);
eq('space-grouped thousands', parseDimension('15 000'), 15);
eq('explicit mm', parseDimension('900 mm'), 0.9);
eq('explicit cm', parseDimension('250cm'), 2.5);
eq('feet-inches', parseDimension(`3'-6"`), 1.0668);
eq('level mark is not a length', parseDimension('+2.700 FFL'), null);
eq('small bare integer is ambiguous', parseDimension('12'), null);
// Ch. 1 Table III
eq('1:98 -> 1:100', nearestPreferredScale(98), 100);
eq('1:52 -> 1:50', nearestPreferredScale(52), 50);
eq('1:75 is not near a preferred scale', nearestPreferredScale(75), null);
// 15° rule: a slightly skewed rectangle becomes exact; a 45° room stays 45°
const skew = regularize([[0, 0], [10, 0.3], [10.1, 5], [0.2, 4.8]]);
near('skewed rect: top edge horizontal', skew[0][1], skew[1][1], 1e-9);
near('skewed rect: right edge vertical', skew[1][0], skew[2][0], 1e-9);
const diamond = regularize([[5, 0], [10, 5.1], [5, 10], [0, 4.9]]);
near('45° room: edges stay at 45°', Math.atan2(diamond[1][1] - diamond[0][1], diamond[1][0] - diamond[0][0]) * 180 / Math.PI, 45, 1e-6);
// edge snapping does not jump to a neighbour's corner 20 px away
const segs: [number, number, number, number][] = [[0, 0, 100, 0], [100, 0, 100, 52], [0, 52, 100, 52], [0, 0, 0, 52], [0, 50, -60, 50]];
eq('edge snap keeps own corner', snapPolygon([[2, -3], [98, 2], [101, 49], [-2, 51]], segs, 12).poly.map((p) => p.map((v) => Math.round(v))), [[0, 0], [100, 0], [100, 52], [0, 52]]);
// Standards checks
eq('sample plan passes checks', checkPlan(samplePlan()).filter((c) => c.level === 'warn').length, 0);
const tiny: Plan = { ...samplePlan(), rooms: [{ id: 'r1', name: 'Bedroom 3', type: 'bedroom', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] }] };
eq('4 m² bedroom flagged (Table IV 6.5 m²)', checkPlan(tiny).some((c) => c.level === 'warn' && c.room_id === 'r1'), true);
const big = samplePlan();
const doubled: Plan = { ...big, openings: big.openings.map((o) => ({ ...o, a: [o.a[0] * 2, o.a[1] * 2], b: [o.b[0] * 2, o.b[1] * 2] })) };
eq('doors twice too wide -> scale warning', checkPlan(doubled).some((c) => /scale is probably off/.test(c.text)), true);
near('sample living room 4.8 × 7.2 m', area(big.rooms[0].polygon), 34.56);

// Ch. 41 escape routes on the courtyard house: three exits (front, terrace, gallery); the wardrobe is the furthest room
const esc = escapeRoutes(samplePlan())!;
eq('three exit doors', esc.exits, ['d1', 'd2', 'd3']);
eq('every room reachable', esc.unreachable, []);
near('wardrobe worst distance ≈ 11.2 m', esc.routes.find((r) => r.room_id === 'r9')!.distance_m, 11.18, 0.05);
eq('sample flags > 9 m travel (info)', checkPlan(samplePlan()).some((c) => /9 m/.test(c.text) && c.level === 'info'), true);
// Ch. 41 Table XIV
eq('escape width 100 people', escapeWidth(100).min_width_mm, 850);
eq('escape width 300 people', escapeWidth(300).min_width_mm, 1500);
// Ch. 37 walls from inside faces: a 200 mm gap between two rooms becomes one 200 mm wall on its centreline
const fw = wallsFromFaces([
  { id: 'a', name: 'A', type: 'other', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
  { id: 'b', name: 'B', type: 'other', polygon: [[4.2, 0], [8, 0], [8, 3], [4.2, 3]] },
]).walls;
const party = fw.filter((w) => Math.abs(w.a[0] - 4.1) < 1e-9 && Math.abs(w.b[0] - 4.1) < 1e-9);
eq('shared wall: one wall at x = 4.1', party.length, 1);
eq('shared wall thickness 0.2', party[0]?.thickness, 0.2);
eq('outer walls outside the rooms (net areas kept)', fw.filter((w) => w.thickness === 0.3).every((w) => w.a[0] <= 0 || w.a[0] >= 8 || w.a[1] <= 0 || w.a[1] >= 3), true);
// Ch. 31 garage
const gar: Plan = { ...samplePlan(), openings: [], rooms: [{ id: 'g', name: 'Garage', type: 'garage', polygon: [[0, 0], [2.2, 0], [2.2, 4.5], [0, 4.5]] }] };
eq('2.2 × 4.5 m garage flagged (Fig. 31.30)', checkPlan(gar).some((c) => c.room_id === 'g' && c.level === 'warn'), true);

// Fixtures: the bathroom WC sits against its west wall (x = 2.4), so its front faces east (+x)
const wc = samplePlan().fixtures!.find((f) => f.kind === 'wc' && f.room_id === 'r10')!;
const wcFront = [-Math.sin(wc.angle), Math.cos(wc.angle)];
eq('WC faces into the bathroom (front away from its wall)', inside([wc.center[0] + wcFront[0] * 0.8, wc.center[1] + wcFront[1] * 0.8], samplePlan().rooms.find((r) => r.id === 'r10')!.polygon), true);
eq('WC is in the bathroom', wc.room_id, 'r10');
eq('every sample fixture is inside a room', samplePlan().fixtures!.every((f) => f.room_id), true);

// Mitered walls: L-corner of two 0.2 m walls meets at outer (-0.1,-0.1) and inner (0.1,0.1) corners
const L = wallFootprints([{ id: 'x', a: [0, 0], b: [4, 0], thickness: 0.2 }, { id: 'y', a: [0, 0], b: [0, 3], thickness: 0.2 }]);
const pts = L.flatMap((f) => f.poly.map((p) => p.map((v) => Math.round(v * 1000) / 1000).join(',')));
eq('L-corner: outer miter point shared', pts.filter((p) => p === '-0.1,-0.1').length, 2);
eq('L-corner: inner miter point shared', pts.filter((p) => p === '0.1,0.1').length, 2);
// T-junction: a wall ending 5 cm off another wall's centre line is snapped onto it and the other wall is split
const T = cleanWalls([{ id: 'y', a: [0, 0], b: [4, 0], thickness: 0.2 }, { id: 'x', a: [2, 0.05], b: [2, 3], thickness: 0.12 }]);
eq('T-junction splits the through wall', T.length, 3);
eq('T-junction end snapped to centre line', T.find((w) => w.id === 'x')!.a, [2, 0]);
const sf = wallFootprints(samplePlan().walls);
eq('sample: every footprint is a closed hexagon', sf.every((f) => f.poly.length === 6), true);
// footprints of the sample cover the wall area without big overlaps: total ≈ Σ length × thickness (± corners)
const polyArea = (q: number[][]) => Math.abs(q.reduce((s2, p, i) => s2 + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0)) / 2;
const fpArea = sf.reduce((s2, f) => s2 + polyArea(f.poly), 0), naive = samplePlan().walls.reduce((s2, w) => s2 + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * w.thickness, 0);
eq(`sample: footprint area ${fpArea.toFixed(2)} within 5% of length×thickness ${naive.toFixed(2)}`, Math.abs(fpArea / naive - 1) < 0.05, true);
// label point of an L-shaped room sits inside the room, away from the notch
const lp = labelPoint([[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]);
eq('L-room label inside the L', (lp[0] <= 2 || lp[1] <= 2) && lp[0] >= 0 && lp[1] >= 0, true);

// Doors: swing into rooms (not the hall), entrance inward, no leaf through furniture
const sp = samplePlan();
const swingRoom = (id: string) => {
  const o = sp.openings.find((x) => x.id === id)!, L = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
  const u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], s2 = o.swing ?? 1, n = [-u[1] * s2, u[0] * s2], k = Math.SQRT1_2 * L * 0.6;
  const mid: [number, number] = [o.a[0] + (u[0] + n[0]) * k, o.a[1] + (u[1] + n[1]) * k]; // 45° into the swing
  return sp.rooms.find((r) => inside(mid, r.polygon))?.name;
};
eq('kitchen door opens into the kitchen', swingRoom('d6'), 'Kitchen / dining');
eq('bedroom 2 door opens into bedroom 2', swingRoom('d11'), 'Bedroom 2');
eq('entrance door opens inward (into the hall)', swingRoom('d1'), 'Entrance hall');
eq('wardrobe door opens out of the cupboard', swingRoom('d12') !== 'Wardrobe', true);
eq('no door leaf hits furniture in the sample', sp.openings.filter((o) => o.kind === 'door').flatMap((o) => doorClashes(o, sp.fixtures!)).length, 0);
// Areas: net = Σ rooms (194.4 m²), gross adds the walls; ceiling from the pilot specification
const pa = planAreas(sp);
near('net floor area = Σ rooms', pa.net_floor_area_m2, 194.4, 1e-6);
eq('gross > net', pa.gross_floor_area_m2 > pa.net_floor_area_m2, true);
eq('ceiling from the specification', pa.ceiling_source, 'Pilot house specification');
const ri = roomInfo(sp, sp.rooms.find((r) => r.name === 'Kitchen / dining')!);
eq('kitchen 6.0 × 4.8 m, perimeter 21.6 m', [ri.length, ri.width, ri.perimeter_m], [6, 4.8, 21.6]);

// Feng shui: an empty copy of the sample gets a layout that obeys the rules it checks
const empty = { ...sp, fixtures: [] };
const sug = suggestLayout(empty);
const furnished = { ...empty, fixtures: sug };
eq('suggests a bed for each bedroom', sug.filter((f) => f.kind === 'bed').length, 2);
eq('suggested items are marked as suggestions', sug.every((f) => f.source === 'suggested'), true);
eq('no suggested item blocks a door', furnished.openings.filter((o) => o.kind === 'door').flatMap((o) => doorClashes(o, sug)).length, 0);
eq('no suggested bed, WC or stove faces a door straight on', fengShui(furnished).filter((n) => !n.ok && /straight at the door|faces the door directly|back straight to the door/.test(n.text)).length, 0);
eq('suggested desk does not put its user\'s back to the door', fengShui(furnished).some((n) => /back to the door/.test(n.text)), false);
eq('every suggested item lies inside its room', sug.every((f) => inside(f.center, furnished.rooms.find((r) => r.id === f.room_id)!.polygon)), true);
eq('suggested sofa faces the room entrance', fengShui(furnished).some((n) => /sofa turns its back/.test(n.text)), false);
eq('no suggested bed has its headboard under a window', fengShui(furnished).some((n) => /headboard under a window/.test(n.text)), false);
eq('nothing to suggest for the furnished sample', suggestLayout(sp).length, 0);
const fs = fengShui(sp);
eq('feng shui flags the entrance lining up across the home or confirms it', fs.some((n) => /entrance/.test(n.text)), true);
void doorSweep; void fixtureContains;


// Wall geometry from inside-face rooms: corners close, partitions meet the outer wall's centre line
{
  const { walls, paired } = wallsFromFaces([
    { id: 'a', name: 'A', type: 'other', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { id: 'b', name: 'B', type: 'other', polygon: [[4.12, 0], [8, 0], [8, 3], [4.12, 3]] },
  ]);
  eq('face pair found', paired, true);
  const ends = walls.flatMap((w) => [w.a, w.b]);
  const at = (x: number, y: number) => ends.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6);
  eq('outer corner closes at (-0.15,-0.15)', at(-0.15, -0.15), true);
  eq('partition reaches outer centre line', at(4.06, -0.15) && at(4.06, 3.15), true);
  eq('no face pair on lone room', wallsFromFaces([{ id: 'a', name: 'A', type: 'other', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }]).paired, false);
}
// Sample plan (centre-line rooms): the bedroom-wing line at x = 2.4 is an interior partition
{
  const p = samplePlan();
  const onX = p.walls.filter((w) => Math.abs(w.a[0] - 2.4) < 1e-6 && Math.abs(w.b[0] - 2.4) < 1e-6);
  eq('x = 2.4 partition is 0.12 m', onX.length > 0 && onX.every((w) => w.thickness === 0.12), true);
  eq('perimeter walls are 0.30 m', p.walls.filter((w) => (w.a[1] === 0 && w.b[1] === 0)).every((w) => w.thickness === 0.3), true);
}
// Window sill never above a lowered wall
{
  const w = { id: 'w', a: [0, 0] as [number, number], b: [4, 0] as [number, number], thickness: 0.3 };
  const pcs = wallPieces(w, [{ id: 'o', kind: 'window', a: [1, 0], b: [2, 0] }], 0.3);
  eq('sill clipped to wall height', pcs.pieces.every((q: { z1: number }) => q.z1 <= 0.3 + 1e-9), true);
}
// Corridor-length escape: the far corner of a long room is reported, not a vertex near the door
{
  const plan: Plan = { ...samplePlan(), rooms: [{ id: 'c', name: 'Hall', type: 'corridor', polygon: [[0, 0], [10, 0], [10, 1.2], [0, 1.2]] }], openings: [{ id: 'd', kind: 'door', a: [0, 0.2], b: [0, 1.0] }], walls: [], fixtures: [] };
  const r = escapeRoutes(plan);
  eq('corridor escape ≥ 9.5 m', !!r && r.routes.some((x) => x.distance_m >= 9.5), true);
  const two = escapeRoutes({ ...plan, rooms: [{ id: 'c', name: 'Hall', type: 'corridor', polygon: [[0, 0], [20, 0], [20, 1.2], [0, 1.2]] }],
    openings: [{ id: 'd1', kind: 'door', a: [0, 0.2], b: [0, 1.0] }, { id: 'd2', kind: 'door', a: [20, 0.2], b: [20, 1.0] }] });
  eq('20 m corridor with two exits: worst point ≈ 10 m (mid-length)', !!two && two.routes[0].distance_m >= 9.5 && two.routes[0].distance_m <= 10.5, true);
}
// Verifier: counts must match, drawing text and the model's own assumptions are not evidence
{
  const p = samplePlan();
  const base = { claims: [{ text: 'x', room_ids: [p.rooms[0].id] }], calculation: null, assumptions: [] as string[], not_found: false };
  const rooms = p.rooms.map((r) => ({ id: r.id, name: r.name, area_m2: Math.round(area(r.polygon) * 100) / 100 }));
  const cnt = { what: 'room', room_type: 'bedroom', count: 2, room_ids: ['r1', 'r2'] };
  eq('wrong count is unverified', verify({ ...base, text: 'There are 6 bedrooms.' }, [rooms, cnt], 'How many bedrooms?', p).length > 0, true);
  eq('right count is verified', verify({ ...base, text: 'There are 2 bedrooms.' }, [rooms, cnt], 'How many bedrooms?', p), []);
  eq('model assumption is not evidence', verify({ ...base, text: 'The kitchen is 42 m².', assumptions: ['kitchen taken as 42 m²'] }, [rooms], 'How big is the kitchen?', p).length > 0, true);
  eq('number in a room name is not evidence', verify({ ...base, text: 'The living room is 99 m².' }, [[{ id: 'r1', name: 'LIVING 99 m2', area_m2: 20 }]], 'Living room size?', p).length > 0, true);
}
// Symbol detector: on a scan, its boxes become plan.detected and the count tool answers from them
{
  const sq = (x0: number, y0: number, x1: number, y1: number) => [[y0, x0], [y0, x1], [y1, x1], [y1, x0]]; // [y, x] in 0-1000, as the model returns
  const raw = { scale_evidence: null, stated_scale: null, levels: null, rooms: [{ name: 'Bath', type: 'bathroom', polygon: sq(100, 100, 500, 900) }, { name: 'Bedroom', type: 'bedroom', polygon: sq(500, 100, 900, 900) }],
    openings: [{ kind: 'door', a: [500, 500], b: [600, 500] }], fixtures: [{ kind: 'wc', box: [150, 150, 250, 220] }] } as never;
  const an = { kind: 'image' as const, width: 1000, height: 1000, segments: [], texts: [], scale: null, paper_mm_per_px: null,
    detections: [{ kind: 'toilet', conf: 0.9, bbox: [150, 150, 220, 250] as [number, number, number, number] }, { kind: 'toilet', conf: 0.6, bbox: [300, 150, 370, 250] as [number, number, number, number] },
      { kind: 'window', conf: 0.7, bbox: [600, 95, 800, 105] as [number, number, number, number] }, { kind: 'bogus', conf: 0.9, bbox: [0, 0, 1, 1] as [number, number, number, number] }] };
  const p = buildPlan(raw, an, 'f1', 'sha');
  eq('detector: items kept by known kind', p.detected?.items.map((d) => d.kind), ['toilet', 'toilet', 'window']);
  eq('detector: item lies in its room', p.detected?.items[0].room_id, p.rooms[0].id);
  const wc = runTool(p, 'count', { what: 'wc' }) as { count: number; source: string; read_by_language_model: number };
  eq('detector: wc count comes from the detector', [wc.count, wc.read_by_language_model, /detector/.test(wc.source)], [2, 1, true]);
  eq('detector: window count comes from the detector', (runTool(p, 'count', { what: 'window' }) as { count: number }).count, 1);
  eq('detector: a kind it found none of counts zero', (runTool(p, 'count', { what: 'sink' }) as { count: number }).count, 0);
  eq('detector: other kinds still come from the plan', (runTool(p, 'count', { what: 'bed' }) as { count: number; source?: string }).source, undefined);
  const v = buildPlan(raw, { ...an, kind: 'pdf-vector' as const }, 'f1', 'sha');
  eq('detector: not used on vector sheets', v.detected, undefined);
  const none = buildPlan(raw, { ...an, detections: null }, 'f1', 'sha');
  eq('detector: absent service leaves the plan as read', [none.detected, (runTool(none, 'count', { what: 'wc' }) as { count: number }).count], [undefined, 1]);
}
// Level and ceiling strings (FN-13)
eq('level "1.OG OKFF +3.05"', parseLevel('1.OG OKFF +3.05'), 3.05);
eq('level "Level 2 FFL +6.000"', parseLevel('Level 2 FFL +6.000'), 6);
eq('level "FFL +2700" (mm)', parseLevel('FFL +2700'), 2.7);
eq('level "±0.00"', parseLevel('±0.00'), 0);
eq('level "-0.45"', parseLevel('-0.45'), -0.45);
eq('ceiling "1.OG RH 2,50"', parseCeiling('1.OG RH 2,50'), 2.5);
eq('ceiling "RH 250 cm"', parseCeiling('RH 250 cm'), 2.5);
eq('ceiling "CH 2700"', parseCeiling('CH 2700'), 2.7);
eq('ceiling "2.60 m"', parseCeiling('2.60 m'), 2.6);
eq('calc -2^2', calculate('-2^2'), -4);
eq('calc 2^-1', calculate('2^-1'), 0.5);
eq('calc 2^3^2', calculate('2^3^2'), 512);
eq('calc (1+2)*-3', calculate('(1+2)*-3'), -9);
// Revision comparison
{
  const a = samplePlan();
  eq('same plan: no changes', diffPlans(a, a).rooms.every((r) => r.status === 'same') && !diffPlans(a, a).walls.added.length, true);
  const b: Plan = JSON.parse(JSON.stringify(a));
  const k = b.rooms.find((r) => r.type === 'kitchen')!;
  k.polygon = k.polygon.map(([x, y]) => [x, y === Math.max(...k.polygon.map((p) => p[1])) ? y + 0.5 : y]);
  b.rooms.push({ id: 'rx', name: 'Pantry', type: 'storage', polygon: [[20, 0], [22, 0], [22, 1.5], [20, 1.5]] });
  b.rooms = b.rooms.filter((r) => r.type !== 'utility');
  b.walls.push({ id: 'wx', a: [20, 0], b: [22, 0], thickness: 0.12 });
  const d = diffPlans(a, b);
  eq('added room found', d.rooms.filter((r) => r.status === 'added').map((r) => r.name), ['Pantry']);
  eq('removed room found', d.rooms.filter((r) => r.status === 'removed').map((r) => r.name), ['Utility']);
  eq('kitchen grew by 2.4 m²', d.rooms.find((r) => r.b?.id === k.id)!.delta, 2.4);
  eq('added wall found', d.walls.added.map((w) => w.id), ['wx']);
  eq('summary mentions net area', d.summary.some((x) => x.startsWith('Net floor area')), true);
}

// Markup regions: the plan clipped to a drawn rectangle keeps only what lies inside it
{
  const p = samplePlan();
  const r = { x0: 2.4, y0: 10.2, x1: 6.0, y1: 13.2 }; // exactly the bathroom
  const c = clipPlan(p, r);
  eq('region: only the bathroom', c.rooms.map((x) => x.id), ['r10']);
  near('region: bathroom area kept', area(c.rooms[0].polygon), 10.8, 1e-6);
  eq('region: fittings inside only', c.fixtures!.every((f) => f.room_id === 'r10') && c.fixtures!.length === 4, true);
  eq('region: scope stated', c.assumptions.some((a) => /^Scope: only the marked region/.test(a)), true);
  const half = regionContents(p, { x0: 12, y0: 0, x1: 14.4, y1: 7.2 });
  eq('region: half the living room', half.rooms.map((x) => [x.id, x.share_of_room]), [['r1', 0.5]]);
  eq('segment clipped to region', clipSegment([-1, 1], [5, 1], { x0: 0, y0: 0, x1: 2, y1: 2 }), [[0, 1], [2, 1]]);
  eq('tiny region rejected', parseRegion({ x0: 1, y0: 1, x1: 1.1, y1: 3 }, p), null);
  eq('bad region rejected', parseRegion({ x0: 'a' }, p), null);
}

// Cloudinary: request signing (the documented example) and generated-image transformations
{
  const sig = await signParams({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: '1315060510' }, 'abcd');
  eq('Cloudinary signature matches the documented example', sig, 'bfd09f95f331f558cbd1320e67aa8d488770583e');
  eq('prompt commas and slashes are escaped in the transformation', transformationFor('custom', 'garden, trees/sky'), 'e_gen_background_replace:prompt_garden%2C%20trees%2Fsky/c_limit,w_1600/f_jpg,q_auto');
  eq('custom prompts are cleaned', cleanPrompt('  a <b>garden</b> | with "trees"  '), 'a b garden b with trees');
}

// Gemini: a retired model (404) is replaced by the newest Flash model the key can use, and the call succeeds
{
  const { generate, joinStream } = await import('../apps/api/src/gemini');
  const sse = (...chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
  const joined = joinStream(sse(
    { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking', thought: true }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: '{"rooms":' }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: '[]}' }, { functionCall: { name: 'count', args: { kind: 'door' } } }] }, finishReason: 'STOP' }] },
  ));
  eq('streamed Gemini reply: text pieces joined, thoughts and tool calls kept apart', joined.content?.parts, [{ text: 'thinking', thought: true }, { text: '{"rooms":[]}' }, { functionCall: { name: 'count', args: { kind: 'door' } } }]);
  eq('streamed Gemini reply: finish reason read from the last piece', joined.finishReason, 'STOP');
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url).replace('https://generativelanguage.googleapis.com/v1beta/', ''));
    if (String(url).includes('models?')) return new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }));
    if (String(url).includes('gemini-2.5-flash:')) return new Response('{"error":{"code":404}}', { status: 404 });
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }));
  }) as typeof fetch;
  try {
    const env = { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-flash', DB: null } as never;
    const c = await generate(env, { contents: [] });
    eq('retired Gemini model: falls back to the newest stable Flash', calls, ['models/gemini-2.5-flash:streamGenerateContent?alt=sse', 'models?pageSize=200', 'models/gemini-3.0-flash:streamGenerateContent?alt=sse']);
    eq('retired Gemini model: answer still returned', c.parts[0].text, 'ok');
  } finally { globalThis.fetch = real; }
}

// Question router and official scoring (evals/eval.ts)
{
  const { route, templateOf } = await import('../apps/shared/templates');
  const { score, splitOf } = await import('./eval');
  const det = (kind: string) => ({ kind, conf: 0.9, bbox: [0, 0, 1, 1] as [number, number, number, number] });
  const ev = { kind: 'image', detections: [det('door'), det('door'), det('window'), det('toilet')] };
  eq('router: English door template counts detector doors', route('How many doors are shown on this floor plan? Count doorways fitted with a door.', ev)?.answer, 2);
  eq('router: Finnish window template', route('Kuinka monta ikkunaa pohjapiirustuksessa on?', ev)?.answer, 1);
  eq('router: Finnish toilet template', route('Kuinka monta WC-istuinta pohjapiirustukseen on piirretty?', ev)?.answer, 1);
  eq('router: a class with no detections is zero, not unknown', route('How many showers and bathtubs are drawn on this floor plan in total?', ev)?.answer, 0);
  eq('router: no detector results (vector sheet) gives no answer', route('How many windows are shown on this floor plan?', { kind: 'pdf-vector', detections: null })?.answer, null);
  eq('router: other questions are left to the agent', templateOf('How many saunas are on this floor plan?'), null);
  eq('scoring: counts must be exact', [score({ type: 'count', answer: 5 }, 5), score({ type: 'count', answer: 5 }, 6), score({ type: 'count', answer: 5 }, null)], [true, false, false]);
  eq('scoring: areas within 2 %', [score({ type: 'area', answer: 100 }, 101.9), score({ type: 'area', answer: 100 }, 102.1)], [true, false]);
  eq('scoring: text answers are not scored', score({ type: 'text', answer: 'oak' }, null), null);
  eq('split: a drawing always lands on the same side', splitOf('data/cubicasa5k/colorful-10052.png'), splitOf('data/cubicasa5k/colorful-10052.png'));
}

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
