import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { AI_OFF, ai, say, user } from './state';
import { Spinner, BimpMark } from './brand';
import { Icon } from './icons';
import { AnswerBody } from './Answer';
import { fullDate, when } from './ui';
import type { Comment } from './types';

export type Thread = { root: Comment; replies: Comment[]; n: number };
/** Top-level comments with their replies, numbered in the order they were made (the numbers on the pins). */
export function threadsOf(comments: Comment[]): Thread[] {
  const roots = comments.filter((c) => !c.parent_id).sort((a, b) => a.created_at - b.created_at);
  return roots.map((root, i) => ({ root, n: i + 1, replies: comments.filter((c) => c.parent_id === root.id).sort((a, b) => a.created_at - b.created_at) }));
}
export type Filter = 'open' | 'resolved' | 'all';
const excerpt = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

type Props = {
  projectId: string; comments: Comment[] | null; onComments(f: (c: Comment[]) => Comment[]): void;
  active: string | null; onActive(id: string | null): void; viewedPlanId: string | null;
  revOf(planId: string | null): number | null; roomName(id: string | null): string | null; isOwner: boolean;
  onNew(): void; onShowOn(planId: string): void; hidden?: boolean; errors: Record<string, string>; setError(id: string, e: string): void;
};

export function Comments(p: Props) {
  const [filter, setFilter] = useState<Filter>('open');
  const threads = threadsOf(p.comments ?? []);
  const thread = threads.find((t) => t.root.id === p.active);
  const shown = threads.filter((t) => filter === 'all' || (filter === 'open') === !t.root.resolved);
  const open = threads.filter((t) => !t.root.resolved).length;
  const list = useRef<HTMLUListElement>(null), last = useRef<string | null>(null);
  // back from a thread: focus returns to it in the list
  useEffect(() => {
    if (p.active) { last.current = p.active; return; }
    if (last.current && !p.hidden && document.activeElement === document.body) list.current?.querySelector<HTMLElement>(`[data-thread="${last.current}"]`)?.focus();
  }, [p.active]);

  return (
    <section class="tabpanel comments" id="panel-comments" role="tabpanel" aria-labelledby="tab-comments" hidden={p.hidden}>
      {thread ? <ThreadView {...p} t={thread} /> : (
        <>
          <div class="c-tools">
            <div class="seg sm" role="group" aria-label="Show">
              {(['open', 'resolved', 'all'] as Filter[]).map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'open' ? `Open${open ? ` ${open}` : ''}` : f === 'resolved' ? 'Resolved' : 'All'}</button>
              ))}
            </div>
            <span class="spacer" />
            <button class="btn sm" onClick={p.onNew} title="Comment tool (C): click the plan to pin a comment"><Icon name="pin" size={16} />Comment</button>
          </div>
          {p.comments === null && <div class="loading-block"><Spinner size={24} label="Loading comments" /></div>}
          {p.comments && !shown.length && (
            <div class="empty pad-x">
              <h2 class="empty-h">{threads.length ? `No ${filter} comments` : 'No comments yet'}</h2>
              <p class="muted small">Pin a comment to a spot on the plan: press <kbd>C</kbd> or choose Comment, then click the drawing. Tick "Ask bimp" to get an answer about that spot.</p>
            </div>
          )}
          <ul class="threads" ref={list}>
            {shown.map((t) => {
              const other = t.root.plan_id !== p.viewedPlanId, rev = p.revOf(t.root.plan_id), room = p.roomName(t.root.room_id);
              return (
                <li key={t.root.id}>
                  <button class="thread-row" data-thread={t.root.id} onClick={() => p.onActive(t.root.id)}>
                    <span class={`pin-no${t.root.resolved ? ' resolved' : ''}`} aria-hidden="true">{t.n}</span>
                    <span class="tr-main">
                      <span class="tr-top">
                        <b>{t.root.author === 'ai' ? 'bimp' : t.root.user_email ?? 'Someone'}</b>
                        {room && <span class="muted">· {room}</span>}
                        {other && rev && <span class="pill">on <span class="mono">r{rev}</span></span>}
                        {!!t.root.resolved && <span class="pill ok">Resolved</span>}
                      </span>
                      <span class="tr-body">{excerpt(t.root.body)}</span>
                      <span class="tr-meta muted small">{when(t.root.created_at)}{t.replies.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}` : ''}</span>
                    </span>
                    <span class="sr-only">Comment {t.n}{t.root.resolved ? ', resolved' : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function ThreadView({ t, projectId, onComments, onActive, viewedPlanId, revOf, roomName, isOwner, onShowOn, errors, setError }: Props & { t: Thread }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'reply' | 'ask'>('');
  const head = useRef<HTMLHeadingElement>(null), box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { head.current?.focus(); }, [t.root.id]);
  const me = user.value?.email;
  const mine = (c: Comment) => c.author === 'user' && !!me && c.user_email === me;
  const rev = revOf(t.root.plan_id), room = roomName(t.root.room_id);
  const err = errors[t.root.id];

  async function reply(askAi: boolean) {
    const body = text.trim();
    if (!body && !askAi) return;
    setBusy(askAi ? 'ask' : 'reply'); setError(t.root.id, '');
    try {
      if (body) {
        const d = await api<{ comment: Comment }>(`/projects/${projectId}/comments`, { json: { body, parent_id: t.root.id } });
        onComments((cs) => [...cs, d.comment]); setText('');
      }
      if (askAi) {
        const d = await api<{ reply: Comment | null; ai_error?: string }>(`/projects/${projectId}/comments/${t.root.id}/ask`, { json: {} });
        if (d.reply) { onComments((cs) => [...cs, d.reply!]); say('bimp replied'); }
        if (d.ai_error) setError(t.root.id, d.ai_error);
      } else say('Reply posted');
    } catch (e) { setError(t.root.id, (e as Error).message); }
    finally { setBusy(''); box.current?.focus(); }
  }
  async function resolve() {
    const resolved = !t.root.resolved;
    try {
      await api(`/projects/${projectId}/comments/${t.root.id}`, { method: 'PATCH', json: { resolved } });
      onComments((cs) => cs.map((c) => (c.id === t.root.id ? { ...c, resolved } : c)));
      say(resolved ? `Comment ${t.n} resolved` : `Comment ${t.n} reopened`);
    } catch (e) { setError(t.root.id, (e as Error).message); }
  }
  async function remove(c: Comment) {
    const root = c.id === t.root.id;
    if (!confirm(root ? `Delete comment ${t.n} and its replies?` : 'Delete this reply?')) return;
    try {
      await api(`/projects/${projectId}/comments/${c.id}`, { method: 'DELETE' });
      onComments((cs) => cs.filter((x) => x.id !== c.id && (!root || x.parent_id !== c.id)));
      say(root ? `Comment ${t.n} deleted` : 'Reply deleted');
      if (root) onActive(null); else box.current?.focus();
    } catch (e) { setError(t.root.id, (e as Error).message); }
  }

  return (
    <div class="thread">
      <div class="th-head">
        <button class="icon-btn" onClick={() => onActive(null)} aria-label="All comments" title="All comments"><span aria-hidden="true">←</span></button>
        <h2 ref={head} tabIndex={-1}><span class={`pin-no${t.root.resolved ? ' resolved' : ''}`} aria-hidden="true">{t.n}</span><span class="sr-only">Comment {t.n}</span>{room ?? 'On the plan'}</h2>
        <span class="spacer" />
        <button class="btn ghost sm" onClick={resolve}>{t.root.resolved ? 'Reopen' : <><Icon name="check" size={16} />Resolve</>}</button>
        {(mine(t.root) || isOwner) && <button class="icon-btn" onClick={() => remove(t.root)} aria-label={`Delete comment ${t.n}`} title="Delete"><Icon name="close" size={16} /></button>}
      </div>
      {t.root.plan_id !== viewedPlanId && rev && (
        <p class="th-note small">Pinned on <span class="mono">r{rev}</span>. <button class="link small" onClick={() => onShowOn(t.root.plan_id!)}>Show it on the plan</button></p>
      )}
      <ol class="th-msgs" aria-live="polite" aria-relevant="additions">
        {[t.root, ...t.replies].map((c) => (
          <li key={c.id} class={`cm ${c.author}`}>
            <div class="cm-head">
              {c.author === 'ai' ? <BimpMark size={24} /> : <span class="avatar" aria-hidden="true">{(c.user_email ?? '?').slice(0, 1).toUpperCase()}</span>}
              <b>{c.author === 'ai' ? 'bimp' : c.user_email ?? 'Someone'}</b>
              <span class="muted small" title={fullDate(c.created_at)}>{when(c.created_at)}</span>
              <span class="spacer" />
              {c.id !== t.root.id && (mine(c) || isOwner) && <button class="icon-btn xs" onClick={() => remove(c)} aria-label="Delete reply" title="Delete"><Icon name="close" size={14} /></button>}
            </div>
            <div class="cm-body">{c.author === 'ai' && c.answer ? <AnswerBody c={c.answer} badge /> : <p>{c.body}</p>}</div>
          </li>
        ))}
        {busy === 'ask' && <li class="cm ai pending"><Spinner size={16} label={null} /> bimp is looking at the drawing around the pin…</li>}
      </ol>
      {err && <p class="err" role="alert">{err}</p>}
      <form class="reply" onSubmit={(e) => { e.preventDefault(); reply(false); }}>
        <label class="sr-only" for={`reply-${t.root.id}`}>Reply</label>
        <textarea id={`reply-${t.root.id}`} ref={box} rows={2} placeholder="Reply, or ask bimp about this spot…" value={text} disabled={!!busy}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reply(false); } }} />
        <div class="reply-actions">
          <button type="button" class="btn ghost sm" disabled={!!busy || !ai.value} onClick={() => reply(true)}
            title={ai.value ? 'bimp answers in this thread, looking at the drawing around the pin' : AI_OFF}>Ask bimp</button>
          <button class="btn sm" disabled={!!busy || !text.trim()}>Reply</button>
        </div>
      </form>
    </div>
  );
}

/** The composer next to a new pin on the plan. */
export function PinComposer({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit(body: string, askAi: boolean): void; onCancel(): void }) {
  const [text, setText] = useState('');
  const [askAi, setAskAi] = useState(false);
  return (
    <form class="pin-composer" aria-label="New comment" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSubmit(text.trim(), askAi && ai.value); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <label class="sr-only" for="pin-text">Comment</label>
      <textarea id="pin-text" autoFocus rows={3} placeholder={askAi ? 'Ask about this spot, e.g. "Is this door wide enough for a wheelchair?"' : 'Comment on this spot…'}
        value={text} disabled={busy} onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (text.trim()) onSubmit(text.trim(), askAi && ai.value); } }} />
      <label class="cbx small" title={ai.value ? 'bimp answers in the thread, looking at the drawing around the pin' : AI_OFF}>
        <input type="checkbox" checked={askAi && ai.value} disabled={!ai.value || busy} onChange={(e) => setAskAi(e.currentTarget.checked)} /> Ask bimp
      </label>
      <div class="pc-actions">
        {busy ? <span class="small muted pc-busy"><Spinner size={14} label={null} />{askAi ? 'bimp is reading the drawing…' : 'Posting…'}</span> : <span class="small muted">Ctrl+Enter</span>}
        <span class="spacer" />
        <button type="button" class="btn ghost sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button class="btn sm" disabled={busy || !text.trim()}>{askAi && ai.value ? 'Ask' : 'Comment'}</button>
      </div>
    </form>
  );
}
