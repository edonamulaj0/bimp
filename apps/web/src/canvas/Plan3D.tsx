import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Plan, area, round } from '../../../shared/plan';
import { hoverRoom, selectedRooms } from '../state';
import type { SceneApi } from './scene';

type Props = { plan: Plan; compact?: boolean; rotation?: number; cutaway?: boolean };
const CUT_HEIGHT = 1.2;

export function Plan3D({ plan, compact, rotation = 0, cutaway = true }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const appliedRot = useRef(0);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState('');
  const [labels, setLabels] = useState<{ id: string; name: string; x: number; y: number }[]>([]);

  useEffect(() => {
    let api: SceneApi | null = null, stop = () => {}, dead = false;
    import('./scene').then(({ createScene }) => {
      if (dead) return;
      try {
        api = createScene(host.current!, plan, {
          compact,
          wallHeight: cutaway ? Math.min(CUT_HEIGHT, plan.wallHeight) : plan.wallHeight,
          onHover: (id, x, y) => { hoverRoom.value = id; setTip(id ? { x, y } : null); },
          onLabels: compact ? undefined : setLabels,
          onClick: (id) => { selectedRooms.value = id && !selectedRooms.peek().includes(id) ? [id] : []; },
        });
      } catch {
        return setErr('3D view needs WebGL, which this browser has turned off.');
      }
      sceneRef.current = api;
      api.rotate(rotation);
      appliedRot.current = rotation;
      stop = effect(() => api!.highlight(hoverRoom.value, selectedRooms.value));
    });
    return () => { dead = true; stop(); api?.dispose(); sceneRef.current = null; };
  }, [plan, compact, cutaway]);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.rotate(rotation - appliedRot.current);
    appliedRot.current = rotation;
  }, [rotation]);

  const room = !compact && tip ? plan.rooms.find((r) => r.id === hoverRoom.value) : null;
  return (
    <div ref={host} class={`plan3d${compact ? ' compact' : ''}`} role="img" aria-label="Isometric 3D model">
      {err && <p class="muted small center-msg">{err}</p>}
      {labels.map((l) => <span key={l.id} class={`label3d${hoverRoom.value === l.id ? ' on' : ''}`} style={{ left: `${l.x}px`, top: `${l.y}px` }}>{l.name}</span>)}
      {room && tip && (
        <div class="tip" style={{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }}>
          <b>{room.name}</b> · {round(area(room.polygon), 1)} m²
        </div>
      )}
    </div>
  );
}
