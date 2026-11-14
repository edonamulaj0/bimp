// Plan-view symbols for fittings and furniture, drawn in the fixture's local frame:
// origin at its centre, x along the wall it backs onto, back (wall side) at -d/2, front at +d/2.
import type { Fixture } from '../../../shared/plan';

const S = { fill: 'var(--paper)', stroke: 'var(--wall)', 'stroke-width': 0.02 } as const;
const T = { fill: 'none', stroke: 'var(--wall)', 'stroke-width': 0.015 } as const;

function Shape({ k, w, d }: { k: Fixture['kind']; w: number; d: number }) {
  const x0 = -w / 2, y0 = -d / 2;
  const rect = <rect x={x0} y={y0} width={w} height={d} {...S} />;
  switch (k) {
    case 'wc': {
      const c = Math.min(0.2, d * 0.3);
      return <><rect x={x0} y={y0} width={w} height={c} rx={0.03} {...S} /><ellipse cx={0} cy={y0 + c + (d - c) / 2} rx={w * 0.42} ry={(d - c) / 2} {...S} /></>;
    }
    case 'sink':
      return <>{rect}<rect x={x0 + w * 0.15} y={y0 + d * 0.25} width={w * 0.7} height={d * 0.6} rx={Math.min(w, d) * 0.15} {...T} /><circle cx={0} cy={y0 + d * 0.13} r={0.025} {...T} /></>;
    case 'bathtub':
      return <>{rect}<rect x={x0 + 0.06} y={y0 + 0.06} width={w - 0.12} height={d - 0.12} rx={0.15} {...T} /><circle cx={x0 + 0.2} cy={0} r={0.03} {...T} /></>;
    case 'shower':
      return <>{rect}<path d={`M${x0},${y0}L${-x0},${-y0}M${-x0},${y0}L${x0},${-y0}`} {...T} /><circle cx={0} cy={0} r={0.04} {...T} /></>;
    case 'sauna_stove':
      return <>{rect}<path d={`M${x0},${y0}L${-x0},${-y0}M${-x0},${y0}L${x0},${-y0}`} {...T} /><rect x={x0 + 0.05} y={y0 + 0.05} width={w - 0.1} height={d - 0.1} {...T} /></>;
    case 'stove': {
      const r = Math.min(w, d) * 0.15;
      return <>{rect}{[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => <circle key={`${a}${b}`} cx={(a * w) / 4} cy={(b * d) / 4} r={r} {...T} />)}</>;
    }
    case 'fridge':
      return <>{rect}<line x1={x0} y1={-y0 - 0.06} x2={-x0} y2={-y0 - 0.06} {...T} /><text x={0} y={0.05} font-size={Math.min(w, d) * 0.35} text-anchor="middle" fill="var(--wall)">F</text></>;
    case 'washer':
      return <>{rect}<circle cx={0} cy={0.03} r={Math.min(w, d) * 0.32} {...T} /></>;
    case 'bed': {
      const n = w > 1.2 ? 2 : 1, pw = (w - 0.1 * (n + 1)) / n;
      return <>{rect}{Array.from({ length: n }, (_, i) => <rect key={i} x={x0 + 0.1 + i * (pw + 0.1)} y={y0 + 0.07} width={pw} height={0.3} rx={0.06} {...T} />)}<line x1={x0} y1={y0 + d * 0.33} x2={-x0} y2={y0 + d * 0.33} {...T} /></>;
    }
    case 'sofa': {
      const b = Math.min(0.22, d * 0.3), a = Math.min(0.2, w * 0.15);
      return <>{rect}<rect x={x0} y={y0} width={w} height={b} {...T} /><rect x={x0} y={y0} width={a} height={d} {...T} /><rect x={-x0 - a} y={y0} width={a} height={d} {...T} />
        {w - 2 * a > 1.2 && <line x1={0} y1={y0 + b} x2={0} y2={-y0} {...T} />}</>;
    }
    case 'table': {
      const cw = 0.4, n = Math.max(1, Math.floor(w / 0.6));
      return <>{Array.from({ length: n }, (_, i) => [x0 + (w / n) * (i + 0.5)]).flatMap(([cx], i) => [
        <rect key={`a${i}`} x={cx - cw / 2} y={y0 - 0.32} width={cw} height={0.36} rx={0.05} {...T} />,
        <rect key={`b${i}`} x={cx - cw / 2} y={-y0 - 0.04} width={cw} height={0.36} rx={0.05} {...T} />])}{rect}</>;
    }
    case 'desk':
      return <><circle cx={0} cy={-y0 + 0.25} r={0.22} {...T} />{rect}</>;
    case 'wardrobe':
      return <>{rect}<line x1={x0} y1={y0} x2={-x0} y2={-y0} {...T} /><line x1={x0 + 0.05} y1={0} x2={-x0 - 0.05} y2={0} {...T} stroke-dasharray="0.08 0.05" /></>;
  }
}

export function FixtureSymbol({ f }: { f: Fixture }) {
  return (
    <g transform={`translate(${f.center[0]} ${f.center[1]}) rotate(${(f.angle * 180) / Math.PI})`}>
      <title>{f.kind}</title>
      <Shape k={f.kind} w={f.size[0]} d={f.size[1]} />
    </g>
  );
}
