import { useEffect, useRef } from 'preact/hooks';
import { type Plan, FIXTURE_LABEL, area, round } from '../../shared/plan';
import { planAreas, roomInfo } from '../../shared/rooms';
import { fengShui, suggestLayout } from '../../shared/fengshui';
import { ROOM_COLORS } from './canvas/colors';
import { AI_OFF, ai, chatPrompt, hoverRoom, selectedRooms } from './state';

const m = (v: number, d = 2) => v.toFixed(d);

/** Plan overview, or the selected room's measures and feng shui notes. All figures computed from the plan geometry. */
export function InfoPanel({ plan, suggest, onSuggest }: { plan: Plan; suggest: boolean; onSuggest(v: boolean): void }) {
  const room = plan.rooms.find((r) => r.id === selectedRooms.value[0]);
  const pa = planAreas(plan);
  const notes = fengShui(plan, room?.id);
  // offer suggestions only where they would add something (furnishable rooms with nothing in them)
  const empty = !suggest && suggestLayout(plan).length > 0;
  const ceilingNote = pa.ceiling_source === 'assumed' ? ' (assumed)' : '';
  // Keep keyboard focus when the panel swaps between overview and a room (the button that was pressed disappears).
  const back = useRef<HTMLButtonElement>(null), rooms = useRef<HTMLUListElement>(null), last = useRef<string | null>(null);
  useEffect(() => {
    const lost = document.activeElement === document.body;
    if (room && lost) back.current?.focus();
    else if (!room && lost && last.current) rooms.current?.querySelector<HTMLElement>(`[data-room="${last.current}"]`)?.focus();
    last.current = room?.id ?? last.current;
  }, [room?.id]);
  const hover = (id: string | null) => ({ onMouseEnter: () => (hoverRoom.value = id), onMouseLeave: () => (hoverRoom.value = null), onFocus: () => (hoverRoom.value = id), onBlur: () => (hoverRoom.value = null) });

  return (
    <aside class="infopanel" id="info-panel" aria-label="Information" onPointerDown={(e) => e.stopPropagation()}>
      {room ? (() => {
        const ri = roomInfo(plan, room);
        return (
          <>
            <div class="ip-head">
              <span><i class="sw" style={{ background: ROOM_COLORS[room.type] }} /><b>{room.name}</b> <span class="muted small">{room.type}</span></span>
              <button ref={back} class="link small" onClick={() => (selectedRooms.value = [])} aria-label="Back to overview">✕</button>
            </div>
            <dl class="ip-grid">
              <dt>Floor area (net)</dt><dd>{m(ri.net_area_m2)} m²</dd>
              <dt>Dimensions</dt><dd>{m(ri.length)} × {m(ri.width)} m</dd>
              <dt>Perimeter</dt><dd>{m(ri.perimeter_m)} m</dd>
              <dt>Ceiling height</dt><dd>{m(ri.ceiling_height_m)} m{ceilingNote}</dd>
              <dt>Volume</dt><dd>{m(ri.volume_m3, 1)} m³</dd>
              <dt>Doors · windows</dt><dd>{ri.doors} · {ri.windows}</dd>
              <dt>Glazing</dt><dd>{m(ri.glazed_area_m2)} m² ({Math.round(ri.glazing_ratio * 100)}% of floor)</dd>
            </dl>
            {!!ri.fixtures.length && <p class="small muted ip-items">{ri.fixtures.map((f) => FIXTURE_LABEL[f.kind as keyof typeof FIXTURE_LABEL] + (f.source === 'suggested' ? ' (suggested)' : '')).join(', ')}</p>}
          </>
        );
      })() : (
        <>
          <div class="ip-head"><b>Overview</b><span class="muted small">{pa.rooms} rooms · {pa.doors} doors · {pa.windows} windows</span></div>
          <dl class="ip-grid">
            <dt>Net floor area</dt><dd>{m(pa.net_floor_area_m2)} m²</dd>
            <dt>Walls</dt><dd>{m(pa.wall_area_m2)} m²</dd>
            <dt>Gross floor area</dt><dd>{m(pa.gross_floor_area_m2)} m²</dd>
            <dt>Net / gross</dt><dd>{Math.round(pa.net_to_gross * 100)}%</dd>
            <dt>Floor level</dt><dd>{pa.floor_level_m === null ? 'not stated' : `${pa.floor_level_m >= 0 ? '+' : ''}${m(pa.floor_level_m)} m`}</dd>
            <dt>Ceiling height</dt><dd>{m(pa.ceiling_height_m)} m{ceilingNote}</dd>
            <dt>Volume (net)</dt><dd>{m(pa.net_volume_m3, 1)} m³</dd>
          </dl>
          <p class="small muted">Net = rooms measured to the inside of walls; gross adds the walls. Choose a room for its details.</p>
          <h4 id="ip-rooms">Rooms</h4>
          <ul class="ip-rooms" ref={rooms} aria-labelledby="ip-rooms">
            {plan.rooms.map((r) => (
              <li key={r.id}>
                <button data-room={r.id} onClick={() => (selectedRooms.value = [r.id])} {...hover(r.id)}>
                  <span><i class="sw" style={{ background: ROOM_COLORS[r.type] }} />{r.name}</span><span class="mono">{round(area(r.polygon), 1)} m²</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Feng shui <span class="muted small">traditional guidance</span></h4>
      {notes.length ? (
        <ul class="fs">
          {notes.map((n, i) => (
            <li key={i} class={n.ok ? 'ok' : 'warn'}>
              <span aria-hidden="true" class="fs-mark">{n.ok ? '✓' : '△'}</span>
              {n.room_id && !room
                ? <button class="fs-btn" onClick={() => (selectedRooms.value = [n.room_id!])} {...hover(n.room_id)}><span class="sr-only">{n.ok ? 'Good: ' : 'Consider: '}</span>{n.text}</button>
                : <span><span class="sr-only">{n.ok ? 'Good: ' : 'Consider: '}</span>{n.text}</span>}
            </li>
          ))}
        </ul>
      ) : <p class="small muted">{room ? 'No furniture to assess here yet.' : 'Nothing to assess yet.'}</p>}

      <div class="ip-actions">
        {(empty || suggest) && (
          <button class="btn ghost sm" aria-pressed={suggest} onClick={() => onSuggest(!suggest)}
            title="Place furniture in empty rooms following feng shui rules. Shown as suggestions; the drawing is not changed.">
            {suggest ? 'Hide suggested furniture' : 'Apply feng shui furniture'}
          </button>
        )}
        <button class="btn sm" disabled={!ai.value} aria-describedby={ai.value ? undefined : 'ip-ai-off'} onClick={() => (chatPrompt.value = room
          ? `Give me an overview of ${room.name} (${room.id}): size and proportions, light, how it feels and its feng shui, with practical suggestions.`
          : 'Give me an overview of this home: net and gross area, light, how it flows and feels, and its feng shui, with practical suggestions.')}>
          Ask AI for an overview
        </button>
      </div>
      {!ai.value && <p class="small muted" id="ip-ai-off">{AI_OFF}</p>}
      {suggest && <p class="small muted">Dashed items are suggestions by bimp, not part of the drawing.</p>}
    </aside>
  );
}
