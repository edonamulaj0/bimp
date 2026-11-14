// three.js model scene with a free orbit camera. Loaded lazily so the 3D library only downloads when a 3D view is shown.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Region } from '../../../shared/region';
import { type Plan, type Pt, type Fixture, type FixtureKind, type Room, dist, wallPieces } from '../../../shared/plan';
import { clipHalf, labelPoint, wallFootprints } from '../../../shared/walls';
import { ROOM_COLORS } from './colors';
import { floorTexture } from './floors';

export type WallMode = 'dollhouse' | 'cut' | 'full';
export type ViewPreset = 'iso' | 'top' | 'front' | 'side' | 'eye' | 'reset';
export type Projection = 'persp' | 'ortho';
export type CameraView = { pos: [number, number, number]; target: [number, number, number]; zoom?: number };
export type SceneApi = {
  highlight(hover: string | null, selected: string[]): void; rotate(steps: number): void; orbit(dAz: number, dEl: number): void;
  pan(dx: number, dy: number): void; zoom(k: number): void; view(v: ViewPreset): void;
  projection(): Projection; setProjection(p: Projection): void; getView(): CameraView;
  planPoint(clientX: number, clientY: number): Pt | null; setControls(on: boolean): void; setRegion(r: Region | null): void;
  /** The current view as a PNG with a transparent background (no region box), for image generation. */
  snapshot(): Promise<Blob>; dispose(): void;
};
type Opts = { compact?: boolean; walls?: WallMode; furniture?: boolean; projection?: Projection; view?: CameraView | null;
  onHover(id: string | null, x: number, y: number): void; onClick(id: string | null): void;
  onLabels?(labels: { id: string; name: string; x: number; y: number }[]): void;
  /** Context menu at a client position (right click without dragging, double click, long press). */
  onMenu?(x: number, y: number, roomId: string | null, p: Pt | null): void;
  onView?(): void };

const ISO_ELEVATION = Math.atan(1 / Math.SQRT2); // true isometric: 35.264°
const CUT = 1.2, LOW = 0.3; // section cut height; dollhouse: front exterior walls drop to a low base

const insidePoly = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

