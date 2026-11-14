// Design knowledge used for reading drawings and checking plans. Every figure cites its source so answers stay verifiable.
// Source: Metric Handbook: Planning and Design Data, 4th ed. (D. Littlefield, ed., Architectural Press 2012).
import { type Plan, type Pt, type Room, type Opening, area, dist, round } from './plan';
import { escapeRoutes } from './escape';

export const BOOK = 'Metric Handbook, 4th ed.';

/** Ch. 1 Table III: internationally recommended scales for construction drawings. */
export const PREFERRED_SCALES = [1, 5, 10, 20, 50, 100, 200, 500, 1000, 1250, 2000, 2500, 5000];
/** Ch. 1 Table III: general location drawings (floor plans) are drawn at 1:200, 1:100 or 1:50. */
export const PLAN_SCALES = [50, 100, 200];

export function nearestPreferredScale(n: number, tolerance = 0.05): number | null {
  const best = PREFERRED_SCALES.reduce((a, b) => (Math.abs(b / n - 1) < Math.abs(a / n - 1) ? b : a));
  return Math.abs(best / n - 1) <= tolerance ? best : null;
}

/**
 * Ch. 1 §2: drawings use mm without decimals (2000 = 2 m) or metres; units are not mixed;
 * Continental practice uses a decimal comma; no thousands marker (a space may group digits).
 * Returns metres, or null if the text isn't a recognisable length.
 */
