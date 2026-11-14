import { type Plan, type Room, type Opening, type Pt, type Fixture, type FixtureKind, wallsFromRooms } from './plan';

/**
 * The show apartment drawn on the marketing site: a furnished ground-floor flat with an entrance terrace,
 * 13.2 × 9.7 m on wall centre lines. The layout is adapted from Swiss Dwellings v3.0.0 (Archilyse AG,
 * doi:10.5281/zenodo.7788422, CC BY 4.0), site 3575 / building 5460, ground floor: walls squared up and put on centre
 * lines, the two closets by the entrance fitted as a store and a WC, the large inner "Korridor" used as a dining
 * room, the kitchen–bedroom door left out, and all furniture added by us. Keep the credit wherever it is shown.
 */
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: Room[] = [
  { id: 'r1', name: 'Bedroom 1', type: 'bedroom', polygon: rect(0, 0, 3.9, 4.5) },
  { id: 'r2', name: 'Bathroom', type: 'bathroom', polygon: rect(3.9, 0, 8.4, 2.1) },
  { id: 'r3', name: 'Hall', type: 'circulation', polygon: rect(3.9, 2.1, 8.4, 4.5) },
  { id: 'r4', name: 'Dining', type: 'dining', polygon: rect(8.4, 0, 11.2, 4.5) },
  { id: 'r5', name: 'Store', type: 'storage', polygon: rect(11.2, 0, 12.2, 2.4) },
  { id: 'r6', name: 'WC', type: 'wc', polygon: rect(12.2, 0, 13.2, 2.4) },
  { id: 'r7', name: 'Entrance', type: 'circulation', polygon: rect(11.2, 2.4, 13.2, 4.5) },
  { id: 'r8', name: 'Living room', type: 'living', polygon: rect(0, 4.5, 5.6, 9.7) },
  { id: 'r9', name: 'Kitchen', type: 'kitchen', polygon: rect(5.6, 4.5, 9.1, 9.7) },
  { id: 'r10', name: 'Bedroom 2', type: 'bedroom', polygon: rect(9.1, 4.5, 13.2, 9.7) },
  { id: 'r11', name: 'Terrace', type: 'outdoor', polygon: rect(13.2, 0, 17.0, 5.0) },
];
// swing: a door hinges at `a`; on a wall running +x, 1 opens south and -1 north; on a wall running +y, 1 opens west and -1 east
const o = (id: string, kind: Opening['kind'], a: Pt, b: Pt, swing?: 1 | -1): Opening => ({ id, kind, a, b, ...(swing ? { swing } : {}) });
const openings: Opening[] = [
  o('d1', 'door', [13.2, 3.4], [13.2, 4.3], 1),      // terrace → entrance (front door)
  o('d2', 'door', [11.2, 3.3], [11.2, 4.2], -1),     // entrance ↔ dining
  o('d3', 'door', [8.4, 2.95], [8.4, 3.85], -1),     // dining ↔ hall
  o('d4', 'door', [6.15, 2.1], [7.0, 2.1], -1),      // hall ↔ bathroom
  o('d5', 'door', [3.9, 2.4], [3.9, 3.3], 1),        // hall ↔ bedroom 1
  o('d6', 'door', [4.15, 4.5], [5.0, 4.5], 1),       // hall ↔ living room
  o('d7', 'door', [6.2, 4.5], [7.1, 4.5], 1),        // hall ↔ kitchen
  o('d8', 'door', [10.0, 4.5], [10.9, 4.5], 1),      // dining ↔ bedroom 2
  o('d9', 'door', [11.35, 2.4], [12.05, 2.4], 1),    // entrance ↔ store
  o('d10', 'door', [12.35, 2.4], [13.05, 2.4], 1),   // entrance ↔ WC
  o('w1', 'window', [2.0, 0], [3.25, 0]),
  o('w2', 'window', [6.05, 0], [7.15, 0]),
  o('w3', 'window', [9.65, 0], [11.0, 0]),
  o('w4', 'window', [0, 1.9], [0, 3.2]),
  o('w5', 'window', [0, 6.1], [0, 7.35]),
  o('w6', 'window', [1.55, 9.7], [2.85, 9.7]),
  o('w7', 'window', [5.95, 9.7], [7.25, 9.7]),
  o('w8', 'window', [10.35, 9.7], [11.65, 9.7]),
  o('w9', 'window', [13.2, 6.6], [13.2, 7.85]),
];

