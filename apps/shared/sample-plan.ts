import { type Plan, type Room, type Opening, type Pt, type FixtureKind, placeFixture, wallsFromRooms } from './plan';
import { orientDoors } from './rooms';

/**
 * The pilot house: a single-storey courtyard house, L-shaped (16.80 × 17.40 m overall on wall centre lines, 194.4 m²).
 * A day wing runs east–west (study, entrance, kitchen / dining, a double-aspect living room); a bedroom wing runs south.
 * A glazed gallery lines the inside of the L and opens onto the courtyard, so every room is reached from it and
 * the house has three exits (front door, living room terrace door, gallery courtyard door).
 * Sized against the Metric Handbook (4th ed.): bedrooms above Ch. 8 Table IV minima, a 1.20 m gallery for passing
 * (Ch. 2 Fig. 2.35), 800–1000 mm doorsets (Ch. 2 §4.6). Exact geometry; a model for learning bimp, not a real site.
 */
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: Room[] = [
  // day wing (y 0–7.2)
  { id: 'r1', name: 'Living room', type: 'living', polygon: rect(12.0, 0, 16.8, 7.2) },
  { id: 'r2', name: 'Kitchen / dining', type: 'kitchen', polygon: rect(7.2, 0, 12.0, 6.0) },
  { id: 'r3', name: 'Entrance hall', type: 'circulation', polygon: rect(4.8, 0, 7.2, 6.0) },
  { id: 'r4', name: 'Study', type: 'office', polygon: rect(0, 0, 4.8, 3.6) },
  { id: 'r5', name: 'WC', type: 'wc', polygon: rect(0, 3.6, 2.4, 6.0) },
  { id: 'r6', name: 'Utility', type: 'utility', polygon: rect(2.4, 3.6, 4.8, 6.0) },
  // the gallery: along the day wing, then down the bedroom wing, glazed to the courtyard
  { id: 'r7', name: 'Gallery', type: 'circulation', polygon: [[0, 6.0], [12.0, 6.0], [12.0, 7.2], [7.2, 7.2], [7.2, 13.2], [6.0, 13.2], [6.0, 7.2], [0, 7.2]] },
  // bedroom wing (x 0–7.2)
  { id: 'r8', name: 'Bedroom 2', type: 'bedroom', polygon: rect(0, 7.2, 6.0, 10.2) },
  { id: 'r9', name: 'Wardrobe', type: 'storage', polygon: rect(0, 10.2, 2.4, 13.2) },
  { id: 'r10', name: 'Bathroom', type: 'bathroom', polygon: rect(2.4, 10.2, 6.0, 13.2) },
  { id: 'r11', name: 'Main bedroom', type: 'bedroom', polygon: rect(2.4, 13.2, 7.2, 17.4) },
  { id: 'r12', name: 'En-suite', type: 'bathroom', polygon: rect(0, 13.2, 2.4, 15.6) },
  { id: 'r13', name: 'Dressing room', type: 'storage', polygon: rect(0, 15.6, 2.4, 17.4) },
];
const o = (id: string, kind: Opening['kind'], a: Pt, b: Pt): Opening => ({ id, kind, a, b });
const openings: Opening[] = [
  // exits
  o('d1', 'door', [5.5, 0], [6.5, 0]),           // front door
  o('d2', 'door', [13.0, 7.2], [14.0, 7.2]),     // living room → courtyard terrace
  o('d3', 'door', [7.2, 11.0], [7.2, 12.0]),     // gallery → courtyard
  // day wing
  o('d4', 'door', [5.55, 6.0], [6.45, 6.0]),     // entrance ↔ gallery
  o('d5', 'door', [4.8, 1.2], [4.8, 2.1]),       // entrance ↔ study
  o('d6', 'door', [7.2, 3.9], [7.2, 4.8]),       // entrance ↔ kitchen
  o('d7', 'door', [12.0, 6.15], [12.0, 7.05]),   // gallery ↔ living
  o('d8', 'door', [12.0, 2.4], [12.0, 3.3]),     // kitchen ↔ living
  o('d9', 'door', [0.8, 6.0], [1.6, 6.0]),       // gallery ↔ WC
  o('d10', 'door', [3.2, 6.0], [4.0, 6.0]),      // gallery ↔ utility
  // bedroom wing
  o('d11', 'door', [6.0, 9.1], [6.0, 9.95]),     // gallery ↔ bedroom 2
  o('d12', 'door', [0.25, 10.2], [1.05, 10.2]),  // bedroom 2 ↔ wardrobe
  o('d13', 'door', [6.0, 12.0], [6.0, 12.8]),    // gallery ↔ bathroom
  o('d14', 'door', [6.15, 13.2], [7.05, 13.2]),  // gallery ↔ main bedroom
  o('d15', 'door', [2.4, 13.6], [2.4, 14.4]),    // main bedroom ↔ en-suite
  o('d16', 'door', [2.4, 16.3], [2.4, 17.1]),    // main bedroom ↔ dressing room
  // windows
  o('w1', 'window', [1.2, 0], [3.6, 0]),
  o('w2', 'window', [0, 0.9], [0, 2.7]),
  o('w3', 'window', [0, 4.5], [0, 5.1]),
  o('w4', 'window', [8.4, 0], [10.8, 0]),
  o('w5', 'window', [13.2, 0], [15.6, 0]),
  o('w6', 'window', [16.8, 1.4], [16.8, 5.6]),
  o('w7', 'window', [14.6, 7.2], [16.2, 7.2]),
  o('w8', 'window', [7.6, 7.2], [9.4, 7.2]),
  o('w9', 'window', [9.8, 7.2], [11.6, 7.2]),
  o('w10', 'window', [7.2, 7.8], [7.2, 10.2]),
  o('w11', 'window', [0, 7.9], [0, 9.6]),
  o('w12', 'window', [0, 14.0], [0, 14.8]),
  o('w13', 'window', [3.4, 17.4], [6.2, 17.4]),
  o('w14', 'window', [7.2, 14.2], [7.2, 16.4]),
];

