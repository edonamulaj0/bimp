import { type Plan, type Pt, type Room, type Opening, ROOM_TYPES, bounds, dist, wallsFromRooms, round } from '../../shared/plan';
import { generate, textOf } from './gemini';
import { type Env, fail, toBase64 } from './util';

const PROMPT_VERSION = 'extract-v1';
const P = { type: 'ARRAY', items: { type: 'NUMBER' } }; // [y, x] normalised 0-1000
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scale_evidence: {
      type: 'OBJECT', nullable: true,
      properties: { text: { type: 'STRING' }, value_m: { type: 'NUMBER' }, a: P, b: P },
      required: ['text', 'value_m', 'a', 'b'],
    },
    rooms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, type: { type: 'STRING', enum: [...ROOM_TYPES] }, polygon: { type: 'ARRAY', items: P } },
        required: ['name', 'type', 'polygon'],
      },
    },
    walls: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { a: P, b: P, kind: { type: 'STRING', enum: ['exterior', 'interior'] } }, required: ['a', 'b', 'kind'] },
    },
    openings: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['door', 'window'] }, a: P, b: P }, required: ['kind', 'a', 'b'] },
    },
  },
  required: ['rooms', 'walls', 'openings'],
};

const PROMPT = `You are reading an architectural floor plan (any language, any drawing style).
Extract its geometry as JSON. Every point is [y, x], normalised 0-1000 over the full image or page, origin top-left.
- rooms: every enclosed room or area. name = the room label exactly as written on the drawing (keep its language; if unlabelled, a short description).
  type = closest category. polygon = boundary along the inside face of the walls, vertices in order.
- walls: wall centrelines as straight segments; kind exterior or interior.
- openings: each door and window as the segment spanning the opening along its wall.
- scale_evidence: one dimension string written on the drawing (prefer the longest overall dimension), its value converted to metres,
  and the two endpoints of that dimension line. null if the drawing has no dimensions.
If the sheet has several plans, use only the main floor plan. Never invent rooms that are not drawn.`;

type Raw = {
  scale_evidence?: { text: string; value_m: number; a: number[]; b: number[] } | null;
  rooms: { name: string; type: string; polygon: number[][] }[];
  walls: { a: number[]; b: number[]; kind: 'exterior' | 'interior' }[];
  openings: { kind: 'door' | 'window'; a: number[]; b: number[] }[];
};

/** PDF page size in points from the first MediaBox; good enough for uncompressed page dictionaries. */
export function pdfPageSize(buf: ArrayBuffer): [number, number] | null {
  const head = new TextDecoder('latin1').decode(buf.slice(0, Math.min(buf.byteLength, 2_000_000)));
  const m = head.match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
  return m ? [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])] : null;
}

export async function extractPlan(env: Env, file: { id: string; mime: string; sha256: string; width: number | null; height: number | null }, data: ArrayBuffer): Promise<Plan> {
  const assumptions: string[] = ['Geometry extracted by AI from the drawing: preview, not measured', 'Wall height 2.7 m', 'Exterior walls 0.30 m, interior 0.12 m'];
  let W = file.width, H = file.height;
  if (!W || !H) {
    const size = file.mime === 'application/pdf' ? pdfPageSize(data) : null;
    [W, H] = size ?? [1191, 842];
    if (!size) assumptions.push('Page size unknown: assumed A3 landscape proportions');
  }

  const content = await generate(env, {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: file.mime, data: toBase64(data) } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  }, `${PROMPT_VERSION}:${file.sha256}`);

  let raw: Raw;
  try { raw = JSON.parse(textOf(content)); } catch { throw fail(502, 'The AI returned an unreadable plan. Try again or use a clearer image.'); }
  const px = (p: number[]): Pt => [((p?.[1] ?? 0) / 1000) * W!, ((p?.[0] ?? 0) / 1000) * H!];

  const rooms0 = raw.rooms.filter((r) => r.polygon?.length >= 3).map((r) => ({ ...r, poly: r.polygon.map(px) }));
  const openings0 = raw.openings.map((o) => ({ kind: o.kind, a: px(o.a), b: px(o.b) }));
  const walls0 = raw.walls.map((w) => ({ a: px(w.a), b: px(w.b), kind: w.kind }));
  if (!rooms0.length) throw fail(422, 'No rooms could be read from this drawing. Is it a floor plan?');

  // Scale: from a dimension string on the drawing, else from typical door width, else an assumed building width.
  const ext = bounds(rooms0.flatMap((r) => r.poly));
  const extentPx = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0);
  let mpp: number | null = null, scaleSource = '';
  const ev = raw.scale_evidence;
  if (ev && ev.value_m > 0) {
    const d = dist(px(ev.a), px(ev.b));
    if (d > 5) { mpp = ev.value_m / d; scaleSource = `Dimension "${ev.text}" on the drawing`; }
  }
  const sane = (m: number | null) => m !== null && extentPx * m > 2 && extentPx * m < 500;
  if (!sane(mpp)) {
    const doors = openings0.filter((o) => o.kind === 'door').map((o) => dist(o.a, o.b)).filter((d) => d > 1).sort((a, b) => a - b);
    if (doors.length) {
      mpp = 0.9 / doors[doors.length >> 1];
      scaleSource = 'Assumed typical door width of 0.9 m';
      assumptions.push(scaleSource);
    }
  }
  if (!sane(mpp)) {
    mpp = 12 / extentPx;
    scaleSource = 'No scale found: assumed the plan is 12 m across';
    assumptions.push(scaleSource);
  }
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
  const walls = walls0.length >= 3
    ? walls0.map((w, i) => ({ id: `w${i + 1}`, a: toM(w.a), b: toM(w.b), thickness: w.kind === 'exterior' ? 0.3 : 0.12 }))
    : wallsFromRooms(rooms);
  const all = [...rooms.flatMap((r) => r.polygon), ...walls.flatMap((w) => [w.a, w.b])];
  const bb = bounds(all);

  return {
    version: 1,
    method: 'gemini',
    measured: false,
    width: round(bb.x1, 2),
    height: round(bb.y1, 2),
    wallHeight: 2.7,
    rooms,
    walls,
    openings,
    scale: { metersPerPx: m, source: scaleSource },
    source: { fileId: file.id, mime: file.mime, imageWidth: W, imageHeight: H, offset: [round(-ox * m, 3), round(-oy * m, 3)] },
    assumptions,
  };
}
