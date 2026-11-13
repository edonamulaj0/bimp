import { useEffect, useRef, useState } from 'preact/hooks';
import { type Plan, ROOM_TYPES, area, round } from '../../shared/plan';
import { api } from './api';
import { Plan2D } from './canvas/Plan2D';
import { Plan3D } from './canvas/Plan3D';
import { ROOM_COLORS } from './canvas/colors';
import { checkPlan } from '../../shared/standards';
import { hoverRoom, selectedRooms } from './state';
import { Topbar } from './Topbar';

type Content = {
  text: string; kind?: 'system'; claims?: { text: string; room_ids: string[] }[]; calculation?: string | null;
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
    hoverRoom.value = null; selectedRooms.value = [];
    api<Data>(`/projects/${id}`).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  const startResize = (e: PointerEvent) => {
    const x0 = e.clientX, w0 = chatW;
    const move = (m: PointerEvent) => setChatW(Math.min(Math.max(w0 + m.clientX - x0, 300), innerWidth * 0.6));
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  return (
    <div class="page ws-page">
      <Topbar>
        <a href="#/" class="muted small">Projects</a> <span class="muted">/</span> <b>{data?.project.name ?? '…'}</b>
      </Topbar>
      {err && <p class="err pad">{err}</p>}
      {data && (
        <>
          <div class="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat</button>
            <button role="tab" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')}>Canvas</button>
          </div>
          <div class={`ws show-${tab}`} style={{ '--chat-w': `${chatW}px` }}>
            <Chat projectId={id} messages={data.messages} hasPlan={!!data.plan} resumeJob={data.jobs[0]?.id}
              onMessages={(messages) => setData((d) => d && { ...d, messages })}
              onPlan={(plan) => { setData((d) => d && { ...d, plan }); }} />
            <div class="ws-handle" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
            <CanvasPane plan={data.plan} projectId={id} name={data.project.name} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- chat
function Chat({ projectId, messages, hasPlan, resumeJob, onMessages, onPlan }: {
  projectId: string; messages: Msg[]; hasPlan: boolean; resumeJob?: string; onMessages(m: Msg[]): void; onPlan(p: Plan): void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [messages.length, status]);
  const busy = !!status;
  const push = (...m: Msg[]) => { messages = [...messages, ...m]; onMessages(messages); };
  const fail = (e: unknown) => push({ role: 'assistant', content: { text: (e as Error).message, kind: 'system' } });
  useEffect(() => { if (resumeJob) follow(resumeJob).catch(fail).finally(() => setStatus('')); }, []);

  /** Polls an ingestion job (a Cloudflare Workflow) until it finishes, showing its stage. */
  async function follow(jobId: string) {
    for (let i = 0; i < 400; i++) {
      const d = await api<{ job: Job; plan?: Plan; message?: Msg }>(`/projects/${projectId}/jobs/${jobId}`);
      if (d.job.status === 'done') { if (d.plan) onPlan(d.plan); if (d.message) push(d.message); return; }
      if (d.job.status === 'failed') throw new Error(`Couldn't read the drawing: ${d.job.error ?? 'unknown error'}`);
      setStatus(d.job.stage);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('Still working on the drawing. Reload the page later to see the result.');
  }

  async function send(e: Event) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    push({ role: 'user', content: { text: q } });
    setStatus('Reading the plan…');
    try { const d = await api(`/projects/${projectId}/chat`, { json: { message: q } }); push(d.message); }
    catch (e) { fail(e); }
    finally { setStatus(''); }
  }

  async function upload(f: File) {
    push({ role: 'user', content: { text: `Uploaded ${f.name}` } });
    try {
      const headers: Record<string, string> = { 'x-filename': encodeURIComponent(f.name), 'content-type': f.type || 'application/octet-stream' };
      if (f.type.startsWith('image/')) {
        const bmp = await createImageBitmap(f);
        headers['x-image-width'] = String(bmp.width); headers['x-image-height'] = String(bmp.height);
        bmp.close();
      }
      setStatus('Uploading…');
      const up = await api(`/projects/${projectId}/files`, { body: f, headers });
      setStatus('Queued…');
      await follow(up.job.id);
    } catch (e) { fail(e); }
    finally { setStatus(''); if (file.current) file.current.value = ''; }
  }

  return (
    <section class="chat" aria-label="Chat">
      <div class="msgs" ref={list}>
        {!messages.length && (
          <div class="empty">
            <p><b>Ask about this plan.</b></p>
            <p class="muted small">{hasPlan ? 'Try: "What is the area of the kitchen?", "How many windows are there?", "How many 30×30 cm tiles for the bathroom?"' : 'Upload a floor plan (PDF, DXF, PNG, JPG) with the + button. bimp builds a 2D and isometric 3D plan from it.'}</p>
          </div>
        )}
        {messages.map((m, i) => <Message key={i} m={m} />)}
        {status && <p class="status muted small">{status}</p>}
      </div>
      <form class="composer" onSubmit={send}>
        <input ref={file} type="file" accept=".pdf,.dxf,.png,.jpg,.jpeg,.webp" hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) upload(f); }} />
        <button type="button" class="icon" onClick={() => file.current?.click()} disabled={busy} title="Upload a floor plan" aria-label="Upload a floor plan">＋</button>
        <textarea rows={1} placeholder={hasPlan ? 'Ask about the plan…' : 'Upload a floor plan to start'} value={text} disabled={busy}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} aria-label="Question" />
        <button class="icon go" disabled={busy || !text.trim()} aria-label="Send">→</button>
      </form>
    </section>
  );
}

function Message({ m }: { m: Msg }) {
  const c = m.content;
  if (m.role === 'user') return <div class="msg user">{c.text}</div>;
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

function CanvasPane({ plan, projectId, name }: { plan: Plan | null; projectId: string; name: string }) {
  const [mode, setMode] = useState<Mode>('2d');
  const [rot, setRot] = useState(0);
  const [inset, setInset] = useState(true);
  const [source, setSource] = useState(false);
  const [cut, setCut] = useState(true);
  const [showChecks, setShowChecks] = useState(false);
  if (!plan) return <section class="canvas empty-canvas"><p class="muted">No plan yet. Upload a floor plan in the chat to see it here in 2D and 3D.</p></section>;

  const sourceUrl = !source || !plan.source ? null
    : plan.source.renderSha ? `/api/projects/${projectId}/render/${plan.source.renderSha}`
    : plan.source.mime.startsWith('image/') ? `/api/projects/${projectId}/files/${plan.source.fileId}` : null;
  const show3d = mode !== '2d' || inset;
  const focus = plan.rooms.find((r) => r.id === (hoverRoom.value ?? selectedRooms.value[0]));
  const types = ROOM_TYPES.filter((t) => plan.rooms.some((r) => r.type === t));
  const checks = checkPlan(plan);
  const warns = checks.filter((c) => c.level === 'warn').length;

  return (
    <section class="canvas" aria-label="Canvas">
      <div class="toolbar">
        <div class="seg" role="group" aria-label="View">
          {(['2d', '3d', 'split'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'split' ? 'Split' : m.toUpperCase()}</button>
          ))}
        </div>
        {show3d && (
          <div class="seg" role="group" aria-label="Rotate 3D">
            <button onClick={() => setRot((r) => r - 1)} title="Rotate left">⟲</button>
            <button onClick={() => setRot((r) => r + 1)} title="Rotate right">⟳</button>
            <button aria-pressed={cut} onClick={() => setCut(!cut)} title="Cut walls at 1.2 m to see the rooms">Cutaway</button>
          </div>
        )}
        {(plan.source?.renderSha || plan.source?.mime.startsWith('image/')) && mode !== '3d' && (
          <label class="small toggle"><input type="checkbox" checked={source} onChange={(e) => setSource(e.currentTarget.checked)} /> Show source drawing</label>
        )}
        <span class="spacer" />
        <span class={`badge${plan.measured ? ' ok' : ''}`} title={plan.assumptions.join('\n')}>
          {plan.measured ? `Measured · ${plan.scale.source}` : 'Preview, not measured'}
        </span>
      </div>

      <div class={`views mode-${mode}`}>
        {mode !== '3d' && <div class="view"><Plan2D plan={plan} sourceUrl={sourceUrl} title={name} /></div>}
        {mode !== '2d' && <div class="view"><Plan3D plan={plan} rotation={rot} cutaway={cut} /></div>}
        {mode !== 'split' && (
          <div class={`inset${inset ? '' : ' closed'} inset-${mode}`}>
            <div class="inset-bar">
              <button class="link small" onClick={() => setMode(mode === '2d' ? '3d' : '2d')}>{mode === '2d' ? '3D' : '2D'} ⤢</button>
              <button class="link small" onClick={() => setInset(!inset)} aria-label={inset ? 'Minimise' : 'Show'}>{inset ? '–' : '+'}</button>
            </div>
            {inset && (mode === '2d' ? <Plan3D plan={plan} compact rotation={rot} cutaway={cut} /> : <Plan2D plan={plan} compact />)}
          </div>
        )}
        {showChecks && (
          <div class="checks" role="dialog" aria-label="Plan checks">
            <div class="checks-head"><b>Checks against design standards</b><button class="link" onClick={() => setShowChecks(false)} aria-label="Close">✕</button></div>
            {!checks.length && <p class="muted small">Nothing unusual found.</p>}
            {checks.map((c, i) => (
              <button key={i} class={`check ${c.level}`} onClick={() => c.room_id && (selectedRooms.value = [c.room_id])}>
                <span>{c.level === 'warn' ? '⚠' : 'ℹ'} {c.text}</span><small class="muted">{c.ref}</small>
              </button>
            ))}
          </div>
        )}
        <div class="info">
          {focus
            ? <><i class="sw" style={{ background: ROOM_COLORS[focus.type] }} /><b>{focus.name}</b> · {focus.type} · {round(area(focus.polygon), 1)} m²</>
            : <span class="muted">Hover a room to identify it</span>}
        </div>
      </div>

      <div class="legend small">
        <button class={`link small checks-btn${warns ? ' has' : ''}`} onClick={() => setShowChecks(!showChecks)}>
          {warns ? `⚠ ${warns} check${warns > 1 ? 's' : ''}` : `Checks (${checks.length})`}
        </button>
        {types.map((t) => <span key={t}><i class="sw" style={{ background: ROOM_COLORS[t] }} />{t}</span>)}
        <span class="muted">· {plan.rooms.length} rooms · {plan.width} × {plan.height} m · scale: {plan.scale.source}</span>
      </div>
    </section>
  );
}
