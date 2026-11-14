import { useEffect, useRef, useState } from 'preact/hooks';
import type { Plan } from '../../shared/plan';
import { api } from './api';
import { AI_OFF, ACCEPT, ai, chatPrompt, queueFiles, region, say, uploadQueue } from './state';
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
export function Chat({ projectId, messages, hasPlan, shared, resumeJob, hidden, onMessages, onPlan, onRefused }: {
  projectId: string; messages: Msg[]; hasPlan: boolean; shared: boolean; resumeJob?: string; hidden?: boolean;
  onMessages(m: Msg[]): void; onPlan(p: Plan): void; onRefused?(why: string[]): void;
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
  const done = () => { if (alive.current) setJob(''); if (file.current) file.current.value = ''; };
  useEffect(() => {
    if (resumeJob) { setT0(Date.now()); setJob('Reading the drawing…'); follow(resumeJob).catch(fail).finally(done); }
    return () => { alive.current = false; };
  }, []);

  /** Polls an ingestion job (a Cloudflare Workflow) until it finishes, showing its stage. Stops on unmount; rides out brief network errors. */
  async function follow(jobId: string) {
    for (let i = 0, errors = 0; i < 400 && alive.current; i++) {
      let d: { job: Job; plan?: Plan; message?: Msg };
      try { d = await api(`/projects/${projectId}/jobs/${jobId}`); errors = 0; }
      catch (e) {
        if (!(e instanceof TypeError) || ++errors > 3) throw e; // fetch itself failed: offline for a moment
        await new Promise((r) => setTimeout(r, 1500 * 2 ** errors));
        continue;
      }
      if (!alive.current) return;
      if (d.job.status === 'done') { if (d.message) push(d.message); if (d.plan) onPlan(d.plan); return; }
      if (d.job.status === 'failed') throw new Error(`Couldn't read the drawing: ${d.job.error ?? 'unknown error'}`);
      setJob(d.job.stage);
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (alive.current) throw new Error('Still working on the drawing. Reload the page later to see the result.');
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
    try { const d = await api(`/projects/${projectId}/chat`, { json: r ? { message: q, region: r } : { message: q } }); push(d.message); }
    catch (e) { fail(e); }
    finally { if (alive.current) setAsking(false); }
  }

  async function upload(f: File) {
    if (job) return;
    push({ role: 'user', content: { text: `Uploaded ${f.name}` } });
    setT0(Date.now()); setJob('Uploading…');
    try {
      const headers: Record<string, string> = { 'x-filename': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' };
      if (f.type.startsWith('image/')) {
        const bmp = await createImageBitmap(f);
        headers['x-image-width'] = String(bmp.width); headers['x-image-height'] = String(bmp.height);
        bmp.close();
      }
      const up = await api<{ duplicate?: boolean; job: { id: string } | null }>(`/projects/${projectId}/files`, { body: f, headers });
      if (!up.job) return push({ role: 'assistant', content: { text: `${f.name} is already read. Its plan is in the canvas.`, kind: 'system', claims: [] } });
      setJob('Queued…');
      await follow(up.job.id);
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
        {status && <><Spinner size={16} label={null} />{status}{job && <span aria-hidden="true" class="num"> · {clock(Date.now() - t0)}</span>}</>}
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
