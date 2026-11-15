// Drawing -> Plan. The model reads (labels, room outlines, openings); code measures (snapping, scale, areas).
import { type Plan, type Pt, type Room, type Arc, type Wall, type Opening, type Fixture, type Src, FIXTURE_KINDS, DETECTED_KINDS, type DetectedKind, placeFixture, ROOM_TYPES, bounds, dist, wallsFromFaces, wallsFromRooms, round } from '../../shared/plan';
import { type Meter, costUsd, generate, meter, textOf } from './gemini';
import type { Analysis } from './ingest';
import { BOOK, nearestPreferredScale, parseDimension } from '../../shared/standards';
import { orientDoors } from '../../shared/rooms';
import { clipHalf } from '../../shared/walls';
import type { Env } from './util';

const PROMPT_VERSION = 'read-v7';
const P = { type: 'ARRAY', items: { type: 'NUMBER' } }; // [y, x] normalised 0-1000
export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scale_evidence: {
      type: 'OBJECT', nullable: true,
      properties: { text: { type: 'STRING' }, value_m: { type: 'NUMBER' }, a: P, b: P },
      required: ['text', 'value_m', 'a', 'b'],
    },
    levels: {
      type: 'OBJECT', nullable: true,
      properties: { floor_level_text: { type: 'STRING', nullable: true }, ceiling_height_text: { type: 'STRING', nullable: true } },
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
    fixtures: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: [...FIXTURE_KINDS] }, box: { type: 'ARRAY', items: { type: 'NUMBER' } } }, required: ['kind', 'box'] },
    },
  },
  required: ['rooms', 'openings', 'fixtures'],
};

// Reading conventions follow standard drawing practice (Metric Handbook Ch. 1, BS 8541-2 / BS 1192 conventions).
export const PROMPT = `You are reading an architectural floor plan (any language, any drawing style).
Return its rooms, openings and fixtures as JSON. Every point is [y, x], normalised 0-1000 over the full image, origin top-left.
How to read the drawing:
- Walls are the thick (often hatched or filled) double lines. Rooms are the spaces they enclose.
- A door is a gap in a wall with a leaf line and a quarter-circle swing arc. A window is a thin multi-line infill within the wall thickness.
- Dashed lines are things overhead or hidden (beams, roof edges, high cupboards): never room boundaries.
- Stairs are rows of parallel treads, usually with an arrow showing the direction of travel ("UP"/"DN").
- Level marks (FFL, SSL, TBM, "+2.700", a triangle or circle with a value) are heights, NOT dimensions.
- Grid lines are chain-dotted lines ending in a circle with a letter or number: not walls.
rooms: every enclosed room or area. name = the room label exactly as written (keep its language and abbreviations;
  if unlabelled, a short description). type = closest category (circulation = hall, corridor, landing, lobby).
  polygon = boundary along the inside face of the walls, one point at EVERY corner, in order. Follow the drawing exactly:
  a wall drawn at an angle (slanted, diagonal, chamfered corner, bay) is an edge at that angle; never square a room off into
  a rectangle. A curved wall is a run of short edges along the curve. L-, T- and U-shaped rooms keep all their corners.
openings: EVERY door and EVERY window, each as the segment from one jamb to the other along its wall (the full doorset or
  window width, not the door leaf, not the swing arc). Both points lie on the wall, including walls drawn at an angle.
  Go round the outside walls once for windows and external doors, then through every room for its doors: each room normally
  has at least one door or open archway, and habitable rooms normally have a window. Include small windows (WC, bathroom,
  stair), sliding, folding, double and garage doors, and French windows. A doorway drawn without a leaf is still a door.
  Do not report the same opening twice.
scale_evidence: one dimension string with its dimension line (prefer the longest overall dimension). text = exactly as written
  ("12000", "12.00", "12,00", "3'-6\""). Drawings use millimetres without decimals or metres with decimals; value_m = that length
  in metres. a, b = the two ends of the dimension line. null if there are no dimensions.
fixtures: every fitting, appliance and furniture item drawn, each with the closest kind:
  sanitary: toilet bowls (wc), bidet, urinal, wash basins and kitchen sinks (sink; a double-bowl sink is one), bathtub, shower,
    sauna stoves (sauna_stove, "kiuas");
  kitchen and services: cookers/hobs (stove), oven (a tall or separate oven), fridge (also fridge-freezers, often "JK", "JK/PK", "F"),
    dishwasher ("APK", "DW"), washing machine (washer, "PK", "PKK", "WM"), dryer ("KR", "TD"), water_heater ("LVV", "WH"), radiator,
    fireplace (also stoves for heating), counter (kitchen worktops and base units without an appliance in them);
  furniture: bed, bedside, sofa, armchair, chair, table (dining and coffee tables, with their chairs as separate chair items only
    when drawn apart from it), desk, wardrobe (cupboards, closets, tall storage), bookshelf (open shelving), tv (TV or media unit),
    plant; structure: column (a free-standing column or pier).
  Letter codes written in or beside a symbol tell you what it is; use them.
  A symbol that is clearly an object but that you cannot name is kind "unknown": report it, do not leave it out and do not guess.
  box = [ymin, xmin, ymax, xmax] normalised 0-1000, tight around the symbol. One entry per item; skip anything you cannot see.
levels: the finished floor level of this plan as written (e.g. "FFL ±0.00", "OKFF +3.05", "NGF 102.40") and the clear ceiling
  height if stated (e.g. "RH 2.50", "lichte Höhe 2,60", "HSP 2.50", "CH 2400"), as written; null where not stated.
stated_scale: the drawing scale written on the sheet (title block or under the plan, e.g. "1:100", "M 1:50", "Scale 1/100"),
  text as written and ratio as a number (100). null if none is written. If several, the one for the main plan.
If the sheet has several plans, use only the main floor plan. Never invent rooms that are not drawn.`;

export type Raw = {
  scale_evidence?: { text: string; value_m: number; a: number[]; b: number[] } | null;
  stated_scale?: { text: string; ratio: number } | null;
  levels?: { floor_level_text?: string | null; ceiling_height_text?: string | null } | null;
  rooms: { name: string; type: string; polygon: number[][] }[];
  openings: { kind: 'door' | 'window'; a: number[]; b: number[] }[];
  fixtures?: { kind: string; box: number[] }[];
  /** Doors and windows from the second, openings-only reading; merged with `openings` when the plan is built. */
  more_openings?: { kind: 'door' | 'window'; a: number[]; b: number[] }[];
  /** How many enlarged pieces were read again for fittings and furniture, and how many of the fittings come from them. */
  zoom?: { tiles: number; found: number };
  /** What the reading cost: model calls made (cached readings are free), tokens, and US dollars at list price. */
  usage?: { calls: number; tokens_in: number; tokens_out: number; usd: number };
};

const LEVEL_KEY = /(?:FFL|FFB|OKFF|OKRF|NGF|SSL|RH|LH|CH|HSP|H(?:ö|oe)he|Höhe|level|niveau|kote)\s*[:=]?\s*/i;

/** Floor level in metres from a level mark ("FFL +2.700", "1.OG OKFF +3,05", "±0.00"); a signed number wins over a storey number. */
export function parseLevel(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/([+\-−±])\s*(\d+(?:[.,]\d+)?)/) ?? text.match(new RegExp(LEVEL_KEY.source + '()(\\d+(?:[.,]\\d+)?)', 'i'));
  if (!m) return null;
  let v = Number(m[2].replace(',', '.'));
  if (!m[2].includes('.') && !m[2].includes(',') && Math.abs(v) >= 100) v /= 1000; // level in mm
  v *= m[1] === '-' || m[1] === '−' ? -1 : 1;
  return Number.isFinite(v) && Math.abs(v) < 1000 ? v : null;
}

/** Ceiling height in metres ("RH 2,50", "CH 2700", "RH 250 cm", "1.OG RH 2,50"): the number after the keyword, with its unit. */
export function parseCeiling(text: string | null): number | null {
  if (!text) return null;
  const tok = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?(?![\w.])/;
  const after = text.match(LEVEL_KEY);
  const m = (after ? text.slice(after.index! + after[0].length) : text).match(tok) ?? text.match(tok);
  if (!m) return null;
  const v = parseDimension(m[1] + (m[2] ? ` ${m[2]}` : ''));
  if (v !== null) return v;
  const n = Number(m[1].replace(',', '.'));
  return n >= 2 && n <= 8 ? n : n >= 200 && n <= 800 ? n / 100 : null; // "2,50" (m) or "250" (cm)
}