export function createScene(host: HTMLElement, plan: Plan, opts: Opts): SceneApi {
  const mode: WallMode = opts.walls ?? 'dollhouse';
  const HF = plan.wallHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = !opts.compact;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  const ext = Math.max(plan.width, plan.height);
  sun.position.set(plan.width / 2 - ext * 0.6, ext * 1.4, plan.height / 2 - ext * 0.35);
  sun.target.position.set(plan.width / 2, 0, plan.height / 2);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.1, far: ext * 4 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ext * 3, ext * 3), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(plan.width / 2, -0.09, plan.height / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const disposables: { dispose(): void }[] = [ground.geometry, ground.material as THREE.Material];

  // Floors: a slab per room with a procedural material by room type (wood, tiles, concrete, decking), tinted by type.
  const floors = plan.rooms.map((r) => {
    const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }); // cap UVs are plan metres
    geo.rotateX(Math.PI / 2); // plan (x, y) -> world (x, -, z); slab hangs below y = 0
    const base = new THREE.Color(ROOM_COLORS[r.type]).lerp(new THREE.Color(0xffffff), 0.55);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: base, map: floorTexture(r.type) }));
    mesh.receiveShadow = true;
    mesh.userData = { id: r.id, base };
    scene.add(mesh);
    return mesh;
  });

  const addMerged = (to: THREE.Object3D, bin: { dispose(): void }[], geos: THREE.BufferGeometry[], mat: THREE.Material, edgesOpacity = 0.5, shadows = true) => {
    if (!geos.length) { mat.dispose(); return; }
    const geo = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    to.add(mesh);
    bin.push(geo, mat);
    if (edgesOpacity > 0) {
      const eg = new THREE.EdgesGeometry(geo, 30);
      const lm = new THREE.LineBasicMaterial({ color: 0x2b2f36, transparent: true, opacity: edgesOpacity });
      to.add(new THREE.LineSegments(eg, lm));
      bin.push(eg, lm);
    }
  };

  // Which side of each wall is indoors: exterior walls have a room on one side only.
  const footprints = wallFootprints(plan.walls);
  const roomAt = (p: Pt): Room | undefined => plan.rooms.find((r) => insidePoly(p, r.polygon));
  const indoor = new Map(footprints.map((f) => {
    const w = f.wall, L = dist(w.a, w.b) || 1, n: Pt = [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
    const m: Pt = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], k = w.thickness / 2 + 0.25;
    const l = roomAt([m[0] + n[0] * k, m[1] + n[1] * k]), r = roomAt([m[0] - n[0] * k, m[1] - n[1] * k]);
    return [w.id, l && !r ? n : r && !l ? ([-n[0], -n[1]] as Pt) : null] as const; // null: interior wall
  }));

  // Walls, openings and frames: rebuilt when the dollhouse view rotates (front walls change).
  let envelope = new THREE.Group(), envBin: { dispose(): void }[] = [];
  const buildEnvelope = (cam: THREE.Vector3) => {
    scene.remove(envelope); envBin.forEach((d) => d.dispose());
    envelope = new THREE.Group(); envBin = [];
    const dx = cam.x - plan.width / 2, dz = cam.z - plan.height / 2, cl = Math.hypot(dx, dz) || 1, toCam: Pt = [dx / cl, dz / cl];
    const heightOf = (id: string) => {
      if (mode === 'full') return HF;
      if (mode === 'cut') return Math.min(CUT, HF);
      const nIn = indoor.get(id);
      if (!nIn) return Math.min(CUT, HF);                                   // interior partition: cut
      return nIn[0] * toCam[0] + nIn[1] * toCam[1] < -0.02 ? LOW : HF;      // camera outside it: front wall drops
    };
    const pieces: { poly: Pt[]; z0: number; z1: number }[] = [];
    const wallH = new Map<string, number>();
    for (const f of footprints) {
      const w = f.wall, len = dist(w.a, w.b), H = heightOf(w.id), { dir, pieces: ranges } = wallPieces(w, plan.openings, H);
      wallH.set(w.id, H);
      for (const r of ranges) {
        let poly = f.poly;
        if (r.s > 1e-6) poly = clipHalf(poly, w.a, dir, r.s, 1);
        if (r.e < len - 1e-6) poly = clipHalf(poly, w.a, dir, r.e, -1);
        if (poly.length >= 3) pieces.push({ poly, z0: r.z0, z1: r.z1 });
      }
    }
    // Baked occlusion: wall sides darken toward the floor; cut tops are dark (poché). After neonplan3d (MIT).
    const wallGeos = pieces.map(({ poly, z0, z1 }) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y))), { depth: z1 - z0, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, z1, 0);
      const n = g.toNonIndexed(); g.dispose();
      const nm = n.getAttribute('normal'), pos = n.getAttribute('position'), c = new Float32Array(nm.count * 3);
      const side = new THREE.Color(0xfbfaf7), topC = new THREE.Color(z1 >= HF - 1e-6 ? 0x6b7078 : 0x30343b), tmp = new THREE.Color();
      for (let i = 0; i < nm.count; i++) {
        if (nm.getY(i) > 0.9) topC.toArray(c, i * 3);
        else tmp.copy(side).multiplyScalar(0.66 + 0.34 * Math.min(1, pos.getY(i) / 1.4)).toArray(c, i * 3);
      }
      n.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return n;
    });
    addMerged(envelope, envBin, wallGeos, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), 0);
    const olGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wallOutline(pieces), 3));
    const olMat = new THREE.LineBasicMaterial({ color: 0x23262b, transparent: true, opacity: 0.6 });
    envelope.add(new THREE.LineSegments(olGeo, olMat));
    envBin.push(olGeo, olMat);

    // Height of the wall an opening sits in.
    const heightAt = (m: Pt) => {
      let best = HF, bd = Infinity;
      for (const f of footprints) {
        const w = f.wall, L = dist(w.a, w.b) || 1, u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
        const t = Math.max(0, Math.min(L, (m[0] - w.a[0]) * u[0] + (m[1] - w.a[1]) * u[1]));
        const d = Math.hypot(m[0] - w.a[0] - u[0] * t, m[1] - w.a[1] - u[1] * t);
        if (d < bd) { bd = d; best = wallH.get(w.id) ?? HF; }
      }
      return best;
    };
    const leaves: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    for (const o of plan.openings) {
      const L = dist(o.a, o.b);
      if (L < 0.2) continue;
      const H = heightAt([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]);
      const u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], sw = o.swing ?? 1, n = [-u[1] * sw, u[0] * sw];
      if (o.kind === 'door' && H > 0.5) {
        const h = Math.min(2.05, H), g = new THREE.BoxGeometry(L, h, 0.04);
        g.rotateY(-Math.atan2(n[1], n[0]));
        g.translate(o.a[0] + n[0] * L / 2, h / 2, o.a[1] + n[1] * L / 2);
        leaves.push(colour(g.toNonIndexed(), 0xd8c3a3, 0x8a7458));
      } else if (o.kind === 'window' && H > 0.9) {
        const top = Math.min(2.1, H), g = new THREE.BoxGeometry(L, top - 0.9, 0.02);
        g.rotateY(-Math.atan2(u[1], u[0]));
        g.translate((o.a[0] + o.b[0]) / 2, (0.9 + top) / 2, (o.a[1] + o.b[1]) / 2);
        glass.push(g);
      }
    }
    addMerged(envelope, envBin, leaves, new THREE.MeshLambertMaterial({ vertexColors: true }), 0.35);
    addMerged(envelope, envBin, openingFrames(plan, heightAt), new THREE.MeshLambertMaterial({ vertexColors: true }), 0.3);
    addMerged(envelope, envBin, glass, new THREE.MeshLambertMaterial({ color: 0x9cc4e4, transparent: true, opacity: 0.32, depthWrite: false }), 0, false);
    scene.add(envelope);
  };

  // Soft contact shadows on the floor along every wall a room touches, left out across doorways.
  const strips = contactStrips(plan);
  if (strips.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(strips.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(strips.col, 3));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    scene.add(new THREE.Mesh(g, m));
    disposables.push(g, m);
  }

  // Fittings and furniture: CC0 Kenney models scaled to the size read from the drawing (boxes where no model fits),
  // clipped at the cut height in section mode.
  const FH = mode === 'cut' ? Math.min(CUT, HF) : HF;
  const clip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), FH + 0.001)];
  const boxed: Fixture[] = [];
  let alive = true;
  const placed: THREE.Object3D[] = [];
  for (const f of opts.furniture === false ? [] : plan.fixtures ?? []) {
    const name = modelFor(f, plan);
    if (!name) { boxed.push(f); continue; }
    loadModel(name).then((src) => {
      if (!alive) return;
      const o = placeModel(src, f, clip, !opts.compact);
      scene.add(o); placed.push(o); render();
    }).catch(() => {
      if (!alive) return;
      const geos = fixtureParts(f, FH);
      if (geos.length) {
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true }), m = new THREE.Mesh(mergeGeometries(geos)!, mat);
        geos.forEach((g) => g.dispose());
        m.castShadow = true; m.userData.ownGeometry = true; // not shared with the model cache: dispose with the scene
        scene.add(m); placed.push(m); render();
      }
    });
  }
  const fx: THREE.BufferGeometry[] = [];
  for (const f of boxed) for (const g of fixtureParts(f, FH)) fx.push(g);
  addMerged(scene, disposables, fx, new THREE.MeshLambertMaterial({ vertexColors: true }), 0.35);

  // Free camera: orbit (left drag / one finger), pan (right drag, Shift+drag / two fingers), zoom (wheel / pinch),
  // in perspective or parallel projection. Starts at the isometric angle the views used before.
  const target = new THREE.Vector3(plan.width / 2, 0, plan.height / 2);
  const radius = Math.hypot(plan.width, plan.height) / 2 + HF;
  const persp = new THREE.PerspectiveCamera(35, 1, 0.05, radius * 40);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -radius * 20, radius * 20);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = opts.projection === 'ortho' ? ortho : persp;
  const homeDist = () => radius / Math.sin(THREE.MathUtils.degToRad(persp.fov / 2)) * (opts.compact ? 0.8 : 0.82);
  const presetPos = (v: ViewPreset): THREE.Vector3 => {
    const d = homeDist(), at = (az: number, el: number) => new THREE.Vector3(Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d).add(target);
    switch (v) {
      case 'top': return at(Math.PI / 2, Math.PI / 2 - 0.001);
      case 'front': return at(Math.PI / 2, 0.12);   // from the south (plan +y), looking north
      case 'side': return at(0, 0.12);              // from the east (plan +x)
      case 'eye': return at(Math.PI / 4, 0.32);
      default: return at(Math.PI / 4, ISO_ELEVATION);
    }
  };
  const el = renderer.domElement;
  let controls = new OrbitControls(camera, el);
  const setupControls = () => {
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true; controls.zoomToCursor = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // never under the ground
    controls.minDistance = 1.5; controls.maxDistance = radius * 12; controls.minZoom = 0.3; controls.maxZoom = 12;
    controls.target.copy(target);
    controls.enabled = !opts.compact;
    controls.addEventListener('change', onChange);
  };
  const fitOrtho = () => {
    const { clientWidth: w, clientHeight: h } = host, aspect = w / (h || 1), half = radius * 1.05;
    Object.assign(ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    ortho.updateProjectionMatrix();
  };
  if (opts.view) { camera.position.fromArray(opts.view.pos); target.fromArray(opts.view.target); if (camera === ortho) ortho.zoom = opts.view.zoom ?? 1; }
  else camera.position.copy(presetPos('iso'));
  let lowKey = '';
  const lowered = () => {
    if (mode !== 'dollhouse') return '';
    const dx = camera.position.x - controls.target.x, dz = camera.position.z - controls.target.z, L = Math.hypot(dx, dz) || 1, toCam: Pt = [dx / L, dz / L];
    return footprints.map((f) => { const n = indoor.get(f.wall.id); return n && n[0] * toCam[0] + n[1] * toCam[1] < -0.02 ? '1' : '0'; }).join('');
  };
  const render = () => {
    renderer.render(scene, camera);
    if (opts.onLabels) {
      const v = new THREE.Vector3(), { clientWidth: w, clientHeight: h } = host;
      opts.onLabels(plan.rooms.flatMap((r) => {
        const [x, z] = labelPoint(r.polygon);
        v.set(x, 0.1, z).project(camera);
        return v.z > 1 || v.z < -1 ? [] : [{ id: r.id, name: r.name, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h }];
      }));
    }
  };
  let raf = 0;
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const tick = () => { raf = 0; if (flight) stepFlight(); if (controls.update()) kick(); };
  function onChange() {
    const k = lowered();
    if (k !== lowKey) { lowKey = k; buildEnvelope(camera.position); }
    render(); kick();
    opts.onView?.();
  }
  // animated moves to a preset
  let flight: { t0: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3; z0: number; z1: number } | null = null;
  const flyTo = (pos: THREE.Vector3, tgt: THREE.Vector3, zoom = 1) => {
    const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
    flight = { t0: performance.now() - (quick ? 1e4 : 0), p0: camera.position.clone(), p1: pos, c0: controls.target.clone(), c1: tgt.clone(), z0: camera.zoom, z1: zoom };
    kick();
  };
  const stepFlight = () => {
    const f = flight!, k = Math.min(1, (performance.now() - f.t0) / 480), e = 1 - (1 - k) ** 3;
    camera.position.lerpVectors(f.p0, f.p1, e); controls.target.lerpVectors(f.c0, f.c1, e);
    if (camera === ortho) { ortho.zoom = f.z0 + (f.z1 - f.z0) * e; ortho.updateProjectionMatrix(); }
    if (k >= 1) flight = null; else kick();
    controls.update(); onChange();
  };
  setupControls();
  lowKey = lowered();
  buildEnvelope(camera.position);
  const fit = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h);
    persp.aspect = w / h; persp.updateProjectionMatrix();
    fitOrtho();
    controls.update();
    render();
  };
  // Picking: rooms under the pointer; points on the floor plane (y = 0) in plan metres.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const pick = (cx: number, cy: number) => { aim(cx, cy); return (ray.intersectObjects(floors)[0]?.object.userData.id as string | undefined) ?? null; };
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const planPoint = (cx: number, cy: number): Pt | null => {
    aim(cx, cy);
    const hit = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
    return hit ? [hit.x, hit.z] : null;
  };
  let down: { x: number; y: number; b: number; t: number } | null = null, hoverRaf = 0, press = 0;
  const onMove = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { clearTimeout(press); press = 0; }
    if (e.buttons || hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const r = el.getBoundingClientRect();
      opts.onHover(pick(e.clientX, e.clientY), e.clientX - r.left, e.clientY - r.top);
    });
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, b: e.button, t: performance.now() };
    if (e.pointerType === 'touch' && opts.onMenu) press = window.setTimeout(() => { press = 0; down = null; opts.onMenu!(e.clientX, e.clientY, pick(e.clientX, e.clientY), planPoint(e.clientX, e.clientY)); }, 550);
  };
  const onUp = (e: PointerEvent) => {
    clearTimeout(press); press = 0;
    if (!down) return;
    const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
    if (still && down.b === 0) opts.onClick(pick(e.clientX, e.clientY));
    if (still && down.b === 2 && opts.onMenu) opts.onMenu(e.clientX, e.clientY, pick(e.clientX, e.clientY), planPoint(e.clientX, e.clientY));
    down = null;
  };
  const onLeave = () => opts.onHover(null, 0, 0);
  const onDbl = (e: MouseEvent) => { if (opts.onMenu) opts.onMenu(e.clientX, e.clientY, pick(e.clientX, e.clientY), planPoint(e.clientX, e.clientY)); else api.view('iso'); };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointerleave', onLeave);
  if (!opts.compact) el.addEventListener('dblclick', onDbl);

  const ro = new ResizeObserver(fit);
  ro.observe(host);
  fit();

  // markup region: a translucent volume over the floor with an outline
  let regionObj: THREE.Group | null = null;
  const regionBin: { dispose(): void }[] = [];
  const clearRegion = () => { if (regionObj) scene.remove(regionObj); regionBin.splice(0).forEach((d) => d.dispose()); regionObj = null; };

  const white = new THREE.Color(0xffffff);
  const orbitBy = (dAz: number, dEl = 0) => {
    const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dAz; sph.phi = THREE.MathUtils.clamp(sph.phi - dEl, 0.01, controls.maxPolarAngle);
    flyTo(new THREE.Vector3().setFromSpherical(sph).add(controls.target), controls.target.clone(), camera.zoom);
  };
  const api: SceneApi = {
    highlight(hover, selected) {
      for (const m of floors) {
        const on = m.userData.id === hover || selected.includes(m.userData.id);
        (m.material as THREE.MeshLambertMaterial).color.copy(m.userData.base).lerp(white, on ? 0.45 : 0);
        m.position.y = on ? 0.06 : 0;
      }
      render();
    },
    rotate(steps) { if (steps) orbitBy((steps * Math.PI) / 2); },
    orbit(dAz, dEl) { orbitBy(dAz, dEl); },
    pan(dx, dy) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const k = radius * 0.15 / (camera === ortho ? ortho.zoom : 1), d = right.multiplyScalar(dx * k).add(up.multiplyScalar(dy * k));
      flyTo(camera.position.clone().add(d), controls.target.clone().add(d), camera.zoom);
    },
    zoom(k) {
      if (camera === ortho) flyTo(camera.position.clone(), controls.target.clone(), THREE.MathUtils.clamp(ortho.zoom / k, controls.minZoom, controls.maxZoom));
      else { const off = camera.position.clone().sub(controls.target).multiplyScalar(k); flyTo(controls.target.clone().add(off), controls.target.clone()); }
    },
    view(v) {
      const t = new THREE.Vector3(plan.width / 2, 0, plan.height / 2);
      if (v === 'reset') v = 'iso';
      target.copy(t);
      flyTo(presetPos(v), t, 1);
    },
    projection() { return camera === ortho ? 'ortho' : 'persp'; },
    setProjection(p) {
      const next = p === 'ortho' ? ortho : persp;
      if (next === camera) return;
      next.position.copy(camera.position); next.zoom = 1; next.updateProjectionMatrix();
      const tgt = controls.target.clone();
      controls.removeEventListener('change', onChange); controls.dispose();
      camera = next;
      controls = new OrbitControls(camera, el);
      setupControls(); controls.target.copy(tgt);
      fit();
    },
    async snapshot() {
      const hidden = regionObj?.visible;
      if (regionObj) regionObj.visible = false;
      renderer.render(scene, camera); // read back in the same task, before the drawing buffer is cleared
      const url = el.toDataURL('image/png');
      if (regionObj) regionObj.visible = hidden ?? true;
      render();
      const bin = atob(url.slice(url.indexOf(',') + 1)), bytes = new Uint8Array(bin.length); // not fetch(): CSP allows no data: connections
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'image/png' });
    },
    getView() { return { pos: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number], zoom: camera.zoom }; },
    planPoint,
    setControls(on) { controls.enabled = on && !opts.compact; },
    setRegion(r) {
      clearRegion();
      if (!r) return render();
      const w = r.x1 - r.x0, d = r.y1 - r.y0, h = Math.min(HF, 2.4);
      regionObj = new THREE.Group();
      const box = new THREE.BoxGeometry(w, h, d); box.translate(r.x0 + w / 2, h / 2, r.y0 + d / 2);
      const fill = new THREE.MeshBasicMaterial({ color: 0xff682b, transparent: true, opacity: 0.08, depthWrite: false });
      const edges = new THREE.EdgesGeometry(box), line = new THREE.LineBasicMaterial({ color: 0xff682b, transparent: true, opacity: 0.95, depthTest: false });
      const base = new THREE.PlaneGeometry(w, d); base.rotateX(-Math.PI / 2); base.translate(r.x0 + w / 2, 0.015, r.y0 + d / 2);
      const baseMat = new THREE.MeshBasicMaterial({ color: 0xff682b, transparent: true, opacity: 0.16, depthWrite: false });
      regionObj.add(new THREE.Mesh(box, fill), new THREE.LineSegments(edges, line), new THREE.Mesh(base, baseMat));
      regionObj.renderOrder = 10;
      regionBin.push(box, fill, edges, line, base, baseMat);
      scene.add(regionObj);
      render();
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf); cancelAnimationFrame(hoverRaf); clearTimeout(press);
      clearRegion();
      placed.forEach((o) => o.traverse((m) => {
        if (!(m as THREE.Mesh).isMesh) return;
        ((m as THREE.Mesh).material as THREE.Material).dispose();
        if (m.userData.ownGeometry) (m as THREE.Mesh).geometry.dispose();
      }));
      ro.disconnect();
      controls.removeEventListener('change', onChange); controls.dispose();
      floors.forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      disposables.forEach((d) => d.dispose());
      envBin.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss(); // browsers cap live WebGL contexts; free this one now rather than at GC
      el.remove();
    },
  };
  return api;
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

