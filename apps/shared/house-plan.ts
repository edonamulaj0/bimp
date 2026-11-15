import { type Plan, type Room, type Opening, type Pt, type Fixture, type FixtureKind, wallsFromRooms } from './plan';

/**
 * The pilot house: the sample every account opens with and the plan drawn on the marketing site. A single-storey,
 * three-bedroom bungalow, 14.4 × 9.0 m on wall centre lines (about 113 m² net), street to the north and garden to the
 * south. Its layout and room sizes follow the way such houses are commonly built (builders' three-bedroom bungalows:
 * a lounge of 16 to 18 m², a kitchen-diner of about 18 m², a main bedroom near 14 m² with a shower room, a second
 * double and a single) rather than one large open room:
 *  - The front door opens into a hall with coats, a cloakroom WC and the utility room off it; the kitchen-diner is
 *    straight ahead and the bedroom corridor to one side.
 *  - Kitchen-diner and living room sit side by side on the garden, joined by a door, each a room that furnishes
 *    easily: a kitchen run with the table by the window, a seating group facing a television wall, doors to the terrace.
 *  - Bedrooms 2 and 3 and the family bathroom face the street; the main bedroom is on the garden with its own shower
 *    room; a linen store closes the corridor.
 *  - Three ways out: front door, back door from the utility, garden door from the living room.
 * Geometry is exact: walls on the centre lines below, rooms to the inside faces of those walls, so areas are net. It
 * is a model for learning bimp, not a drawing of a real site.
 */