const walls = wallsFromRooms(rooms);
// [kind, centre x, centre y, box width (x), box depth (y), turn?] on the plan; placeFixture turns each to back onto its wall.
// Centres sit half a wall thickness off the centre line (0.06 m interior, 0.15 m exterior) so items stand at the wall face.
const items: [FixtureKind, number, number, number, number, boolean?][] = [
  // study, WC, utility
  ['desk', 2.4, 3.19, 1.4, 0.7, true],
  ['wc', 0.475, 5.3, 0.65, 0.4], ['sink', 2.165, 4.3, 0.35, 0.5], ['washer', 3.2, 3.96, 0.6, 0.6],
  // kitchen / dining: a run on the entrance wall, sink under the north window, table toward the living room
  ['stove', 7.56, 1.4, 0.6, 0.6], ['fridge', 7.585, 2.5, 0.65, 0.65], ['sink', 9.6, 0.45, 0.9, 0.6], ['table', 10.0, 3.9, 1.6, 0.9],
  // living
  ['sofa', 14.4, 0.6, 2.2, 0.9], ['table', 14.4, 2.3, 1.2, 0.6],
  // bedroom 2 and its wardrobe
  ['bed', 3.0, 8.26, 1.6, 2.0], ['wardrobe', 1.2, 12.84, 1.6, 0.6],
  // bathroom
  ['bathtub', 4.2, 12.765, 1.7, 0.75], ['wc', 2.785, 10.9, 0.65, 0.4], ['sink', 2.635, 11.75, 0.45, 0.6], ['shower', 3.9, 10.71, 0.9, 0.9],
  // main suite
  ['bed', 3.46, 15.4, 2.0, 1.6], ['shower', 0.6, 13.71, 0.9, 0.9], ['wc', 1.4, 15.215, 0.4, 0.65], ['sink', 2.165, 15.0, 0.35, 0.5],
  ['wardrobe', 1.2, 16.95, 1.6, 0.6],
];

const base = (): Plan => ({
  version: 1,
  method: 'sample',
  measured: true,
  width: 16.8,
  height: 17.4,
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
    'Pilot model for learning bimp: an L-shaped courtyard house, exact geometry on wall centre lines, not a drawing of a real site',
    'Wall height 2.7 m, clear ceiling height 2.6 m',
    'Exterior walls 0.30 m (masonry cavity wall), interior partitions 0.12 m',
  ],
});

/** The sample, with doors swung by the same rules applied to drawings. */
export const samplePlan = (): Plan => { const p = base(); return { ...p, openings: orientDoors(p) }; };
