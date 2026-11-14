// Writes the marketing site's line drawings of the show apartment (furnished plan and isometric wireframe) to
// apps/web/partials/. The plan is apps/shared/apartment-plan.ts; rugs, side tables, plants and the like are drawn here
// only (they are not fixture kinds bimp reads from drawings).
// Run: npx esbuild scripts/site-drawings.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/bimp/sd.mjs && node node_modules/.cache/bimp/sd.mjs
import { writeFileSync } from 'node:fs';
import { apartmentPlan } from '../apps/shared/apartment-plan';
import { wallFootprints, clipHalf } from '../apps/shared/walls';
import { dist, wallPieces, area, type Pt, type Room } from '../apps/shared/plan';
import { roomDims } from '../apps/shared/rooms';

const p = apartmentPlan(), S = 50, M = 70; // px per metre, margin
const indoor = p.rooms.filter((r) => r.type !== 'outdoor'), terrace = p.rooms.filter((r) => r.type === 'outdoor');
const bw = Math.max(...indoor.flatMap((r) => r.polygon.map((q) => q[0]))), bh = Math.max(...indoor.flatMap((r) => r.polygon.map((q) => q[1])));
const f = (n: number) => Math.round(n * 10) / 10;
const X = (x: number) => f(M + x * S), Y = (y: number) => f(M + y * S);
const poly = (q: Pt[]) => 'M' + q.map(([x, y]) => `${X(x)},${Y(y)}`).join('L') + 'Z';
const W = M * 2 + p.width * S, H = M + p.height * S + 36;
const box = (r: Room) => ({ x0: r.polygon[0][0], y0: r.polygon[0][1], x1: r.polygon[2][0], y1: r.polygon[2][1] });

// each group of strokes is drawn in turn: floors, then walls, openings, furniture, dimensions
type El = { d: string; cls: string; tf?: string };
const floors: El[] = [], rugs: El[] = [], furn: El[] = [], wallEls: El[] = [], openEls: El[] = [], dims: El[] = [];

// floor finishes: boards in dry rooms, tiles in wet rooms and the kitchen, decking outside. One path per room.
for (const r of p.rooms) {
  const { x0, y0, x1, y1 } = box(r), t = r.type;
  let d = '';
  const hl = (step: number) => { for (let y = y0 + step; y < y1 - 0.01; y += step) d += `M${X(x0)},${Y(y)}H${X(x1)}`; };
  const vl = (step: number) => { for (let x = x0 + step; x < x1 - 0.01; x += step) d += `M${X(x)},${Y(y0)}V${Y(y1)}`; };
  if (t === 'bathroom' || t === 'wc') { hl(0.3); vl(0.3); }
  else if (t === 'kitchen' || t === 'storage') { hl(0.6); vl(0.6); }
  else if (t === 'outdoor') vl(0.2);
  else if (r.name === 'Entrance' || r.name === 'Hall') { hl(0.6); vl(0.6); }
  else hl(0.25);
  floors.push({ d, cls: 'g' });
}

