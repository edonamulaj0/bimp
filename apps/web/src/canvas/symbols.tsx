// Plan-view symbols for fittings and furniture at real size, drawn in the fixture's local frame:
// origin at its centre, x along the wall it backs onto, back (wall side) at -d/2, front at +d/2.
// Thin lines (0.25 mm), lighter than walls and doors so they don't compete with the structure.
import { type Fixture, fixtureName } from '../../../shared/plan';
import { W, ln } from './weights';

const S = { fill: 'var(--sheet)', ...ln(W.fixture) } as const;
const T = { fill: 'none', ...ln(W.thin) } as const;
const HIDDEN = { fill: 'none', ...ln(W.thin, '4 3') } as const; // above the cut: rods, upper cabinets

/** Bed size letter from its width (UK/EU mattresses): K ≥ 1.8, Q ≥ 1.5, F (double) ≥ 1.35, else T (single). */
const bedSize = (w: number) => (w >= 1.75 ? 'K' : w >= 1.48 ? 'Q' : w >= 1.3 ? 'F' : 'T');

function Shape({ k, w, d }: { k: Fixture['kind']; w: number; d: number }) {
  const x0 = -w / 2, y0 = -d / 2;
  const rect = <rect x={x0} y={y0} width={w} height={d} {...S} />;
  switch (k) {
    case 'wc': { // tank rectangle against the wall, oval bowl in front
      const c = Math.min(0.2, d * 0.3);
      return <><rect x={x0} y={y0} width={w} height={c} rx={0.02} {...S} /><ellipse cx={0} cy={y0 + c + (d - c) / 2} rx={w * 0.4} ry={(d - c) / 2} {...S} /></>;
    }
    case 'sink':
      return <>{rect}<rect x={x0 + w * 0.15} y={y0 + d * 0.25} width={w * 0.7} height={d * 0.6} rx={Math.min(w, d) * 0.15} {...T} /><circle cx={0} cy={y0 + d * 0.13} r={0.025} {...T} />
        <line x1={x0} y1={y0 + 0.35} x2={-x0} y2={y0 + 0.35} {...HIDDEN} /></>;
    case 'bathtub':
      return <>{rect}<rect x={x0 + 0.06} y={y0 + 0.06} width={w - 0.12} height={d - 0.12} rx={0.15} {...T} /><circle cx={x0 + 0.2} cy={0} r={0.03} {...T} /></>;
    case 'shower':
      return <>{rect}<path d={`M${x0},${y0}L${-x0},${-y0}M${-x0},${y0}L${x0},${-y0}`} {...T} /><circle cx={0} cy={0} r={0.04} {...T} /></>;
    case 'sauna_stove':
      return <>{rect}<path d={`M${x0},${y0}L${-x0},${-y0}M${-x0},${y0}L${x0},${-y0}`} {...T} /><rect x={x0 + 0.05} y={y0 + 0.05} width={w - 0.1} height={d - 0.1} {...T} /></>;
    case 'stove': { // counter with a four-ring cooktop; wall cabinets above shown dashed
      // a kitchen run read as one cooker keeps its worktop; the hob on it is the size of a hob, not stretched along it
      const hob = Math.min(w, 0.65), r = Math.min(hob, d) * 0.15;
      return <>{rect}{[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => <circle key={`${a}${b}`} cx={(a * hob) / 4} cy={(b * d) / 4} r={r} {...T} />)}
        <line x1={x0} y1={y0 + 0.35} x2={-x0} y2={y0 + 0.35} {...HIDDEN} /></>;
    }
    case 'fridge':
      return <>{rect}<line x1={x0} y1={-y0 - 0.06} x2={-x0} y2={-y0 - 0.06} {...T} /><text x={0} y={0.05} font-size={Math.min(w, d) * 0.35} text-anchor="middle" fill="var(--wall)">F</text></>;
    case 'washer':
      return <>{rect}<circle cx={0} cy={0.03} r={Math.min(w, d) * 0.32} {...T} /></>;
    case 'bed': { // pillows at the head, blanket line with a folded corner, size letter
      const n = w > 1.2 ? 2 : 1, pw = (w - 0.1 * (n + 1)) / n, by = y0 + d * 0.3, f = Math.min(0.35, w * 0.3);
      return <>{rect}{Array.from({ length: n }, (_, i) => <rect key={i} x={x0 + 0.1 + i * (pw + 0.1)} y={y0 + 0.07} width={pw} height={0.28} rx={0.06} {...T} />)}
        <path d={`M${x0},${by}H${-x0 - f}L${-x0},${by + f}`} {...T} /><path d={`M${-x0 - f},${by}L${-x0 - f},${by + f}H${-x0}`} {...T} />
        <text x={0} y={y0 + d * 0.68} font-size={Math.min(0.28, w * 0.18)} text-anchor="middle" fill="var(--wall)" opacity={0.7}>{bedSize(w)}</text></>;
    }
    case 'sofa': { // seat with back and armrests as bands, cushion divisions
      const b = Math.min(0.22, d * 0.3), a = Math.min(0.2, w * 0.15), n = Math.max(1, Math.round((w - 2 * a) / 0.65)), cw = (w - 2 * a) / n;
      return <>{rect}<rect x={x0 + a} y={y0} width={w - 2 * a} height={b} {...T} /><rect x={x0} y={y0} width={a} height={d} {...T} /><rect x={-x0 - a} y={y0} width={a} height={d} {...T} />
        {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={x0 + a + cw * (i + 1)} y1={y0 + b} x2={x0 + a + cw * (i + 1)} y2={-y0} {...T} />)}</>;
    }
    case 'table': { // table with a small square per chair on both long sides, and at the ends of a long table
      const c = 0.42, n = Math.max(1, Math.floor(w / 0.6)), ends = w >= 1.4 && d >= 0.7;
      return <>{Array.from({ length: n }, (_, i) => x0 + (w / n) * (i + 0.5)).flatMap((cx, i) => [
        <rect key={`a${i}`} x={cx - c / 2} y={y0 - c + 0.06} width={c} height={c} {...T} />,
        <rect key={`b${i}`} x={cx - c / 2} y={-y0 - 0.06} width={c} height={c} {...T} />])}
        {ends && [x0 - c + 0.06, -x0 - 0.06].map((x) => <rect key={x} x={x} y={-c / 2} width={c} height={c} {...T} />)}{rect}</>;
    }
    case 'desk':
      return <><rect x={-0.21} y={-y0 + 0.04} width={0.42} height={0.42} {...T} />{rect}</>;
    case 'wardrobe': // centre line between the doors, hanging rod dashed
      return <>{rect}<line x1={0} y1={y0} x2={0} y2={-y0} {...T} /><line x1={x0 + 0.05} y1={0} x2={-x0 - 0.05} y2={0} {...HIDDEN} /></>;
    case 'bidet': case 'urinal': { // a short fixing against the wall and a bowl in front
      const c = Math.min(0.12, d * 0.25);
      return <><rect x={x0 + w * 0.15} y={y0} width={w * 0.7} height={c} {...S} /><ellipse cx={0} cy={y0 + c + (d - c) / 2} rx={w * (k === 'urinal' ? 0.32 : 0.42)} ry={(d - c) / 2} {...S} />
        {k === 'bidet' && <circle cx={0} cy={y0 + c + 0.05} r={0.02} {...T} />}</>;
    }
    case 'dryer':
      return <>{rect}<circle cx={0} cy={0.03} r={Math.min(w, d) * 0.32} {...T} /><circle cx={0} cy={0.03} r={Math.min(w, d) * 0.12} {...T} /></>;
    case 'dishwasher': case 'oven': case 'water_heater': { // an appliance box with its letter code, as on drawings
      const code = k === 'dishwasher' ? 'DW' : k === 'oven' ? 'OV' : 'WH';
      return <>{k === 'water_heater' ? <circle cx={0} cy={0} r={Math.min(w, d) / 2} {...S} /> : rect}{k === 'oven' && <rect x={x0 + 0.06} y={y0 + 0.06} width={w - 0.12} height={d - 0.12} {...T} />}
        <text x={0} y={Math.min(w, d) * 0.1} font-size={Math.min(w, d) * 0.3} text-anchor="middle" fill="var(--wall)">{code}</text></>;
    }
    case 'radiator': { // ribs
      const n = Math.max(3, Math.round(w / 0.08));
      return <>{rect}{Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={x0 + (w / n) * (i + 1)} y1={y0} x2={x0 + (w / n) * (i + 1)} y2={-y0} {...T} />)}</>;
    }
    case 'fireplace': // the surround with the firebox opening to the front
      return <>{rect}<path d={`M${x0 + w * 0.2},${-y0}V${y0 + d * 0.35}H${-x0 - w * 0.2}V${-y0}`} {...T} /></>;
    case 'counter': // worktop; wall cabinets above shown dashed
      return <>{rect}<line x1={x0} y1={y0 + Math.min(0.35, d * 0.6)} x2={-x0} y2={y0 + Math.min(0.35, d * 0.6)} {...HIDDEN} /></>;
    case 'chair':
      return <><rect x={x0} y={y0} width={w} height={d} rx={0.04} {...S} /><line x1={x0} y1={y0 + d * 0.18} x2={-x0} y2={y0 + d * 0.18} {...T} /></>;
    case 'armchair': { const a = Math.min(0.14, w * 0.18);
      return <><rect x={x0} y={y0} width={w} height={d} rx={0.08} {...S} /><rect x={x0 + a} y={y0} width={w - 2 * a} height={Math.min(0.18, d * 0.25)} {...T} />
        <line x1={x0 + a} y1={y0} x2={x0 + a} y2={-y0} {...T} /><line x1={-x0 - a} y1={y0} x2={-x0 - a} y2={-y0} {...T} /></>; }
    case 'tv':
      return <>{rect}<line x1={x0 + w * 0.15} y1={y0 + d * 0.3} x2={-x0 - w * 0.15} y2={y0 + d * 0.3} {...ln(W.fixture)} /></>;
    case 'bookshelf': { const n = Math.max(2, Math.round(w / 0.45));
      return <>{rect}{Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={x0 + (w / n) * (i + 1)} y1={y0} x2={x0 + (w / n) * (i + 1)} y2={-y0} {...T} />)}</>; }
    case 'bedside':
      return <>{rect}<circle cx={0} cy={0} r={Math.min(w, d) * 0.28} {...T} /></>;
    case 'plant': { const r = Math.min(w, d) / 2;
      return <><circle cx={0} cy={0} r={r} {...S} /><circle cx={0} cy={0} r={r * 0.45} {...T} />{[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={0} y1={0} x2={Math.cos(i * 1.047) * r * 0.9} y2={Math.sin(i * 1.047) * r * 0.9} {...T} />)}</>; }
    case 'column':
      return <rect x={x0} y={y0} width={w} height={d} fill="var(--wall)" {...ln(W.fixture)} />;
    case 'unknown': // something is drawn here that nobody has named yet
      return <rect x={x0} y={y0} width={w} height={d} fill="var(--sheet)" {...ln(W.fixture, '5 3')} />;
  }
}

export function FixtureSymbol({ f }: { f: Fixture }) {
  return (
    <g transform={`translate(${f.center[0]} ${f.center[1]}) rotate(${(f.angle * 180) / Math.PI})`} class={f.source === 'suggested' ? 'suggested' : undefined}>
      <title>{fixtureName(f)}</title>
      <Shape k={f.kind} w={f.size[0]} d={f.size[1]} />
    </g>
  );
}
