import { type Plan, type Room, type Opening, type Pt, type FixtureKind, placeFixture, wallsFromRooms } from './plan';
import { orientDoors } from './rooms';

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: Room[] = [
  { id: 'r1', name: 'Living room', type: 'living', polygon: rect(0, 0, 6.5, 5) },
  { id: 'r2', name: 'Kitchen', type: 'kitchen', polygon: rect(6.5, 0, 12, 4) },
  { id: 'r3', name: 'Hall', type: 'circulation', polygon: rect(6.5, 4, 12, 5.2) },
  { id: 'r4', name: 'Bedroom 1', type: 'bedroom', polygon: rect(0, 5, 4.5, 9) },
  { id: 'r5', name: 'Bathroom', type: 'bathroom', polygon: rect(4.5, 5, 6.5, 7.5) },
  { id: 'r6', name: 'Storage', type: 'storage', polygon: rect(4.5, 7.5, 6.5, 9) },
  { id: 'r7', name: 'Bedroom 2', type: 'bedroom', polygon: rect(6.5, 5.2, 9.5, 9) },
  { id: 'r8', name: 'Office', type: 'office', polygon: rect(9.5, 5.2, 12, 9) },
];
const o = (id: string, kind: Opening['kind'], a: Pt, b: Pt): Opening => ({ id, kind, a, b });
const openings: Opening[] = [
  o('d1', 'door', [12, 4.2], [12, 5.0]),
  o('d2', 'door', [6.5, 4.1], [6.5, 4.95]),
  o('d3', 'door', [7.0, 4], [7.85, 4]),
  o('d4', 'door', [7.0, 5.2], [7.85, 5.2]),
  o('d5', 'door', [10.0, 5.2], [10.85, 5.2]),
  o('d6', 'door', [4.5, 5.6], [4.5, 6.4]),
  o('d7', 'door', [5.0, 5.0], [5.8, 5.0]),
  o('d8', 'door', [6.5, 7.8], [6.5, 8.6]),
  o('w1', 'window', [1.0, 0], [3.0, 0]),
  o('w2', 'window', [4.0, 0], [5.5, 0]),
  o('w3', 'window', [0, 1.5], [0, 3.5]),
  o('w4', 'window', [8.0, 0], [10.5, 0]),
  o('w5', 'window', [1.2, 9], [3.2, 9]),
  o('w6', 'window', [0, 6.2], [0, 7.8]),
  o('w7', 'window', [7.2, 9], [8.8, 9]),
  o('w8', 'window', [10.0, 9], [11.5, 9]),
  o('w9', 'window', [12, 6.5], [12, 8]),
];

const walls = wallsFromRooms(rooms);
// [kind, centre x, centre y, width, depth, turn?] as boxes on the plan; placeFixture turns each to back onto its wall.
// turn = face the wall instead (a desk in the command position: chair between desk and wall, facing the room).
const items: [FixtureKind, number, number, number, number, boolean?][] = [
  ['wc', 6.1, 5.37, 0.4, 0.65], ['sink', 6.25, 6.45, 0.35, 0.55], ['bathtub', 5.5, 7.1, 1.7, 0.7],
  ['stove', 11.7, 1.0, 0.6, 0.6], ['sink', 11.7, 2.3, 0.6, 0.9], ['fridge', 11.65, 3.5, 0.65, 0.65], ['table', 8.6, 1.9, 1.6, 0.9],
  ['sofa', 0.5, 2.5, 0.9, 2.2], ['table', 2.1, 2.5, 0.6, 1.2],
  ['bed', 1.5, 6.05, 1.6, 2.0], ['wardrobe', 3.9, 8.7, 1.2, 0.6],
  ['bed', 8.7, 6.25, 0.9, 2.0], ['wardrobe', 9.2, 8.2, 0.6, 1.2],
  ['desk', 10.75, 7.9, 1.4, 0.7, true], ['washer', 5.5, 8.7, 0.6, 0.6],
];

const base = (): Plan => ({
  version: 1,
  method: 'sample',
  measured: false,
  width: 12,
  height: 9,
  wallHeight: 2.7,
  rooms,
  walls,
  openings,
  fixtures: items.map(([k, x, y, w, h, turn], i) => {
    const f = placeFixture(k, [x, y], w, h, walls, rooms, `f${i + 1}`);
    return turn ? { ...f, angle: f.angle + Math.PI } : f;
  }),
  scale: { metersPerPx: null, source: 'Hand-made sample plan' },
  source: null,
  assumptions: ['Sample plan for demonstration, not from a real drawing', 'Wall height 2.7 m', 'Exterior walls 0.30 m, interior 0.12 m'],
});

/** The sample, with doors swung by the same rules applied to drawings. */
export const samplePlan = (): Plan => { const p = base(); return { ...p, openings: orientDoors(p) }; };
