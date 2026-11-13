// Drawing -> Plan. The model reads (labels, room outlines, openings); code measures (snapping, scale, areas).
import { type Plan, type Pt, type Room, type Opening, ROOM_TYPES, bounds, dist, wallsFromRooms, round } from '../../shared/plan';
import { generate, textOf } from './gemini';
import type { Analysis } from './ingest';
import { BOOK, nearestPreferredScale, parseDimension } from '../../shared/standards';
import type { Env } from './util';

const PROMPT_VERSION = 'read-v3';
const P = { type: 'ARRAY', items: { type: 'NUMBER' } }; // [y, x] normalised 0-1000
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scale_evidence: {
      type: 'OBJECT', nullable: true,
      properties: { text: { type: 'STRING' }, value_m: { type: 'NUMBER' }, a: P, b: P },
      required: ['text', 'value_m', 'a', 'b'],
    },
    stated_scale: {
      type: 'OBJECT', nullable: true,
      properties: { text: { type: 'STRING' }, ratio: { type: 'NUMBER' } },
      required: ['text', 'ratio'],
    },
    rooms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, type: { type: 'STRING', enum: [...ROOM_TYPES] }, polygon: { type: 'ARRAY', items: P } },
        required: ['name', 'type', 'polygon'],
      },
    },
    openings: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['door', 'window'] }, a: P, b: P }, required: ['kind', 'a', 'b'] },
    },
  },
  required: ['rooms', 'openings'],
};

// Reading conventions follow standard drawing practice (Metric Handbook Ch. 1, BS 8541-2 / BS 1192 conventions).
const PROMPT = `You are reading an architectural floor plan (any language, any drawing style).
Return its rooms and openings as JSON. Every point is [y, x], normalised 0-1000 over the full image, origin top-left.
How to read the drawing:
- Walls are the thick (often hatched or filled) double lines. Rooms are the spaces they enclose.
- A door is a gap in a wall with a leaf line and a quarter-circle swing arc. A window is a thin multi-line infill within the wall thickness.
- Dashed lines are things overhead or hidden (beams, roof edges, high cupboards): never room boundaries.
- Stairs are rows of parallel treads, usually with an arrow showing the direction of travel ("UP"/"DN").
- Level marks (FFL, SSL, TBM, "+2.700", a triangle or circle with a value) are heights, NOT dimensions.
- Grid lines are chain-dotted lines ending in a circle with a letter or number: not walls.
rooms: every enclosed room or area. name = the room label exactly as written (keep its language and abbreviations;
  if unlabelled, a short description). type = closest category (circulation = hall, corridor, landing, lobby).
  polygon = boundary along the inside face of the walls, corners in order. Walls are usually orthogonal; follow the drawing.
openings: each door and window as the segment spanning the opening along its wall (the full doorset width, not the leaf).
scale_evidence: one dimension string with its dimension line (prefer the longest overall dimension). text = exactly as written
  ("12000", "12.00", "12,00", "3'-6\""). Drawings use millimetres without decimals or metres with decimals; value_m = that length
  in metres. a, b = the two ends of the dimension line. null if there are no dimensions.
stated_scale: the drawing scale written on the sheet (title block or under the plan, e.g. "1:100", "M 1:50", "Scale 1/100"),
  text as written and ratio as a number (100). null if none is written. If several, the one for the main plan.
If the sheet has several plans, use only the main floor plan. Never invent rooms that are not drawn.`;

export type Raw = {
  scale_evidence?: { text: string; value_m: number; a: number[]; b: number[] } | null;
  stated_scale?: { text: string; ratio: number } | null;
  rooms: { name: string; type: string; polygon: number[][] }[];
  openings: { kind: 'door' | 'window'; a: number[]; b: number[] }[];
};

export async function readDrawing(env: Env, png: string, renderSha: string, an: Pick<Analysis, 'kind' | 'texts' | 'width' | 'height'>): Promise<Raw> {
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [{ inlineData: { mimeType: 'image/png', data: png } }, { text: PROMPT }];
  if (an.kind === 'dxf' && an.texts.length) {
    // DXF text is rendered as ASCII only; give the model the exact strings and positions.
    const list = an.texts.slice(0, 300).map((t) => `[${Math.round((t.bbox[1] / an.height) * 1000)}, ${Math.round((t.bbox[0] / an.width) * 1000)}] ${t.text}`);
    parts.push({ text: `Exact text on the drawing ([y, x] of each label):\n${list.join('\n')}` });
  }
  const content = await generate(env, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  }, `${PROMPT_VERSION}:${renderSha}`);
  const raw = JSON.parse(textOf(content)) as Raw;
  return { scale_evidence: raw.scale_evidence ?? null, stated_scale: raw.stated_scale ?? null, rooms: raw.rooms ?? [], openings: raw.openings ?? [] };
}

