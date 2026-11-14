import { type Plan, type Room, type Opening, type Pt, type Fixture, type FixtureKind, wallsFromRooms } from './plan';

/**
 * The pilot house: the sample every account opens with and the plan drawn on the marketing site. A single-storey,
 * three-bedroom house, 16.8 × 9.6 m on wall centre lines, street to the north and garden to the south. It is laid out
 * the way a residential architect would argue for it:
 *  - An entrance transition: the front door opens into a hall with coats to one side and a straight sightline through
 *    the living space to the garden door, so you see daylight and the garden before you see anyone's bedroom.
 *  - An intimacy gradient from public to private: hall, then the shared kitchen / dining / living room, then a short
 *    night corridor, then bedrooms; the main bedroom is reached last, through its own dressing room.
 *  - Service rooms (utility, WC, bathroom) on the street side as a buffer; the rooms people stay in face the garden.
 *  - One generous shared room at the heart, zoned by furniture rather than walls: kitchen by the utility and back
 *    door, table by the terrace window, seating at the quiet end.
 *  - Light on two sides in the living room, bedroom 2 and the main bedroom; a terrace as an outdoor room off the plan.
 *  - Circulation kept short: hall and corridor are about a tenth of the floor area, and no room is a way through to
 *    another except the dressing room, by design.
 * Geometry is exact (centre lines); it is a model for learning bimp, not a drawing of a real site.
 */
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: Room[] = [
  { id: 'r1', name: 'Utility', type: 'utility', polygon: rect(0, 0, 2.7, 4.2) },
  { id: 'r2', name: 'Bedroom 3', type: 'bedroom', polygon: rect(2.7, 0, 6.0, 4.2) },
  { id: 'r3', name: 'Entrance hall', type: 'circulation', polygon: rect(6.0, 0, 8.4, 4.2) },
  { id: 'r4', name: 'WC', type: 'wc', polygon: rect(8.4, 0, 9.6, 3.0) },
  { id: 'r5', name: 'Bathroom', type: 'bathroom', polygon: rect(9.6, 0, 12.6, 3.0) },
  { id: 'r6', name: 'Corridor', type: 'circulation', polygon: rect(8.4, 3.0, 12.6, 4.2) },
  { id: 'r7', name: 'Bedroom 2', type: 'bedroom', polygon: rect(12.6, 0, 16.8, 4.2) },
  { id: 'r8', name: 'Kitchen / dining / living', type: 'living', polygon: rect(0, 4.2, 11.4, 9.6) },
  { id: 'r9', name: 'Dressing', type: 'storage', polygon: rect(11.4, 4.2, 13.8, 6.0) },
  { id: 'r10', name: 'En-suite', type: 'bathroom', polygon: rect(13.8, 4.2, 16.8, 6.0) },
  { id: 'r11', name: 'Main bedroom', type: 'bedroom', polygon: rect(11.4, 6.0, 16.8, 9.6) },
];
/** The paved terrace off the garden door. Drawn on the site; left out of the plan so areas and escape distances are the house's own. */
export const houseTerrace: Room = { id: 't1', name: 'Terrace', type: 'outdoor', polygon: rect(3.0, 9.6, 11.4, 12.6) };
// swing: a door hinges at `a`; on a wall running +x, 1 opens south and -1 north; on a wall running +y, 1 opens west and -1 east
const o = (id: string, kind: Opening['kind'], a: Pt, b: Pt, swing?: 1 | -1): Opening => ({ id, kind, a, b, ...(swing ? { swing } : {}) });
const openings: Opening[] = [
  // exits: front door, back door from the utility, garden door onto the terrace
  o('d1', 'door', [6.7, 0], [7.7, 0], 1),
  o('d2', 'door', [0, 0.6], [0, 1.5], -1),
  o('d3', 'door', [6.6, 9.6], [7.8, 9.6], 1),
  // day side
  o('d4', 'door', [6.7, 4.2], [7.7, 4.2], 1),        // hall ↔ living, on the axis from the front door to the garden
  o('d5', 'door', [0.9, 4.2], [1.8, 4.2], -1),       // kitchen ↔ utility
  o('d6', 'door', [6.0, 2.6], [6.0, 3.5], 1),        // hall ↔ bedroom 3
  o('d7', 'door', [8.4, 1.6], [8.4, 2.4], -1),       // hall ↔ WC
  // night side
  o('d8', 'door', [8.4, 3.15], [8.4, 4.05], -1),     // hall ↔ corridor
  o('d9', 'door', [10.9, 3.0], [11.75, 3.0], -1),    // corridor ↔ bathroom
  o('d10', 'door', [12.6, 3.15], [12.6, 4.05], -1),  // corridor ↔ bedroom 2
  o('d11', 'door', [11.55, 4.2], [12.45, 4.2], 1),   // corridor ↔ dressing
  o('d12', 'door', [12.6, 6.0], [13.5, 6.0], 1),     // dressing ↔ main bedroom
  o('d13', 'door', [13.95, 6.0], [14.7, 6.0], -1),   // main bedroom ↔ en-suite
  // windows: north (street)
  o('w1', 'window', [0.9, 0], [1.8, 0]),
  o('w2', 'window', [3.5, 0], [5.3, 0]),
  o('w3', 'window', [8.75, 0], [9.25, 0]),
  o('w4', 'window', [10.5, 0], [11.7, 0]),
  o('w5', 'window', [13.6, 0], [15.8, 0]),
  // east
  o('w6', 'window', [16.8, 1.4], [16.8, 2.9]),
  o('w7', 'window', [16.8, 4.8], [16.8, 5.5]),
  o('w8', 'window', [16.8, 7.0], [16.8, 8.6]),
  // south (garden)
  o('w9', 'window', [12.6, 9.6], [15.6, 9.6]),
  o('w10', 'window', [8.6, 9.6], [10.8, 9.6]),
  o('w11', 'window', [3.6, 9.6], [6.0, 9.6]),
  o('w12', 'window', [0.8, 9.6], [2.4, 9.6]),
  // west
  o('w13', 'window', [0, 5.6], [0, 7.6]),
];