export function parseDimension(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/(\d)\s(?=\d{3}\b)/g, '$1');
  const ftin = t.match(/^(\d+)\s*['’]\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:["”]|in)?$/);
  if (ftin) return round(Number(ftin[1]) * 0.3048 + Number(ftin[2] ?? 0) * 0.0254, 4);
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (m[2] === 'mm') return v / 1000;
  if (m[2] === 'cm') return v / 100;
  if (m[2] === 'm') return v;
  // No unit: a decimal marker means metres (2.50 / 2,50); a plain integer of 3+ digits means millimetres (2500).
  if (/[.,]/.test(m[1])) return v;
  return v >= 100 ? v / 1000 : null;
}

type Std = { min: number; recommended?: number; ref: string; note: string };
/** Ch. 8 Table IV (minimum room sizes, m²) — the smallest minimum across household sizes for each room kind. */
export const ROOM_STANDARDS: Partial<Record<Room['type'], Std>> = {
  bedroom: { min: 6.5, recommended: 8, ref: `${BOOK} Ch. 8 Table IV`, note: 'single bedroom minimum 6.5 m² (8 m² recommended); main double bedroom minimum 11 m², other doubles 10 m²' },
  living: { min: 11, recommended: 11, ref: `${BOOK} Ch. 8 Table IV`, note: 'living room with dining kitchen: minimum 11 m² (1 person) to 17 m² (7 people)' },
  kitchen: { min: 5.5, recommended: 5.5, ref: `${BOOK} Ch. 8 Table IV`, note: 'galley kitchen minimum 5.5 m²; dining kitchen minimum 8 m²' },
};
export const BED = { single: [2.0, 0.9], double: [2.0, 1.5], ref: `${BOOK} Ch. 8 Table III` };
/** Ch. 2 Fig. 2.35: 900 mm normally used by one person with occasional passing; 1200–1400 mm for two people passing. */
export const CORRIDOR = { min: 0.9, passing: 1.2, ref: `${BOOK} Ch. 2 Fig. 2.35` };
/** Ch. 2 §4.6, §4.9: doorsets 800 / 900 / 1000 mm (coordinating); no door other than a cupboard narrower than an 800 mm set. */
export const DOOR = { typical: [0.8, 1.0], plausible: [0.6, 1.25], ref: `${BOOK} Ch. 2 §4.6, §4.9` };
/** Ch. 2 §5.2 / Table X: twice the rise plus the going between 550 and 700 mm; rise ≤ 220 mm (private), going ≥ 220 mm. */
export const STAIR = { twoRPlusG: [0.55, 0.7], maxRise: 0.22, minGoing: 0.22, ref: `${BOOK} Ch. 2 §5.2, Table X` };
/** Ch. 2 §4.5: wheelchair turning space 1.4 m square. */
export const TURNING = { side: 1.4, ref: `${BOOK} Ch. 2 §4.5` };

/** Ch. 41 Figs. 41.16–41.21: in a flat without an alternative exit, every point within 9 m of the entrance door. */
export const FLAT_TRAVEL = { max: 9, ref: `${BOOK} Ch. 41 Figs. 41.16–41.21` };
/** Ch. 41 Table XV (Approved Document B vol. 2 Table 2): maximum travel distance, one direction / more than one (m). */
export const TRAVEL: Record<string, [number, number]> = {
  institutional: [9, 18], 'residential bedrooms': [9, 18], 'residential elsewhere': [18, 35], office: [18, 45], shop: [18, 45],
  'assembly seating in rows': [15, 32], assembly: [18, 45], industrial: [25, 45], storage: [25, 45], 'plant room': [9, 35],
};
export const TRAVEL_REF = `${BOOK} Ch. 41 Table XV (direct distance may be taken as 2/3 of travel distance)`;
/** Ch. 41 Table XI (Approved Document B vol. 2 Table C1): floor space per person, m². */
export const OCCUPANCY: Record<string, number> = {
  'standing / bar': 0.3, 'assembly hall / dance': 0.5, concourse: 0.7, 'meeting / dining / restaurant': 1.0, exhibition: 1.5,
  'shop sales': 2.0, 'gallery / dormitory / workshop': 5.0, office: 6.0, 'shop (bulky goods)': 7.0, 'kitchen / library': 7.0,
  'bedroom / study-bedroom': 8.0, 'bed-sitting room': 10.0, 'storage / warehouse': 30.0,
};
export const OCCUPANCY_REF = `${BOOK} Ch. 41 Table XI`;
/** Ch. 41 Table XIV: minimum width of escape routes and exits by number of people. */
export function escapeWidth(people: number) {
  const mm = people <= 50 ? 750 : people <= 110 ? 850 : people <= 220 ? 1050 : 5 * people;
  return { people, min_width_mm: mm, ref: `${BOOK} Ch. 41 Table XIV` };
}
/** Ch. 42 §5.2: stairs ≥ 1000 mm clear between handrails, ≤ 12 steps a flight, ramps no steeper than 1:12 (1:20 preferred). */
export const ACCESS = { stairWidth: 1.0, stepsPerFlight: 12, ramp: '1:12 max, 1:20 preferred', level: '1:60', ref: `${BOOK} Ch. 42 §5.2, Tables V–VI` };
/** Ch. 31 Fig. 31.30: smallest single domestic garage 2400 × 4900 mm inside. */
export const GARAGE = { width: 2.4, length: 4.9, ref: `${BOOK} Ch. 31 Fig. 31.30` };
/** Ch. 37 §4: brick 215 × 102.5 × 65 mm, blocks 90–100 mm thick: plausible wall thicknesses for reading plans. */
export const WALL = { min: 0.075, max: 0.6, interior: 0.12, exterior: 0.3, ref: `${BOOK} Ch. 37 §4` };

const HABITABLE: Room['type'][] = ['living', 'dining', 'bedroom', 'kitchen', 'office'];

/** Openings lying on a room's boundary (within a wall's thickness). */
export function openingsOf(r: Room, openings: Opening[]) {
  return openings.filter((o) => {
    const m: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    return r.polygon.some((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length];
      const L2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((m[0] - p[0]) * (q[0] - p[0]) + (m[1] - p[1]) * (q[1] - p[1])) / L2));
      return dist(m, [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]) < 0.4;
    });
  });
}

export type Check = { level: 'warn' | 'info'; text: string; ref: string; room_id?: string };

/** Shortest side of the room's minimum-area bounding rectangle (rotating calipers over the hull edges). */
function minWidth(poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    if (L < 1e-6) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    for (const p of poly) {
      const s = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], t = (p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0];
      lo = Math.min(lo, s); hi = Math.max(hi, s); lo2 = Math.min(lo2, t); hi2 = Math.max(hi2, t);
    }
    best = Math.min(best, Math.min(hi - lo, hi2 - lo2));
  }
  return best;
}

