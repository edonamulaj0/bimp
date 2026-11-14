// Feng shui: traditional placement guidance turned into geometric checks, and a furniture layout that follows it.
// These are cultural design conventions, not building standards; results are presented as guidance.
import { type Plan, type Pt, type Room, type Fixture, type FixtureKind, type Opening, FIXTURE_LABEL, dist, area } from './plan';
import { doorSweep, fixtureContains, inside, openingsOfRoom, roomDims } from './rooms';
import { labelPoint } from './walls';

export type FsNote = { room_id?: string; ok: boolean; text: string };

const front = (f: Fixture): Pt => [-Math.sin(f.angle), Math.cos(f.angle)]; // local +y (away from the wall)
const doorMid = (o: Opening): Pt => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
/** How far p sits sideways from the line through the door, perpendicular to its wall (0 = straight in line). */
function lateral(o: Opening, p: Pt) {
  const L = dist(o.a, o.b) || 1, u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], m = doorMid(o);
  return Math.abs((p[0] - m[0]) * u[0] + (p[1] - m[1]) * u[1]);
}
const inLine = (o: Opening, p: Pt, half: number) => lateral(o, p) < dist(o.a, o.b) / 2 + half * 0.5;
/** The door sits straight in front of the item (foot of the bed, front of the WC, behind the cook at the stove). */
function facesDoor(f: Fixture, o: Opening) {
  const m = doorMid(o), dx = m[0] - f.center[0], dy = m[1] - f.center[1], c = Math.cos(-f.angle), s = Math.sin(-f.angle);
  const x = dx * c - dy * s, y = dx * s + dy * c;
  return Math.abs(x) < f.size[0] / 2 + dist(o.a, o.b) / 4 && y > f.size[1] / 2;
}

/** True if the span [p, q] on a wall overlaps a window lying on the same wall line (within 0.35 m of it). */
function spanUnderWindow(p: Pt, q: Pt, windows: Opening[]) {
  const L = dist(p, q) || 1, u: Pt = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  return windows.some((w) => {
    const off = (x: Pt) => Math.abs((x[0] - p[0]) * -u[1] + (x[1] - p[1]) * u[0]);
    if (off(w.a) > 0.35 || off(w.b) > 0.35) return false;
    const t = [w.a, w.b].map((x) => (x[0] - p[0]) * u[0] + (x[1] - p[1]) * u[1]).sort((m, n) => m - n);
    return t[1] > 0.05 && t[0] < L - 0.05;
  });
}

/** A room's entrance: a door from the hall or from outside, else its widest door. */
function entranceOf(plan: Plan, r: Room, doors: Opening[]): Opening | null {
  if (!doors.length) return null;
  const otherSide = (o: Opening) => {
    const L = dist(o.a, o.b) || 1, n: Pt = [-(o.b[1] - o.a[1]) / L, (o.b[0] - o.a[0]) / L], m = doorMid(o);
    for (const k of [0.45, -0.45]) { const p: Pt = [m[0] + n[0] * k, m[1] + n[1] * k]; if (!inside(p, r.polygon)) return plan.rooms.find((x) => inside(p, x.polygon)) ?? null; }
    return null;
  };
  const rank = (o: Opening) => { const t = otherSide(o)?.type; return t === undefined ? 3 : t === 'circulation' ? 2 : 0; };
  return [...doors].sort((a, b) => rank(b) - rank(a) || dist(b.a, b.b) - dist(a.a, a.b))[0];
}

