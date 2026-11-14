import { hoverRoom, selectedRooms } from './state';
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
      {c.calculation && <pre class="calc">{c.calculation}</pre>}
      {!!c.assumptions?.length && (
        <details class="small muted"><summary>Assumptions ({c.assumptions.length})</summary><ul>{c.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
      )}
      {!badge && c.kind !== 'system' && c.verified === false && (
        <p class="unverified small" title={c.issues?.join('\n')}>Unverified: {c.issues?.[0]}</p>
      )}
      {badge && c.verified === false && !!c.issues?.length && <p class="unverified small">{c.issues[0]}</p>}
    </>
  );
}
