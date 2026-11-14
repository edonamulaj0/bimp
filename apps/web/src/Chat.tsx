import { useEffect, useRef, useState } from 'preact/hooks';
import type { Plan } from '../../shared/plan';
import { api } from './api';
import { AI_OFF, ACCEPT, ai, answerNote, chatPrompt, pendingDrawing, queueFiles, region, say, selectedRooms, uploadQueue } from './state';
import { regionSize } from '../../shared/region';
import { BimpMark, Spinner } from './brand';
import { Icon } from './icons';
import { AnswerBody } from './Answer';
import type { Content, Job, Msg } from './types';

const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** The overview prompts from the info panel are long; show them as a short label. */
const shortText = (t: string) => { const m = t.match(/^Give me an overview of (.+?)(?: \([^()]*\))?: /); return m ? `Overview of ${m[1]}` : t; };
/** Errors: shown live (kind 'error'), or failed jobs persisted by the server as a bare system note (no claims). */
const isError = (c: Content) => c.kind === 'error' || (c.kind === 'system' && !c.claims);

/** bimp AI, docked under the file tree: questions about the plan, or about the marked region only. Also runs uploads. */
export function Chat({ projectId, planId, messages, hasPlan, shared, resumeJob, hidden, onMessages, onPlan, onRefused, onChanged }: {
  projectId: string; /** the revision on the canvas: questions are about it */ planId?: string | null; messages: Msg[]; hasPlan: boolean; shared: boolean; resumeJob?: string; hidden?: boolean;
  onMessages(m: Msg[]): void; onPlan(p: Plan): void; onRefused?(why: string[]): void; /** files changed without a new plan (a reading was stopped) */ onChanged?(): void;
}) {
  const [text, setText] = useState('');
  const [job, setJob] = useState(''); // stage of the drawing being read; uploads don't block questions
  const [asking, setAsking] = useState(false);
  const [t0, setT0] = useState(0);
  const [, tick] = useState(0);
  const alive = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [messages.length, asking, !!job, hidden]);
  // dropped files: one at a time, in the order they were dropped
  useEffect(() => {
    const [next, ...rest] = uploadQueue.value;
    if (!next || job) return;
    uploadQueue.value = rest;
    upload(next);
  }, [uploadQueue.value, !!job]);
  const scope = region.value;
  useEffect(() => { if (!job) return; const h = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(h); }, [!!job]);
  const canAsk = ai.value && hasPlan;
  const push = (...m: Msg[]) => { if (!alive.current) return; messages = [...messages, ...m]; onMessages(messages); };
  const fail = (e: unknown) => push({ role: 'assistant', content: { text: (e as Error).message, kind: 'error' } });
  const jobId = useRef<string | null>(null);      // the reading in progress, so it can be stopped
  const stopped = useRef(false);
  const asker = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const local = useRef<string | null>(null); // object URL of the image being uploaded, shown on the canvas at once
  const pending = (url: string | null, name: string, stage: string) => { if (alive.current) pendingDrawing.value = url ? { url, name, stage, stop: () => { void stop(); } } : null; };
  const done = () => {
    jobId.current = null; stopped.current = false;
    if (alive.current) { setJob(''); setStopping(false); pendingDrawing.value = null; }
    if (local.current) { URL.revokeObjectURL(local.current); local.current = null; }
    if (file.current) file.current.value = '';
  };
  useEffect(() => {
    if (resumeJob) { setT0(Date.now()); setJob('Reading the drawing…'); follow(resumeJob).catch(fail).finally(done); }
    return () => { alive.current = false; answerNote.value = null; pendingDrawing.value = null; if (local.current) URL.revokeObjectURL(local.current); };
  }, []);

  /** Polls an ingestion job (a Cloudflare Workflow) until it finishes, showing its stage. Stops on unmount; rides out brief network errors. */
  async function follow(id: string, name = 'the drawing') {
    jobId.current = id;
    const gone = () => stopped.current || jobId.current !== id; // stopped: this reading is no longer the one being followed
    for (let i = 0, errors = 0; i < 400 && alive.current && !gone(); i++) {
      let d: { job: Job; plan?: Plan; message?: Msg };
      try { d = await api(`/projects/${projectId}/jobs/${id}`); errors = 0; }
      catch (e) {
        if (gone()) return; // the reading was stopped while this check was on its way
        if (!(e instanceof TypeError) || ++errors > 3) throw e; // fetch itself failed: offline for a moment
        await new Promise((r) => setTimeout(r, 1500 * 2 ** errors));
        continue;
      }
      if (!alive.current || gone()) return;
      if (d.job.status === 'done') { if (d.message) push(d.message); if (d.plan) onPlan(d.plan); return; }
      if (d.job.status === 'failed') throw new Error(`Couldn't read the drawing: ${d.job.error ?? 'unknown error'}`);
      setJob(d.job.stage);
      // the sheet as rendered for reading once it exists (any page of a PDF, a DXF), else the uploaded image itself
      pending(d.job.render_sha ? `/api/projects/${projectId}/render/${d.job.render_sha}` : local.current ?? (d.job.file_id ? `/api/projects/${projectId}/files/${d.job.file_id}/preview` : null), name, d.job.stage);
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (alive.current && !gone()) throw new Error('Still working on the drawing. Reload the page later to see the result.');
  }

  useEffect(() => {
    const q = chatPrompt.value;
    if (!q || asking) return;
    chatPrompt.value = null;
    if (canAsk) ask(q);
  }, [chatPrompt.value, asking]);

  function send(e: Event) {
    e.preventDefault();
    if (canAsk) ask(text.trim());
  }

  async function ask(q: string) {
    if (!q || asking) return;
    setText('');
    setAsking(true);
    const r = region.peek();
    push({ role: 'user', content: r ? { text: q, region: r } : { text: q } });
    asker.current = new AbortController();
    answerNote.value = null;
    try {
      const d = await api<{ message: Msg }>(`/projects/${projectId}/chat`, { json: { message: q, ...(r ? { region: r } : {}), ...(planId ? { plan_id: planId } : {}) }, signal: asker.current.signal });
      push(d.message);
      // the answer goes onto the plan too: the rooms or items it rests on are highlighted, with the answer beside them
      const c = d.message.content, rooms = [...new Set((c.claims ?? []).flatMap((cl) => cl.room_ids))], items = [...new Set((c.claims ?? []).flatMap((cl) => cl.item_ids ?? []))];
      if (alive.current && !c.not_found && (r || rooms.length || items.length)) {
        // the note beside the area is short: the claims themselves ("Kitchen 21.28 m²"), else the answer's first sentence
        const plain = (t: string) => t.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
        const brief = (c.claims ?? []).map((cl) => plain(cl.text)).filter(Boolean).slice(0, 3).join(' · ') || plain(c.text).split(/(?<=[.!?])\s/)[0];
        answerNote.value = { key: Date.now(), planId: planId ?? null, question: q, text: brief.length > 110 ? `${brief.slice(0, 108)}…` : brief, rooms, items, region: r, verified: c.verified };
        if (rooms.length) selectedRooms.value = rooms;
      }
    }
    catch (e) {
      if ((e as Error).name === 'AbortError') push({ role: 'assistant', content: { text: 'Stopped waiting for the answer. If bimp had already finished it, it appears here when the project is opened again.', kind: 'system', claims: [] } });
      else fail(e);
    }
    finally { if (alive.current) setAsking(false); }
  }

  /** Stop: ends the reading in progress (a drawing uploaded by mistake leaves the project again), and gives up waiting for an answer. */
  async function stop() {
    asker.current?.abort();
    const id = jobId.current;
    if (!id || stopping) return;
    setStopping(true); stopped.current = true;
    uploadQueue.value = [];
    try { const d = await api<{ message: Msg }>(`/projects/${projectId}/jobs/${id}`, { method: 'DELETE' }); push(d.message); say('Reading stopped'); onChanged?.(); }
    catch (e) { stopped.current = false; if (alive.current) setStopping(false); if (!/already/.test((e as Error).message)) fail(e); return; }
    done();
  }

  async function upload(f: File) {
    if (job) return;
    push({ role: 'user', content: { text: `Uploaded ${f.name}` } });
    setT0(Date.now()); setJob('Uploading…');
    try {
      // Only real raster images are measured and shown at once; a browser may call a .dxf "image/vnd.dxf".
      const raster = /^image\/(png|jpeg|webp)$/.test(f.type) && !/\.(dxf|pdf)$/i.test(f.name);
      const headers: Record<string, string> = { 'x-filename': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' };
      if (raster) {
        try {
          const bmp = await createImageBitmap(f);
          headers['x-image-width'] = String(bmp.width); headers['x-image-height'] = String(bmp.height);
          bmp.close();
        } catch { /* the server reads the size itself; an unreadable image is reported by the reading */ }
        local.current = URL.createObjectURL(f);
        pending(local.current, f.name, 'Uploading…');
      }
      const up = await api<{ duplicate?: boolean; job: { id: string } | null }>(`/projects/${projectId}/files`, { body: f, headers });
      if (!up.job) return push({ role: 'assistant', content: { text: `${f.name} is already read. Its plan is in the canvas.`, kind: 'system', claims: [] } });
      setJob('Queued…');
      await follow(up.job.id, f.name);
    } catch (e) { fail(e); }
    finally { done(); }
  }

  const status = [job && `${job}`, uploadQueue.value.length && `${uploadQueue.value.length} more queued`, asking && (scope ? 'Reading the region…' : 'Reading the plan…')].filter(Boolean).join(' · ');
  const size = scope && regionSize(scope);
  return (
    <section class="chat dock" id="panel-chat" aria-labelledby="chat-h" hidden={hidden} data-tour="chat">
      <div class="dock-h">
        <h2 id="chat-h"><BimpMark size={18} />bimp AI</h2>
        <span class="spacer" />
        {messages.length > 0 && <span class="muted small">{messages.filter((m) => m.role === 'user').length} asked</span>}
      </div>
      <div class="msgs" ref={list} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
        {!messages.length && (
          <div class="empty">
            <h2 class="empty-h">{hasPlan ? 'Ask about this plan' : 'Start with a drawing'}</h2>
            <p class="muted small">{hasPlan ? 'Try: "What is the area of the kitchen?", "How many windows are there?", or mark a region on the plan (R) and ask about just that area.' : 'Drop a floor plan (PDF, DXF, PNG, JPG or WebP) on the file list, or use the + button. bimp builds a 2D plan and a 3D model from it.'}</p>
          </div>
        )}
        {messages.map((m, i) => <Message key={m.id ?? i} m={m} shared={shared} />)}
      </div>
      <p class="status" role="status">
        {status && <><Spinner size={16} label={null} /><span class="status-t">{status}{job && <span aria-hidden="true" class="num"> · {clock(Date.now() - t0)}</span>}</span>
          {(asking || !!job) && <button type="button" class="link small stop" onClick={stop} disabled={stopping} title={job ? 'Stop reading this drawing and remove it from the project' : 'Stop waiting for the answer'}>{stopping ? 'Stopping…' : 'Stop'}</button>}</>}
      </p>
      {!ai.value && <p class="ai-off small muted" id="ai-off">{AI_OFF}</p>}
      {size && (
        <div class="scope" role="status">
          <span class="scope-k" aria-hidden="true" />
          <span>Region <span class="mono">{size.w.toFixed(2)} × {size.h.toFixed(2)} m</span> · answers use only what's inside</span>
          <button type="button" class="link small" onClick={() => { region.value = null; say('Region cleared. Questions cover the whole plan.'); }}>Clear</button>
        </div>
      )}
      <form class="composer" onSubmit={send}>
        <input ref={file} id="plan-file" type="file" accept={ACCEPT.join(',')} multiple hidden
          onChange={(e) => { const fs = e.currentTarget.files; if (fs?.length) { const no = queueFiles([...fs]); if (no.length) onRefused?.(no); } e.currentTarget.value = ''; }} />
        <button type="button" class="icon" onClick={() => file.current?.click()} disabled={!!job} title="Upload a floor plan" aria-label="Upload a floor plan"><Icon name="plus" /></button>
        <textarea rows={1} placeholder={!ai.value ? 'Answers are off' : !hasPlan ? 'Upload a floor plan to start' : scope ? 'Ask about the marked region…' : 'Ask about the plan…'} value={text} disabled={!canAsk}
          aria-describedby={ai.value ? undefined : 'ai-off'}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} aria-label="Question" />
        <button class="icon go" disabled={!canAsk || asking || !text.trim()} aria-label="Send">→</button>
      </form>
    </section>
  );
}

function Message({ m, shared }: { m: Msg; shared: boolean }) {
  const c = m.content;
  if (m.role === 'user') return (
    <div class="msg-user">
      {shared && m.user_email && <span class="who-line">{m.user_email}</span>}
      <div class="msg user" title={shortText(c.text) !== c.text ? c.text : undefined}>{shortText(c.text)}</div>
      {c.region && <span class="who-line"><span class="scope-k" aria-hidden="true" /> Region {regionSize(c.region).w.toFixed(2)} × {regionSize(c.region).h.toFixed(2)} m</span>}
    </div>
  );
  if (isError(c)) return <div class="msg bot sys error" role="alert"><b class="sys-label">Problem</b><p>{c.text}</p></div>;
  return <div class={`msg bot${c.kind === 'system' ? ' sys' : ''}`}><AnswerBody c={c} /></div>;
}
