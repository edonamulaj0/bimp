import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Plan, ROOM_TYPES, area, round } from '../../shared/plan';
import { api } from './api';
import { Plan2D } from './canvas/Plan2D';
import { Plan3D } from './canvas/Plan3D';
import { ROOM_COLORS } from './canvas/colors';
import { checkPlan } from '../../shared/standards';
import { AI_OFF, ai, chatPrompt, hoverRoom, selectedRooms } from './state';
import { InfoPanel } from './InfoPanel';
import { suggestLayout } from '../../shared/fengshui';
import { Topbar } from './Topbar';
import { Spinner } from './brand';

type Content = {
  text: string; kind?: 'system' | 'error'; claims?: { text: string; room_ids: string[] }[]; calculation?: string | null;
  assumptions?: string[]; not_found?: boolean; verified?: boolean; issues?: string[];
};
type Msg = { role: 'user' | 'assistant'; content: Content };
type Job = { id: string; status: string; stage: string; error?: string | null };
type Data = { project: { id: string; name: string }; plan: Plan | null; messages: Msg[]; jobs: Job[] };

export function ProjectPage({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'chat' | 'canvas'>('chat');
  const [chatW, setChatW] = useState(400);
  useEffect(() => {
    hoverRoom.value = null; selectedRooms.value = []; chatPrompt.value = null;
    api<Data>(`/projects/${id}`).then(setData).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => { document.title = `${data?.project.name ?? 'Project'} · bimp`; }, [data?.project.name]);

  const maxW = () => Math.round(innerWidth * 0.6);
  const clampW = (w: number) => Math.min(Math.max(w, 300), maxW());
  const startResize = (e: PointerEvent) => {
    const x0 = e.clientX, w0 = chatW;
    const move = (m: PointerEvent) => setChatW(clampW(w0 + m.clientX - x0));
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const upload = () => { setTab('chat'); (document.getElementById('plan-file') as HTMLInputElement | null)?.click(); };

  return (
    <div class="page ws-page">
      <Topbar>
        <a href="#/" class="crumb">Projects</a> <span class="crumb-sep" aria-hidden="true">/</span> <h1 class="crumb-h1" tabIndex={-1}>{data?.project.name ?? '…'}</h1>
      </Topbar>
      <main id="main" class="ws-main">
        {err && <p class="err pad" role="alert">{err}</p>}
        {!data && !err && <div class="loading-block grow"><Spinner size={48} label="Loading project" /></div>}
        {data && (
          <>
            <div class="tabs" role="group" aria-label="Show">
              <button aria-pressed={tab === 'chat'} aria-controls="pane-chat" onClick={() => setTab('chat')}>Chat</button>
              <button aria-pressed={tab === 'canvas'} aria-controls="pane-canvas" onClick={() => setTab('canvas')}>Canvas</button>
            </div>
            <div class={`ws show-${tab}`} style={{ '--chat-w': `${chatW}px` }}>
              <Chat projectId={id} messages={data.messages} hasPlan={!!data.plan} resumeJob={data.jobs[0]?.id}
                onMessages={(messages) => setData((d) => d && { ...d, messages })}
                onPlan={(plan) => { setData((d) => d && { ...d, plan }); }} />
              <div class="ws-handle" onPointerDown={startResize} role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize chat"
                aria-controls="pane-chat" aria-valuenow={chatW} aria-valuemin={300} aria-valuemax={maxW()}
                onKeyDown={(e) => { const d = { ArrowLeft: -20, ArrowRight: 20 }[e.key]; if (d) { e.preventDefault(); setChatW(clampW(chatW + d)); } }} />
              <CanvasPane plan={data.plan} projectId={id} name={data.project.name} onUpload={upload} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- chat
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** The overview prompts from the info panel are long; show them as a short label. */
const shortText = (t: string) => { const m = t.match(/^Give me an overview of (.+?)(?: \([^()]*\))?: /); return m ? `Overview of ${m[1]}` : t; };
/** Errors: shown live (kind 'error'), or failed jobs persisted by the server as a bare system note (no claims). */
const isError = (c: Content) => c.kind === 'error' || (c.kind === 'system' && !c.claims);

function Chat({ projectId, messages, hasPlan, resumeJob, onMessages, onPlan }: {
  projectId: string; messages: Msg[]; hasPlan: boolean; resumeJob?: string; onMessages(m: Msg[]): void; onPlan(p: Plan): void;
}) {
  const [text, setText] = useState('');
  const [job, setJob] = useState(''); // stage of the drawing being read; uploads don't block questions
  const [asking, setAsking] = useState(false);
  const [t0, setT0] = useState(0);
  const [, tick] = useState(0);
  const alive = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [messages.length, asking, !!job]);
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
      if (d.job.status === 'done') { if (d.plan) onPlan(d.plan); if (d.message) push(d.message); return; }
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
    push({ role: 'user', content: { text: q } });
    setAsking(true);
    try { const d = await api(`/projects/${projectId}/chat`, { json: { message: q } }); push(d.message); }
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

  const status = [job && `${job}`, asking && 'Reading the plan…'].filter(Boolean).join(' · ');
  return (
    <section class="chat" id="pane-chat" aria-label="Chat">
      <div class="msgs" ref={list} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
        {!messages.length && (
          <div class="empty">
            <p class="label">{hasPlan ? 'Ask' : 'Start'}</p>
            <h2 class="empty-h">{hasPlan ? 'Ask about this plan.' : 'Start with a drawing.'}</h2>
            <p class="muted small">{hasPlan ? 'Try: "What is the area of the kitchen?", "How many windows are there?", "How many 30×30 cm tiles for the bathroom?"' : 'Upload a floor plan (PDF, DXF, PNG, JPG or WebP) with the + button. bimp builds a 2D and isometric 3D plan from it.'}</p>
          </div>
        )}
        {messages.map((m, i) => <Message key={i} m={m} />)}
      </div>
      <p class="status" role="status">
        {status && <><Spinner size={16} label={null} />{status}{job && <span aria-hidden="true"> · {clock(Date.now() - t0)}</span>}</>}
      </p>
      {!ai.value && <p class="ai-off small muted" id="ai-off">{AI_OFF}</p>}
      <form class="composer" onSubmit={send}>
        <input ref={file} id="plan-file" type="file" accept=".pdf,.dxf,.png,.jpg,.jpeg,.webp" hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) upload(f); }} />
        <button type="button" class="icon" onClick={() => file.current?.click()} disabled={!!job} title="Upload a floor plan" aria-label="Upload a floor plan">＋</button>
        <textarea rows={1} placeholder={!ai.value ? 'Answers are off' : hasPlan ? 'Ask about the plan…' : 'Upload a floor plan to start'} value={text} disabled={!canAsk}
          aria-describedby={ai.value ? undefined : 'ai-off'}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} aria-label="Question" />
        <button class="icon go" disabled={!canAsk || asking || !text.trim()} aria-label="Send">→</button>
      </form>
    </section>
  );
}

function Message({ m }: { m: Msg }) {
  const c = m.content;
  if (m.role === 'user') return <div class="msg user" title={shortText(c.text) !== c.text ? c.text : undefined}>{shortText(c.text)}</div>;
  if (isError(c)) return <div class="msg bot sys error" role="alert"><b class="sys-label">Problem</b><p>{c.text}</p></div>;
  return (
    <div class={`msg bot${c.kind === 'system' ? ' sys' : ''}`}>
      <p>{c.text}</p>
      {!!c.claims?.length && (
        <div class="chips">
          {c.claims.map((cl, i) => (
            <button key={i} class="chip" title={cl.text}
              onClick={() => (selectedRooms.value = cl.room_ids)}
              onMouseEnter={() => (hoverRoom.value = cl.room_ids[0] ?? null)} onMouseLeave={() => (hoverRoom.value = null)}>
              {cl.text.length > 48 ? cl.text.slice(0, 46) + '…' : cl.text}
            </button>
          ))}
        </div>
      )}
      {c.calculation && <pre class="calc">{c.calculation}</pre>}
      {!!c.assumptions?.length && (
        <details class="small muted"><summary>Assumptions ({c.assumptions.length})</summary><ul>{c.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
      )}
      {c.kind !== 'system' && c.verified === false && (
        <p class="unverified small" title={c.issues?.join('\n')}>Unverified: {c.issues?.[0]}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- canvas
type Mode = '2d' | '3d' | 'split';

function CanvasPane({ plan: drawn, projectId, name, onUpload }: { plan: Plan | null; projectId: string; name: string; onUpload(): void }) {
  const [mode, setMode] = useState<Mode>('2d');
  const [rot, setRot] = useState(0);
  const [source, setSource] = useState(false);
  const [walls, setWalls] = useState<'dollhouse' | 'cut' | 'full'>('dollhouse');
  const [showChecks, setShowChecks] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [info, setInfo] = useState(() => innerWidth >= 1100);
  const checksBtn = useRef<HTMLButtonElement>(null);
  // Suggested furniture is shown alongside the drawing's own items and marked as a suggestion; never saved as drawing data.
  const plan = useMemo(() => (drawn && suggest ? { ...drawn, fixtures: [...(drawn.fixtures ?? []), ...suggestLayout(drawn)] } : drawn), [drawn, suggest]);
  if (!plan) return (
    <section class="canvas empty-canvas" id="pane-canvas" aria-label="Canvas">
      <p class="muted">No plan yet. Upload a floor plan and bimp draws it here in 2D and 3D.</p>
      <button class="btn" onClick={onUpload}>Upload a floor plan</button>
      <p class="muted small">PDF, DXF, PNG, JPG or WebP</p>
    </section>
  );

  const sourceUrl = !source || !plan.source ? null
    : plan.source.renderSha ? `/api/projects/${projectId}/render/${plan.source.renderSha}`
    : plan.source.mime.startsWith('image/') ? `/api/projects/${projectId}/files/${plan.source.fileId}` : null;
  const show3d = mode !== '2d';
  const focus = plan.rooms.find((r) => r.id === (hoverRoom.value ?? selectedRooms.value[0]));
  const types = ROOM_TYPES.filter((t) => plan.rooms.some((r) => r.type === t));
  const checks = checkPlan(plan);
  const warns = checks.filter((c) => c.level === 'warn').length;
  const closeChecks = () => { setShowChecks(false); checksBtn.current?.focus(); };

  return (
    <section class="canvas" id="pane-canvas" aria-label="Canvas">
      <div class="toolbar">
        <div class="seg" role="group" aria-label="View">
          {(['2d', '3d', 'split'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'split' ? 'Split' : m.toUpperCase()}</button>
          ))}
        </div>
        {show3d && (<>
          <div class="seg" role="group" aria-label="Rotate 3D">
            <button onClick={() => setRot((r) => r - 1)} title="Rotate left" aria-label="Rotate left">⟲</button>
            <button onClick={() => setRot((r) => r + 1)} title="Rotate right" aria-label="Rotate right">⟳</button>
          </div>
          <div class="seg" role="group" aria-label="Walls">
            {([['dollhouse', 'Dollhouse', 'Front walls lowered, back walls full height'], ['cut', 'Cut 1.2 m', 'All walls cut at 1.2 m, like a plan section'], ['full', 'Full', 'All walls full height']] as const).map(([m, label, title]) => (
              <button key={m} aria-pressed={walls === m} title={title} onClick={() => setWalls(m)}>{label}</button>
            ))}
          </div>
        </>)}
        {(plan.source?.renderSha || plan.source?.mime.startsWith('image/')) && mode !== '3d' && (
          <label class="small toggle"><input type="checkbox" checked={source} onChange={(e) => setSource(e.currentTarget.checked)} /> Show source drawing</label>
        )}
        <span class="spacer" />
        <button class="btn ghost sm" aria-pressed={info} aria-controls="info-panel" onClick={() => setInfo(!info)}>Info</button>
        <span class={`badge${plan.measured ? ' ok' : ''}`} title={plan.assumptions.join('\n')}>
          {plan.measured ? `Measured · ${plan.scale.source}` : 'Preview, not measured'}
        </span>
      </div>

      <div class="canvas-body">
        <div class={`views mode-${mode}`}>
          {mode !== '3d' && <div class="view"><Plan2D plan={plan} sourceUrl={sourceUrl} title={name} /></div>}
          {mode !== '2d' && <div class="view"><Plan3D plan={plan} rotation={rot} walls={walls} /></div>}
          {showChecks && (
            <div class="checks" id="checks-panel" role="region" aria-labelledby="checks-title" onKeyDown={(e) => e.key === 'Escape' && closeChecks()}>
              <div class="checks-head"><b id="checks-title">Checks against design standards</b><button class="link" onClick={closeChecks} aria-label="Close checks">✕</button></div>
              {!checks.length && <p class="muted small">Nothing unusual found.</p>}
              {checks.map((c, i) => (
                <button key={i} class={`check check--${c.level}`} onClick={() => c.room_id && (selectedRooms.value = [c.room_id])}>
                  <span><span aria-hidden="true">{c.level === 'warn' ? '⚠' : 'ℹ'}</span> <span class="sr-only">{c.level === 'warn' ? 'Warning: ' : 'Note: '}</span>{c.text}</span><small class="muted">{c.ref}</small>
                </button>
              ))}
            </div>
          )}
          <div class="hover-readout" aria-hidden="true">
            {focus
              ? <><i class="sw" style={{ background: ROOM_COLORS[focus.type] }} /><b>{focus.name}</b> · {focus.type} · {round(area(focus.polygon), 1)} m²</>
              : <span class="muted">Hover or tab to a room to identify it</span>}
          </div>
        </div>
        {info && <InfoPanel plan={plan} suggest={suggest} onSuggest={setSuggest} />}
      </div>

      <div class="legend small">
        <button ref={checksBtn} class={`link small checks-btn${warns ? ' has' : ''}`} aria-expanded={showChecks} aria-controls="checks-panel"
          onClick={() => (showChecks ? closeChecks() : setShowChecks(true))}>
          {warns ? <><span aria-hidden="true">⚠ </span>{warns} check{warns > 1 ? 's' : ''} to review</> : `Checks (${checks.length})`}
        </button>
        {types.map((t) => <span key={t}><i class="sw" style={{ background: ROOM_COLORS[t] }} />{t}</span>)}
        <span class="muted">· {plan.rooms.length} rooms · {plan.width} × {plan.height} m · scale: {plan.scale.source}</span>
      </div>
    </section>
  );
}
