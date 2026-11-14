import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Plan, area, round } from '../../../shared/plan';
import { type Region, normRegion, regionSize } from '../../../shared/region';
import { hoverRoom, selectedRooms } from '../state';
import type { CameraView, Projection, SceneApi, ViewPreset, WallMode } from './scene';
import type { CanvasTool, MenuAt } from './Plan2D';
import { Spinner } from '../brand';

/** Imperative controls for the toolbar and the context menu. */
export type Plan3DApi = { view(v: ViewPreset): void; zoom(k: number): void; rotate(steps: number): void; projection(): Projection; setProjection(p: Projection): void; snapshot(): Promise<Blob> | null };

type Props = {
  plan: Plan; compact?: boolean; rotation?: number; walls?: WallMode; furniture?: boolean; labels?: boolean; projection?: Projection;
  tool?: CanvasTool; region?: Region | null; onRegion?(r: Region | null): void; apiRef?: { current: Plan3DApi | null }; onMenu?(m: MenuAt): void;
};

/** The camera survives scene rebuilds (wall mode, furniture), per plan. */
const views = new WeakMap<Plan, CameraView>();

export function Plan3D({ plan, compact, rotation = 0, walls = 'dollhouse', furniture = true, labels: showLabels = true, projection = 'persp', tool = 'select', region, onRegion, apiRef, onMenu }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const appliedRot = useRef(0);
  const latestRot = useRef(rotation);
  latestRot.current = rotation; // the scene loads lazily; apply the rotation current when it is ready, not the one captured here
  const live = useRef({ tool, region, onRegion, onMenu, projection });
  live.current = { tool, region, onRegion, onMenu, projection };
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState<{ id: string; name: string; x: number; y: number }[]>([]);
  const [drawing, setDrawing] = useState<Region | null>(null);

  useEffect(() => {
    let api: SceneApi | null = null, stop = () => {}, dead = false;
    setReady(false);
    import('./scene').then(({ createScene }) => {
      if (dead) return;
      try {
        api = createScene(host.current!, plan, {
          compact,
          walls,
          furniture,
          projection: live.current.projection,
          view: compact ? null : views.get(plan) ?? null,
          onHover: (id, x, y) => { hoverRoom.value = id; setTip(id ? { x, y } : null); },
          onLabels: compact ? undefined : setLabels,
          onClick: (id) => { if (live.current.tool === 'select') selectedRooms.value = id && !selectedRooms.peek().includes(id) ? [id] : []; },
          onMenu: compact ? undefined : (x, y, roomId, p) => live.current.onMenu?.({ x, y, roomId, p }),
          onView: () => { if (!compact && api) views.set(plan, api.getView()); },
        });
      } catch {
        return setErr('3D view needs WebGL, which this browser has turned off.');
      }
      sceneRef.current = api;
      setReady(true);
      if (latestRot.current - appliedRot.current) api.rotate(latestRot.current - appliedRot.current);
      appliedRot.current = latestRot.current;
      api.setRegion(live.current.region ?? null);
      stop = effect(() => api!.highlight(hoverRoom.value, selectedRooms.value));
    });
    return () => { dead = true; stop(); api?.dispose(); sceneRef.current = null; };
  }, [plan, compact, walls, furniture]);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.rotate(rotation - appliedRot.current);
    appliedRot.current = rotation;
  }, [rotation]);
  useEffect(() => { sceneRef.current?.setProjection(projection); }, [projection, ready]);
  useEffect(() => { if (!drawing) sceneRef.current?.setRegion(region ?? null); }, [region, ready, drawing]);
  useEffect(() => { sceneRef.current?.setControls(tool !== 'region'); }, [tool, ready]);

  if (apiRef) apiRef.current = {
    view: (v) => sceneRef.current?.view(v), zoom: (k) => sceneRef.current?.zoom(k), rotate: (n) => sceneRef.current?.rotate(n),
    projection: () => sceneRef.current?.projection() ?? projection, setProjection: (p) => sceneRef.current?.setProjection(p),
    snapshot: () => sceneRef.current?.snapshot() ?? null,
  };

  // Markup tool: drag a rectangle on the floor. Runs in the capture phase so the orbit controls never see the drag.
  useEffect(() => {
    const el = host.current;
    if (!el || compact) return;
    let from: [number, number] | null = null;
    const down = (e: PointerEvent) => {
      if (live.current.tool !== 'region' || e.button !== 0 || !sceneRef.current) return;
      const p = sceneRef.current.planPoint(e.clientX, e.clientY);
      if (!p) return;
      e.stopPropagation();
      from = p; el.setPointerCapture(e.pointerId);
      setDrawing(normRegion(p, p));
    };
    const move = (e: PointerEvent) => {
      if (!from || !sceneRef.current) return;
      const p = sceneRef.current.planPoint(e.clientX, e.clientY);
      if (!p) return;
      const r = normRegion(from, p);
      setDrawing(r); sceneRef.current.setRegion(r);
    };
    const up = (e: PointerEvent) => {
      if (!from || !sceneRef.current) return;
      const p = sceneRef.current.planPoint(e.clientX, e.clientY) ?? from, r = normRegion(from, p), { w, h } = regionSize(r);
      from = null; setDrawing(null);
      if (w >= 0.2 && h >= 0.2) live.current.onRegion?.(r); else sceneRef.current.setRegion(live.current.region ?? null);
    };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true); el.addEventListener('pointerup', up, true);
    return () => { el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true); el.removeEventListener('pointerup', up, true); };
  }, [compact]);

  // Keyboard: arrows orbit, Shift + arrows pan, + and − zoom, Home goes back to the isometric view.
  const keys = (e: KeyboardEvent) => {
    const s = sceneRef.current;
    if (!s || compact) return;
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, number[]>)[e.key];
    if (d) { e.preventDefault(); if (e.shiftKey) s.pan(d[0], d[1]); else s.orbit(d[0] * Math.PI / 12, d[1] * Math.PI / 24); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); s.zoom(0.8); }
    else if (e.key === '-') { e.preventDefault(); s.zoom(1.25); }
    else if (e.key === 'Home') { e.preventDefault(); s.view('iso'); }
  };

  const room = !compact && tip ? plan.rooms.find((r) => r.id === hoverRoom.value) : null;
  const shown = drawing;
  return (
    <div ref={host} class={`plan3d${compact ? ' compact' : ''}${tool === 'region' ? ' placing' : ''}`} role={compact ? 'img' : 'application'} tabIndex={compact ? undefined : 0}
      aria-roledescription={compact ? undefined : '3D model'}
      aria-label={compact ? '3D model' : '3D model. Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom. Arrow keys orbit, Shift and arrows pan, plus and minus zoom, Home resets.'}
      onKeyDown={keys}>
      {err && <p class="muted small center-msg">{err}</p>}
      {!ready && !err && <div class="center-msg"><Spinner size={compact ? 24 : 40} label="Building the 3D view" /></div>}
      {showLabels && labels.map((l) => <span key={l.id} class={`label3d${hoverRoom.value === l.id ? ' on' : ''}`} style={{ left: `${l.x}px`, top: `${l.y}px` }}>{l.name}</span>)}
      {shown && !compact && <span class="region-size" aria-hidden="true">{regionSize(shown).w.toFixed(2)} × {regionSize(shown).h.toFixed(2)} m</span>}
      {room && tip && (
        <div class="tip" style={{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }}>
          <b>{room.name}</b> · {round(area(room.polygon), 1)} m²
        </div>
      )}
    </div>
  );
}
