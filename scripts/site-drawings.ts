// Writes the marketing site's line drawings of the pilot house (plan and isometric wireframe) to apps/web/partials/.
// Run: npx esbuild scripts/site-drawings.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/bimp/sd.mjs && node node_modules/.cache/bimp/sd.mjs
import { writeFileSync } from 'node:fs';
import { samplePlan } from '../apps/shared/sample-plan';
import { wallFootprints, labelPoint } from '../apps/shared/walls';
import { dist, wallPieces, type Pt } from '../apps/shared/plan';
import { clipHalf } from '../apps/shared/walls';

const p = samplePlan(), S = 50, M = 70; // px per metre, margin
const f = (n: number) => Math.round(n * 10) / 10;
const X = (x: number) => f(M + x * S), Y = (y: number) => f(M + y * S);
const poly = (q: Pt[]) => 'M' + q.map(([x, y]) => `${X(x)},${Y(y)}`).join('L') + 'Z';
let i = 0;
const el = (d: string, cls: string) => `<path class="${cls}" d="${d}" pathLength="1" style="--i:${i++}"/>`;
const out: string[] = [];
// grid
const W = M * 2 + p.width * S, H = M * 2 + p.height * S;
for (let x = 0; x <= p.width + 0.01; x += 1.2) out.push(`<path class="g" d="M${X(x)},${f(M - 30)}V${f(H - M + 30)}" pathLength="1" style="--i:${i++ % 12}"/>`);
for (let y = 0; y <= p.height + 0.01; y += 1.2) out.push(`<path class="g" d="M${f(M - 30)},${Y(y)}H${f(W - M + 30)}" pathLength="1" style="--i:${i++ % 12}"/>`);
i = 0;
// walls, with openings cut out
const fps = wallFootprints(p.walls);
for (const fp of fps) {
  const w = fp.wall, len = dist(w.a, w.b), { dir, pieces } = wallPieces(w, p.openings, 2.7);
  for (const r of pieces.filter((r) => r.z0 === 0 && r.z1 > 2)) {
    let q = fp.poly;
    if (r.s > 1e-6) q = clipHalf(q, w.a, dir, r.s, 1);
    if (r.e < len - 1e-6) q = clipHalf(q, w.a, dir, r.e, -1);
    if (q.length >= 3) out.push(el(poly(q), w.thickness > 0.2 ? 'w ext' : 'w'));
  }
}
// openings
for (const o of p.openings) {
  const L = dist(o.a, o.b), u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], sw = o.swing ?? 1, n = [-u[1] * sw, u[0] * sw];
  if (o.kind === 'door') {
    const tip: Pt = [o.a[0] + n[0] * L, o.a[1] + n[1] * L];
    out.push(el(`M${X(o.a[0])},${Y(o.a[1])}L${X(tip[0])},${Y(tip[1])}`, 'o'));
    out.push(el(`M${X(o.b[0])},${Y(o.b[1])}A${f(L * S)},${f(L * S)} 0 0 ${sw === 1 ? 1 : 0} ${X(tip[0])},${Y(tip[1])}`, 'sw'));
  } else {
    const k = 0.05, a1: Pt = [o.a[0] + u[1] * k, o.a[1] - u[0] * k], b1: Pt = [o.b[0] + u[1] * k, o.b[1] - u[0] * k], a2: Pt = [o.a[0] - u[1] * k, o.a[1] + u[0] * k], b2: Pt = [o.b[0] - u[1] * k, o.b[1] + u[0] * k];
    out.push(el(`M${X(a1[0])},${Y(a1[1])}L${X(b1[0])},${Y(b1[1])}M${X(a2[0])},${Y(a2[1])}L${X(b2[0])},${Y(b2[1])}`, 'o'));
  }
}
// dimensions: overall, top and left
const dim = (x1: number, y1: number, x2: number, y2: number, t: string, vert = false) => {
  out.push(el(`M${x1},${y1}L${x2},${y2}M${x1 - 5},${y1 + 5}L${x1 + 5},${y1 - 5}M${x2 - 5},${y2 + 5}L${x2 + 5},${y2 - 5}`, 'd'));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  out.push(`<text class="dt" x="${vert ? mx - 8 : mx}" y="${vert ? my : my - 8}" ${vert ? `transform="rotate(-90 ${mx - 8} ${my})"` : ''} text-anchor="middle">${t}</text>`);
};
dim(X(-0.15), Y(-0.15) - 34, X(p.width + 0.15), Y(-0.15) - 34, '14 700');
dim(X(-0.15) - 34, Y(-0.15), X(-0.15) - 34, Y(p.height + 0.15), '10 500', true);
// room labels
const labels = p.rooms.filter((r) => !/Linen|wardrobe|WC|Utility/.test(r.name)).map((r) => { const [x, y] = labelPoint(r.polygon); return `<text class="rl" x="${X(x)}" y="${Y(y)}" text-anchor="middle">${r.name}</text>`; });
const plan = `<svg class="drawing plan-drawing" viewBox="0 0 ${f(W)} ${f(H)}" role="img" aria-label="Floor plan of the pilot house, drawn line by line: walls, doors with their swings, windows and overall dimensions of 14.7 by 10.5 metres.">
<g class="grid" aria-hidden="true">${out.filter((s) => s.includes('class="g"')).join('')}</g>
<g class="lines" aria-hidden="true">${out.filter((s) => !s.includes('class="g"')).join('')}</g>
<g class="labels" aria-hidden="true">${labels.join('')}</g>
</svg>`;
writeFileSync('apps/web/partials/plan-drawing.html', plan + '\n');