export function fengShui(plan: Plan, roomId?: string): FsNote[] {
  const notes: FsNote[] = [];
  const rooms = plan.rooms.filter((r) => !roomId || r.id === roomId);
  const fx = plan.fixtures ?? [];
  for (const r of rooms) {
    const ops = openingsOfRoom(r, plan.openings), doors = ops.filter((o) => o.kind === 'door'), windows = ops.filter((o) => o.kind === 'window');
    const items = fx.filter((f) => f.room_id === r.id);
    const diag = Math.hypot(roomDims(r.polygon).length, roomDims(r.polygon).width);
    const habitable = ['living', 'dining', 'bedroom', 'kitchen', 'office'].includes(r.type);
    if (habitable) notes.push(windows.length ? { room_id: r.id, ok: true, text: `${r.name}: natural light from ${windows.length} window${windows.length > 1 ? 's' : ''}.` }
      : { room_id: r.id, ok: false, text: `${r.name}: no window found; light and air (chi) are weak here.` });
    for (const f of items) {
      const name = `${r.name}: the ${FIXTURE_LABEL[f.kind]}`;
      const nearDoor = entranceOf(plan, r, doors);
      if (f.kind === 'bed') {
        if (doors.some((o) => facesDoor(f, o))) notes.push({ room_id: r.id, ok: false, text: `${name} points its foot straight at the door; turn or move it so the door is seen diagonally.` });
        else if (nearDoor && dist(doorMid(nearDoor), f.center) > diag * 0.35) notes.push({ room_id: r.id, ok: true, text: `${name} is in the command position: the door is seen diagonally.` });
      }
      if (f.kind === 'bed') {
        const back: Pt = [f.center[0] - front(f)[0] * f.size[1] / 2, f.center[1] - front(f)[1] * f.size[1] / 2];
        const side: Pt = [Math.cos(f.angle), Math.sin(f.angle)];
        const hb: [Pt, Pt] = [[back[0] - side[0] * f.size[0] / 2, back[1] - side[1] * f.size[0] / 2], [back[0] + side[0] * f.size[0] / 2, back[1] + side[1] * f.size[0] / 2]];
        if (spanUnderWindow(hb[0], hb[1], windows)) notes.push({ room_id: r.id, ok: false, text: `${name} has its headboard under a window; a solid wall behind the head gives support.` });
        const behind: Pt = [back[0] - front(f)[0] * 0.5, back[1] - front(f)[1] * 0.5];
        const other = plan.rooms.find((x) => x.id !== r.id && inside(behind, x.polygon));
        if (other && (other.type === 'bathroom' || other.type === 'wc')) notes.push({ room_id: r.id, ok: false, text: `${name} backs onto the ${other.name}.` });
      }
      if (f.kind === 'desk' && nearDoor) {
        // the sitter faces the desk's back (the wall side); a door behind the sitter is the problem
        const toDoor: Pt = [doorMid(nearDoor)[0] - f.center[0], doorMid(nearDoor)[1] - f.center[1]];
        if (toDoor[0] * front(f)[0] + toDoor[1] * front(f)[1] > 0.3 * Math.hypot(...toDoor)) notes.push({ room_id: r.id, ok: false, text: `${name}: whoever sits there has their back to the door.` });
      }
      if (f.kind === 'sofa' && nearDoor) {
        const toDoor: Pt = [doorMid(nearDoor)[0] - f.center[0], doorMid(nearDoor)[1] - f.center[1]];
        notes.push(toDoor[0] * front(f)[0] + toDoor[1] * front(f)[1] > 0
          ? { room_id: r.id, ok: true, text: `${name} has a wall behind it and faces the entrance.` }
          : { room_id: r.id, ok: false, text: `${name} turns its back to the entrance.` });
      }
      if (f.kind === 'stove') {
        const sink = items.find((x) => x.kind === 'sink');
        if (sink && dist(sink.center, f.center) < (sink.size[0] + f.size[0]) / 2 + 0.3) notes.push({ room_id: r.id, ok: false, text: `${name} sits right next to the sink (fire beside water); keep a stretch of worktop between them.` });
        if (doors.some((o) => facesDoor(f, o))) notes.push({ room_id: r.id, ok: false, text: `${name}: the cook stands with their back straight to the door.` });
      }
      if (f.kind === 'wc' && doors.some((o) => facesDoor(f, o))) notes.push({ room_id: r.id, ok: false, text: `${name} faces the door directly.` });
    }
    for (const o of doors) for (const f of items) if (doorSweep(o).some((p) => fixtureContains(f, p))) notes.push({ room_id: r.id, ok: false, text: `${r.name}: door ${o.id} is blocked by the ${FIXTURE_LABEL[f.kind]}; chi should flow freely through doors.` });
  }
  if (!roomId) {
    // entrance in line with an opening on the far side: energy rushes straight through
    const doors = plan.openings.filter((o) => o.kind === 'door');
    for (const e of doors) {
      const rs = plan.rooms.filter((r) => openingsOfRoom(r, [e]).length);
      if (rs.length !== 1) continue; // entrance doors touch one room only
      const far = plan.openings.find((o) => o !== e && dist(doorMid(o), doorMid(e)) > 3 && inLine(e, doorMid(o), 0.2) && Math.abs(((o.b[0] - o.a[0]) * (e.b[0] - e.a[0]) + (o.b[1] - o.a[1]) * (e.b[1] - e.a[1])) / ((dist(o.a, o.b) * dist(e.a, e.b)) || 1)) > 0.9);
      if (far) notes.push({ ok: false, text: `The entrance (${e.id}) lines up with ${far.kind === 'door' ? 'door' : 'window'} ${far.id} across the home; energy rushes straight through. A screen, plant or rug in between slows it.` });
      else notes.push({ ok: true, text: `The entrance (${e.id}) does not look straight through the home.` });
    }
  }
  return notes;
}