const OPENINGS_VERSION = 'openings-v1';
export const OPENINGS_SCHEMA = { type: 'OBJECT', properties: { openings: SCHEMA.properties.openings }, required: ['openings'] };
// A second reading that looks for nothing but doors and windows: asked for everything at once, the model drops openings first.
export const OPENINGS_PROMPT = `You are reading an architectural floor plan (any language, any drawing style).
Find EVERY door and EVERY window on the main floor plan and nothing else. Every point is [y, x], normalised 0-1000 over the
full image, origin top-left.
- A door is a gap in a wall, usually with a leaf line and a quarter-circle swing arc; sliding doors are drawn as offset parallel
  panels, folding doors as a zigzag, garage doors as a wide gap with a dashed line. A doorway without a leaf is still a door.
- A window is a thin multi-line infill within the wall thickness (two to four parallel lines across the wall), often on the
  outside walls; glazed doors to a terrace or balcony are doors.
Each opening is the segment from one jamb to the other along its wall (the full width, not the door leaf or swing arc); both
points lie on the wall, also when the wall is drawn at an angle. Work systematically: go once round the outside of the building,
then through the interior room by room. Report each opening once. Do not report furniture, stairs, dimension lines or text.`;

const FIXTURES_VERSION = 'fixtures-v1';
export const FIXTURES_SCHEMA = { type: 'OBJECT', properties: { fixtures: SCHEMA.properties.fixtures }, required: ['fixtures'] };
// A third reading, of enlarged pieces of the plan, that looks for nothing but fittings and furniture: on the whole
// sheet a chair or a bedside table is a few pixels, and asked for everything at once the model leaves small things out.
export const FIXTURES_PROMPT = `This is an enlarged PART of an architectural floor plan (any language, any drawing style).
Find EVERY fitting, appliance and piece of furniture drawn in it, and nothing else. Give each the closest kind:
  sanitary: toilet bowls (wc), bidet, urinal, wash basins and kitchen sinks (sink; a double-bowl sink is one), bathtub, shower,
    sauna stoves (sauna_stove, "kiuas");
  kitchen and services: cookers/hobs (stove), oven (a tall or separate oven), fridge (also fridge-freezers, often "JK", "JK/PK", "F"),
    dishwasher ("APK", "DW"), washing machine (washer, "PK", "PKK", "WM"), dryer ("KR", "TD"), water_heater ("LVV", "WH"), radiator,
    fireplace (also stoves for heating), counter (kitchen worktops and base units without an appliance in them);
  furniture: bed, bedside (bedside tables), sofa, armchair, chair (every chair, also each one at a table or desk), table (dining and
    coffee tables), desk, wardrobe (cupboards, closets, tall storage), bookshelf (open shelving), tv (TV or media unit), plant;
  structure: column (a free-standing column or pier).
Letter codes written in or beside a symbol tell you what it is; use them. A symbol that is clearly an object but that you
cannot name is kind "unknown": report it, do not leave it out and do not guess.
box = [ymin, xmin, ymax, xmax], normalised 0-1000 over THIS image, origin top-left, tight around the symbol itself.
One entry per item. Go through the image room by room. Report an item also when the edge of the image cuts it.
Do not report walls, doors, windows, stairs, dimension lines, room labels or other text. Skip anything you cannot see.`;

/** One enlarged piece of the render (`box` = what it covers, render pixels) and the fittings read in it (boxes 0-1000 over the piece). */
export type TileReading = { box: [number, number, number, number]; fixtures: { kind: string; box: number[] }[] };

/** The part of the render that holds the plan: the bounds of the rooms as read, with a margin, in render pixels. null without rooms. */
export function planRegion(raw: Pick<Raw, 'rooms'>, an: Pick<Analysis, 'width' | 'height'>): [number, number, number, number] | null {
  const pts = raw.rooms.flatMap((r) => r.polygon ?? []).filter((p) => p?.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) return null;
  const ys = pts.map((p) => (p[0] / 1000) * an.height), xs = pts.map((p) => (p[1] / 1000) * an.width);
  const pad = 0.03 * Math.max(an.width, an.height);
  return [Math.max(0, Math.min(...xs) - pad), Math.max(0, Math.min(...ys) - pad), Math.min(an.width, Math.max(...xs) + pad), Math.min(an.height, Math.max(...ys) + pad)];
}

/** Reads the fittings in each enlarged piece (cached per render and piece). A piece that fails is read as empty: the first reading still stands. */
export async function readFixtures(env: Env, tiles: { png: string; box: number[] }[], renderSha: string, m: Meter): Promise<TileReading[]> {
  return Promise.all(tiles.map(async (t): Promise<TileReading> => {
    const box = t.box.map(Math.round) as [number, number, number, number];
    const got = await ask<{ fixtures?: TileReading['fixtures'] }>(env, [{ inlineData: { mimeType: 'image/png', data: t.png } }, { text: FIXTURES_PROMPT }], FIXTURES_SCHEMA, `${FIXTURES_VERSION}:${renderSha}:${box.join(',')}`, m)
      .catch((e) => { console.warn('fixtures pass', (e as Error).message); return { fixtures: [] }; });
    return { box, fixtures: (got.fixtures ?? []).filter((f) => f?.box?.length === 4 && f.box.every(Number.isFinite)) };
  }));
}

/**
 * The fittings of the whole plan from the first reading and the enlarged pieces, boxes 0-1000 over the full render.
 * What a piece saw is placed more exactly, so it comes first and wins where both report the same thing; a thing cut
 * by a piece's inner edge is left to the neighbouring piece that holds it whole; a thing two pieces both saw is kept
 * once; what only the first reading has stays.
 */
export function mergeFixtures(base: NonNullable<Raw['fixtures']>, tiles: TileReading[], an: Pick<Analysis, 'width' | 'height'>): NonNullable<Raw['fixtures']> {
  if (!tiles.length) return base;
  const rx0 = Math.min(...tiles.map((t) => t.box[0])), ry0 = Math.min(...tiles.map((t) => t.box[1])), rx1 = Math.max(...tiles.map((t) => t.box[2])), ry1 = Math.max(...tiles.map((t) => t.box[3]));
  type B = { kind: string; px: [number, number, number, number]; edge: number };
  const seen: B[] = [];
  for (const t of tiles) {
    const [tx0, ty0, tx1, ty1] = t.box, tw = tx1 - tx0, th = ty1 - ty0;
    for (const f of t.fixtures) {
      const y0 = ty0 + (Math.min(f.box[0], f.box[2]) / 1000) * th, y1 = ty0 + (Math.max(f.box[0], f.box[2]) / 1000) * th;
      const x0 = tx0 + (Math.min(f.box[1], f.box[3]) / 1000) * tw, x1 = tx0 + (Math.max(f.box[1], f.box[3]) / 1000) * tw;
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      // cut by an edge of the piece that is not the edge of the plan: the neighbour has it whole
      const e = 0.015, cut = (x0 - tx0 < e * tw && tx0 > rx0 + 1) || (tx1 - x1 < e * tw && tx1 < rx1 - 1) || (y0 - ty0 < e * th && ty0 > ry0 + 1) || (ty1 - y1 < e * th && ty1 < ry1 - 1);
      if (cut) continue;
      seen.push({ kind: f.kind, px: [x0, y0, x1, y1], edge: Math.min(x0 - tx0, tx1 - x1, y0 - ty0, ty1 - y1) });
    }
  }
  const over = (p: B['px'], q: B['px']) => {
    const ix = Math.min(p[2], q[2]) - Math.max(p[0], q[0]), iy = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
    return ix > 0 && iy > 0 ? (ix * iy) / Math.min((p[2] - p[0]) * (p[3] - p[1]), (q[2] - q[0]) * (q[3] - q[1])) : 0;
  };
  // seen by two pieces: the one farther from its piece's edge is the better view
  seen.sort((a, b) => b.edge - a.edge);
  const once = seen.filter((f, i) => !seen.some((g, j) => j < i && over(f.px, g.px) > 0.5));
  const norm = (b: B['px']) => [(b[1] / an.height) * 1000, (b[0] / an.width) * 1000, (b[3] / an.height) * 1000, (b[2] / an.width) * 1000];
  const basePx = (f: { box: number[] }): B['px'] => [(Math.min(f.box[1], f.box[3]) / 1000) * an.width, (Math.min(f.box[0], f.box[2]) / 1000) * an.height, (Math.max(f.box[1], f.box[3]) / 1000) * an.width, (Math.max(f.box[0], f.box[2]) / 1000) * an.height];
  // the first reading's item is the same thing when a piece has that kind there, or anything of about its size on it;
  // a chair at a desk or a sink in a worktop overlaps its neighbour without being it
  const size = (b: B['px']) => (b[2] - b[0]) * (b[3] - b[1]);
  const sameThing = (f: { kind: string; box: number[] }, g: B) => { const p = basePx(f), o = over(p, g.px), r = size(p) / size(g.px);
    return (g.kind === f.kind && o > 0.3) || (o > 0.6 && r > 0.5 && r < 2); };
  const only = base.filter((f) => f?.box?.length === 4 && !once.some((g) => sameThing(f, g)));
  return [...once.map((f) => ({ kind: f.kind, box: norm(f.px) })), ...only];
}