const W = 14.4, H = 9.0;
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: Room[] = [
  { id: 'r1', name: 'Utility', type: 'utility', polygon: rect(0, 0, 2.1, 3.0) },
  { id: 'r2', name: 'WC', type: 'wc', polygon: rect(0, 3.0, 2.1, 4.8) },
  { id: 'r3', name: 'Entrance hall', type: 'circulation', polygon: rect(2.1, 0, 4.5, 4.8) },
  { id: 'r4', name: 'Bathroom', type: 'bathroom', polygon: rect(4.5, 0, 6.9, 3.6) },
  { id: 'r5', name: 'Bedroom 3', type: 'bedroom', polygon: rect(6.9, 0, 10.2, 3.6) },
  { id: 'r6', name: 'Bedroom 2', type: 'bedroom', polygon: rect(10.2, 0, 14.4, 3.6) },
  { id: 'r7', name: 'Corridor', type: 'circulation', polygon: rect(4.5, 3.6, 12.6, 4.8) },
  { id: 'r8', name: 'Store', type: 'storage', polygon: rect(12.6, 3.6, 14.4, 4.8) },
  { id: 'r9', name: 'Kitchen / dining', type: 'kitchen', polygon: rect(0, 4.8, 4.8, 9.0) },
  { id: 'r10', name: 'Living room', type: 'living', polygon: rect(4.8, 4.8, 9.3, 9.0) },
  { id: 'r11', name: 'Main bedroom', type: 'bedroom', polygon: rect(9.3, 4.8, 12.9, 9.0) },
  { id: 'r12', name: 'En-suite', type: 'bathroom', polygon: rect(12.9, 4.8, 14.4, 9.0) },
];
/** The paved terrace off the garden door. Drawn on the site; left out of the plan so areas and escape distances are the house's own. */
export const houseTerrace: Room = { id: 't1', name: 'Terrace', type: 'outdoor', polygon: rect(4.2, 9.0, 10.2, 12.0) };
// swing: a door hinges at `a`; on a wall running +x, 1 opens south and -1 north; on a wall running +y, 1 opens west and -1 east
const o = (id: string, kind: Opening['kind'], a: Pt, b: Pt, swing?: 1 | -1): Opening => ({ id, kind, a, b, ...(swing ? { swing } : {}) });
const openings: Opening[] = [
  // exits: front door, back door from the utility, garden door onto the terrace
  o('d1', 'door', [2.8, 0], [3.8, 0], 1),
  o('d2', 'door', [0, 0.9], [0, 1.8], -1),
  o('d3', 'door', [6.5, 9.0], [7.7, 9.0], 1),
  // off the hall
  o('d4', 'door', [2.8, 4.8], [3.7, 4.8], 1),        // hall ↔ kitchen / dining, straight ahead of the front door
  o('d5', 'door', [2.1, 0.9], [2.1, 1.8], 1),        // hall ↔ utility
  o('d6', 'door', [2.1, 3.4], [2.1, 4.2], -1),       // hall ↔ WC, opening out into the hall
  o('d7', 'door', [4.5, 3.75], [4.5, 4.65], -1),     // hall ↔ corridor
  // off the corridor
  o('d8', 'door', [5.7, 3.6], [6.5, 3.6], -1),       // bathroom
  o('d9', 'door', [9.1, 3.6], [10.0, 3.6], -1),      // bedroom 3
  o('d10', 'door', [10.5, 3.6], [11.4, 3.6], -1),    // bedroom 2
  o('d11', 'door', [12.6, 3.8], [12.6, 4.6], 1),     // linen store, opening out into the corridor
  o('d12', 'door', [5.3, 4.8], [6.2, 4.8], 1),       // living room
  o('d13', 'door', [9.6, 4.8], [10.5, 4.8], 1),      // main bedroom
  // between rooms
  o('d14', 'door', [12.9, 5.1], [12.9, 5.9], 1),     // main bedroom ↔ en-suite, opening into the bedroom
  o('d15', 'door', [4.8, 7.3], [4.8, 8.2], -1),      // kitchen / dining ↔ living room, by the garden windows
  // windows: north (street)
  o('w1', 'window', [0.6, 0], [1.5, 0]),
  o('w2', 'window', [7.6, 0], [9.4, 0]),
  o('w3', 'window', [5.2, 0], [6.2, 0]),
  o('w4', 'window', [11.2, 0], [13.2, 0]),
  // east
  o('w5', 'window', [14.4, 1.1], [14.4, 2.5]),
  o('w6', 'window', [14.4, 6.9], [14.4, 7.5]),
  // south (garden)
  o('w7', 'window', [10.0, 9.0], [12.2, 9.0]),
  o('w8', 'window', [7.9, 9.0], [9.0, 9.0]),
  o('w9', 'window', [5.1, 9.0], [6.2, 9.0]),
  o('w10', 'window', [1.2, 9.0], [3.6, 9.0]),
  // west
  o('w11', 'window', [0, 5.9], [0, 7.3]),
  o('w12', 'window', [0, 3.6], [0, 4.2]),
];

