import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Plan, area, round } from '../../../shared/plan';
import { hoverRoom, selectedRooms } from '../state';
import type { SceneApi, WallMode } from './scene';
import { Spinner } from '../brand';

type Props = { plan: Plan; compact?: boolean; rotation?: number; walls?: WallMode };

export function Plan3D({ plan, compact, rotation = 0, walls = 'dollhouse' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const appliedRot = useRef(0);
  const latestRot = useRef(rotation);
  latestRot.current = rotation; // the scene loads lazily; apply the rotation current when it is ready, not the one captured here
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState<{ id: string; name: string; x: number; y: number }[]>([]);

  useEffect(() => {
    let api: SceneApi | null = null, stop = () => {}, dead = false;
    import('./scene').then(({ createScene }) => {
      if (dead) return;
      try {
        api = createScene(host.current!, plan, {
          compact,
          walls,
          onHover: (id, x, y) => { hoverRoom.value = id; setTip(id ? { x, y } : null); },
          onLabels: compact ? undefined : setLabels,
          onClick: (id) => { selectedRooms.value = id && !selectedRooms.peek().includes(id) ? [id] : []; },
        });
      } catch {
        return setErr('3D view needs WebGL, which this browser has turned off.');
      }
      sceneRef.current = api;
      setReady(true);
      api.rotate(latestRot.current);
      appliedRot.current = latestRot.current;
      stop = effect(() => api!.highlight(hoverRoom.value, selectedRooms.value));
    });
    return () => { dead = true; stop(); api?.dispose(); sceneRef.current = null; };
  }, [plan, compact, walls]);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.rotate(rotation - appliedRot.current);
    appliedRot.current = rotation;
  }, [rotation]);

  const room = !compact && tip ? plan.rooms.find((r) => r.id === hoverRoom.value) : null;
  return (
    <div ref={host} class={`plan3d${compact ? ' compact' : ''}`} role="img" aria-label="Isometric 3D model">
      {err && <p class="muted small center-msg">{err}</p>}
      {!ready && !err && <div class="center-msg"><Spinner size={compact ? 24 : 40} label="Building the 3D view" /></div>}
      {labels.map((l) => <span key={l.id} class={`label3d${hoverRoom.value === l.id ? ' on' : ''}`} style={{ left: `${l.x}px`, top: `${l.y}px` }}>{l.name}</span>)}
      {room && tip && (
        <div class="tip" style={{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }}>
          <b>{room.name}</b> · {round(area(room.polygon), 1)} m²
        </div>
      )}
    </div>
  );
}