async function ask<T>(env: Env, parts: unknown[], schema: unknown, key: string, m: Meter): Promise<T> {
  const body = (hi: boolean) => ({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0, ...(hi ? { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } : {}) },
  });
  const check = (c: Parameters<typeof textOf>[0]) => void JSON.parse(textOf(c));
  // High media resolution keeps thin window lines and door arcs legible; a model that refuses the setting is asked again without it.
  let content;
  try { content = await generate(env, body(true), `${key}:hi`, check, m); }
  catch (e) { if ((e as { status?: number }).status === 503) throw e; content = await generate(env, body(false), key, check, m); }
  return JSON.parse(textOf(content)) as T;
}

export async function readDrawing(env: Env, png: string, renderSha: string, an: Pick<Analysis, 'kind' | 'texts' | 'width' | 'height'>): Promise<Raw> {
  const image = { inlineData: { mimeType: 'image/png', data: png } };
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [image, { text: PROMPT }];
  if (an.kind === 'dxf' && an.texts.length) {
    // DXF text is rendered as ASCII only; give the model the exact strings and positions.
    const list = an.texts.slice(0, 300).map((t) => `[${Math.round((t.bbox[1] / an.height) * 1000)}, ${Math.round((t.bbox[0] / an.width) * 1000)}] ${t.text}`);
    parts.push({ text: `Exact text on the drawing ([y, x] of each label):\n${list.join('\n')}` });
  }
  const m = meter();
  const [raw, extra] = await Promise.all([
    ask<Raw>(env, parts, SCHEMA, `${PROMPT_VERSION}:${renderSha}`, m),
    // The plan stands without the second reading: if it fails, the first one's openings are used as they are.
    ask<Pick<Raw, 'openings'>>(env, [image, { text: OPENINGS_PROMPT }], OPENINGS_SCHEMA, `${OPENINGS_VERSION}:${renderSha}`, m)
      .catch((e) => { console.warn('openings pass', (e as Error).message); return { openings: [] as Raw['openings'] }; }),
  ]);
  return { scale_evidence: raw.scale_evidence ?? null, stated_scale: raw.stated_scale ?? null, rooms: raw.rooms ?? [], openings: raw.openings ?? [], fixtures: raw.fixtures ?? [], levels: raw.levels ?? null,
    more_openings: (extra.openings ?? []).filter((o) => o?.a?.length === 2 && o?.b?.length === 2),
    usage: { calls: m.calls, tokens_in: m.tokens_in, tokens_out: m.tokens_out, usd: costUsd(env, m) } };
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

const DEG = Math.PI / 180;
/** Smallest angle between two directions that count as the same when 90° apart. */
const axisGap = (a: number, b: number) => { const d = Math.abs(a - b) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d); };

/**
 * The direction (modulo 90°) most of the wall length runs along: the mode, not the mean, so a slanted wall or a bay does
 * not pull the axes of an otherwise square plan off true. Returns the axis and the share of edge length that follows it.
 */
export function dominantAxis(polys: Pt[][], tolDeg = 4): { axis: number; share: number } {
  const edges = polys.flatMap((poly) => poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; return { L: dist(a, b), t: Math.atan2(b[1] - a[1], b[0] - a[0]) }; })).filter((e) => e.L > 1e-9);
  const total = edges.reduce((s, e) => s + e.L, 0);
  if (!total) return { axis: 0, share: 0 };
  const tol = tolDeg * DEG;
  let best = { score: -1, t: 0 };
  for (const c of edges) {
    const score = edges.reduce((s, e) => s + (axisGap(e.t, c.t) <= tol ? e.L : 0), 0);
    if (score > best.score) best = { score, t: c.t };
  }
  // refine: length-weighted mean of the edges that agree with the winner (4θ maps directions 90° apart onto each other)
  let c = 0, sn = 0;
  for (const e of edges) if (axisGap(e.t, best.t) <= tol) { c += e.L * Math.cos(4 * e.t); sn += e.L * Math.sin(4 * e.t); }
  let axis = Math.atan2(sn, c) / 4;
  const step = Math.PI / 12; // drawings use multiples of 15° (Metric Handbook Ch. 1 §3.2)
  if (Math.abs(axis - Math.round(axis / step) * step) < 2 * DEG) axis = Math.round(axis / step) * step;
  return { axis, share: best.score / total };
}

/**
 * Straightens an outline that could not be snapped to line work: edges within a few degrees of the main axes are made
 * exact, and edges at a real angle (slanted walls) are left at their angle. `axis` is the plan's main direction; without
 * it the room's own is used. `curved[i]` marks corners on a curved wall: the edges between them are left as they are.
 */
export function regularize(poly: Pt[], tolDeg = 4, axis?: number, curved?: boolean[]): Pt[] {
  const th = axis ?? dominantAxis([poly], tolDeg).axis;
  const [co, si] = [Math.cos(th), Math.sin(th)];
  const q = poly.map(([x, y]) => [x * co + y * si, -x * si + y * co] as Pt); // rotate into the room's axes
  const tol = Math.tan(tolDeg * DEG);
  q.forEach((a, i) => {
    const j = (i + 1) % q.length, b = q[j];
    if (curved?.[i] && curved[j]) return; // a piece of a curved wall is not a sloppy straight one
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dy) <= Math.abs(dx) * tol) { const y = (a[1] + b[1]) / 2; q[i] = [a[0], y]; q[j] = [b[0], y]; }
    else if (Math.abs(dx) <= Math.abs(dy) * tol) { const x = (a[0] + b[0]) / 2; q[i] = [x, a[1]]; q[j] = [x, b[1]]; }
  });
  return q.map(([x, y]) => [x * co - y * si, x * si + y * co] as Pt);
}

/**
 * Lines up wall faces that are one line on the drawing: outlines read or traced room by room put the same face a few
 * centimetres apart in neighbouring rooms, which shows as a jog where their walls meet. Edges that run along the
 * plan's axes and lie within `tol` of each other are moved onto their common (length-weighted) line.
 */
export function alignEdges(polys: Pt[][], axis: number, tol: number): Pt[][] {
  const [co, si] = [Math.cos(axis), Math.sin(axis)];
  const q = polys.map((poly) => poly.map(([x, y]) => [x * co + y * si, -x * si + y * co] as Pt));
  for (const k of [0, 1] as const) { // k = 1: edges along x share a y; k = 0: edges along y share an x
    const edges: { v: number; L: number; set(v: number): void }[] = [];
    for (const poly of q) poly.forEach((a, i) => {
      const j = (i + 1) % poly.length, b = poly[j], L = Math.abs(b[1 - k] - a[1 - k]);
      if (L > 1e-9 && Math.abs(b[k] - a[k]) <= 1e-6 * Math.max(1, L)) edges.push({ v: a[k], L, set: (v) => { poly[i][k] = v; poly[j][k] = v; } });
    });
    edges.sort((a, b) => a.v - b.v);
    for (let i = 0; i < edges.length;) {
      let j = i + 1;
      while (j < edges.length && edges[j].v - edges[i].v <= tol) j++; // a cluster never spans more than tol: thin walls stay two faces
      const run = edges.slice(i, j), w = run.reduce((t, e) => t + e.L, 0);
      const v = run.reduce((t, e) => t + e.v * e.L, 0) / w;
      run.forEach((e) => e.set(v));
      i = j;
    }
  }
  return q.map((poly) => poly.map(([x, y]) => [x * co - y * si, x * si + y * co] as Pt));
}

