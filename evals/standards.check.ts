// Run: npm test. Checks the drawing-convention and standards logic (Metric Handbook rules) on known cases.
import { parseDimension, nearestPreferredScale, checkPlan } from '../apps/shared/standards';
import { regularize, snapPolygon } from '../apps/api/src/extract';
import { samplePlan } from '../apps/shared/sample-plan';
import { area, type Plan } from '../apps/shared/plan';

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

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