// the terrace is open: only the indoor rooms make walls
const walls = wallsFromRooms(rooms.filter((r) => r.type !== 'outdoor'));
const inside = (p: Pt, q: Pt[]) => p[0] > q[0][0] && p[0] < q[2][0] && p[1] > q[0][1] && p[1] < q[2][1];
// [kind, centre x, centre y, width along its back, depth, quarter turns]: 0 backs onto the north side, 1 east, 2 south, 3 west
const items: [FixtureKind, number, number, number, number, 0 | 1 | 2 | 3][] = [
  // bedroom 1
  ['bed', 1.6, 3.44, 1.6, 2.0, 2], ['wardrobe', 3.54, 1.2, 1.8, 0.6, 1], ['desk', 0.9, 0.45, 1.2, 0.6, 0],
  // bathroom
  ['bathtub', 4.335, 1.0, 1.7, 0.75, 3], ['sink', 5.35, 0.4, 0.8, 0.5, 0], ['wc', 6.6, 0.475, 0.4, 0.65, 0], ['shower', 7.89, 0.6, 0.9, 0.9, 0],
  // hall
  ['wardrobe', 4.9, 2.46, 1.6, 0.6, 0],
  // dining
  ['table', 9.8, 1.75, 1.8, 0.9, 1],
  // store and WC
  ['washer', 11.7, 0.45, 0.6, 0.6, 0], ['wc', 12.7, 0.475, 0.4, 0.65, 0], ['sink', 12.41, 1.5, 0.45, 0.3, 3],
  // living room
  ['sofa', 2.0, 5.035, 2.4, 0.95, 0], ['sofa', 0.6, 6.85, 1.7, 0.9, 3], ['desk', 4.3, 9.25, 1.4, 0.6, 2],
  // kitchen
  ['fridge', 8.715, 4.885, 0.65, 0.65, 1], ['stove', 8.74, 6.0, 0.6, 0.6, 1], ['sink', 8.74, 7.7, 0.9, 0.6, 1], ['table', 6.75, 7.6, 1.4, 0.8, 1],
  // bedroom 2
  ['bed', 10.16, 7.6, 1.8, 2.0, 3], ['wardrobe', 12.0, 4.86, 1.9, 0.6, 0], ['desk', 12.75, 8.75, 1.3, 0.6, 1],
  // terrace
  ['table', 15.2, 1.9, 1.2, 0.8, 0],
];
const fixtures: Fixture[] = items.map(([kind, x, y, w, d, q], i) => ({
  id: `f${i + 1}`, kind, center: [x, y], size: [w, d], angle: Math.round(q * (Math.PI / 2) * 1e4) / 1e4,
  room_id: rooms.find((r) => inside([x, y], r.polygon))?.id ?? null,
}));

export const apartmentPlan = (): Plan => ({
  version: 1,
  method: 'sample',
  measured: true,
  width: 17.0,
  height: 9.7,
  wallHeight: 2.7,
  rooms,
  walls,
  openings,
  fixtures,
  levels: { floor: 0, ceiling: 2.6, source: 'Show apartment specification' },
  scale: { metersPerPx: null, source: 'Design model, exact geometry (1:100)', ratio: 100 },
  source: null,
  assumptions: [
    'Layout adapted from Swiss Dwellings v3.0.0 (Archilyse AG, CC BY 4.0), site 3575, building 5460, ground floor; furniture added',
    'Exact geometry on wall centre lines; wall height 2.7 m, clear ceiling height 2.6 m',
    'Exterior walls 0.30 m, interior partitions 0.12 m; the terrace is open',
  ],
});
