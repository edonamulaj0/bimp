// three.js isometric scene. Loaded lazily so the 3D library only downloads when a 3D view is shown.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Plan, type Fixture, centroid, dist, wallPieces } from '../../../shared/plan';
import { ROOM_COLORS } from './colors';

export type SceneApi = { highlight(hover: string | null, selected: string[]): void; rotate(steps: number): void; dispose(): void };
type Opts = { compact?: boolean; wallHeight?: number; onHover(id: string | null, x: number, y: number): void; onClick(id: string | null): void;
  onLabels?(labels: { id: string; name: string; x: number; y: number }[]): void };

const ISO_ELEVATION = Math.atan(1 / Math.SQRT2); // true isometric: 35.264°

export function createScene(host: HTMLElement, plan: Plan, opts: Opts): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = !opts.compact;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 2.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-6, 14, -4);
  scene.add(sun);

  // Floors: one slab per room, coloured by type.
  const floors = plan.rooms.map((r) => {
    const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // plan (x, y) -> world (x, -, z); slab hangs below y = 0
    const base = new THREE.Color(ROOM_COLORS[r.type]).lerp(new THREE.Color(0xffffff), 0.25);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: base }));
    mesh.receiveShadow = true;
    mesh.userData = { id: r.id, base };
    scene.add(mesh);
    return mesh;
  });

  // Walls: split around doors/windows, merged into one mesh.
  const H = opts.wallHeight ?? plan.wallHeight;
  const parts: THREE.BufferGeometry[] = [];
  for (const w of plan.walls) {
    const { dir, pieces } = wallPieces(w, plan.openings, H);
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const p of pieces) {
      const s = p.s === 0 ? -w.thickness / 2 : p.s, e = p.e >= len - 1e-6 ? len + w.thickness / 2 : p.e;
      const g = new THREE.BoxGeometry(e - s, p.z1 - p.z0, w.thickness);
      const mid = (s + e) / 2;
      g.rotateY(-Math.atan2(dir[1], dir[0]));
      g.translate(w.a[0] + dir[0] * mid, (p.z0 + p.z1) / 2, w.a[1] + dir[1] * mid);
      parts.push(g);
    }
  }
  const disposables: { dispose(): void }[] = [];
  const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material, edgesOpacity = 0.5, shadows = true) => {
    if (!geos.length) return;
    const geo = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    scene.add(mesh);
    disposables.push(geo, mat);
    if (edgesOpacity > 0) {
      const eg = new THREE.EdgesGeometry(geo, 30);
      const lm = new THREE.LineBasicMaterial({ color: 0x2b2f36, transparent: true, opacity: edgesOpacity });
      scene.add(new THREE.LineSegments(eg, lm));
      disposables.push(eg, lm);
    }
  };
  // Architectural model convention: wall tops where the walls are cut are dark (poché), sides white.
  const tint = (g: THREE.BufferGeometry, side: number, top?: number) => {
    const n = g.getAttribute('normal'), c = new Float32Array(n.count * 3);
    const cs = new THREE.Color(side), ct = new THREE.Color(top ?? side);
    for (let i = 0; i < n.count; i++) (n.getY(i) > 0.9 ? ct : cs).toArray(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const wallGeos = parts.map((g) => tint(g.toNonIndexed(), 0xfbfaf7, 0x30343b));
  parts.forEach((g) => g.dispose());
  addMerged(wallGeos, new THREE.MeshLambertMaterial({ vertexColors: true }), 0.45);

  // Door leaves (open at 90°, as drawn on the plan) and window glass.
  const leaves: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  for (const o of plan.openings) {
    const L = dist(o.a, o.b);
    if (L < 0.2) continue;
    const u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], n = [-u[1], u[0]];
    if (o.kind === 'door') {
      const h = Math.min(2.05, H), g = new THREE.BoxGeometry(L, h, 0.04);
      g.rotateY(-Math.atan2(n[1], n[0]));
      g.translate(o.a[0] + n[0] * L / 2, h / 2, o.a[1] + n[1] * L / 2);
      leaves.push(tint(g.toNonIndexed(), 0xd8c3a3, 0x8a7458));
    } else if (H > 0.9) {
      const top = Math.min(2.1, H), g = new THREE.BoxGeometry(L, top - 0.9, 0.02);
      g.rotateY(-Math.atan2(u[1], u[0]));
      g.translate((o.a[0] + o.b[0]) / 2, (0.9 + top) / 2, (o.a[1] + o.b[1]) / 2);
      glass.push(g);
    }
  }
  addMerged(leaves, new THREE.MeshLambertMaterial({ vertexColors: true }), 0.35);
  addMerged(glass, new THREE.MeshLambertMaterial({ color: 0x8fb8de, transparent: true, opacity: 0.45 }), 0, false);

  // Fittings and furniture: simple low-poly volumes, heights from typical sizes, cut at the wall height.
  const fx: THREE.BufferGeometry[] = [];
  for (const f of plan.fixtures ?? []) for (const g of fixtureParts(f, H)) fx.push(g);
  addMerged(fx, new THREE.MeshLambertMaterial({ vertexColors: true }), 0.35);

  // Isometric orthographic camera.
  const camera = new THREE.OrthographicCamera();
  const target = new THREE.Vector3(plan.width / 2, 0, plan.height / 2);
  let rot = 0, zoom = 1;
  const fit = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h);
    const aspect = w / h;
    const span = (plan.width + plan.height) * 0.72 * (opts.compact ? 1.0 : 1.12);
    const half = Math.max(span / 2 / aspect, (span * 0.62 + H) / 2) / zoom;
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, near: -1000, far: 1000 });
    const a = Math.PI / 4 + (rot * Math.PI) / 2, d = 100;
    camera.position.set(target.x + Math.cos(a) * Math.cos(ISO_ELEVATION) * d, target.y + Math.sin(ISO_ELEVATION) * d, target.z + Math.sin(a) * Math.cos(ISO_ELEVATION) * d);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
    if (opts.onLabels) {
      const v = new THREE.Vector3();
      opts.onLabels(plan.rooms.map((r) => {
        const [x, z] = centroid(r.polygon);
        v.set(x, 0.1, z).project(camera);
        return { id: r.id, name: r.name, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
      }));
    }
  };
  const render = () => renderer.render(scene, camera);

  // Picking: rooms under the pointer.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e: PointerEvent | MouseEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return (ray.intersectObjects(floors)[0]?.object.userData.id as string | undefined) ?? null;
  };
  const el = renderer.domElement;
  let dragFrom: { x: number; y: number; t: THREE.Vector3; moved: boolean } | null = null;
  const onMove = (e: PointerEvent) => {
    if (dragFrom && e.buttons & 1 && !opts.compact) {
      const dx = e.clientX - dragFrom.x, dy = e.clientY - dragFrom.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragFrom.moved = true;
      const k = (camera.top - camera.bottom) / el.clientHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      target.copy(dragFrom.t).addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      fit();
      return;
    }
    const r = el.getBoundingClientRect();
    opts.onHover(pick(e), e.clientX - r.left, e.clientY - r.top);
  };
  const onDown = (e: PointerEvent) => { dragFrom = { x: e.clientX, y: e.clientY, t: target.clone(), moved: false }; };
  const onUp = (e: PointerEvent) => { if (dragFrom && !dragFrom.moved) opts.onClick(pick(e)); dragFrom = null; };
  const onLeave = () => opts.onHover(null, 0, 0);
  const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom = Math.min(Math.max(zoom * Math.exp(-e.deltaY * 0.0015), 0.4), 8); fit(); };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointerleave', onLeave);
  if (!opts.compact) {
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', () => { zoom = 1; target.set(plan.width / 2, 0, plan.height / 2); fit(); });
  }

  const ro = new ResizeObserver(fit);
  ro.observe(host);
  fit();

  const white = new THREE.Color(0xffffff);
  return {
    highlight(hover, selected) {
      for (const m of floors) {
        const on = m.userData.id === hover || selected.includes(m.userData.id);
        (m.material as THREE.MeshLambertMaterial).color.copy(m.userData.base).lerp(white, on ? 0.45 : 0);
        m.position.y = on ? 0.06 : 0;
      }
      render();
    },
    rotate(steps) { rot = (rot + steps + 4) % 4; fit(); },
    dispose() {
      ro.disconnect();
      floors.forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.remove();
    },
  };
}