// furniture and fittings, drawn in each item's own frame: x along its back, back at -d/2, front at +d/2 (metres × S)
const n = (v: number) => f(v * S);
const R = (x: number, y: number, w: number, h: number) => `M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
const RR = (x: number, y: number, w: number, h: number, r: number) => `M${n(x + r)},${n(y)}h${n(w - 2 * r)}a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(r)}v${n(h - 2 * r)}a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(r)}h${n(-(w - 2 * r))}a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(-r)}v${n(-(h - 2 * r))}a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(-r)}Z`;
const E = (cx: number, cy: number, rx: number, ry = rx) => `M${n(cx - rx)},${n(cy)}a${n(rx)},${n(ry)} 0 1 0 ${n(2 * rx)},0a${n(rx)},${n(ry)} 0 1 0 ${n(-2 * rx)},0Z`;
const L = (x1: number, y1: number, x2: number, y2: number) => `M${n(x1)},${n(y1)}L${n(x2)},${n(y2)}`;
/** [filled outline, thin detail] for an item w wide and d deep. */
function shape(k: string, w: number, d: number): [string, string] {
  const x0 = -w / 2, y0 = -d / 2, base = R(x0, y0, w, d);
  switch (k) {
    case 'wc': { const c = Math.min(0.2, d * 0.3); return [RR(x0, y0, w, c, 0.02) + E(0, y0 + c + (d - c) / 2, w * 0.4, (d - c) / 2), '']; }
    case 'sink': return [base, RR(x0 + w * 0.15, y0 + d * 0.25, w * 0.7, d * 0.6, Math.min(w, d) * 0.15) + E(0, y0 + d * 0.13, 0.025)];
    case 'bathtub': return [base, RR(x0 + 0.06, y0 + 0.06, w - 0.12, d - 0.12, 0.15) + E(x0 + 0.22, 0, 0.03)];
    case 'shower': return [base, L(x0, y0, -x0, -y0) + L(-x0, y0, x0, -y0) + E(0, 0, 0.04)];
    case 'stove': { const r = Math.min(w, d) * 0.15; return [base, [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => E((a * w) / 4, (b * d) / 4, r)).join('')]; }
    case 'fridge': return [base, L(x0, -y0 - 0.06, -x0, -y0 - 0.06) + L(x0, y0, -x0, -y0)];
    case 'washer': return [base, E(0, 0.03, Math.min(w, d) * 0.32) + E(0, 0.03, Math.min(w, d) * 0.2)];
    case 'bed': {
      const c = w > 1.2 ? 2 : 1, pw = (w - 0.1 * (c + 1)) / c, by = y0 + d * 0.3, fo = Math.min(0.35, w * 0.3);
      return [base, Array.from({ length: c }, (_, i) => RR(x0 + 0.1 + i * (pw + 0.1), y0 + 0.07, pw, 0.28, 0.06)).join('') + `M${n(x0)},${n(by)}H${n(-x0 - fo)}L${n(-x0)},${n(by + fo)}M${n(-x0 - fo)},${n(by)}V${n(by + fo)}H${n(-x0)}`];
    }
    case 'sofa': {
      const b = Math.min(0.22, d * 0.3), a = Math.min(0.2, w * 0.15), c = Math.max(1, Math.round((w - 2 * a) / 0.65)), cw = (w - 2 * a) / c;
      return [base, R(x0 + a, y0, w - 2 * a, b) + R(x0, y0, a, d) + R(-x0 - a, y0, a, d) + Array.from({ length: c - 1 }, (_, i) => L(x0 + a + cw * (i + 1), y0 + b, x0 + a + cw * (i + 1), -y0)).join('')];
    }
    case 'armchair': return [RR(x0, y0, w, d, 0.08), R(x0 + 0.14, y0, w - 0.28, 0.18) + L(x0 + 0.14, y0, x0 + 0.14, -y0) + L(-x0 - 0.14, y0, -x0 - 0.14, -y0)];
    case 'table': { // chairs tucked under both long sides, and at the ends of a long table
      const c = 0.42, k2 = Math.max(1, Math.floor(w / 0.6)), ends = w >= 1.4 && d >= 0.7;
      const chairs = Array.from({ length: k2 }, (_, i) => x0 + (w / k2) * (i + 0.5)).map((cx) => RR(cx - c / 2, y0 - c + 0.08, c, c, 0.05) + RR(cx - c / 2, -y0 - 0.08, c, c, 0.05)).join('')
        + (ends ? RR(x0 - c + 0.08, -c / 2, c, c, 0.05) + RR(-x0 - 0.08, -c / 2, c, c, 0.05) : '');
      return [chairs + base, ''];
    }
    case 'desk': return [RR(-0.21, -y0 + 0.02, 0.42, 0.42, 0.05) + base, R(x0 + 0.1, y0 + 0.08, 0.5, 0.32)];
    case 'wardrobe': return [base, L(0, y0, 0, -y0) + L(x0 + 0.05, 0, -x0 - 0.05, 0)];
    case 'lowtable': return [RR(x0, y0, w, d, 0.04), R(x0 + 0.08, y0 + 0.08, w - 0.16, d - 0.16)];
    case 'bedside': return [base, E(0, 0, Math.min(w, d) * 0.28)];
    case 'shelf': { const c = Math.max(2, Math.round(w / 0.45)); return [base, Array.from({ length: c - 1 }, (_, i) => L(x0 + (w / c) * (i + 1), y0, x0 + (w / c) * (i + 1), -y0)).join('')]; }
    case 'counter': return [base, ''];
    case 'plant': { const r = w / 2; return [E(0, 0, r), E(0, 0, r * 0.45) + [0, 1, 2, 3, 4, 5].map((i) => L(0, 0, Math.cos(i * 1.047) * r * 0.9, Math.sin(i * 1.047) * r * 0.9)).join('')]; }
    case 'rug': return ['', R(x0, y0, w, d) + R(x0 + 0.1, y0 + 0.1, w - 0.2, d - 0.2)];
  }
  return [base, ''];
}
const place = (k: string, x: number, y: number, w: number, d: number, deg: number, into = furn) => {
  const [a, b] = shape(k, w, d), tf = `translate(${X(x)} ${Y(y)}) rotate(${f(deg)})`;
  if (a) into.push({ d: a, cls: 'f', tf });
  if (b) into.push({ d: b, cls: 'ft', tf });
};
// drawn here only: [kind, centre x, centre y, width, depth, quarter turns]
const decor: [string, number, number, number, number, number][] = [
  ['rug', 2.3, 6.6, 3.0, 2.3, 0], ['rug', 1.6, 2.9, 2.8, 2.2, 0], ['rug', 10.9, 7.6, 3.0, 2.2, 1], ['rug', 6.3, 3.55, 3.0, 0.8, 0], ['rug', 9.8, 1.75, 3.0, 2.1, 1], ['rug', 5.35, 1.0, 0.9, 0.5, 0],
  ['counter', 8.74, 7.38, 4.34, 0.6, 1],
  ['lowtable', 2.3, 6.5, 1.1, 0.6, 0], ['armchair', 3.95, 6.9, 0.85, 0.85, 1], ['shelf', 5.365, 7.5, 2.2, 0.35, 1], ['plant', 0.55, 9.15, 0.6, 0.6, 0], ['plant', 5.2, 5.85, 0.5, 0.5, 0],
  ['bedside', 0.5, 4.22, 0.45, 0.4, 2], ['bedside', 2.7, 4.22, 0.45, 0.4, 2], ['bedside', 9.4, 6.4, 0.45, 0.45, 3], ['bedside', 9.4, 8.8, 0.45, 0.45, 3],
  ['shelf', 10.94, 1.4, 1.6, 0.4, 1], ['plant', 8.82, 0.5, 0.5, 0.5, 0], ['shelf', 11.41, 1.55, 1.2, 0.3, 3],
  ['armchair', 15.0, 4.25, 0.8, 0.8, 2], ['armchair', 16.1, 4.25, 0.8, 0.8, 2], ['plant', 13.75, 0.55, 0.6, 0.6, 0], ['plant', 16.5, 0.55, 0.5, 0.5, 0],
];
for (const [k, x, y, w, d, q] of decor) place(k, x, y, w, d, q * 90, k === 'rug' ? rugs : furn);
for (const fx of p.fixtures ?? []) place(fx.kind, fx.center[0], fx.center[1], fx.size[0], fx.size[1], (fx.angle * 180) / Math.PI);

// walls, with openings cut out
for (const fp of wallFootprints(p.walls)) {
  const w = fp.wall, len = dist(w.a, w.b), { dir, pieces } = wallPieces(w, p.openings, 2.7);
  for (const r of pieces.filter((r) => r.z0 === 0 && r.z1 > 2)) {
    let q = fp.poly;
    if (r.s > 1e-6) q = clipHalf(q, w.a, dir, r.s, 1);
    if (r.e < len - 1e-6) q = clipHalf(q, w.a, dir, r.e, -1);
    if (q.length >= 3) wallEls.push({ d: poly(q), cls: w.thickness > 0.2 ? 'w ext' : 'w' });
  }
}
// openings: door leaf and swing; window as a frame through the wall with the glass line
for (const o of p.openings) {
  const len = dist(o.a, o.b), u = [(o.b[0] - o.a[0]) / len, (o.b[1] - o.a[1]) / len], sw = o.swing ?? 1, nn = [-u[1] * sw, u[0] * sw];
  if (o.kind === 'door') {
    const tip: Pt = [o.a[0] + nn[0] * len, o.a[1] + nn[1] * len];
    openEls.push({ d: `M${X(o.a[0])},${Y(o.a[1])}L${X(tip[0])},${Y(tip[1])}`, cls: 'o' });
    openEls.push({ d: `M${X(o.b[0])},${Y(o.b[1])}A${f(len * S)},${f(len * S)} 0 0 ${sw === 1 ? 1 : 0} ${X(tip[0])},${Y(tip[1])}`, cls: 'sw' });
  } else {
    const k = 0.15, c = (s: number, t: number): Pt => [o.a[0] + u[0] * t + u[1] * s, o.a[1] + u[1] * t - u[0] * s];
    openEls.push({ d: poly([c(k, 0), c(k, len), c(-k, len), c(-k, 0)]), cls: 'o win' });
    openEls.push({ d: `M${X(c(0, 0)[0])},${Y(c(0, 0)[1])}L${X(c(0, len)[0])},${Y(c(0, len)[1])}`, cls: 'o' });
  }
}
// the terrace edge: a slab line and a rail just inside it
for (const r of terrace) {
  const { x0, y0, x1, y1 } = box(r), e = 0.1;
  openEls.push({ d: `M${X(x0)},${Y(y0)}H${X(x1)}V${Y(y1)}H${X(x0)}`, cls: 'o' });
  openEls.push({ d: `M${X(x0 + 0.15)},${Y(y0 + e)}H${X(x1 - e)}V${Y(y1 - e)}H${X(x0 + 0.15)}`, cls: 'sw' });
}
// dimensions: overall over the outer faces of the house, top and left
const texts: string[] = [];
const dim = (x1: number, y1: number, x2: number, y2: number, t: string, vert = false) => {
  dims.push({ d: `M${x1},${y1}L${x2},${y2}M${x1 - 5},${y1 + 5}L${x1 + 5},${y1 - 5}M${x2 - 5},${y2 + 5}L${x2 + 5},${y2 - 5}`, cls: 'd' });
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  texts.push(`<text class="dt" x="${vert ? mx - 8 : mx}" y="${vert ? my : my - 8}" ${vert ? `transform="rotate(-90 ${mx - 8} ${my})"` : ''} text-anchor="middle">${t}</text>`);
};
const mm = (v: number) => String(Math.round(v * 1000)).replace(/(\d)(?=(\d{3})+$)/g, '$1 ');
dim(X(-0.15), Y(-0.15) - 34, X(bw + 0.15), Y(-0.15) - 34, mm(bw + 0.3));
dim(X(-0.15) - 34, Y(-0.15), X(-0.15) - 34, Y(bh + 0.15), mm(bh + 0.3), true);

// room labels with net areas, placed clear of the furniture
const at: Record<string, Pt> = { 'Bedroom 1': [1.9, 1.55], Bathroom: [7.6, 1.5], Hall: [7.35, 2.7], Dining: [9.8, 3.75], 'Living room': [3.3, 8.45], Kitchen: [7.35, 5.75], 'Bedroom 2': [12.0, 6.15], Terrace: [15.2, 3.1] };
const labels = p.rooms.filter((r) => at[r.name]).map((r) => {
  const [x, y] = at[r.name];
  return `<text class="rl" x="${X(x)}" y="${Y(y)}" text-anchor="middle">${r.name}</text><text class="ra" x="${X(x)}" y="${f(Y(y) + 14)}" text-anchor="middle">${area(r.polygon).toFixed(1)} m²</text>`;
});

// stroke order for the drafting animation, spread over a fixed span however many strokes there are
const seq = [...wallEls, ...openEls, ...rugs, ...furn, ...dims];
const order = new Map(seq.map((e, i) => [e, Math.round((i / seq.length) * 150)]));
const path = (e: El, i: number) => `<path class="${e.cls}" d="${e.d}" pathLength="1" style="--i:${i}"${e.tf ? ` transform="${e.tf}"` : ''}/>`;
// room hit areas: hovering or focusing one reports its name, net area and clear size in the plate's title block
const hits = p.rooms.map((r) => { const a = area(r.polygon), s = roomDims(r.polygon); return `<path class="room" tabindex="0" role="button" aria-label="${r.name}, ${a.toFixed(1)} square metres" data-name="${r.name}" data-area="${a.toFixed(1)} m²" data-size="${s.length.toFixed(2)} × ${s.width.toFixed(2)} m" d="${poly(r.polygon)}"/>`; });
const net = indoor.reduce((s, r) => s + area(r.polygon), 0);
const plan = `<svg class="drawing plan-drawing" viewBox="0 0 ${f(W)} ${f(H)}" role="img" aria-label="Furnished floor plan of a two-bedroom apartment with a terrace, drawn line by line: walls, doors with their swings, windows, furniture and overall dimensions of ${f(bw + 0.3)} by ${f(bh + 0.3)} metres.">
<g class="grid" aria-hidden="true">${floors.map((e, i) => path(e, i)).join('')}</g>
<g class="lines" aria-hidden="true">${[...rugs, ...furn, ...wallEls, ...openEls, ...dims].map((e) => path(e, order.get(e)!)).join('')}${texts.join('')}</g>
<g class="labels" aria-hidden="true">${labels.join('')}</g>
<g class="rooms">${hits.join('')}</g>
</svg>`;
writeFileSync('apps/web/partials/plan-drawing.html', plan + '\n');

// isometric wireframe of the house: floor outlines, then wall verticals, then wall tops, then a roof outline
const iso = (x: number, y: number, z: number): [number, number] => {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6), k = 34;
  return [f((x - y) * c * k), f(((x + y) * s - z) * k)];
};
const seg = (a: [number, number, number], b: [number, number, number]) => { const [x1, y1] = iso(...a), [x2, y2] = iso(...b); return `M${x1},${y1}L${x2},${y2}`; };
const layers: Record<string, string[]> = { floor: [], up: [], top: [], roof: [] };
for (const r of p.rooms) layers.floor.push(r.polygon.map((q, j) => seg([q[0], q[1], 0], [r.polygon[(j + 1) % r.polygon.length][0], r.polygon[(j + 1) % r.polygon.length][1], 0])).join(''));
const corners = new Map<string, Pt>();
for (const r of indoor) for (const q of r.polygon) corners.set(q.join(','), q);
const HT = 2.7;
for (const q of corners.values()) layers.up.push(seg([q[0], q[1], 0], [q[0], q[1], HT]));
for (const w of p.walls) layers.top.push(seg([w.a[0], w.a[1], HT], [w.b[0], w.b[1], HT]));
const RH = 1.6, ridgeY = bh / 2; // a simple gabled roof along x
const e: [number, number, number][] = [[0, 0, HT], [bw, 0, HT], [bw, bh, HT], [0, bh, HT]];
layers.roof.push(seg([0, ridgeY, HT + RH], [bw, ridgeY, HT + RH]), seg(e[0], [0, ridgeY, HT + RH]), seg(e[3], [0, ridgeY, HT + RH]), seg(e[1], [bw, ridgeY, HT + RH]), seg(e[2], [bw, ridgeY, HT + RH]));
for (let x = 1.2; x < bw; x += 1.2) layers.roof.push(seg([x, 0, HT], [x, ridgeY, HT + RH]), seg([x, bh, HT], [x, ridgeY, HT + RH]));
const all = Object.values(layers).flat().join('').match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g)!.map((v) => v.split(',').map(Number));
const minX = Math.min(...all.map((v) => v[0])) - 20, maxX = Math.max(...all.map((v) => v[0])) + 20, minY = Math.min(...all.map((v) => v[1])) - 20, maxY = Math.max(...all.map((v) => v[1])) + 20;
let c = 0;
const wire = `<svg class="drawing wire-drawing" viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" role="img" aria-label="Isometric wireframe of the apartment assembling: floor outlines, wall edges, wall heads, then the roof.">
${Object.entries(layers).map(([k, ds]) => `<g class="layer ${k}" aria-hidden="true">${ds.map((d) => `<path d="${d}" pathLength="1" style="--i:${c++ % 40}"/>`).join('')}</g>`).join('\n')}
</svg>`;
writeFileSync('apps/web/partials/wire-drawing.html', wire + '\n');
console.log('ok', plan.length, wire.length, 'net', net.toFixed(1), 'terrace', terrace.map((r) => area(r.polygon).toFixed(1)).join());
