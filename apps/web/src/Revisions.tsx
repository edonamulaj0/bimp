import { useRef, useState } from 'preact/hooks';
import type { PlanDiff } from '../../shared/diff';
import { round } from '../../shared/plan';
import { hoverRoom, selectedRooms } from './state';
import { Spinner } from './brand';
import { Icon } from './icons';
import { fullDate, when } from './ui';
import type { Revision } from './types';

type Props = {
  revisions: Revision[]; latestId: string | null; viewedId: string | null; loading: string | null;
  compare: [string, string] | null; diff: PlanDiff | null; hidden?: boolean;
  onView(id: string | null): void; onCompare(pair: [string, string] | null): void; onNote(id: string, note: string): Promise<void>;
};
const sgn = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(round(n, 2))}`;

/** Every reading of a drawing, newest first: view one, label it, or compare two. */
export function Revisions({ revisions, latestId, viewedId, loading, compare, diff, hidden, onView, onCompare, onNote }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const revOf = (id: string) => revisions.find((r) => r.id === id);
  const pick = (id: string, on: boolean) => setPicked((p) => (on ? [...p.filter((x) => x !== id), id].slice(-2) : p.filter((x) => x !== id)));
  const startCompare = () => {
    const [a, b] = [...picked].sort((x, y) => (revOf(x)?.rev ?? 0) - (revOf(y)?.rev ?? 0));
    onCompare([a, b]);
  };
  async function save(r: Revision, note: string) {
    setEditing(null);
    if (note.trim() === (r.note ?? '')) return;
    try { await onNote(r.id, note.trim()); setErr(''); } catch (e) { setErr((e as Error).message); }
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-note="${r.id}"]`)?.focus());
  }

  return (
    <section class="tabpanel revs" id="panel-revisions" role="tabpanel" aria-labelledby="tab-revisions" hidden={hidden} ref={box}>
      {compare && (
        <div class="cmp" role="region" aria-label="Comparison">
          <div class="cmp-head">
            <b>Comparing <span class="mono">r{revOf(compare[0])?.rev}</span> → <span class="mono">r{revOf(compare[1])?.rev}</span></b>
            <button class="btn ghost sm" onClick={() => { onCompare(null); setPicked([]); }}>Exit compare</button>
          </div>
          {!diff ? <div class="loading-block"><Spinner size={24} label="Loading both revisions" /></div> : (
            <>
              <ul class="cmp-sum">{diff.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
              <div class="cmp-key small" aria-hidden="true"><span class="k add" />Added <span class="k del" />Removed <span class="k chg" />Resized</div>
              <ul class="cmp-rooms">
                {diff.rooms.filter((r) => r.status !== 'same').map((r, i) => (
                  <li key={i}>
                    <button disabled={!r.b} onClick={() => r.b && (selectedRooms.value = [r.b.id])}
                      onMouseEnter={() => (hoverRoom.value = r.b?.id ?? null)} onMouseLeave={() => (hoverRoom.value = null)}>
                      <span class={`k ${r.status === 'added' ? 'add' : r.status === 'removed' ? 'del' : 'chg'}`} aria-hidden="true" />
                      <span class="cr-name">{r.name}<span class="sr-only">, {r.status}</span></span>
                      <span class="mono muted">{r.area_a ?? '–'} → {r.area_b ?? '–'} m²</span>
                      <span class={`mono delta ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}`}>{sgn(r.delta)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div class="revs-tools">
        <span class="muted small">{revisions.length} revision{revisions.length === 1 ? '' : 's'}</span>
        <span class="spacer" />
        {!compare && revisions.length > 1 && (
          <button class="btn ghost sm" disabled={picked.length !== 2} onClick={startCompare} title={picked.length !== 2 ? 'Tick two revisions to compare them' : undefined}>
            <Icon name="compare" size={16} />
            {picked.length === 2 ? `Compare r${Math.min(...picked.map((p) => revOf(p)?.rev ?? 0))} → r${Math.max(...picked.map((p) => revOf(p)?.rev ?? 0))}` : 'Compare two'}
          </button>
        )}
      </div>
      <p class="err" role="alert">{err}</p>
      {!revisions.length && <p class="muted small pad-x">No revisions yet. Each drawing you upload becomes a revision you can view, label and compare.</p>}
      <ol class="rev-list">
        {revisions.map((r) => {
          const viewed = r.id === viewedId, latest = r.id === latestId, inCmp = compare?.includes(r.id);
          return (
            <li key={r.id} class={`rev${viewed ? ' viewed' : ''}${inCmp ? ' in-cmp' : ''}`}>
              {revisions.length > 1 && !compare && (
                <input type="checkbox" class="rev-pick" checked={picked.includes(r.id)} aria-label={`Select r${r.rev} to compare`} onChange={(e) => pick(r.id, e.currentTarget.checked)} />
              )}
              <div class="rev-main">
                <div class="rev-line">
                  <button class="rev-open" onClick={() => onView(latest ? null : r.id)} aria-current={viewed ? 'true' : undefined}
                    aria-label={`r${r.rev}${r.note ? `, ${r.note}` : ''}${latest ? ', latest' : ''}. ${viewed ? 'Shown on the canvas' : 'View on the canvas'}`}>
                    <span class="mono rev-id">r{r.rev}</span>
                    <span class="mono rev-file" title={r.filename ?? undefined}>{r.filename ?? 'sample plan'}</span>
                  </button>
                  {latest && <span class="pill">Latest</span>}
                  {loading === r.id && <Spinner size={14} label="Loading revision" />}
                </div>
                {editing === r.id
                  ? <NoteInput value={r.note ?? ''} onDone={(v) => (v === null ? (setEditing(null), requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-note="${r.id}"]`)?.focus())) : save(r, v))} />
                  : <button class={`rev-note${r.note ? '' : ' empty'}`} data-note={r.id} onClick={() => setEditing(r.id)} aria-label={r.note ? `Edit note: ${r.note}` : `Add a note to r${r.rev}`}>
                      {r.note || 'Add a note'}
                    </button>}
                <div class="rev-meta small muted">
                  <span title={fullDate(r.created_at)}>{when(r.created_at)}</span>
                  <span><span class="mono">{r.rooms}</span> rooms</span>
                  <span><span class="mono">{round(r.net_m2, 1)}</span> m² net</span>
                  <span class={`pill ${r.measured ? 'ok' : ''}`}>{r.measured ? 'Measured' : 'Preview'}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function NoteInput({ value, onDone }: { value: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (x: string | null) => { if (done.current) return; done.current = true; onDone(x); };
  return (
    <input class="rename note-input" autoFocus maxLength={120} aria-label="Revision note" placeholder="e.g. Issued for planning" value={v}
      onInput={(e) => setV(e.currentTarget.value)} onBlur={() => finish(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(v); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } }} />
  );
}