/**
 * A door or window put into the wall as drawn (`poche`): just beyond each jamb the drawn wall is crossed, which gives
 * its two faces there; the opening is moved onto the middle between them and takes the wall's thickness. null when
 * no drawn wall stands beyond either jamb, or the wall runs solid through a door's middle: the drawing has no
 * opening there.
 */
export function seatInPoche<T extends { a: Pt; b: Pt; kind?: 'door' | 'window' }>(o: T, poche: Pt[][][]): (T & { t: number }) | null {
  const L = dist(o.a, o.b);
  if (L < 1e-6) return null;
  const u: Pt = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], n: Pt = [-u[1], u[0]];
  // the wall's faces on the line through p across the wall: the stretch of drawn wall around p, as offsets along n
  const faces = (p: Pt): [number, number] | null => {
    let best: [number, number] | null = null;
    for (const rings of poche) {
      const ts: number[] = [];
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const da = (a[0] - p[0]) * u[0] + (a[1] - p[1]) * u[1], db = (b[0] - p[0]) * u[0] + (b[1] - p[1]) * u[1];
        if (da > 0 === db > 0) continue; // this edge does not cross the line
        const f = da / (da - db), x: Pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        ts.push((x[0] - p[0]) * n[0] + (x[1] - p[1]) * n[1]);
      }
      ts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i] <= 0.08 && ts[i + 1] >= -0.08 && ts[i + 1] - ts[i] >= 0.04 && ts[i + 1] - ts[i] <= 2.5) {
        if (!best || ts[i + 1] - ts[i] < best[1] - best[0]) best = [ts[i], ts[i + 1]];
      }
    }
    return best;
  };
  const found: [number, number][] = [];
  for (const [end, dir] of [[o.a, -1], [o.b, 1]] as [Pt, number][]) for (const reach of [0.08, 0.25, 0.5]) {
    const f = faces([end[0] + u[0] * dir * reach, end[1] + u[1] * dir * reach]);
    if (f) { found.push(f); break; }
  }
  if (!found.length) return null;
  // ...and a doorway is a gap in the wall: a door whose middle is solid wall was read where there is none. (A window is
  // drawn as lines across the wall, which count as wall here; it is cut into the wall when it is drawn.)
  const mid0: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  if (o.kind !== 'window' && faces(mid0)) return null;
  const lo = found.reduce((s, f) => s + f[0], 0) / found.length, hi = found.reduce((s, f) => s + f[1], 0) / found.length, mid = (lo + hi) / 2;
  const shift = (p: Pt): Pt => [round(p[0] + n[0] * mid, 3), round(p[1] + n[1] * mid, 3)];
  return { ...o, a: shift(o.a), b: shift(o.b), t: round(hi - lo, 3) };
}

/** An edge of a measured room outline (metres) and the stretches of it, as fractions, along which the drawing shows a line. */
export type SeenEdge = { a: Pt; b: Pt; drawn: [number, number][] };

/**
 * Walls only where the drawing has them. Every room is read with a closed outline, also where the plan is open, and
 * every edge of an outline gets a wall; a stretch of wall beside which the drawing shows nothing at all, on every
 * room edge that runs along it, is taken out. Stretches under half a metre stay (a gap in a scan is not an opening),
 * walls beside no measured edge stay, curved walls stay.
 */
export function openWalls(walls: Wall[], edges: SeenEdge[], minGap = 0.5): Wall[] {
  if (!edges.length) return walls;
  const out: Wall[] = [];
  for (const w of walls) {
    const L = dist(w.a, w.b);
    if (w.curve || L < 0.05) { out.push(w); continue; }
    const u: Pt = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const along = (p: Pt) => (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1], off = (p: Pt) => Math.abs((p[0] - w.a[0]) * -u[1] + (p[1] - w.a[1]) * u[0]);
    const known: [number, number][] = [], drawn: [number, number][] = [];
    for (const e of edges) {
      const Le = dist(e.a, e.b);
      if (Le < 0.05 || Math.abs(((e.b[0] - e.a[0]) * u[1] - (e.b[1] - e.a[1]) * u[0]) / Le) > 0.17) continue; // not along this wall
      const mid: Pt = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
      if (off(mid) > w.thickness / 2 + 0.25) continue; // not beside it
      const p = (f: number) => along([e.a[0] + (e.b[0] - e.a[0]) * f, e.a[1] + (e.b[1] - e.a[1]) * f]);
      const span = (f0: number, f1: number): [number, number] => { const x = p(f0), y = p(f1); return [Math.min(x, y), Math.max(x, y)]; };
      known.push(span(0, 1));
      for (const [f0, f1] of e.drawn) drawn.push(span(f0, f1));
    }
    if (!known.length) { out.push(w); continue; }
    // open = seen by some edge and drawn by none; found on a fine grid along the wall
    const step = 0.05, n = Math.max(1, Math.round(L / step)), has = (xs: [number, number][], t: number) => xs.some(([x, y]) => t >= x - 0.1 && t <= y + 0.1);
    const open = Array.from({ length: n }, (_, i) => { const t = ((i + 0.5) * L) / n; return has(known, t) && !has(drawn, t); });
    for (let i = 0; i < n;) { // stretches too short to be an opening are wall after all
      if (!open[i]) { i++; continue; }
      let j = i; while (j < n && open[j]) j++;
      if (((j - i) * L) / n < minGap) for (let q = i; q < j; q++) open[q] = false;
      i = j;
    }
    let piece = 0;
    for (let i = 0; i < n;) {
      if (open[i]) { i++; continue; }
      let j = i; while (j < n && !open[j]) j++;
      const t0 = (i * L) / n, t1 = (j * L) / n;
      if (t1 - t0 >= 0.2 || (i === 0 && j === n)) out.push(i === 0 && j === n ? w : { ...w, id: `${w.id}p${++piece}`, a: [round(w.a[0] + u[0] * t0, 3), round(w.a[1] + u[1] * t0, 3)], b: [round(w.a[0] + u[0] * t1, 3), round(w.a[1] + u[1] * t1, 3)] });
      i = j;
    }
  }
  return out.map((w, i) => ({ ...w, id: `w${i + 1}` }));
}

/**
 * A fitting's box (corners a, b in metres) cut back to the room it stands in, when part of it reaches past the room's
 * outline (into a wall, or through it): the bounds of what lies inside the room it mostly stands in. null when the
 * box is inside a room already, stands in none (a column on a terrace edge), or would lose most of itself.
 */
export function fixtureInRoom(a: Pt, b: Pt, rooms: Room[]): [Pt, Pt] | null {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const full = (x1 - x0) * (y1 - y0);
  if (!(full > 0)) return null;
  const polyArea = (q: Pt[]) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
  let best: { area: number; part: Pt[] } | null = null;
  for (const r of rooms) {
    let part = r.polygon;
    for (const [u, c, keep] of [[[1, 0], x0, 1], [[1, 0], x1, -1], [[0, 1], y0, 1], [[0, 1], y1, -1]] as [Pt, number, 1 | -1][]) {
      part = part.length >= 3 ? clipHalf(part, [0, 0], u, c, keep) : [];
    }
    const area = part.length >= 3 ? polyArea(part) : 0;
    if (area > (best?.area ?? 0)) best = { area, part };
  }
  if (!best || best.area >= 0.97 * full || best.area < 0.45 * full) return null;
  const bb = bounds(best.part);
  if (bb.x1 - bb.x0 < 0.5 * (x1 - x0) || bb.y1 - bb.y0 < 0.5 * (y1 - y0)) return null; // a sliver along one side is not the fitting
  return [[bb.x0, bb.y0], [bb.x1, bb.y1]];
}

