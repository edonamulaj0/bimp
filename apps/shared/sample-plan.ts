import { type Plan, type Room, type Opening, type Pt, type FixtureKind, placeFixture, wallsFromRooms } from './plan';
import { orientDoors } from './rooms';

/**
 * The pilot house: a single-storey, three-bedroom dwelling (14.40 × 10.20 m on wall centre lines, 146.9 m²).
 * Day zone to the north (living, kitchen / dining, entrance with WC and utility), a 1.20 m corridor, night zone to the
 * south (main bedroom with en-suite and walk-in wardrobe, family bathroom, two double bedrooms, linen store).
 * Sized against the Metric Handbook (4th ed.): bedrooms above Ch. 8 Table IV minima, corridor ≥ 1.2 m for passing
 * (Ch. 2 Fig. 2.35), 800–1000 mm doorsets (Ch. 2 §4.6), two exits (front door, garden door), every habitable room
 * glazed. Geometry is exact (drawn on wall centre lines); it is a model for learning bimp, not a drawing of a real site.
 */
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: Room[] = [
  { id: 'r1', name: 'Living room', type: 'living', polygon: rect(0, 0, 6.0, 4.8) },
  { id: 'r2', name: 'Kitchen / dining', type: 'kitchen', polygon: rect(6.0, 0, 10.8, 4.8) },
  { id: 'r3', name: 'Entrance hall', type: 'circulation', polygon: rect(10.8, 0, 12.6, 4.8) },
  { id: 'r4', name: 'Utility', type: 'utility', polygon: rect(12.6, 0, 14.4, 2.4) },
  { id: 'r5', name: 'WC', type: 'wc', polygon: rect(12.6, 2.4, 14.4, 4.8) },
  { id: 'r6', name: 'Corridor', type: 'circulation', polygon: rect(4.2, 4.8, 12.6, 6.0) },
  { id: 'r7', name: 'Linen store', type: 'storage', polygon: rect(12.6, 4.8, 14.4, 6.0) },
  { id: 'r8', name: 'Main bedroom', type: 'bedroom', polygon: rect(0, 4.8, 4.2, 8.4) },
  { id: 'r9', name: 'En-suite', type: 'bathroom', polygon: rect(0, 8.4, 2.4, 10.2) },
  { id: 'r10', name: 'Walk-in wardrobe', type: 'storage', polygon: rect(2.4, 8.4, 4.2, 10.2) },
  { id: 'r11', name: 'Bathroom', type: 'bathroom', polygon: rect(4.2, 6.0, 6.6, 10.2) },
  { id: 'r12', name: 'Bedroom 2', type: 'bedroom', polygon: rect(6.6, 6.0, 10.5, 10.2) },
  { id: 'r13', name: 'Bedroom 3', type: 'bedroom', polygon: rect(10.5, 6.0, 14.4, 10.2) },
];
const o = (id: string, kind: Opening['kind'], a: Pt, b: Pt): Opening => ({ id, kind, a, b });
const openings: Opening[] = [
  // exits: the front door into the entrance hall and the garden door from the living room
  o('d1', 'door', [11.2, 0], [12.2, 0]),
  o('d2', 'door', [0, 3.4], [0, 4.4]),
  // day zone
  o('d3', 'door', [4.65, 4.8], [5.55, 4.8]),     // living ↔ corridor
  o('d4', 'door', [6.0, 3.3], [6.0, 4.2]),       // living ↔ kitchen
  o('d5', 'door', [10.8, 0.9], [10.8, 1.8]),     // kitchen ↔ entrance
  o('d6', 'door', [11.25, 4.8], [12.15, 4.8]),   // entrance ↔ corridor
  o('d7', 'door', [12.6, 0.8], [12.6, 1.6]),     // entrance ↔ utility
  o('d8', 'door', [12.6, 3.5], [12.6, 4.3]),     // entrance ↔ WC
  // night zone
  o('d9', 'door', [4.2, 5.05], [4.2, 5.9]),      // corridor ↔ main bedroom
  o('d10', 'door', [0.25, 8.4], [1.05, 8.4]),      // main bedroom ↔ en-suite
  o('d11', 'door', [3.15, 8.4], [3.95, 8.4]),      // main bedroom ↔ wardrobe
  o('d12', 'door', [4.8, 6.0], [5.6, 6.0]),      // corridor ↔ bathroom
  o('d13', 'door', [7.0, 6.0], [7.85, 6.0]),     // corridor ↔ bedroom 2
  o('d14', 'door', [11.0, 6.0], [11.85, 6.0]),   // corridor ↔ bedroom 3
  o('d15', 'door', [12.6, 5.0], [12.6, 5.8]),    // corridor ↔ linen store
  // windows
  o('w1', 'window', [1.0, 0], [3.4, 0]),
  o('w2', 'window', [0, 0.9], [0, 2.7]),
  o('w3', 'window', [7.2, 0], [9.6, 0]),
  o('w4', 'window', [14.4, 0.7], [14.4, 1.6]),
  o('w5', 'window', [14.4, 3.1], [14.4, 3.7]),
  o('w6', 'window', [0, 5.6], [0, 7.4]),
  o('w7', 'window', [0.8, 10.2], [1.6, 10.2]),
  o('w8', 'window', [5.0, 10.2], [5.9, 10.2]),
  o('w9', 'window', [7.6, 10.2], [9.4, 10.2]),
  o('w10', 'window', [11.4, 10.2], [13.2, 10.2]),
  o('w11', 'window', [14.4, 7.0], [14.4, 8.2]),
];