// ---- Kenney Furniture Kit models (CC0, apps/web/public/models/kenney) ----
const MODELS: Partial<Record<FixtureKind, string>> = {
  wc: 'toilet', bathtub: 'bathtub', shower: 'shower', stove: 'kitchenStove', fridge: 'kitchenFridge', washer: 'washer',
  sofa: 'loungeSofa', table: 'table', desk: 'desk',
};

function modelFor(f: Fixture, plan: Plan): string | null {
  if (f.kind === 'sink') return plan.rooms.find((r) => r.id === f.room_id)?.type === 'kitchen' ? 'kitchenSink' : 'bathroomSink';
  if (f.kind === 'bed') return f.size[0] > 1.2 ? 'bedDouble' : 'bedSingle';
  return MODELS[f.kind] ?? null;
}

const cache = new Map<string, Promise<THREE.Object3D>>();
function loadModel(name: string) {
  if (!cache.has(name)) cache.set(name, new GLTFLoader().loadAsync(`/models/kenney/${name}.glb`).then((g) => g.scene));
  return cache.get(name)!;
}

function placeModel(src: THREE.Object3D, f: Fixture, clip: THREE.Plane[], shadows: boolean) {
  // Kenney models face +Z, which is our local front (away from the wall), so no extra yaw is needed.
  const obj = src.clone(true);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  const sx = f.size[0] / (size.x || 1), sz = f.size[1] / (size.z || 1);
  const pivot = new THREE.Group();
  pivot.add(obj);
  pivot.scale.set(sx, (sx + sz) / 2, sz);
  pivot.rotation.y = -f.angle;
  pivot.position.set(f.center[0], 0, f.center[1]);
  obj.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.Material).clone();
    mat.clippingPlanes = clip;
    mesh.material = mat;
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
  });
  return pivot;
}