/**
 * A room's outline in metres with its curved walls drawn as they will be kept: each arc (corners from..from+n-1 of
 * `poly`, on a circle) is laid out again as even pieces about 25 cm long between its first and last corner, which is
 * fine enough to look and measure round (under a centimetre off the circle) and coarse enough for each piece to be a
 * wall. Returns the new polygon and where its arcs now are.
 */
export function withArcs(poly: Pt[], arcs: Arc[]): { polygon: Pt[]; arcs: Arc[] } {
  if (!arcs.length) return { polygon: poly, arcs: [] };
  const sorted = [...arcs].sort((a, b) => a.from - b.from), polygon: Pt[] = [], out: Arc[] = [];
  let i = 0;
  for (const c of sorted) {
    if (c.from < i || c.from + c.n > poly.length) continue; // overlapping or out of range: left as plain corners
    while (i < c.from) polygon.push(poly[i++]);
    const a = poly[c.from], b = poly[c.from + c.n - 1], mid = poly[c.from + (c.n >> 1)];
    const ang = (p: Pt) => Math.atan2(p[1] - c.center[1], p[0] - c.center[0]);
    const t0 = ang(a), TAU = 2 * Math.PI, ccw = Math.sin(ang(mid) - t0) > 0;
    const sweep = ccw ? (((ang(b) - t0) % TAU) + TAU) % TAU : -((((t0 - ang(b)) % TAU) + TAU) % TAU);
    const ra = dist(a, c.center), rb = dist(b, c.center), len = Math.abs(sweep) * c.radius;
    const steps = Math.max(len < 0.32 ? 1 : 4, Math.min(64, Math.ceil(len / 0.25), Math.floor(len / 0.08)));
    out.push({ from: polygon.length, n: steps + 1, center: [round(c.center[0], 3), round(c.center[1], 3)], radius: round(c.radius, 3) });
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (sweep * k) / steps, r = ra + ((rb - ra) * k) / steps; // the ends stay exactly where they are
      polygon.push(k === 0 ? a : k === steps ? b : [round(c.center[0] + r * Math.cos(t), 3), round(c.center[1] + r * Math.sin(t), 3)]);
    }
    i = c.from + c.n;
  }
  while (i < poly.length) polygon.push(poly[i++]);
  return { polygon, arcs: out };
}

const segDist = (p: Pt, a: Pt, b: Pt) => { const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2)); return dist(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); };
type Op = { kind: 'door' | 'window'; a: Pt; b: Pt };
/**
 * Seats openings in the walls and drops repeats. Each opening is projected onto the centre line of the nearest wall
 * (any angle), so it cuts that wall instead of floating beside it; one that is already there, from an
 * earlier source in the list, is not added again. Openings with no wall within reach are kept where they were read,
 * unless they lie across the floor of one of `rooms`: those are misreadings and are left out.
 */
export function seatOpenings(ops: Op[], walls: Wall[], reach = 0.6, rooms: Room[] = []): Op[] {
  const out: Op[] = [];
  for (const o of ops) {
    const L = dist(o.a, o.b);
    if (!(L >= 0.25)) continue; // too short to be a door or window: a misread tick
    const d: Pt = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], m: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    let best: { cost: number; w: Wall; u: Pt; along: boolean } | null = null;
    for (const w of walls) {
      const Lw = dist(w.a, w.b);
      if (Lw < 0.05) continue;
      const u: Pt = [(w.b[0] - w.a[0]) / Lw, (w.b[1] - w.a[1]) / Lw];
      const t = Math.max(0, Math.min(Lw, (m[0] - w.a[0]) * u[0] + (m[1] - w.a[1]) * u[1]));
      const gap = dist(m, [w.a[0] + u[0] * t, w.a[1] + u[1] * t]);
      if (gap > reach + w.thickness / 2) continue;
      const along = Math.abs(d[0] * u[0] + d[1] * u[1]) > 0.7;
      const cost = gap + (along ? 0 : 0.4); // a wall running the opening's way wins over a nearer cross wall
      if (!best || cost < best.cost) best = { cost, w, u, along };
    }
    let s: Op = o;
    // no wall near it, and it lies across the floor of a room or along a boundary with no wall: a door or window is in a
    // wall, so this was misread
    if (!best && rooms.some((r) => inside(m, r.polygon) || r.polygon.some((p, i) => segDist(m, p, r.polygon[(i + 1) % r.polygon.length]) < 1.5))) continue;
    if (best) {
      const { w, u } = best, on = (p: Pt) => (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1], at = (t: number): Pt => [round(w.a[0] + u[0] * t, 3), round(w.a[1] + u[1] * t, 3)];
      // read across the wall (the model gave the door leaf): keep its width, centred where it was read
      const [t0, t1] = best.along ? [on(o.a), on(o.b)] : [on(m) - L / 2, on(m) + L / 2];
      if (Math.abs(t1 - t0) >= 0.25) s = { kind: o.kind, a: at(t0), b: at(t1) };
    }
    const sL = dist(s.a, s.b), su: Pt = [(s.b[0] - s.a[0]) / sL, (s.b[1] - s.a[1]) / sL];
    const repeat = out.some((p) => {
      const pL = dist(p.a, p.b), pu: Pt = [(p.b[0] - p.a[0]) / pL, (p.b[1] - p.a[1]) / pL];
      if (Math.abs(su[0] * pu[0] + su[1] * pu[1]) < 0.9) return false;
      const k = (q: Pt) => (q[0] - p.a[0]) * pu[0] + (q[1] - p.a[1]) * pu[1];
      const off = Math.abs((s.a[0] + s.b[0] - 2 * p.a[0]) / 2 * -pu[1] + (s.a[1] + s.b[1] - 2 * p.a[1]) / 2 * pu[0]);
      const [x0, x1] = [k(s.a), k(s.b)].sort((x, y) => x - y);
      return off < 0.35 && Math.min(x1, pL) - Math.max(x0, 0) > 0.4 * Math.min(sL, pL);
    });
    if (!repeat) out.push(s);
  }
  return out;
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

/**
 * What the ingestion service needs to trace exact room outlines (POST /trace): the rooms as read, and every opening
 * known so far (both readings and the symbol detector) to draw shut, all in render pixels. Rooms keep their index.
 */
export function traceRequest(raw: Raw, an: Pick<Analysis, 'width' | 'height' | 'detections'>): { rooms: Pt[][]; close: Seg[]; boxes: number[][] } {
  const px = (p: number[]): Pt => [((p?.[1] ?? 0) / 1000) * an.width, ((p?.[0] ?? 0) / 1000) * an.height];
  const close: Seg[] = [...raw.openings, ...(raw.more_openings ?? [])].filter((o) => o?.a?.length === 2 && o?.b?.length === 2).map((o) => [...px(o.a), ...px(o.b)] as Seg);
  for (const d of an.detections ?? []) {
    if ((d.kind !== 'door' && d.kind !== 'window') || d.bbox?.length !== 4) continue;
    const [x0, y0, x1, y1] = d.bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    close.push(x1 - x0 >= y1 - y0 ? [x0, cy, x1, cy] : [cx, y0, cx, y1]); // the box lies across the wall: its long axis runs along it
  }
  // fittings and furniture as read, [x0, y0, x1, y1], by index: the service tightens each onto the lines drawn there
  const boxes = (raw.fixtures ?? []).map((f) => { if (f.box?.length !== 4) return []; const a = px([f.box[0], f.box[1]]), b = px([f.box[2], f.box[3]]); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; });
  return { rooms: raw.rooms.map((r) => (r.polygon?.length >= 3 ? r.polygon.map(px) : [])), close, boxes };
}

/**
 * What the ingestion service measured on the render itself (POST /trace), all in render pixels and by index:
 * rooms[i] the outline of raw.rooms[i] (how[i]: traced from an enclosed space, or its edges fitted to the wall faces),
 * boxes[i] the box of raw.fixtures[i] tightened onto its lines, exterior_px the thickness of the outside walls.
 * null wherever the drawing gave no clear answer: then what the model read stands.
 */
