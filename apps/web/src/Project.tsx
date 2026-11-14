import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Plan, type Pt, ROOM_TYPES, area, round } from '../../shared/plan';
import { type PlanDiff, diffPlans } from '../../shared/diff';
import { inside } from '../../shared/rooms';
import { checkPlan } from '../../shared/standards';
import { suggestLayout } from '../../shared/fengshui';
import { api } from './api';
import { type PinMark, Plan2D } from './canvas/Plan2D';
import { Plan3D } from './canvas/Plan3D';
import { ROOM_COLORS } from './canvas/colors';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { chatPrompt, hoverRoom, projectsVersion, say, selectedRooms } from './state';
import { InfoPanel } from './InfoPanel';
import { PageHeader } from './Shell';
import { Spinner } from './brand';
import { Icon } from './icons';
import { Chat } from './Chat';
import { Comments, PinComposer, threadsOf } from './Comments';
import { Revisions } from './Revisions';
import type { Comment, ProjectData } from './types';

type Tab = 'chat' | 'comments' | 'revisions' | 'info';
const TABS: [Tab, string][] = [['chat', 'Chat'], ['comments', 'Comments'], ['revisions', 'Revisions'], ['info', 'Info']];
const stored = <T,>(k: string, d: T, ok: (v: string) => boolean, map: (v: string) => T): T => { try { const v = localStorage.getItem(k); return v !== null && ok(v) ? map(v) : d; } catch { return d; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function ProjectPage({ id }: { id: string }) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTabState] = useState<Tab>(() => stored('bimp.tab', 'chat' as Tab, (v) => TABS.some((t) => t[0] === v), (v) => v as Tab));
  const [showPlan, setShowPlan] = useState(false); // narrow screens: the plan or the panel
  const [panelW, setPanelW] = useState(() => stored('bimp.panelW', 380, (v) => +v >= 300, Number));
  const [panelOpen, setPanelOpen] = useState(true);
  // revisions
  const plans = useRef(new Map<string, Plan>());
  const [, bump] = useState(0);
  const [viewRev, setViewRev] = useState<string | null>(null); // null = latest
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const [loadingRev, setLoadingRev] = useState<string | null>(null);
  // comments
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Pt | null>(null);
  const [posting, setPosting] = useState(false);
  const [focusAt, setFocusAt] = useState<{ p: Pt; key: number } | null>(null);
  const [threadErr, setThreadErr] = useState<Record<string, string>>({});

  const setTab = (t: Tab) => { setTabState(t); store('bimp.tab', t); setPanelOpen(true); setShowPlan(false); };
  const load = () => api<ProjectData>(`/projects/${id}`).then((d) => { if (d.plan && d.plan_id) plans.current.set(d.plan_id, d.plan); setData(d); }).catch((e) => setErr(e.message));
  useEffect(() => {
    hoverRoom.value = null; selectedRooms.value = []; chatPrompt.value = null;
    load();
    api<{ comments: Comment[] }>(`/projects/${id}/comments`).then((d) => setComments(d.comments)).catch(() => setComments([]));
  }, [id]);
  useEffect(() => { document.title = `${data?.project.name ?? 'Project'} · bimp`; }, [data?.project.name]);
  // the overview prompt from Info goes to the chat
  useEffect(() => { if (chatPrompt.value && tab !== 'chat') setTab('chat'); }, [chatPrompt.value]);

  async function fetchPlan(rid: string) {
    if (plans.current.has(rid)) return plans.current.get(rid)!;
    setLoadingRev(rid);
    try { const d = await api<{ plan: Plan }>(`/projects/${id}/revisions/${rid}`); plans.current.set(rid, d.plan); bump((n) => n + 1); return d.plan; }
    finally { setLoadingRev(null); }
  }
  const view = async (rid: string | null) => {
    setCompare(null); setDraft(null);
    if (!rid) { setViewRev(null); return say('Showing the latest revision'); }
    try { await fetchPlan(rid); setViewRev(rid); selectedRooms.value = []; say(`Showing r${revOf(rid)}`); setShowPlan(true); }
    catch (e) { setErr((e as Error).message); }
  };
  const startCompare = async (pair: [string, string] | null) => {
    setCompare(pair); setDraft(null); setPlacing(false);
    if (!pair) return;
    try { await Promise.all(pair.map(fetchPlan)); say(`Comparing r${revOf(pair[0])} with r${revOf(pair[1])}`); }
    catch (e) { setErr((e as Error).message); setCompare(null); }
  };

  const latestId = data?.plan_id ?? null;
  const shownId = compare?.[1] ?? viewRev ?? latestId;
  const shownPlan = (shownId && plans.current.get(shownId)) || (shownId === latestId ? data?.plan ?? null : null);
  const diff = useMemo<PlanDiff | null>(() => {
    const a = compare && plans.current.get(compare[0]), b = compare && plans.current.get(compare[1]);
    return a && b ? diffPlans(a, b) : null;
  }, [compare, plans.current.size]);
  const revOf = (pid: string | null) => data?.revisions.find((r) => r.id === pid)?.rev ?? null;
  const roomName = (rid: string | null) => (rid && (shownPlan?.rooms.find((r) => r.id === rid) ?? data?.plan?.rooms.find((r) => r.id === rid))?.name) || null;

  const threads = useMemo(() => threadsOf(comments ?? []), [comments]);
  const pins: PinMark[] = threads.filter((t) => t.root.plan_id === shownId && t.root.x !== null && t.root.y !== null).map((t) => ({
    id: t.root.id, n: t.n, x: t.root.x!, y: t.root.y!, resolved: !!t.root.resolved,
    label: `Comment ${t.n}${t.root.resolved ? ', resolved' : ''}, ${t.root.author === 'ai' ? 'bimp' : t.root.user_email ?? ''}: ${t.root.body.slice(0, 80)}${t.replies.length ? `. ${t.replies.length} replies` : ''}`,
  }));
  const openThread = (cid: string | null, pan = true) => {
    setActive(cid);
    if (!cid) return;
    setDraft(null);
    const t = threads.find((x) => x.root.id === cid);
    if (pan && t && t.root.plan_id === shownId && t.root.x !== null) setFocusAt({ p: [t.root.x, t.root.y!], key: Date.now() });
  };
  const onPin = (cid: string) => { openThread(cid, false); setTab('comments'); };

  const canComment = !!shownPlan && !compare;
  const toggleTool = (on = !placing) => {
    if (on && !canComment) return;
    setPlacing(on); setDraft(null);
    if (on) { setShowPlan(true); say('Comment tool on. Click the plan, or tab to a room and press Enter, to pin a comment. Escape to stop.'); }
  };
  const place = (p: Pt, roomId?: string) => {
    setDraft(p); setActive(null);
    const r = roomId ? shownPlan?.rooms.find((x) => x.id === roomId) : shownPlan?.rooms.find((x) => inside(p, x.polygon));
    say(`Pin placed${r ? ` in ${r.name}` : ''}. Write your comment.`);
  };
  async function post(body: string, askAi: boolean) {
    if (!draft || !shownId) return;
    setPosting(true);
    try {
      const d = await api<{ comment: Comment; reply: Comment | null; ai_error?: string }>(`/projects/${id}/comments`, { json: { body, x: draft[0], y: draft[1], plan_id: shownId, ask_ai: askAi || undefined } });
      setComments((cs) => [...(cs ?? []), d.comment, ...(d.reply ? [d.reply] : [])]);
      if (d.ai_error) setThreadErr((e) => ({ ...e, [d.comment.id]: d.ai_error! }));
      setDraft(null); setPlacing(false); setActive(d.comment.id); setTab('comments');
      say(d.reply ? 'Comment posted. bimp replied.' : 'Comment posted');
    } catch (e) { setErr((e as Error).message); }
    finally { setPosting(false); }
  }
  // C: comment tool; Escape: drop the pin being written, then leave the tool
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); toggleTool(); }
      else if (e.key === 'Escape' && (draft || placing)) { if (draft) setDraft(null); else toggleTool(false); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const maxW = () => Math.round(Math.min(760, innerWidth * 0.6));
  const clampW = (w: number) => Math.min(Math.max(w, 300), maxW());
  const resize = (w: number) => { const v = clampW(w); setPanelW(v); store('bimp.panelW', String(v)); };
  const startResize = (e: PointerEvent) => {
    const x0 = e.clientX, w0 = panelW;
    const move = (m: PointerEvent) => resize(w0 - (m.clientX - x0));
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const upload = () => { setTab('chat'); requestAnimationFrame(() => (document.getElementById('plan-file') as HTMLInputElement | null)?.click()); };
  const tabKeys = (e: KeyboardEvent, list: string[]) => {
    const i = list.indexOf((e.currentTarget as HTMLElement).dataset.tab!), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = list[(i + d + list.length) % list.length];
    (e.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };
  const openCount = threads.filter((t) => !t.root.resolved).length;
  const count = (t: Tab) => (t === 'comments' ? openCount : t === 'revisions' ? data?.revisions.length ?? 0 : 0);
  const team = data?.project.team;
  const rev = viewRev ? data?.revisions.find((r) => r.id === viewRev) : null;
  const banner = compare
    ? <>Comparing <span class="mono">r{revOf(compare[0])}</span> → <span class="mono">r{revOf(compare[1])}</span><span class="cmp-key" aria-hidden="true"><span class="k add" />added <span class="k del" />removed <span class="k chg" />resized</span><button class="link" onClick={() => startCompare(null)}>Exit compare</button></>
    : rev ? <>Viewing <span class="mono">r{rev.rev}</span>{rev.note ? ` · ${rev.note}` : ''} · read-only<button class="link" onClick={() => view(null)}>Back to latest</button></> : null;

  return (
    <>
      <PageHeader
        crumbs={[team ? { label: team.name, href: `#/team/${team.id}` } : { label: 'Personal', href: '#/personal' }]}
        title={data?.project.name ?? '…'}
        actions={data && <>
          <button class="btn ghost sm" onClick={upload}><Icon name="upload" size={16} /><span class="hide-sm">Upload drawing</span><span class="sr-only show-sm">Upload drawing</span></button>
          <button class="icon-btn panel-toggle" aria-pressed={panelOpen} aria-controls="ws-panel" onClick={() => setPanelOpen(!panelOpen)} aria-label="Side panel" title={panelOpen ? 'Hide panel' : 'Show panel'}><Icon name="sidebar" /></button>
        </>} />
      <main id="main" class="ws-main" tabIndex={-1}>
        {err && <p class="err pad-x" role="alert">{err} <button class="link small" onClick={() => setErr('')}>Dismiss</button></p>}
        {!data && !err && <div class="loading-block grow"><Spinner size={48} label="Loading project" /></div>}
        {data && (
          <>
            <div class="m-tabs" role="tablist" aria-label="Workspace">
              {[['plan', 'Plan'] as const, ...TABS.map(([t, l]) => [t, l] as const)].map(([t, l]) => {
                const on = t === 'plan' ? showPlan : !showPlan && tab === t;
                return <button key={t} role="tab" data-tab={t} aria-selected={on} tabIndex={on ? 0 : -1} aria-controls={t === 'plan' ? 'pane-canvas' : `panel-${t}`}
                  onKeyDown={(e) => tabKeys(e, ['plan', ...TABS.map((x) => x[0])])}
                  onClick={() => (t === 'plan' ? setShowPlan(true) : setTab(t))}>{l}{t !== 'plan' && !!count(t) && <span class="count">{count(t)}</span>}</button>;
              })}
            </div>
            <div class={`ws${panelOpen ? '' : ' no-panel'}${showPlan ? ' show-plan' : ' show-panel'}`} style={{ '--panel-w': `${panelW}px` }}>
              <CanvasPane plan={shownPlan} projectId={id} name={data.project.name} onUpload={upload} loading={!!(shownId && !shownPlan)}
                banner={banner} diff={diff} pins={compare ? [] : pins} activePin={active} onPin={onPin}
                placing={placing && canComment} onTool={() => toggleTool()} canComment={canComment} onPlace={place} draft={draft} focusAt={focusAt}
                popover={draft && <PinComposer busy={posting} onSubmit={post} onCancel={() => setDraft(null)} />}
                onChecks={() => { setTab('info'); requestAnimationFrame(() => document.getElementById('checks-h')?.focus()); }} />
              <div class="ws-handle" onPointerDown={startResize} role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize panel"
                aria-controls="ws-panel" aria-valuenow={panelW} aria-valuemin={300} aria-valuemax={maxW()}
                onKeyDown={(e) => { const d = { ArrowLeft: 20, ArrowRight: -20 }[e.key]; if (d) { e.preventDefault(); resize(panelW + d); } }} />
              <aside class="panel" id="ws-panel" aria-label="Project panel">
                <div class="p-tabs" role="tablist" aria-label="Panel">
                  {TABS.map(([t, l]) => (
                    <button key={t} id={`tab-${t}`} role="tab" data-tab={t} aria-selected={tab === t} aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1}
                      onKeyDown={(e) => tabKeys(e, TABS.map((x) => x[0]))} onClick={() => setTab(t)}>
                      {l}{!!count(t) && <span class="count">{count(t)}</span>}
                    </button>
                  ))}
                  <span class="spacer" />
                  <button class="icon-btn" onClick={() => setPanelOpen(false)} aria-label="Hide panel" title="Hide panel"><Icon name="close" size={16} /></button>
                </div>
                <Chat projectId={id} messages={data.messages} hasPlan={!!data.plan} shared={!!team} resumeJob={data.jobs[0]?.id} hidden={tab !== 'chat'}
                  onMessages={(messages) => setData((d) => d && { ...d, messages })}
                  onPlan={(plan) => { setData((d) => d && { ...d, plan }); setViewRev(null); setCompare(null); load(); projectsVersion.value++; }} />
                <Comments projectId={id} comments={comments} onComments={(f) => setComments((c) => f(c ?? []))} hidden={tab !== 'comments'}
                  active={active} onActive={(cid) => openThread(cid)} viewedPlanId={shownId} revOf={revOf} roomName={roomName}
                  isOwner={data.project.role === 'owner'} onNew={() => toggleTool(true)} onShowOn={(pid) => view(pid === latestId ? null : pid).then(() => openThread(active))}
                  errors={threadErr} setError={(cid, e) => setThreadErr((x) => ({ ...x, [cid]: e }))} />
                <Revisions revisions={data.revisions} latestId={latestId} viewedId={compare ? null : shownId} loading={loadingRev} compare={compare} diff={diff}
                  hidden={tab !== 'revisions'} onView={view} onCompare={startCompare}
                  onNote={async (rid, note) => {
                    const d = await api<{ revision: { note: string | null } }>(`/projects/${id}/revisions/${rid}`, { method: 'PATCH', json: { note } });
                    setData((x) => x && { ...x, revisions: x.revisions.map((r) => (r.id === rid ? { ...r, note: d.revision?.note ?? note } : r)) });
                    say('Note saved');
                  }} />
                {shownPlan
                  ? <InfoPanelHost plan={shownPlan} hidden={tab !== 'info'} />
                  : <section class="tabpanel" id="panel-info" role="tabpanel" aria-labelledby="tab-info" hidden={tab !== 'info'}><p class="muted small pad-x">No plan yet. Upload a drawing to see its rooms, areas and checks.</p></section>}
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}

/** Suggested furniture is per-session view state; it lives with the Info tab and the canvas reads it. */
const suggestOn = signal(false);
function InfoPanelHost({ plan, hidden }: { plan: Plan; hidden: boolean }) {
  return <InfoPanel plan={plan} suggest={suggestOn.value} onSuggest={(v) => (suggestOn.value = v)} hidden={hidden} />;
}

// ---------------------------------------------------------------- canvas
type Mode = '2d' | '3d' | 'split';
type CanvasProps = {
  plan: Plan | null; projectId: string; name: string; loading: boolean; onUpload(): void; onChecks(): void;
  banner: ComponentChildren; diff: PlanDiff | null; pins: PinMark[]; activePin: string | null; onPin(id: string): void;
  placing: boolean; canComment: boolean; onTool(): void; onPlace(p: Pt, roomId?: string): void; draft: Pt | null; focusAt: { p: Pt; key: number } | null;
  popover: ComponentChildren;
};

function CanvasPane({ plan: drawn, projectId, name, loading, onUpload, onChecks, banner, diff, pins, activePin, onPin, placing, canComment, onTool, onPlace, draft, focusAt, popover }: CanvasProps) {
  const [mode, setMode] = useState<Mode>('2d');
  const [rot, setRot] = useState(0);
  const [source, setSource] = useState(false);
  const [walls, setWalls] = useState<'dollhouse' | 'cut' | 'full'>('dollhouse');
  const suggest = suggestOn.value && !diff;
  // pins and the comment tool live on the 2D plan
  useEffect(() => { if (placing && mode === '3d') setMode('2d'); }, [placing]);
  // Suggested furniture is shown alongside the drawing's own items and marked as a suggestion; never saved as drawing data.
  const plan = useMemo(() => (drawn && suggest ? { ...drawn, fixtures: [...(drawn.fixtures ?? []), ...suggestLayout(drawn)] } : drawn), [drawn, suggest]);
  if (loading) return <section class="canvas empty-canvas" id="pane-canvas" aria-label="Canvas"><Spinner size={40} label="Loading revision" /></section>;
  if (!plan) return (
    <section class="canvas empty-canvas" id="pane-canvas" aria-label="Canvas">
      <div class="drop">
        <h2>No drawing yet</h2>
        <p class="muted">Upload a floor plan and bimp reads it into rooms, walls and openings, drawn here in 2D and 3D.</p>
        <button class="btn sm" onClick={onUpload}><Icon name="upload" size={16} />Upload a floor plan</button>
        <p class="muted small">PDF, DXF, PNG, JPG or WebP</p>
      </div>
    </section>
  );

  const sourceUrl = !source || !plan.source || diff ? null
    : plan.source.renderSha ? `/api/projects/${projectId}/render/${plan.source.renderSha}`
    : plan.source.mime.startsWith('image/') ? `/api/projects/${projectId}/files/${plan.source.fileId}` : null;
  const show3d = mode !== '2d';
  const focus = plan.rooms.find((r) => r.id === (hoverRoom.value ?? selectedRooms.value[0]));
  const types = ROOM_TYPES.filter((t) => plan.rooms.some((r) => r.type === t));
  const checks = checkPlan(plan);
  const warns = checks.filter((c) => c.level === 'warn').length;

  return (
    <section class={`canvas${placing ? ' is-placing' : ''}`} id="pane-canvas" aria-label="Canvas">
      <div class="toolbar">
        <div class="seg sm" role="group" aria-label="View">
          {(['2d', '3d', 'split'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'split' ? 'Split' : m.toUpperCase()}</button>
          ))}
        </div>
        <button class={`tool${placing ? ' on' : ''}`} aria-pressed={placing} onClick={onTool} disabled={!canComment}
          title={canComment ? 'Comment: click the plan to pin a comment (C)' : 'Exit compare to comment'} aria-keyshortcuts="C">
          <Icon name="pin" size={16} />Comment<kbd aria-hidden="true">C</kbd>
        </button>
        {show3d && (<>
          <div class="seg sm" role="group" aria-label="Rotate 3D">
            <button onClick={() => setRot((r) => r - 1)} title="Rotate left" aria-label="Rotate left">⟲</button>
            <button onClick={() => setRot((r) => r + 1)} title="Rotate right" aria-label="Rotate right">⟳</button>
          </div>
          <div class="seg sm" role="group" aria-label="Walls">
            {([['dollhouse', 'Dollhouse', 'Front walls lowered, back walls full height'], ['cut', 'Cut 1.2 m', 'All walls cut at 1.2 m, like a plan section'], ['full', 'Full', 'All walls full height']] as const).map(([m, label, title]) => (
              <button key={m} aria-pressed={walls === m} title={title} onClick={() => setWalls(m)}>{label}</button>
            ))}
          </div>
        </>)}
        {(plan.source?.renderSha || plan.source?.mime.startsWith('image/')) && mode !== '3d' && !diff && (
          <label class="small toggle"><input type="checkbox" checked={source} onChange={(e) => setSource(e.currentTarget.checked)} /> Source drawing</label>
        )}
        <span class="spacer" />
        <span class={`pill${plan.measured ? ' ok' : ' warn'}`} title={plan.assumptions.join('\n')}>
          {plan.measured ? `Measured · ${plan.scale.source}` : 'Preview, not measured'}
        </span>
      </div>
      {banner && <div class="plan-banner" role="status">{banner}</div>}
      {placing && <div class="tool-hint" aria-hidden="true">Click the plan to pin a comment · Esc to stop</div>}

      <div class={`views mode-${mode}`}>
        {mode !== '3d' && (
          <div class="view">
            <Plan2D plan={plan} sourceUrl={sourceUrl} title={name} pins={pins} activePin={activePin} onPin={onPin}
              placing={placing} onPlace={onPlace} draft={draft} popover={popover} diff={diff} focusAt={focusAt} />
          </div>
        )}
        {mode !== '2d' && <div class="view"><Plan3D plan={plan} rotation={rot} walls={walls} /></div>}
        <div class="hover-readout" aria-hidden="true">
          {focus
            ? <><i class="sw" style={{ background: ROOM_COLORS[focus.type] }} /><b>{focus.name}</b> · {focus.type} · <span class="mono">{round(area(focus.polygon), 1)} m²</span></>
            : <span class="muted">Hover or tab to a room to identify it</span>}
        </div>
      </div>

      <div class="legend small">
        <button class={`link small checks-btn${warns ? ' has' : ''}`} onClick={onChecks}>
          {warns ? <><span aria-hidden="true">△ </span>{warns} check{warns > 1 ? 's' : ''} to review</> : `Checks (${checks.length})`}
        </button>
        {types.map((t) => <span key={t} class="lg-type"><i class="sw" style={{ background: ROOM_COLORS[t] }} />{t}</span>)}
        <span class="muted">· {plan.rooms.length} rooms · <span class="mono">{plan.width} × {plan.height} m</span></span>
      </div>
    </section>
  );
}