const walls = wallsFromRooms(rooms); // walls stand on the centre lines the layout above is set out on
// Rooms are stored the way plans read from drawings are: to the inside faces of their walls, so areas are net. Each
// centre-line rectangle is drawn in by half the wall on that side (0.15 m on the perimeter, 0.06 m at partitions).
const half = (v: number, edge: number) => (Math.abs(v) < 1e-9 || Math.abs(v - edge) < 1e-9 ? 0.15 : 0.06);
const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
const netRooms: Room[] = rooms.map((r) => {
  const [[x0, y0], , [x1, y1]] = r.polygon;
  return { ...r, polygon: rect(r3(x0 + half(x0, W)), r3(y0 + half(y0, H)), r3(x1 - half(x1, W)), r3(y1 - half(y1, H))) };
});
const inside = (p: Pt, q: Pt[]) => p[0] > q[0][0] && p[0] < q[2][0] && p[1] > q[0][1] && p[1] < q[2][1];
// [kind, centre x, centre y, width along its back, depth, quarter turns]: 0 backs onto the north side, 1 east, 2 south, 3 west
const items: [FixtureKind, number, number, number, number, 0 | 1 | 2 | 3][] = [
  // bedroom 3: single-size double against the partition, desk under the window, wardrobe clear of the door
  ['bed', 7.96, 2.1, 1.4, 2.0, 3], ['desk', 7.9, 0.45, 1.4, 0.6, 0], ['wardrobe', 9.84, 1.3, 1.6, 0.6, 1],
  // utility: laundry and sink along the wall shared with the WC, so the pipes run together
  ['washer', 0.5, 2.64, 0.6, 0.6, 2], ['sink', 1.25, 2.64, 0.7, 0.6, 2],
  // WC
  ['wc', 0.475, 4.45, 0.4, 0.65, 3], ['sink', 1.0, 3.21, 0.45, 0.3, 0],
  // entrance hall: coats, clear of the open front door
  ['wardrobe', 4.14, 2.0, 1.2, 0.6, 1],
  // bathroom: bath along the outside wall under the window, basin and WC on the wall shared with the hall
  ['bathtub', 5.7, 0.525, 1.7, 0.75, 0], ['sink', 4.81, 1.9, 0.8, 0.5, 3], ['wc', 4.885, 2.85, 0.4, 0.65, 3],
  // bedroom 2: double with the headboard on the partition, wardrobe on the corridor wall, desk at the east window
  ['bed', 11.26, 1.5, 1.6, 2.0, 3], ['wardrobe', 13.0, 3.24, 1.8, 0.6, 2], ['desk', 13.95, 1.8, 1.3, 0.6, 1],
  // store: hot water cylinder
  ['water_heater', 13.95, 4.2, 0.6, 0.6, 1],
  // kitchen: fridge, sink under the west window, hob; the table by the garden window
  ['fridge', 0.475, 5.3, 0.65, 0.65, 3], ['sink', 0.45, 6.6, 1.0, 0.6, 3], ['stove', 0.45, 7.9, 0.6, 0.6, 3],
  ['table', 2.75, 7.45, 1.6, 0.9, 0],
  // living room: seating on two sides facing the television wall
  ['sofa', 8.765, 6.5, 2.2, 0.95, 1], ['sofa', 7.3, 5.335, 1.8, 0.95, 0], ['tv', 5.06, 6.2, 1.4, 0.4, 3],
  // main bedroom: headboard on the solid west wall with room to walk round, wardrobe between the two doors, desk by the window
  ['bed', 10.36, 7.4, 1.8, 2.0, 3], ['wardrobe', 11.3, 5.16, 1.4, 0.6, 0], ['desk', 12.54, 7.7, 1.2, 0.6, 1],
  // en-suite: basin and WC in a row, shower across the end
  ['sink', 14.05, 6.3, 0.6, 0.4, 1], ['wc', 13.925, 7.6, 0.4, 0.65, 1], ['shower', 13.6, 8.4, 0.9, 0.9, 2],
];
const fixtures: Fixture[] = items.map(([kind, x, y, w, d, q], i) => ({
  id: `f${i + 1}`, kind, center: [x, y], size: [w, d], angle: Math.round(q * (Math.PI / 2) * 1e4) / 1e4,
  room_id: rooms.find((r) => inside([x, y], r.polygon))?.id ?? null,
}));

export const housePlan = (): Plan => ({
  version: 1,
  method: 'sample',
  measured: true,
  width: W,
  height: H,
  wallHeight: 2.7,
  rooms: netRooms,
  walls,
  openings,
  fixtures,
  levels: { floor: 0, ceiling: 2.6, source: 'Pilot house specification' },
  scale: { metersPerPx: null, source: 'Design model, exact geometry (1:100)', ratio: 100 },
  source: null,
  assumptions: [
    'Pilot model for learning bimp: exact geometry, walls set out on centre lines and rooms measured to the inside faces of walls; not a drawing of a real site',
    'Wall height 2.7 m, clear ceiling height 2.6 m',
    'Exterior walls 0.30 m (masonry cavity wall), interior partitions 0.12 m',
  ],
});