type Seg = [number, number, number, number];

/** Moves a point onto the drawing's line work: to a corner of two crossing lines if one is near, else onto the nearest line. */
export function snapPoint(p: Pt, segs: Seg[], tol: number): Pt | null {
  const near: { d: number; q: Pt; s: Seg }[] = [];
  for (const s of segs) {
    if (p[0] < Math.min(s[0], s[2]) - tol || p[0] > Math.max(s[0], s[2]) + tol || p[1] < Math.min(s[1], s[3]) - tol || p[1] > Math.max(s[1], s[3]) + tol) continue;
    const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / L2));
    const q: Pt = [s[0] + t * dx, s[1] + t * dy];
    const d = dist(p, q);
    if (d < tol) near.push({ d, q, s });
  }
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d);
  const top = near.slice(0, 10);
  let best: Pt | null = null, bestD = tol * 1.5;
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const [a, b] = [top[i].s, top[j].s];
    const d1 = [a[2] - a[0], a[3] - a[1]], d2 = [b[2] - b[0], b[3] - b[1]];
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cross) < 0.5 * Math.hypot(...d1) * Math.hypot(...d2)) continue; // need > 30° between lines
    const t = ((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / cross;
    const x: Pt = [a[0] + t * d1[0], a[1] + t * d1[1]];
    const d = dist(p, x);
    if (d < bestD) { best = x; bestD = d; }
  }
  return best ?? top[0].q;
}

const lineX = (a: Seg, b: Seg): Pt | null => {
  const d1 = [a[2] - a[0], a[3] - a[1]], d2 = [b[2] - b[0], b[3] - b[1]];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / cross;
  return [a[0] + t * d1[0], a[1] + t * d1[1]];
};

/**
 * Snaps a polygon edge by edge: each edge moves onto a parallel line of the drawing that overlaps it,
 * and corners are rebuilt as intersections of consecutive snapped edges. Unlike snapping single points,
 * this cannot jump to a neighbouring room's corner a few centimetres away.
 */
export function snapPolygon(poly: Pt[], segs: Seg[], tol: number): { poly: Pt[]; snapped: number } {
  const n = poly.length;
  const lines: (Seg | null)[] = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const L = dist(a, b);
    if (L < tol) return null;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let best: Seg | null = null, bestD = tol;
    for (const s of segs) {
      const sl = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (sl < 1e-6) continue;
      // Both ends of the edge near the line plus real overlap along it: this bounds the angle by the edge's own
      // length, so short noisy edges still match while crossing lines (no overlap) never do.
      const off = (p: Pt) => (p[0] - s[0]) * -(s[3] - s[1]) / sl + (p[1] - s[1]) * (s[2] - s[0]) / sl;
      const d = Math.max(Math.abs(off(a)), Math.abs(off(b)));
      if (d >= bestD) continue;
      const t0 = (s[0] - a[0]) * u[0] + (s[1] - a[1]) * u[1], t1 = (s[2] - a[0]) * u[0] + (s[3] - a[1]) * u[1];
      const overlap = Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap < 0.5 * Math.min(L, sl)) continue;
      best = s; bestD = d;
    }
    return best;
  });
  let snapped = 0;
  const out = poly.map((p, i) => {
    const prev = lines[(i - 1 + n) % n], next = lines[i];
    const x = prev && next ? lineX(prev, next) : null;
    if (x && dist(x, p) < tol * 2) { snapped++; return x; }
    return snapPoint(p, segs, tol * 0.5) ?? p;
  });
  return { poly: out, snapped };
}

/**
 * Straightens an outline that could not be snapped to line work: drawings use orthogonal walls and inclined lines at
 * multiples of 15° (Metric Handbook Ch. 1 §3.2), so edges within a few degrees of the room's main axes are made exact.
 */
export function regularize(poly: Pt[], tolDeg = 4): Pt[] {
  let c = 0, sn = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], L = dist(a, b), t = Math.atan2(b[1] - a[1], b[0] - a[0]);
    c += L * Math.cos(4 * t); sn += L * Math.sin(4 * t);
  });
  let th = Math.atan2(sn, c) / 4; // dominant axis, modulo 90°
  const step = Math.PI / 12;
  if (Math.abs(th - Math.round(th / step) * step) < (2 * Math.PI) / 180) th = Math.round(th / step) * step;
  const [co, si] = [Math.cos(th), Math.sin(th)];
  const q = poly.map(([x, y]) => [x * co + y * si, -x * si + y * co] as Pt); // rotate into the room's axes
  const tol = Math.tan((tolDeg * Math.PI) / 180);
  q.forEach((a, i) => {
    const j = (i + 1) % q.length, b = q[j];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dy) <= Math.abs(dx) * tol) { const y = (a[1] + b[1]) / 2; q[i] = [a[0], y]; q[j] = [b[0], y]; }
    else if (Math.abs(dx) <= Math.abs(dy) * tol) { const x = (a[0] + b[0]) / 2; q[i] = [x, a[1]]; q[j] = [x, b[1]]; }
  });
  return q.map(([x, y]) => [x * co - y * si, x * si + y * co] as Pt);
}