// ---- wall outline: keep only edges not shared by two pieces (no seams at joints), corner verticals only ----
function wallOutline(pieces: { poly: Pt[]; z0: number; z1: number }[]): number[] {
  const out: number[] = [];
  const k = (p: Pt) => `${Math.round(p[0] * 500)},${Math.round(p[1] * 500)}`;
  const levels = new Map<number, Pt[][]>();
  for (const p of pieces) for (const z of [p.z0, p.z1]) levels.set(z, [...(levels.get(z) ?? []), p.poly]);
  const cornersAt = new Map<number, Set<string>>();
  for (const [z, polys] of levels) {
    const verts = polys.flat();
    const count = new Map<string, { a: Pt; b: Pt; n: number }>();
    for (const poly of polys) poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], L = dist(a, b);
      if (L < 1e-4) return;
      // split this edge at every vertex lying on it, so T-joints cancel piecewise
      const ts = [0, 1, ...verts.map((v) => {
        const t = ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / (L * L);
        const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        return t > 1e-4 && t < 1 - 1e-4 && dist(q, v) < 2e-3 ? t : -1;
      }).filter((t) => t > 0)].sort((x, y) => x - y);
      for (let j = 0; j + 1 < ts.length; j++) {
        const p0: Pt = [a[0] + (b[0] - a[0]) * ts[j], a[1] + (b[1] - a[1]) * ts[j]];
        const p1: Pt = [a[0] + (b[0] - a[0]) * ts[j + 1], a[1] + (b[1] - a[1]) * ts[j + 1]];
        if (dist(p0, p1) < 1e-4) continue;
        const key = [k(p0), k(p1)].sort().join('|');
        const e = count.get(key);
        if (e) e.n++; else count.set(key, { a: p0, b: p1, n: 1 });
      }
    });
    const dirs = new Map<string, Pt[]>();
    for (const { a, b, n } of count.values()) {
      if (n !== 1) continue;
      out.push(a[0], z, a[1], b[0], z, b[1]);
      const L = dist(a, b), u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      dirs.set(k(a), [...(dirs.get(k(a)) ?? []), u]);
      dirs.set(k(b), [...(dirs.get(k(b)) ?? []), [-u[0], -u[1]]]);
    }
    const corners = new Set<string>();
    for (const [v, ds] of dirs) if (ds.length !== 2 || Math.abs(ds[0][0] * ds[1][1] - ds[0][1] * ds[1][0]) > 1e-3 || ds[0][0] * ds[1][0] + ds[0][1] * ds[1][1] > 0) corners.add(v);
    cornersAt.set(z, corners);
  }
  for (const p of pieces) {
    const top = cornersAt.get(p.z1)!;
    for (const v of new Set(p.poly.map(k))) if (top.has(v)) {
      const q = p.poly.find((x) => k(x) === v)!;
      out.push(q[0], p.z0, q[1], q[0], p.z1, q[1]);
    }
  }
  return out;
}