const walls = wallsFromRooms(rooms);
const inside = (p: Pt, q: Pt[]) => p[0] > q[0][0] && p[0] < q[2][0] && p[1] > q[0][1] && p[1] < q[2][1];
// [kind, centre x, centre y, width along its back, depth, quarter turns]: 0 backs onto the north side, 1 east, 2 south, 3 west
const items: [FixtureKind, number, number, number, number, 0 | 1 | 2 | 3][] = [
  // utility: laundry and sink on the east wall, tall store beside them
  ['washer', 2.34, 0.6, 0.6, 0.6, 1], ['sink', 2.34, 1.4, 0.7, 0.6, 1], ['wardrobe', 2.34, 2.5, 1.2, 0.6, 1],
  // bedroom 3
  ['bed', 3.76, 3.2, 1.4, 2.0, 3], ['desk', 4.4, 0.45, 1.4, 0.6, 0], ['wardrobe', 3.06, 1.1, 1.6, 0.6, 3],
  // entrance hall: coats
  ['wardrobe', 6.36, 1.3, 1.6, 0.6, 3],
  // WC
  ['wc', 9.0, 0.475, 0.4, 0.65, 0], ['sink', 9.39, 1.2, 0.45, 0.3, 1],
  // bathroom
  ['bathtub', 12.165, 1.0, 1.7, 0.75, 1], ['wc', 10.1, 0.475, 0.4, 0.65, 0], ['sink', 11.0, 0.4, 0.9, 0.5, 0], ['shower', 10.11, 2.3, 0.9, 0.9, 3],
  // bedroom 2
  ['bed', 13.66, 1.5, 1.6, 2.0, 3], ['wardrobe', 15.5, 3.84, 1.8, 0.6, 2], ['desk', 16.35, 2.15, 1.3, 0.6, 1],
  // kitchen: fridge and hob on the north wall, sink under the west window
  ['fridge', 2.5, 4.585, 0.65, 0.65, 0], ['stove', 3.9, 4.56, 0.6, 0.6, 0], ['sink', 0.45, 6.6, 1.0, 0.6, 3],
  // dining and living
  ['table', 5.0, 7.3, 2.2, 1.0, 1], ['sofa', 9.8, 7.9, 2.6, 0.95, 2], ['sofa', 10.865, 6.2, 1.8, 0.95, 1],
  // dressing and en-suite
  ['wardrobe', 13.44, 5.1, 1.5, 0.6, 1], ['wardrobe', 11.76, 5.5, 0.8, 0.6, 3],
  ['shower', 14.31, 4.71, 0.9, 0.9, 0], ['wc', 15.3, 4.585, 0.4, 0.65, 0], ['sink', 16.1, 4.51, 0.9, 0.5, 0],
  // main bedroom
  ['bed', 15.7, 7.06, 1.8, 2.0, 0], ['desk', 11.76, 8.3, 1.3, 0.6, 3],
];
const fixtures: Fixture[] = items.map(([kind, x, y, w, d, q], i) => ({
  id: `f${i + 1}`, kind, center: [x, y], size: [w, d], angle: Math.round(q * (Math.PI / 2) * 1e4) / 1e4,
  room_id: rooms.find((r) => inside([x, y], r.polygon))?.id ?? null,
}));

export const housePlan = (): Plan => ({
  version: 1,
  method: 'sample',
  measured: true,
  width: 16.8,
  height: 9.6,
  wallHeight: 2.7,
  rooms,
  walls,
  openings,
  fixtures,
  levels: { floor: 0, ceiling: 2.6, source: 'Pilot house specification' },
  scale: { metersPerPx: null, source: 'Design model, exact geometry (1:100)', ratio: 100 },
  source: null,
  assumptions: [
    'Pilot model for learning bimp: exact geometry on wall centre lines, not a drawing of a real site',
    'Wall height 2.7 m, clear ceiling height 2.6 m',
    'Exterior walls 0.30 m (masonry cavity wall), interior partitions 0.12 m',
  ],
});