const walls = wallsFromRooms(rooms);
// [kind, centre x, centre y, box width (x), box depth (y), turn?] on the plan; placeFixture turns each to back onto its wall.
// Centres sit half a wall thickness off the centre line (0.06 m interior, 0.15 m exterior) so items stand at the wall face.
const items: [FixtureKind, number, number, number, number, boolean?][] = [
  // living
  ['sofa', 2.2, 4.29, 2.2, 0.9], ['table', 2.2, 3.1, 1.2, 0.6],
  // kitchen / dining: hob and fridge on the east wall, sink under the north window, table by the living room door
  ['stove', 10.44, 3.0, 0.6, 0.6], ['fridge', 10.415, 4.3, 0.65, 0.65], ['sink', 8.4, 0.45, 0.9, 0.6], ['table', 7.6, 2.6, 0.9, 1.6],
  // utility and WC
  ['washer', 13.4, 2.04, 0.6, 0.6], ['wc', 13.9, 2.785, 0.4, 0.65], ['sink', 14.075, 4.2, 0.35, 0.45],
  // main bedroom suite
  ['bed', 2.0, 5.86, 1.6, 2.0], ['shower', 0.6, 9.6, 0.9, 0.9], ['wc', 2.015, 9.75, 0.65, 0.4], ['sink', 2.165, 8.95, 0.35, 0.5],
  ['wardrobe', 3.3, 9.75, 1.6, 0.6],
  // family bathroom
  ['bathtub', 5.4, 9.675, 1.7, 0.75], ['wc', 4.585, 7.6, 0.65, 0.4], ['sink', 6.315, 7.2, 0.45, 0.6], ['shower', 6.09, 8.4, 0.9, 0.9],
  // bedrooms 2 and 3
  ['bed', 9.44, 8.0, 2.0, 1.6], ['wardrobe', 6.96, 8.6, 0.6, 1.8],
  ['bed', 11.56, 8.6, 2.0, 1.6], ['desk', 13.9, 7.6, 0.7, 1.4, true], ['wardrobe', 13.4, 6.36, 1.8, 0.6],
];

const base = (): Plan => ({
  version: 1,
  method: 'sample',
  measured: true,
  width: 14.4,
  height: 10.2,
  wallHeight: 2.7,
  rooms,
  walls,
  openings,
  fixtures: items.map(([k, x, y, w, h, turn], i) => {
    const f = placeFixture(k, [x, y], w, h, walls, rooms, `f${i + 1}`);
    return turn ? { ...f, angle: f.angle + Math.PI } : f;
  }),
  levels: { floor: 0, ceiling: 2.6, source: 'Pilot house specification' },
  scale: { metersPerPx: null, source: 'Design model, exact geometry (1:100)', ratio: 100 },
  source: null,
  assumptions: [
    'Pilot model for learning bimp: exact geometry on wall centre lines, not a drawing of a real site',
    'Wall height 2.7 m, clear ceiling height 2.6 m',
    'Exterior walls 0.30 m (masonry cavity wall), interior partitions 0.12 m',
  ],
});

/** The sample, with doors swung by the same rules applied to drawings. */
export const samplePlan = (): Plan => { const p = base(); return { ...p, openings: orientDoors(p) }; };