const inside = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

export function buildPlan(raw: Raw, an: Omit<Analysis, 'render_png'>, fileId: string, renderSha: string): Plan {
  const { width: W, height: H } = an;
  const px = (p: number[]): Pt => [((p?.[1] ?? 0) / 1000) * W, ((p?.[0] ?? 0) / 1000) * H];
  const tol = Math.max(W, H) * 0.01;
  let corners = 0, snapped = 0;
  const snap = (p: Pt) => (an.segments.length ? snapPoint(p, an.segments, tol) : null) ?? p;

  const rooms0 = raw.rooms.filter((r) => r.polygon?.length >= 3).map((r) => {
    const res = snapPolygon(r.polygon.map(px), an.segments, tol);
    corners += r.polygon.length; snapped += res.snapped;
    // Vector line work is exact; raster lines (OpenCV on stroke faces) are not, so raster outlines are straightened too.
    const raster = an.kind === 'image' || an.kind === 'pdf-scan';
    return { ...r, poly: raster || res.snapped < r.polygon.length ? regularize(res.poly) : res.poly };
  });
  if (!rooms0.length) throw Object.assign(new Error('No rooms could be read from this drawing. Is it a floor plan?'), { fatal: true });
  const openings0 = raw.openings.map((o) => ({ kind: o.kind, a: snap(px(o.a)), b: snap(px(o.b)) }));
  const snapRatio = corners ? snapped / corners : 0;

  // Labels: prefer the exact text string inside the room when it matches what the model read.
  for (const r of rooms0) {
    const want = norm(r.name);
    const hit = an.texts.find((t) => {
      const c: Pt = [(t.bbox[0] + t.bbox[2]) / 2, (t.bbox[1] + t.bbox[3]) / 2];
      const n = norm(t.text);
      return n.length > 1 && inside(c, r.poly) && (n.includes(want) || want.includes(n));
    });
    if (hit) r.name = hit.text;
  }

  // Scale: stated on the drawing (sheet 1:N or DXF units) > dimension string > door width > assumed width.
  const assumptions: string[] = [];
  const ext = bounds(rooms0.flatMap((r) => r.poly));
  const extentPx = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0);
  const sane = (m: number | null | undefined): m is number => !!m && extentPx * m > 2 && extentPx * m < 500;
  let mpp: number | null = null, scaleSource = '', ratio: number | undefined;
  const ev = raw.scale_evidence;
  const evLen = ev ? dist(snap(px(ev.a)), snap(px(ev.b))) : 0;
  // Code, not the model, turns the dimension text into metres (mm without decimals, or metres; decimal comma allowed).
  const parsed = ev ? parseDimension(ev.text) : null;
  const dimM = parsed ?? (ev && ev.value_m > 0 ? ev.value_m : null);
  if (ev && parsed && ev.value_m > 0 && Math.abs(parsed / ev.value_m - 1) > 0.01)
    assumptions.push(`Read dimension "${ev.text}" as ${parsed} m (drawing convention: millimetres without decimals or metres with decimals, ${BOOK} Ch. 1 §2)`);
  const mppDim = dimM && evLen > 5 ? dimM / evLen : null;
  const paper = an.paper_mm_per_px ?? null;
  const statedN = raw.stated_scale && raw.stated_scale.ratio >= 1 ? Math.round(raw.stated_scale.ratio) : null;
  const mppStated = statedN && paper ? (statedN * paper) / 1000 : null;
  const exact = sane(an.scale?.meters_per_px) ? an.scale!.meters_per_px : null;

  if (exact) {
    mpp = exact; scaleSource = an.scale!.source; ratio = an.scale!.ratio;
    if ((an.scale!.all_ratios?.length ?? 0) > 1) assumptions.push(`Several scales on the sheet (${an.scale!.all_ratios!.map((n) => `1:${n}`).join(', ')}); used the most frequent, 1:${an.scale!.ratio}`);
    if (mppDim) {
      const diff = mppDim / exact - 1;
      assumptions.push(Math.abs(diff) > 0.05
        ? `Conflict: dimension "${ev!.text}" implies a scale ${round(diff * 100, 1)}% off the stated one. Used ${scaleSource}; check the drawing`
        : `Scale cross-checked against dimension "${ev!.text}" (within ${Math.max(0.1, round(Math.abs(diff) * 100, 1))}%)`);
    }
  } else if (sane(mppStated) && sane(mppDim) && Math.abs(mppDim / mppStated - 1) <= 0.05) {
    mpp = mppStated; ratio = statedN!;
    scaleSource = `Scale 1:${statedN} written on the sheet, confirmed by dimension "${ev!.text}"`;
  } else if (sane(mppDim) && paper && nearestPreferredScale((mppDim * 1000) / paper)) {
    // The sheet's physical size is known, so a dimension gives the drawing scale; drawings use preferred scales
    // (Ch. 1 Table III), so rounding to the nearest one removes the error of reading the dimension line's ends.
    const n = (mppDim * 1000) / paper;
    ratio = nearestPreferredScale(n)!;
    mpp = (ratio * paper) / 1000;
    scaleSource = `1:${ratio}: dimension "${ev!.text}" implies 1:${Math.round(n)}, rounded to the nearest preferred scale (${BOOK} Ch. 1 Table III)`;
    if (statedN && statedN !== ratio) assumptions.push(`Conflict: the sheet says 1:${statedN} but dimension "${ev!.text}" implies 1:${Math.round(n)}. Used 1:${ratio}; check the drawing`);
  } else if (sane(mppDim)) {
    mpp = mppDim; scaleSource = `Dimension "${ev!.text}" on the drawing`;
    if (mppStated && Math.abs(mppDim / mppStated - 1) > 0.05) assumptions.push(`Conflict: the sheet says 1:${statedN} but dimension "${ev!.text}" disagrees. Used the dimension; check the drawing`);
  } else if (sane(mppStated)) {
    mpp = mppStated; ratio = statedN!;
    scaleSource = `Scale 1:${statedN} written on the sheet (no dimension to cross-check)`;
    assumptions.push(scaleSource);
  } else {
    const doors = openings0.filter((o) => o.kind === 'door').map((o) => dist(o.a, o.b)).filter((d) => d > 1).sort((a, b) => a - b);
    const byDoor = doors.length ? 0.9 / doors[doors.length >> 1] : null;
    if (sane(byDoor)) { mpp = byDoor; scaleSource = `Assumed typical doorset width of 0.9 m (${BOOK} Ch. 2 §4.6)`; }
    else { mpp = 12 / extentPx; scaleSource = 'No scale found: assumed the plan is 12 m across'; }
    assumptions.push(scaleSource);
  }

  const measured = !!exact && snapRatio >= 0.9 && (an.kind === 'pdf-vector' || an.kind === 'dxf');
  assumptions.unshift(
    measured
      ? `Room outlines read by AI and snapped to the drawing's line work (${Math.round(snapRatio * 100)}% of corners); scale from the drawing`
      : `Preview, not measured: ${!exact ? 'no exact scale on the drawing' : `only ${Math.round(snapRatio * 100)}% of corners matched line work`}`,
    'Wall height 2.7 m (assumed)', 'Exterior walls 0.30 m, interior 0.12 m (assumed)',
  );

  const m = mpp!;
  const ox = ext.x0, oy = ext.y0;
  const toM = (p: Pt): Pt => [round((p[0] - ox) * m, 3), round((p[1] - oy) * m, 3)];
  const rooms: Room[] = rooms0.map((r, i) => ({
    id: `r${i + 1}`,
    name: r.name.trim() || `Room ${i + 1}`,
    type: (ROOM_TYPES as readonly string[]).includes(r.type) ? (r.type as Room['type']) : 'other',
    polygon: r.poly.map(toM),
  }));
  const openings: Opening[] = openings0.map((o, i) => ({ id: `${o.kind[0]}${i + 1}`, kind: o.kind, a: toM(o.a), b: toM(o.b) }));
  const walls = wallsFromRooms(rooms);
  const bb = bounds([...rooms.flatMap((r) => r.polygon), ...walls.flatMap((w) => [w.a, w.b])]);

  return {
    version: 1,
    method: 'hybrid',
    measured,
    width: round(bb.x1, 2),
    height: round(bb.y1, 2),
    wallHeight: 2.7,
    rooms,
    walls,
    openings,
    scale: { metersPerPx: m, source: scaleSource, ...(ratio ? { ratio } : {}) },
    source: { fileId, renderSha, mime: 'image/png', imageWidth: W, imageHeight: H, offset: [round(-ox * m, 3), round(-oy * m, 3)] },
    provenance: { kind: an.kind, scaleExact: !!exact, snapped: round(snapRatio, 3), segments: an.segments.length },
    assumptions,
  };
}