/** Plausibility checks against design standards. A failed check usually means a misread outline, label or scale. */
export function checkPlan(plan: Plan): Check[] {
  const out: Check[] = [];
  for (const r of plan.rooms) {
    const a = area(r.polygon), w = minWidth(r.polygon);
    const std = ROOM_STANDARDS[r.type];
    if (std && a < std.min) out.push({ level: 'warn', room_id: r.id, ref: std.ref, text: `${r.name}: ${round(a, 1)} m² is below the ${std.min} m² minimum for a ${r.type} (${std.note}). Check the outline, the room type or the scale.` });
    // A 900 mm bed plus a 600 mm access strip (our assumption) needs 1.5 m of clear width.
    if (r.type === 'bedroom' && w < BED.single[1] + 0.6) out.push({ level: 'info', room_id: r.id, ref: BED.ref, text: `${r.name}: ${round(w, 2)} m wide, too narrow for a 2000 × 900 mm bed plus access. Is it really a bedroom?` });
    if (r.type === 'circulation' && w < CORRIDOR.min) out.push({ level: 'warn', room_id: r.id, ref: CORRIDOR.ref, text: `${r.name}: ${round(w, 2)} m wide, under the 900 mm a corridor normally needs.` });
  }
  // With fewer than two windows found the reading is probably incomplete; don't flag every room.
  const hasWindows = plan.openings.filter((o) => o.kind === 'window').length >= 2;
  for (const r of plan.rooms) {
    const w = minWidth(r.polygon);
    if (r.type === 'garage') {
      const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
      const len = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (w < GARAGE.width || len < GARAGE.length) out.push({ level: 'warn', room_id: r.id, ref: GARAGE.ref, text: `${r.name}: ${round(w, 2)} × ${round(len, 2)} m, smaller than the 2.4 × 4.9 m minimum single garage.` });
    }
    if (r.type === 'stair' && w < ACCESS.stairWidth) out.push({ level: 'info', room_id: r.id, ref: ACCESS.ref, text: `${r.name}: ${round(w, 2)} m wide; accessible stairs need 1000 mm clear between handrails.` });
    if (hasWindows && HABITABLE.includes(r.type) && !openingsOf(r, plan.openings).some((o) => o.kind === 'window'))
      out.push({ level: 'info', room_id: r.id, ref: `${BOOK} Ch. 39`, text: `${r.name}: no window found. Habitable rooms need daylight; check the drawing.` });
  }
  const hasDoors = plan.openings.some((o) => o.kind === 'door');
  const esc = hasDoors ? escapeRoutes(plan) : null;
  if (hasDoors && !esc) out.push({ level: 'info', ref: `${BOOK} Ch. 41`, text: 'No exit door found (a door with outside space on one side). Escape distances cannot be estimated; check the drawing.' });
  if (esc) {
    const worst = esc.routes.reduce((a, b) => (b.distance_m > a.distance_m ? b : a), esc.routes[0]);
    if (worst && worst.distance_m > FLAT_TRAVEL.max) {
      const r = plan.rooms.find((x) => x.id === worst.room_id)!;
      out.push({ level: 'info', room_id: r.id, ref: FLAT_TRAVEL.ref, text: `Furthest point (in ${r.name}) is about ${worst.distance_m} m from an exit door. A flat without an alternative exit is limited to 9 m unless it has a protected entrance hall.` });
    }
    for (const id of esc.unreachable) {
      const r = plan.rooms.find((x) => x.id === id)!;
      out.push({ level: 'info', room_id: id, ref: `${BOOK} Ch. 41`, text: `${r.name}: no door found leading out of it. Check the drawing for a missing door.` });
    }
  }
  const doors = plan.openings.filter((o) => o.kind === 'door').map((o) => dist(o.a, o.b)).sort((x, y) => x - y);
  if (doors.length >= 3) {
    const med = doors[doors.length >> 1];
    if (med < DOOR.plausible[0] || med > DOOR.plausible[1]) out.push({ level: 'warn', ref: DOOR.ref, text: `Doors measure ${round(med, 2)} m wide on average; typical doorsets are 0.8–1.0 m. The scale is probably off by about ${round(0.9 / med, 2)}×.` });
  }
  if (plan.scale.ratio && !PREFERRED_SCALES.includes(plan.scale.ratio)) out.push({ level: 'info', ref: `${BOOK} Ch. 1 Table III`, text: `1:${plan.scale.ratio} is not a preferred drawing scale; check that the scale was read correctly.` });
  return out;
}
