import { hoverRoom, parsed, selectedRooms } from './state';
import type { Content } from './types';
import { Markdown } from './Markdown';

/** Room citations: choosing one selects the rooms on the plan, hovering highlights them. */
export function Citations({ claims }: { claims?: Content['claims'] }) {
  if (!claims?.length) return null;
  return (
    <div class="chips">
      {claims.map((cl, i) => (
        <button key={i} type="button" class="chip" title={cl.text} disabled={!cl.room_ids.length}
          onClick={() => (selectedRooms.value = cl.room_ids)}
          onMouseEnter={() => (hoverRoom.value = cl.room_ids[0] ?? null)} onMouseLeave={() => (hoverRoom.value = null)}
          onFocus={() => (hoverRoom.value = cl.room_ids[0] ?? null)} onBlur={() => (hoverRoom.value = null)}>
          {cl.text.length > 48 ? cl.text.slice(0, 46) + '…' : cl.text}
        </button>
      ))}
    </div>
  );
}

/** US dollars as cents, to the precision that still says something: "0.21¢", "<0.01¢". */
export const cents = (usd: number) => (usd <= 0 ? '0¢' : usd < 0.0001 ? '<0.01¢' : `${(usd * 100).toFixed(usd < 0.01 ? 2 : 1)}¢`);

/** Crops of the source sheet, one per citation that has one: the cited rooms or items are outlined. */
export function Evidence({ claims }: { claims?: Content['claims'] }) {
  const route = parsed.value, shown = (claims ?? []).filter((cl) => cl.evidence);
  if (route.page !== 'project' || !shown.length) return null;
  // one crop per distinct area of the sheet; a list of rooms shows its first few
  const seen = new Set<string>(), list = shown.filter((cl) => { const k = cl.evidence!.box.join(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
  return (
    <div class="evidence">
      {list.map((cl, i) => {
        const e = cl.evidence!, [x0, y0, x1, y1] = e.box, w = x1 - x0, h = y1 - y0, sw = Math.max(w, h) / 110;
        return (
          <button key={i} type="button" class="ev" title="Show on the plan" onClick={() => (selectedRooms.value = cl.room_ids)}
            onMouseEnter={() => (hoverRoom.value = cl.room_ids[0] ?? null)} onMouseLeave={() => (hoverRoom.value = null)}>
            <svg viewBox={`${x0} ${y0} ${w} ${h}`} role="img" aria-label={`Source drawing${e.pages && e.pages > 1 ? `, page ${e.page}` : ''}: ${cl.text}`} preserveAspectRatio="xMidYMid meet" style={{ aspectRatio: `${w} / ${h}` }}>
              <image href={`/api/projects/${route.id}/render/${e.render}`} width={e.size[0]} height={e.size[1]} />
              {e.marks.map((b, k) => <rect key={k} x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} fill="none" stroke="#ff682b" stroke-width={sw} />)}
            </svg>
            <span class="ev-cap">{cl.text.length > 40 ? cl.text.slice(0, 38) + '…' : cl.text}<span class="muted"> · source{e.pages && e.pages > 1 ? `, p. ${e.page}` : ''}</span></span>
          </button>
        );
      })}
    </div>
  );
}

/** The body of an answer from bimp: text, citations, calculation, assumptions, and whether it was verified. */
export function AnswerBody({ c, badge }: { c: Content; badge?: boolean }) {
  return (
    <>
      {badge && c.kind !== 'system' && c.verified !== undefined && (
        <span class={`vbadge ${c.verified ? 'ok' : 'warn'}`} title={c.verified ? 'Every figure was checked against the plan geometry' : c.issues?.join('\n')}>
          {c.verified ? 'Verified' : 'Unverified'}
        </span>
      )}
      <Markdown text={c.text} />
      <Citations claims={c.claims} />
      <Evidence claims={c.claims} />
{(!!c.reasoning?.length || !!c.steps?.length) && (
        <details class="why" open={!badge}>
          <summary>How this was worked out</summary>
          {!!c.reasoning?.length && <ol>{c.reasoning.map((s, i) => <li key={i}><Markdown text={s} /></li>)}</ol>}
          {!!c.steps?.length && (
            <>
              <p class="why-h">Looked up on the plan</p>
              <ul class="trace">{c.steps.map((s, i) => <li key={i}><b>{s.tool}</b><span>{s.found}</span></li>)}</ul>
            </>
          )}
        </details>
      )}
      {c.calculation && <pre class="calc">{c.calculation}</pre>}
      {!!c.assumptions?.length && (
        <details class="small muted"><summary>Assumptions ({c.assumptions.length})</summary><ul>{c.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
      )}
      {!badge && c.kind !== 'system' && c.verified === false && (
        <p class="unverified small" title={c.issues?.join('\n')}>Unverified: {c.issues?.[0]}</p>
      )}
      {badge && c.verified === false && !!c.issues?.length && <p class="unverified small">{c.issues[0]}</p>}
      {c.cost && (
        <p class="cost small muted" title={c.cost.by === 'model' ? `${c.cost.tokens_in ?? 0} tokens in, ${c.cost.tokens_out ?? 0} out, at the model's list price` : undefined}>
          {c.cost.by === 'reading' ? c.cost.note
            : c.cost.by === 'code' ? `Answered by code from the stored plan · 0¢ · ${c.cost.ms ?? 0} ms`
            : `${cents(c.cost.usd)} · ${c.cost.calls ?? 0} model call${c.cost.calls === 1 ? '' : 's'} · ${((c.cost.ms ?? 0) / 1000).toFixed(1)} s`}
        </p>
      )}
    </>
  );
}