// ---- layout suggestion ----
type Want = { kind: FixtureKind; w: number; d: number; score: (c: Pt, inward: Pt, r: Room) => number; offWall?: number; facingWall?: boolean; notUnderWindow?: boolean };

export function suggestLayout(plan: Plan): Fixture[] {
  const out: Fixture[] = [];
  const furnished = new Set((plan.fixtures ?? []).filter((f) => f.source !== 'suggested').map((f) => f.room_id));
  let n = 0;
  for (const r of plan.rooms) {
    if (furnished.has(r.id)) continue;
    const ops = openingsOfRoom(r, plan.openings), doors = ops.filter((o) => o.kind === 'door'), windows = ops.filter((o) => o.kind === 'window');
    const a = area(r.polygon), dims = roomDims(r.polygon);
    const doorDist = (c: Pt) => (doors.length ? Math.min(...doors.map((o) => dist(doorMid(o), c))) : 0);
    const notInLine = (c: Pt, half: number) => (doors.some((o) => inLine(o, c, half)) ? -10 : 0);
    const entrance = entranceOf(plan, r, doors);
    const faceDoor = (c: Pt, dir: Pt) => { if (!entrance) return 0; const t: Pt = [doorMid(entrance)[0] - c[0], doorMid(entrance)[1] - c[1]], L = Math.hypot(...t) || 1; return (t[0] * dir[0] + t[1] * dir[1]) / L; };
    // no door directly behind a sofa or a seated person
    const doorBehind = (c: Pt, dir: Pt) => doors.some((o) => { const t: Pt = [doorMid(o)[0] - c[0], doorMid(o)[1] - c[1]]; return t[0] * dir[0] + t[1] * dir[1] < 0 && Math.hypot(...t) < 1.6; }) ? -10 : 0;
    const wants: Want[] = [];
    if (r.type === 'bedroom' && dims.width >= 2.2) {
      const dbl = dims.width >= 2.8 && a >= 10;
      wants.push({ kind: 'bed', w: dbl ? 1.6 : 0.9, d: 2.0, notUnderWindow: true, score: (c) => doorDist(c) + notInLine(c, 0.8) });
      wants.push({ kind: 'wardrobe', w: 1.2, d: 0.6, score: (c) => -doorDist(c) * 0.3 + notInLine(c, 0.6) });
    } else if (r.type === 'living') {
      wants.push({ kind: 'sofa', w: Math.min(2.2, dims.length * 0.45), d: 0.9, notUnderWindow: true, score: (c, inw) => doorDist(c) * 0.5 + faceDoor(c, inw) * 3 + doorBehind(c, inw) + notInLine(c, 1) });
      wants.push({ kind: 'table', w: 1.4, d: 0.8, offWall: 1.6, score: (c, inw) => doorDist(c) * 0.3 + faceDoor(c, inw) });
    } else if (r.type === 'office') {
      // command position: back to a wall, facing the door, desk out from the wall with the chair behind it
      wants.push({ kind: 'desk', w: 1.2, d: 0.6, offWall: 0.9, facingWall: true, score: (c, inw) => doorDist(c) * 0.5 + faceDoor(c, inw) * 3 + notInLine(c, 0.6) });
    } else if (r.type === 'kitchen') {
      wants.push({ kind: 'fridge', w: 0.6, d: 0.65, score: (c) => -doorDist(c) * 0.2 + notInLine(c, 0.3) });
      wants.push({ kind: 'sink', w: 0.8, d: 0.6, notUnderWindow: false, score: (c) => windows.reduce((s, o) => Math.max(s, 3 - dist(doorMid(o), c)), 0) + notInLine(c, 0.4) });
      wants.push({ kind: 'stove', w: 0.6, d: 0.6, score: (c) => notInLine(c, 1) * 2 + (doors.length ? Math.min(...doors.map((o) => lateral(o, c))) : 0) });
      if (a >= 9) wants.push({ kind: 'table', w: 1.2, d: 0.8, offWall: 1.5, score: (c) => doorDist(c) * 0.2 });
    } else if (r.type === 'bathroom') {
      const tub = dims.length >= 1.75 && a >= 4;
      wants.push(tub ? { kind: 'bathtub', w: 1.7, d: 0.7, score: (c) => doorDist(c) } : { kind: 'shower', w: 0.9, d: 0.9, score: (c) => doorDist(c) });
      wants.push({ kind: 'wc', w: 0.4, d: 0.65, score: (c) => notInLine(c, 0.4) + doorDist(c) * 0.3 });
      wants.push({ kind: 'sink', w: 0.6, d: 0.45, score: (c) => -doorDist(c) * 0.5 });
    } else if (r.type === 'wc') {
      wants.push({ kind: 'wc', w: 0.4, d: 0.65, score: (c) => notInLine(c, 0.4) + doorDist(c) * 0.2 });
      if (a >= 1.6) wants.push({ kind: 'sink', w: 0.45, d: 0.35, score: (c) => -doorDist(c) });
    } else if (r.type === 'dining') {
      const c = labelPoint(r.polygon);
      out.push({ id: `s${++n}`, kind: 'table', center: c, size: [Math.min(1.8, dims.length * 0.5), 0.9], angle: 0, room_id: r.id, source: 'suggested' });
      continue;
    }
    const placed: Fixture[] = [];
    for (const want of wants) {
      let best: { f: Fixture; s: number } | null = null;
      r.polygon.forEach((p, i) => {
        const q = r.polygon[(i + 1) % r.polygon.length], L = dist(p, q);
        if (L < want.w + 0.1) return;
        const u: Pt = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
        let inw: Pt = [-u[1], u[0]];
        const probe: Pt = [(p[0] + q[0]) / 2 + inw[0] * 0.2, (p[1] + q[1]) / 2 + inw[1] * 0.2];
        if (!inside(probe, r.polygon)) inw = [u[1], -u[0]];
        for (let t = want.w / 2 + 0.05; t <= L - want.w / 2 - 0.05; t += 0.1) {
          const off = (want.offWall ?? 0) + want.d / 2 + 0.02;
          const c: Pt = [p[0] + u[0] * t + inw[0] * off, p[1] + u[1] * t + inw[1] * off];
          const dir: Pt = want.facingWall ? [-inw[0], -inw[1]] : inw; // the item's front
          const f: Fixture = { id: `s${n + 1}`, kind: want.kind, center: c, size: [want.w, want.d], angle: Math.atan2(-dir[0], dir[1]), room_id: r.id, source: 'suggested' };
          const corners: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
            const lx = (sx * want.w) / 2, ly = (sy * want.d) / 2, ca = Math.cos(f.angle), sa = Math.sin(f.angle);
            return [c[0] + lx * ca - ly * sa, c[1] + lx * sa + ly * ca];
          });
          if (!corners.every((k) => inside(k, r.polygon))) continue;
          if (doors.some((o) => doorSweep(o).some((pt) => fixtureContains(f, pt, 0.1)))) continue;
          if (doors.some((o) => dist(doorMid(o), c) < want.d / 2 + 0.8)) continue; // keep the way in clear
          if ([...placed, ...out].some((g) => corners.some((k) => fixtureContains(g, k, 0.05)) || fixtureContains(f, g.center, 0.05))) continue;
          const underWindow = spanUnderWindow([p[0] + u[0] * (t - want.w / 2), p[1] + u[1] * (t - want.w / 2)], [p[0] + u[0] * (t + want.w / 2), p[1] + u[1] * (t + want.w / 2)], windows);
          if (want.notUnderWindow && underWindow) continue;
          // same rule the checker applies, with the item's real width
          const lined = ['bed', 'wc', 'stove'].includes(want.kind) && doors.some((o) => facesDoor(f, o)) ? -20 : 0;
          const s = want.score(c, inw, r) + lined;
          if (!best || s > best.s) best = { f, s };
        }
      });
      const chosen = best as { f: Fixture; s: number } | null; // assigned inside the forEach above
      if (chosen) { n++; chosen.f.id = `s${n}`; placed.push(chosen.f); }
    }
    out.push(...placed);
  }
  return out;
}