/** Low-poly volumes for a fixture, in world coordinates, with per-face colours. */
function fixtureParts(f: Fixture, H: number): THREE.BufferGeometry[] {
  const [w, d] = f.size, out: THREE.BufferGeometry[] = [];
  const box = (bw: number, bh: number, bd: number, x: number, y0: number, z: number, side: number, top?: number) => {
    const h = Math.min(bh, Math.max(0.02, H - y0));
    if (y0 >= H) return;
    const g = new THREE.BoxGeometry(bw, h, bd).toNonIndexed();
    g.translate(x, y0 + h / 2, z);
    out.push(colour(g, side, top));
  };
  const cyl = (r: number, h: number, x: number, z: number, color: number) => {
    const g = new THREE.CylinderGeometry(r, r * 0.9, Math.min(h, H), 20).toNonIndexed();
    g.translate(x, Math.min(h, H) / 2, z);
    out.push(colour(g, color));
  };
  const white = 0xf6f5f2, wood = 0xc9a882, fabric = 0x9aa6b2, dark = 0x3b3f45;
  const back = -d / 2;
  switch (f.kind) {
    case 'wc': box(w, 0.75, 0.18, 0, 0, back + 0.09, white); cyl(Math.min(w, d) * 0.38, 0.4, 0, back + 0.18 + (d - 0.18) / 2, white); break;
    case 'sink': box(w, 0.85, d, 0, 0, 0, white, 0xdfe5ea); break;
    case 'bathtub': box(w, 0.55, d, 0, 0, 0, white, 0xd6e6f2); break;
    case 'shower': box(w, 0.06, d, 0, 0, 0, white); break;
    case 'sauna_stove': box(w, 0.75, d, 0, 0, 0, dark, 0x6b5b4b); break;
    case 'stove': box(w, 0.9, d, 0, 0, 0, white, dark); break;
    case 'fridge': box(w, 1.8, d, 0, 0, 0, 0xe9ecef); break;
    case 'washer': box(w, 0.85, d, 0, 0, 0, white); break;
    case 'bed': box(w, 0.45, d, 0, 0, 0, white, 0xeef1f4); box(w * 0.9, 0.12, 0.3, 0, 0.45, back + 0.22, 0xffffff); box(w, 0.8, 0.06, 0, 0, back + 0.03, wood); break;
    case 'sofa': box(w, 0.42, d, 0, 0, 0, fabric); box(w, 0.4, Math.min(0.22, d * 0.3), 0, 0.42, back + 0.11, fabric); break;
    case 'table': case 'desk': box(w, 0.04, d, 0, 0.71, 0, wood);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.05, 0.71, 0.05, a * (w / 2 - 0.05), 0, b * (d / 2 - 0.05), wood); break;
    case 'wardrobe': box(w, 2.0, d, 0, 0, 0, 0xe4ddd2); break;
  }
  const m = new THREE.Matrix4().makeRotationY(-f.angle).setPosition(f.center[0], 0, f.center[1]);
  // plan (x, y) -> world (x, z); a plan rotation by +angle is a rotation by -angle about +Y in world space
  out.forEach((g) => g.applyMatrix4(m));
  return out;
}

function colour(g: THREE.BufferGeometry, side: number, top?: number) {
  const n = g.getAttribute('normal'), c = new Float32Array(n.count * 3);
  const cs = new THREE.Color(side), ct = new THREE.Color(top ?? side);
  for (let i = 0; i < n.count; i++) (n.getY(i) > 0.9 ? ct : cs).toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
