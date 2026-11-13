// three.js isometric scene. Loaded lazily so the 3D library only downloads when a 3D view is shown.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Plan, wallPieces } from '../../../shared/plan';
import { ROOM_COLORS } from './colors';

export type SceneApi = { highlight(hover: string | null, selected: string[]): void; rotate(steps: number): void; dispose(): void };
type Opts = { compact?: boolean; wallHeight?: number; onHover(id: string | null, x: number, y: number): void; onClick(id: string | null): void };

const ISO_ELEVATION = Math.atan(1 / Math.SQRT2); // true isometric: 35.264°

export function createScene(host: HTMLElement, plan: Plan, opts: Opts): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
    const base = new THREE.Color(ROOM_COLORS[r.type]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: base }));
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
  if (parts.length) {
    const geo = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    const walls = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xfbfaf7 }));
    const edgesGeo = new THREE.EdgesGeometry(geo, 30);
    const edges = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0x2b2f36, transparent: true, opacity: 0.55 }));
    scene.add(walls, edges);
    disposables.push(geo, edgesGeo, walls.material, edges.material);
  }

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