export type Measured = { rooms: (number[][] | null)[]; how?: (string | null)[]; /** the filled walls as drawn, [[outer ring, hole, ...], ...] in render pixels, and the share of room outline they run along */ poche?: number[][][][] | null; poche_share?: number | null; /** drawn[i][k]: along which stretches of edge k of rooms[i] anything is drawn, as fractions of the edge */ drawn?: (number[][][] | null)[]; /** arcs[i]: the curved walls of rooms[i], each [first corner, corners, centre x, centre y, radius] */ arcs?: (number[][] | null)[]; boxes?: (number[] | null)[]; /** blank[i]: nothing is drawn where raw.fixtures[i] was read */ blank?: boolean[]; exterior_px?: number | null };

export function buildPlan(raw: Raw, an: Omit<Analysis, 'render_png'>, fileId: string, renderSha: string, measuredOn?: Measured | (number[][] | null)[]): Plan {
  const seen: Measured | undefined = Array.isArray(measuredOn) ? { rooms: measuredOn } : measuredOn;
  const traced = seen?.rooms;
  const { width: W, height: H } = an;
  const px = (p: number[]): Pt => [((p?.[1] ?? 0) / 1000) * W, ((p?.[0] ?? 0) / 1000) * H];
  const tol = Math.max(W, H) * 0.01;
  let corners = 0, snapped = 0;
  const snap = (p: Pt) => (an.segments.length ? snapPoint(p, an.segments, tol) : null) ?? p;

  // Vector line work is exact; raster lines (OpenCV on stroke faces) are not, so raster outlines are straightened too.
  const raster = an.kind === 'image' || an.kind === 'pdf-scan';
  let tracedN = 0, fittedN = 0;
  const read = raw.rooms.map((r, i) => ({ r, t: traced?.[i], i })).filter(({ r }) => r.polygon?.length >= 3).map(({ r, t, i }) => {
    // The outline traced from the wall lines is exact; the one the model read is the fallback.
    const exact = t && t.length >= 3 && t.every((p) => p?.length === 2 && p.every(Number.isFinite)) ? (t as Pt[]) : null;
    if (exact) { tracedN++; if (seen?.how?.[i] === 'fitted') fittedN++; }
    const start = exact ?? r.polygon.map(px);
    // curved walls of the measured outline: their corners stay where the circle put them
    const arcs = (exact ? seen?.arcs?.[i] ?? [] : []).filter((c) => c?.length === 5 && c.every(Number.isFinite) && c[0] >= 0 && c[1] >= 3 && c[0] + c[1] <= start.length && c[4] > 0);
    const curved = start.map((_, k) => arcs.some((c) => k >= c[0] && k < c[0] + c[1]));
    const res = snapPolygon(start, an.segments, tol);
    corners += start.length; snapped += res.snapped;
    const drawn = exact && seen?.drawn?.[i]?.length === start.length ? seen.drawn[i]! : null;
    return { ...r, poly: res.poly.map((p, k) => (curved[k] ? start[k] : p)), loose: raster || res.snapped < start.length, arcs, curved, drawn };
  });
  // One set of axes for the whole plan, so neighbouring rooms stay parallel; a room that mostly runs another way
  // (a wing at an angle) is straightened along its own.
  const planAxis = dominantAxis(read.map((r) => r.poly)).axis;
  const straight = read.map(({ loose, ...r }) => {
    if (!loose) return r;
    const own = dominantAxis([r.poly]);
    const followsPlan = r.poly.reduce((s, a, i) => { const b = r.poly[(i + 1) % r.poly.length]; return s + (axisGap(Math.atan2(b[1] - a[1], b[0] - a[0]), planAxis) <= 4 * DEG ? dist(a, b) : 0); }, 0);
    const perim = r.poly.reduce((s, a, i) => s + dist(a, r.poly[(i + 1) % r.poly.length]), 0) || 1;
    return { ...r, poly: regularize(r.poly, 4, followsPlan / perim >= 0.5 || own.share < 0.5 ? planAxis : own.axis, r.curved) };
  });
  // the same wall face in neighbouring rooms becomes one line; the reach is a few pixels, far less than a wall, so both faces of a wall survive
  const aligned = alignEdges(straight.map((r) => r.poly), planAxis, Math.max(2, Math.max(W, H) * 0.001));
  const rooms0 = straight.map((r, i) => ({ ...r, poly: read[i].loose ? aligned[i] : r.poly }));
  if (!rooms0.length) throw Object.assign(new Error('No rooms could be read from this drawing. Is it a floor plan?'), { fatal: true });
  // Both readings' openings; the first reading's come first, so a repeat from the second is the one dropped.
  const openings0 = [...raw.openings, ...(raw.more_openings ?? [])].filter((o) => o?.a?.length === 2 && o?.b?.length === 2 && (o.kind === 'door' || o.kind === 'window'))
    .map((o) => ({ kind: o.kind, a: snap(px(o.a)), b: snap(px(o.b)) }));
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

  let conflict = false;
  if (exact) {
    mpp = exact; scaleSource = an.scale!.source; ratio = an.scale!.ratio;
    const all = an.scale!.all_ratios ?? [];
    // A sheet can carry detail scales too (1:20 next to 1:100); the dimension decides which one the plan is drawn at.
    const pick = mppDim && ratio ? all.find((n) => Math.abs(mppDim / ((exact / ratio!) * n) - 1) <= 0.05) : undefined;
    if (pick && pick !== ratio) {
      mpp = (exact / ratio!) * pick; ratio = pick; scaleSource = `Sheet scale 1:${pick}`;
      assumptions.push(`Several scales on the sheet (${all.map((n) => `1:${n}`).join(', ')}); used 1:${pick}, the one dimension "${ev!.text}" confirms`);
    } else if (all.length > 1) assumptions.push(`Several scales on the sheet (${all.map((n) => `1:${n}`).join(', ')}); used ${mppDim ? 'the one the dimension confirms' : 'the most frequent'}, 1:${ratio}`);
    if (mppDim) {
      const diff = mppDim / mpp - 1;
      conflict = Math.abs(diff) > 0.05;
      assumptions.push(conflict
        ? `Conflict: dimension "${ev!.text}" implies a scale ${round(diff * 100, 1)}% off the stated one. Used ${scaleSource}, so this plan is a preview; check the drawing`
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

  const measured = !!exact && !conflict && snapRatio >= 0.9 && (an.kind === 'pdf-vector' || an.kind === 'dxf');
  assumptions.unshift(
    measured
      ? `Room outlines read by AI and snapped to the drawing's line work (${Math.round(snapRatio * 100)}% of corners); scale from the drawing`
      : `Preview, not measured: ${!exact ? 'no exact scale on the drawing' : conflict ? 'the stated scale and a dimension disagree' : `only ${Math.round(snapRatio * 100)}% of corners matched line work`}`,
    'Wall height 2.7 m (assumed)', `Wall thickness measured between neighbouring rooms where they face each other; otherwise exterior 0.30 m, interior 0.12 m (assumed, typical masonry: ${BOOK} Ch. 37)`,
  );

  if (traced) assumptions.splice(1, 0, tracedN ? `${tracedN} of ${rooms0.length} room outlines traced from the drawing's own wall lines${fittedN ? ` (${fittedN} edge by edge, where a room is open to its neighbour)` : ''}${tracedN < rooms0.length ? '; the rest as read by AI' : ''}` : 'Room outlines as read by AI: no enclosed space on the drawing matched them');
  const m = mpp!;
  const ox = ext.x0, oy = ext.y0;
  const toM = (p: Pt): Pt => [round((p[0] - ox) * m, 3), round((p[1] - oy) * m, 3)];
  let curvedWalls = 0;
  const rooms: Room[] = rooms0.map((r, i) => {
    const drawn = withArcs(r.poly.map(toM), r.arcs.map((c) => ({ from: c[0], n: c[1], center: [(c[2] - ox) * m, (c[3] - oy) * m] as Pt, radius: c[4] * m })));
    curvedWalls += drawn.arcs.length;
    return {
      id: `r${i + 1}`,
      name: r.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || `Room ${i + 1}`, // a label, not a paragraph
      type: (ROOM_TYPES as readonly string[]).includes(r.type) ? (r.type as Room['type']) : 'other',
      polygon: drawn.polygon,
      ...(drawn.arcs.length ? { arcs: drawn.arcs } : {}),
    };
  });
  if (curvedWalls) assumptions.push(`${curvedWalls} curved wall${curvedWalls === 1 ? '' : 's'} measured on the drawing as ${curvedWalls === 1 ? 'an arc' : 'arcs'} of a circle (radius shown when you point at ${curvedWalls === 1 ? 'it' : 'them'})`);
  // Vector outlines snap to wall faces (inside-face rooms); fall back to centreline merging if no wall gaps are found.
  // Outside walls at the thickness they are drawn with, where the drawing shows them filled; else the usual assumption.
  const drawnT = seen?.exterior_px ? seen.exterior_px * m : 0, exteriorT = drawnT >= 0.1 && drawnT <= 0.7 ? round(drawnT, 2) : 0.3;
  if (exteriorT !== 0.3 || (drawnT >= 0.1 && drawnT <= 0.7)) {
    const k = assumptions.findIndex((a) => a.startsWith('Wall thickness measured between'));
    if (k >= 0) assumptions[k] = `Wall thickness measured on the drawing: outside walls ${exteriorT.toFixed(2)} m, walls between rooms where they face each other; otherwise interior 0.12 m (assumed)`;
  }
  const { walls: faceWalls, paired } = wallsFromFaces(rooms, exteriorT);
  // What the drawing shows along each edge of each measured room (before curves were laid out again: same corners).
  const seenEdges: SeenEdge[] = rooms0.flatMap((r) => (r.drawn ?? []).map((spans, k) => {
    const a = toM(r.poly[k]), b = toM(r.poly[(k + 1) % r.poly.length]);
    return r.curved[k] && r.curved[(k + 1) % r.poly.length] ? null : { a, b, drawn: spans.filter((x) => x?.length === 2) as [number, number][] };
  }).filter((e): e is SeenEdge => !!e));
  const built = paired ? faceWalls : wallsFromRooms(rooms);
  // Where the drawing has its walls filled along most of the rooms' outline, the walls shown are the drawing's own.
  const poche: Pt[][][] | undefined = seen?.poche?.length && (seen.poche_share ?? 0) >= 0.6
    ? seen.poche.map((rings) => rings.filter((r) => r?.length >= 3).map((r) => r.map((p) => toM([p[0], p[1]])))).filter((rings) => rings.length) : undefined;
  if (poche?.length) assumptions.push('Walls are shown exactly as the drawing has them (its filled walls, traced), not rebuilt from the room outlines');
  // Without that, a boundary along which nothing is drawn is not a wall. (With it, the walls shown are right already.)
  const walls = poche?.length ? built : openWalls(built, seenEdges);
  const lengthOf = (ws: Wall[]) => ws.reduce((t, x) => t + dist(x.a, x.b), 0), opened = lengthOf(built) - lengthOf(walls);
  if (opened >= 0.5) assumptions.push(`${round(opened, 1)} m of room boundary has nothing drawn along it (open plan, doorways): no wall is drawn there`);
  // Scans and images: doors and windows the symbol detector found. Its boxes lie across the wall at each opening, so the
  // ones neither reading reported are added along the wall they sit in.
  const read0 = openings0.map((o): Op => ({ kind: o.kind, a: toM(o.a), b: toM(o.b) }));
  const fromDetector: Op[] = [];
  if (an.detections && raster) for (const d of an.detections) {
    if ((d.kind !== 'door' && d.kind !== 'window') || d.bbox?.length !== 4) continue;
    const a = toM([d.bbox[0], d.bbox[1]]), b = toM([d.bbox[2], d.bbox[3]]);
    const c: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bw = Math.abs(b[0] - a[0]), bh = Math.abs(b[1] - a[1]);
    let u: Pt = bw >= bh ? [1, 0] : [0, 1], bestD = 0.5;
    for (const w of walls) {
      const Lw = dist(w.a, w.b) || 1, wu: Pt = [(w.b[0] - w.a[0]) / Lw, (w.b[1] - w.a[1]) / Lw];
      const t = Math.max(0, Math.min(Lw, (c[0] - w.a[0]) * wu[0] + (c[1] - w.a[1]) * wu[1]));
      const gap = dist(c, [w.a[0] + wu[0] * t, w.a[1] + wu[1] * t]);
      if (gap < bestD) { bestD = gap; u = wu; }
    }
    const len = Math.min(d.kind === 'door' ? 2.4 : 6, bw * Math.abs(u[0]) + bh * Math.abs(u[1])); // the box's extent along the wall
    if (len >= 0.4) fromDetector.push({ kind: d.kind, a: [c[0] - (u[0] * len) / 2, c[1] - (u[1] * len) / 2], b: [c[0] + (u[0] * len) / 2, c[1] + (u[1] * len) / 2] });
  }
  // The detector's boxes sit on the opening itself, so where it and a reading report the same door or window the
  // detector's position is the one drawn; the readings add what the detector missed.
  const seated = seatOpenings([...fromDetector, ...read0], walls, 0.6, rooms);
  const readCount = seatOpenings(read0, walls, 0.6, rooms).length, added = seated.length - readCount;
  if (added > 0) assumptions.push(`${added} door${added === 1 ? '' : 's'} or window${added === 1 ? '' : 's'} the language model did not report ${added === 1 ? 'was' : 'were'} added from the symbol detector`);
  // Every item keeps where it was read from: the page and its box on the render, for citations and crops.
  const page = an.page ?? 1;
  const src = (pts: Pt[], pad = 0): Src => {
    const b = bounds(pts), k = (v: number, o: number, max: number) => Math.round(Math.min(max, Math.max(0, v / m + o)));
    return { page, box: [k(b.x0 - pad, ox, W), k(b.y0 - pad, oy, H), k(b.x1 + pad, ox, W), k(b.y1 + pad, oy, H)] };
  };
  for (const r of rooms) r.src = src(r.polygon, 0.15);
  const n = { door: 0, window: 0 };
  // In the drawing's own walls, a door or window sits where the wall is: centred in its thickness, and as deep.
  const inDrawn: (Op & { t?: number })[] = poche?.length ? seated.map((o) => seatInPoche(o, poche)).filter((o): o is Op & { t: number } => !!o) : seated;
  if (poche?.length && inDrawn.length < seated.length) assumptions.push(`${seated.length - inDrawn.length} door${seated.length - inDrawn.length === 1 ? '' : 's'} or window${seated.length - inDrawn.length === 1 ? '' : 's'} read where the drawing has no wall ${seated.length - inDrawn.length === 1 ? 'is' : 'are'} left out`);
  const openings: Opening[] = inDrawn.map((o) => ({ id: `${o.kind[0]}${++n[o.kind]}`, kind: o.kind, a: o.a, b: o.b, src: src([o.a, o.b], 0.5), ...(o.t ? { t: o.t } : {}) }));
  const bb = bounds([...rooms.flatMap((r) => r.polygon), ...walls.flatMap((w) => [w.a, w.b])]);
  // Fittings and furniture, each as a box in render pixels. Where it stands comes from the best source there is:
  // the symbol detector for what it was trained on (toilets, sinks, showers and bathtubs), else the lines the service
  // found drawn there, else the box as the model read it.
  type Fx = { kind: Fixture['kind']; box: [number, number, number, number]; by: 'detector' | 'lines' | 'read' };
  let notDrawn = 0;
  const fx: Fx[] = (raw.fixtures ?? []).map((f, i): Fx | null => {
    if (!(FIXTURE_KINDS as readonly string[]).includes(f.kind) || f.box?.length !== 4) return null;
    if (seen?.blank?.[i]) { notDrawn++; return null; } // read where the sheet is empty: not shown, and said so below
    const t = seen?.boxes?.[i], a = px([f.box[0], f.box[1]]), b = px([f.box[2], f.box[3]]);
    const tight = t && t.length === 4 && t.every(Number.isFinite) && t[2] > t[0] && t[3] > t[1];
    return { kind: f.kind as Fixture['kind'], by: tight ? 'lines' : 'read',
      box: tight ? (t as [number, number, number, number]) : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  }).filter((f): f is Fx => !!f);
  let fxFromDetector = 0, fxMoved = 0;
  if (an.detections && raster) {
    const kindsOf: Record<string, Fixture['kind'][]> = { toilet: ['wc'], sink: ['sink'], shower_bath: ['shower', 'bathtub'] };
    for (const d of an.detections) {
      const kinds = kindsOf[d.kind];
      if (!kinds || d.bbox?.length !== 4) continue;
      const [x0, y0, x1, y1] = d.bbox, pw = (x1 - x0) / 2, ph = (y1 - y0) / 2;
      // the reading's item of that kind standing in (or right by) the detector's box is the same object
      const hit = fx.find((f) => f.by !== 'detector' && kinds.includes(f.kind) && (f.box[0] + f.box[2]) / 2 > x0 - pw && (f.box[0] + f.box[2]) / 2 < x1 + pw && (f.box[1] + f.box[3]) / 2 > y0 - ph && (f.box[1] + f.box[3]) / 2 < y1 + ph);
      if (hit) { hit.box = [x0, y0, x1, y1]; hit.by = 'detector'; fxMoved++; }
      else { // only the detector saw it: a long box is a bathtub, a squarish one a shower
        // ...unless it is too small to be one (a speck the detector took for a symbol on a kind of drawing it never saw)
        if (Math.min(x1 - x0, y1 - y0) * m < (d.kind === 'shower_bath' ? 0.45 : 0.2)) continue;
        const long = Math.max(x1 - x0, y1 - y0) / Math.max(1, Math.min(x1 - x0, y1 - y0));
        fx.push({ kind: d.kind === 'shower_bath' ? (long >= 1.6 ? 'bathtub' : 'shower') : kinds[0], box: [x0, y0, x1, y1], by: 'detector' });
        fxFromDetector++;
      }
    }
  }
  const tightened = fx.filter((f) => f.by === 'lines').length;
  if (fxMoved + fxFromDetector + tightened > 0) assumptions.push(`Fittings and furniture placed from the drawing itself: ${[
    fxMoved && `${fxMoved} where the symbol detector found them`, fxFromDetector && `${fxFromDetector} only the symbol detector found`, tightened && `${tightened} on the lines drawn there`,
  ].filter(Boolean).join(', ')}; the rest where the language model read them`);
  // The same thing reported twice (two boxes of one kind over each other) is one thing: the better-placed box stays.
  const rank = { detector: 0, lines: 1, read: 2 };
  const overlap = (p: Fx['box'], q: Fx['box']) => {
    const ix = Math.min(p[2], q[2]) - Math.max(p[0], q[0]), iy = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
    return ix > 0 && iy > 0 ? (ix * iy) / Math.min((p[2] - p[0]) * (p[3] - p[1]), (q[2] - q[0]) * (q[3] - q[1])) : 0;
  };
  const sameSize = (p: Fx['box'], q: Fx['box']) => { const r = ((p[2] - p[0]) * (p[3] - p[1])) / ((q[2] - q[0]) * (q[3] - q[1])); return r > 0.6 && r < 1.6; };
  // ...also when the two readings disagree on what it is (one box, a toilet and a sink): the better-placed one is believed
  const same = (f: Fx, g: Fx) => (g.kind === f.kind && overlap(f.box, g.box) > 0.6) || (overlap(f.box, g.box) > 0.8 && sameSize(f.box, g.box));
  const once = fx.filter((f, i) => !fx.some((g, j) => j !== i && same(f, g) && (rank[g.by] < rank[f.by] || (rank[g.by] === rank[f.by] && j < i))));
  if (raw.zoom?.tiles) assumptions.push(`Fittings and furniture were read a second time on ${raw.zoom.tiles} enlarged piece${raw.zoom.tiles === 1 ? '' : 's'} of the plan (${raw.zoom.found} found there)`);
  if (notDrawn) assumptions.push(`${notDrawn} fitting${notDrawn === 1 ? '' : 's'} the language model reported where nothing is drawn ${notDrawn === 1 ? 'is' : 'are'} left out`);
  let clipped = 0;
  const fixtures: Fixture[] = once.map((f, i) => {
    let a = toM([f.box[0], f.box[1]]), b = toM([f.box[2], f.box[3]]);
    // Nothing stands inside a wall: a box that reaches past the faces of the room it stands in ends at them.
    const inRoom = fixtureInRoom(a, b, rooms);
    if (inRoom) { [a, b] = inRoom; clipped++; }
    const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    return { ...placeFixture(f.kind, [round((a[0] + b[0]) / 2, 3), round((a[1] + b[1]) / 2, 3)], round(w, 3), round(h, 3), walls, rooms, `f${i + 1}`), src: src([a, b], 0.1) };
  }).filter((f) => f.size[0] > 0.1 && f.size[1] > 0.1 && f.size[0] < 4 && f.size[1] < 4);
  if (clipped) assumptions.push(`${clipped} fitting${clipped === 1 ? '' : 's'} read as reaching into a wall end${clipped === 1 ? 's' : ''} at the face of the room ${clipped === 1 ? 'it stands' : 'they stand'} in`);

  // Scans and images: the detector's symbols, in metres. Counting these is its job, not the language model's.
  let detected: Plan['detected'];
  if (an.detections && (an.kind === 'image' || an.kind === 'pdf-scan')) {
    const n: Record<string, number> = {};
    detected = { model: 'fixtures-v1', items: an.detections
      .filter((d) => (DETECTED_KINDS as readonly string[]).includes(d.kind) && d.bbox?.length === 4)
      .map((d) => {
        const a = toM([d.bbox[0], d.bbox[1]]), b = toM([d.bbox[2], d.bbox[3]]);
        const c: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        n[d.kind] = (n[d.kind] ?? 0) + 1;
        return { id: `x${d.kind[0]}${n[d.kind]}`, kind: d.kind as DetectedKind, conf: d.conf, box: [round(a[0], 3), round(a[1], 3), round(b[0], 3), round(b[1], 3)] as [number, number, number, number],
          room_id: rooms.find((r) => inside(c, r.polygon))?.id ?? null };
      }) };
    assumptions.push('Windows, doors, toilets, sinks, and showers and bathtubs are counted by the symbol detector, not by the language model');
  }

  // Levels: code parses the strings the model copied. Ceiling heights in mm or m (Metric Handbook Ch. 1 §2).
  const ceilText = raw.levels?.ceiling_height_text ?? null, floorText = raw.levels?.floor_level_text ?? null;
  const ceiling = parseCeiling(ceilText);
  const ceilingOk = ceiling !== null && ceiling >= 2 && ceiling <= 8 ? ceiling : null;
  const floor = parseLevel(floorText);
  if (ceilingOk) assumptions[1] = `Ceiling height ${ceilingOk} m from "${ceilText}" on the drawing`;
  // What is written on the sheet goes along with the plan (once each, short, a bounded number): notes and the title
  // block answer questions the geometry cannot.
  const sheetTexts = [...new Set(an.texts.map((t) => t.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80)).filter((t) => t.length > 1))].slice(0, 150);
  const plan: Plan = {
    version: 1,
    method: 'hybrid',
    measured,
    width: round(bb.x1, 2),
    height: round(bb.y1, 2),
    wallHeight: ceilingOk ?? 2.7,
    rooms,
    walls,
    openings,
    ...(poche?.length ? { poche } : {}),
    ...(sheetTexts.length ? { texts: sheetTexts } : {}),
    fixtures,
    ...(detected ? { detected } : {}),
    levels: { floor, ceiling: ceilingOk,
      source: [floorText && `floor "${floorText}"`, ceilingOk && `ceiling "${ceilText}"`].filter(Boolean).join(', ') || 'not stated on the drawing' },
    scale: { metersPerPx: m, source: scaleSource, ...(ratio ? { ratio } : {}) },
    source: { fileId, renderSha, mime: 'image/png', imageWidth: W, imageHeight: H, offset: [round(-ox * m, 3), round(-oy * m, 3)], page, ...(an.pages ? { pages: an.pages } : {}) },
    provenance: { kind: an.kind, scaleExact: !!exact, snapped: round(snapRatio, 3), segments: an.segments.length, traced: tracedN },
    assumptions,
  };
  // Drawings rarely make the swing side machine-readable: apply the usual rules (into rooms, not corridors; hinge by a corner).
  plan.openings = orientDoors(plan);
  return plan;
}