// isometric wireframe: floor outlines, then wall verticals, then wall tops, then a roof outline
const iso = (x: number, y: number, z: number): [number, number] => {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6), k = 34;
  return [f((x - y) * c * k), f(((x + y) * s - z) * k)];
};
const seg = (a: [number, number, number], b: [number, number, number]) => { const [x1, y1] = iso(...a), [x2, y2] = iso(...b); return `M${x1},${y1}L${x2},${y2}`; };
const layers: Record<string, string[]> = { floor: [], up: [], top: [], roof: [] };
for (const r of p.rooms) layers.floor.push(r.polygon.map((q, j) => seg([q[0], q[1], 0], [r.polygon[(j + 1) % r.polygon.length][0], r.polygon[(j + 1) % r.polygon.length][1], 0])).join(''));
const corners = new Map<string, Pt>();
for (const r of p.rooms) for (const q of r.polygon) corners.set(q.join(','), q);
const HT = 2.7;
for (const q of corners.values()) layers.up.push(seg([q[0], q[1], 0], [q[0], q[1], HT]));
for (const w of p.walls) layers.top.push(seg([w.a[0], w.a[1], HT], [w.b[0], w.b[1], HT]));
const R = 1.6, ridgeY = p.height / 2; // a simple gabled roof along x
const e: [number, number, number][] = [[0, 0, HT], [p.width, 0, HT], [p.width, p.height, HT], [0, p.height, HT]];
layers.roof.push(seg([0, ridgeY, HT + R], [p.width, ridgeY, HT + R]), seg(e[0], [0, ridgeY, HT + R]), seg(e[3], [0, ridgeY, HT + R]), seg(e[1], [p.width, ridgeY, HT + R]), seg(e[2], [p.width, ridgeY, HT + R]));
for (let x = 1.2; x < p.width; x += 1.2) layers.roof.push(seg([x, 0, HT], [x, ridgeY, HT + R]), seg([x, p.height, HT], [x, ridgeY, HT + R]));
const all = Object.values(layers).flat().join('').match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g)!.map((v) => v.split(',').map(Number));
const minX = Math.min(...all.map((v) => v[0])) - 20, maxX = Math.max(...all.map((v) => v[0])) + 20, minY = Math.min(...all.map((v) => v[1])) - 20, maxY = Math.max(...all.map((v) => v[1])) + 20;
let n = 0;
const wire = `<svg class="drawing wire-drawing" viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" role="img" aria-label="Isometric wireframe of the pilot house assembling: floor outlines, wall edges, wall heads, then the roof.">
${Object.entries(layers).map(([k, ds]) => `<g class="layer ${k}" aria-hidden="true">${ds.map((d) => `<path d="${d}" pathLength="1" style="--i:${n++ % 40}"/>`).join('')}</g>`).join('\n')}
</svg>`;
writeFileSync('apps/web/partials/wire-drawing.html', wire + '\n');
console.log('ok', plan.length, wire.length);
