// Run: npm test. Checks the drawing-convention and standards logic (Metric Handbook rules) on known cases.
import { parseDimension, nearestPreferredScale, checkPlan } from '../apps/shared/standards';
import { regularize, snapPolygon } from '../apps/api/src/extract';
import { samplePlan } from '../apps/shared/sample-plan';
import { area, wallsFromFaces, type Plan } from '../apps/shared/plan';
import { escapeRoutes } from '../apps/shared/escape';
import { escapeWidth } from '../apps/shared/standards';

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
near('sample area unchanged', area(big.rooms[0].polygon), 32.5);

// Ch. 41 escape routes on the sample house: one exit (hall door), living room's far corner via the hall door
const esc = escapeRoutes(samplePlan())!;
eq('one exit door', esc.exits, ['d1']);
eq('every room reachable', esc.unreachable, []);
near('living room worst distance ≈ 7.92 + 5.5 m', esc.routes.find((r) => r.room_id === 'r1')!.distance_m, 13.42, 0.02);
eq('sample flags > 9 m travel (info)', checkPlan(samplePlan()).some((c) => /9 m/.test(c.text) && c.level === 'info'), true);
// Ch. 41 Table XIV
eq('escape width 100 people', escapeWidth(100).min_width_mm, 850);
eq('escape width 300 people', escapeWidth(300).min_width_mm, 1500);
// Ch. 37 walls from inside faces: a 200 mm gap between two rooms becomes one 200 mm wall on its centreline
const fw = wallsFromFaces([
  { id: 'a', name: 'A', type: 'other', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
  { id: 'b', name: 'B', type: 'other', polygon: [[4.2, 0], [8, 0], [8, 3], [4.2, 3]] },
]);
const party = fw.filter((w) => Math.abs(w.a[0] - 4.1) < 1e-9 && Math.abs(w.b[0] - 4.1) < 1e-9);
eq('shared wall: one wall at x = 4.1', party.length, 1);
eq('shared wall thickness 0.2', party[0]?.thickness, 0.2);
eq('outer walls outside the rooms (net areas kept)', fw.filter((w) => w.thickness === 0.3).every((w) => w.a[0] <= 0 || w.a[0] >= 8 || w.a[1] <= 0 || w.a[1] >= 3), true);
// Ch. 31 garage
const gar: Plan = { ...samplePlan(), openings: [], rooms: [{ id: 'g', name: 'Garage', type: 'garage', polygon: [[0, 0], [2.2, 0], [2.2, 4.5], [0, 4.5]] }] };
eq('2.2 × 4.5 m garage flagged (Fig. 31.30)', checkPlan(gar).some((c) => c.room_id === 'g' && c.level === 'warn'), true);

// Fixtures: the sample WC sits against the bathroom's east wall (x = 6.5), so its front faces west (-x)
const wc = samplePlan().fixtures!.find((f) => f.kind === 'wc')!;
near('WC faces away from its wall (+90°)', wc.angle, Math.PI / 2, 1e-3);
eq('WC is in the bathroom', wc.room_id, 'r5');
eq('every sample fixture is inside a room', samplePlan().fixtures!.every((f) => f.room_id), true);

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