// ---- floor contact strips: a 0.4 m grey-to-white band inside each room edge, skipping door spans ----
function contactStrips(plan: Plan) {
  const pos: number[] = [], col: number[] = [], W = 0.4, dark = 0.72, y = 0.003;
  const doors = plan.openings.filter((o) => o.kind === 'door');
  for (const r of plan.rooms) {
    let sgn = 0;
    r.polygon.forEach((p, i) => { const q = r.polygon[(i + 1) % r.polygon.length]; sgn += p[0] * q[1] - q[0] * p[1]; });
    r.polygon.forEach((a, i) => {
      const b = r.polygon[(i + 1) % r.polygon.length], L = dist(a, b);
      if (L < 0.1) return;
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], inn: Pt = sgn > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
      const gaps = doors.flatMap((o) => {
        const m: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
        const off = Math.abs((m[0] - a[0]) * inn[0] + (m[1] - a[1]) * inn[1]);
        if (off > 0.4) return [];
        const t = [o.a, o.b].map((p) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]).sort((x, z) => x - z);
        return t[1] > 0 && t[0] < L ? [[Math.max(0, t[0]), Math.min(L, t[1])]] : [];
      }).sort((x, z) => x[0] - z[0]);
      let cur = 0;
      const spans: [number, number][] = [];
      for (const [g0, g1] of gaps) { if (g0 > cur) spans.push([cur, g0]); cur = Math.max(cur, g1); }
      if (cur < L) spans.push([cur, L]);
      for (const [s0, s1] of spans) {
        if (s1 - s0 < 0.05) continue;
        const p0: Pt = [a[0] + u[0] * s0, a[1] + u[1] * s0], p1: Pt = [a[0] + u[0] * s1, a[1] + u[1] * s1];
        const q0: Pt = [p0[0] + inn[0] * W, p0[1] + inn[1] * W], q1: Pt = [p1[0] + inn[0] * W, p1[1] + inn[1] * W];
        for (const [p, c] of [[p0, dark], [p1, dark], [q1, 1], [p0, dark], [q1, 1], [q0, 1]] as [Pt, number][]) { pos.push(p[0], y, p[1]); col.push(c, c, c); }
      }
    });
  }
  return { pos, col };
}

// ---- door and window frames: jambs/head standing 1 cm proud of both wall faces, window sills ----
function openingFrames(plan: Plan, heightAt: (m: Pt) => number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const thick = (m: Pt) => {
    let best = 0.2, bd = Infinity;
    for (const w of plan.walls) {
      const L = dist(w.a, w.b) || 1, u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
      const t = Math.max(0, Math.min(L, (m[0] - w.a[0]) * u[0] + (m[1] - w.a[1]) * u[1]));
      const d = Math.hypot(m[0] - w.a[0] - u[0] * t, m[1] - w.a[1] - u[1] * t);
      if (d < bd) { bd = d; best = w.thickness; }
    }
    return best;
  };
  const piece = (o: { a: Pt; b: Pt }, along0: number, along1: number, y0: number, y1: number, depth: number, color: number) => {
    const top = Math.min(y1, heightAt([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]));
    if (top <= y0) return;
    const L = dist(o.a, o.b), u = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L];
    const g = new THREE.BoxGeometry(along1 - along0, top - y0, depth).toNonIndexed();
    g.rotateY(-Math.atan2(u[1], u[0]));
    const mid = (along0 + along1) / 2;
    g.translate(o.a[0] + u[0] * mid, (y0 + top) / 2, o.a[1] + u[1] * mid);
    out.push(colourFaces(g, color));
  };
  const J = 0.05, frame = 0xece7de;
  for (const o of plan.openings) {
    const L = dist(o.a, o.b);
    if (L < 0.3) continue;
    const t = thick([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]) + 0.02;
    if (o.kind === 'door') {
      piece(o, 0, J, 0, 2.1, t, frame); piece(o, L - J, L, 0, 2.1, t, frame); piece(o, 0, L, 2.05, 2.1, t, frame);
    } else {
      piece(o, 0, J, 0.9, 2.1, t, frame); piece(o, L - J, L, 0.9, 2.1, t, frame); piece(o, 0, L, 2.05, 2.1, t, frame);
      piece(o, -0.04, L + 0.04, 0.87, 0.9, t + 0.08, 0xf4f1ea); // sill board, inside and out
    }
  }
  return out;
}

function colourFaces(g: THREE.BufferGeometry, color: number) {
  const n = g.getAttribute('normal'), c = new Float32Array(n.count * 3), cs = new THREE.Color(color);
  for (let i = 0; i < n.count; i++) cs.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
