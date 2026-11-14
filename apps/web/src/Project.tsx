import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Plan, type Pt, ROOM_TYPES, area, round } from '../../shared/plan';
import { type PlanDiff, diffPlans } from '../../shared/diff';
import { inside } from '../../shared/rooms';
import { checkPlan } from '../../shared/standards';
import { suggestLayout } from '../../shared/fengshui';
import { type Region, regionContents, regionSize } from '../../shared/region';
import { api } from './api';
import { ALL_LAYERS, type CanvasTool, type Layers, type MenuAt, type PinMark, Plan2D, type Plan2DApi } from './canvas/Plan2D';
import { Plan3D, type Plan3DApi } from './canvas/Plan3D';
import type { Projection, ViewPreset } from './canvas/scene';
import { ROOM_COLORS } from './canvas/colors';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { chatPrompt, hoverRoom, projectsVersion, queueFiles, region, say, selectedRooms, tourStep, tutorialOpen, visualsOpen } from './state';
import { InfoPanel } from './InfoPanel';
import { PageHeader } from './Shell';
import { Spinner } from './brand';
import { Icon } from './icons';
import { Chat } from './Chat';
import { Comments, PinComposer, threadsOf } from './Comments';
import { Revisions } from './Revisions';
import { FileTree, type FileRow } from './FileTree';
import { CanvasMenu, type CmSection } from './CanvasMenu';
import { Menu } from './ui';
import { Shortcuts, Tour, Tutorial } from './Tour';
import { VisualsDialog } from './Visuals';
import type { Comment, ProjectData } from './types';

type Tab = 'comments' | 'revisions' | 'info';
const TABS: [Tab, string][] = [['comments', 'Comments'], ['revisions', 'Revisions'], ['info', 'Overview']];
/** Phone layout: the canvas fills the screen; everything else opens as a bottom sheet from the tab bar. */
type MPane = 'plan' | 'files' | 'chat' | Tab;
const M_TABS: [MPane, string, string][] = [['plan', 'Plan', 'project'], ['files', 'Files', 'folder'], ['chat', 'Ask', 'sparkle'], ['comments', 'Comments', 'pin'], ['info', 'Overview', 'info']];
const stored = <T,>(k: string, d: T, ok: (v: string) => boolean, map: (v: string) => T): T => { try { const v = localStorage.getItem(k); return v !== null && ok(v) ? map(v) : d; } catch { return d; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const PHONE = '(max-width: 899px)';
function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q), f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}
const TOOL_KEYS: Record<string, CanvasTool> = { v: 'select', c: 'comment', r: 'region', m: 'measure' };
export const TOOLS: [CanvasTool, string, string, string, string][] = [
  ['select', 'Select', 'cursor', 'V', 'Select rooms; drag to pan'],
  ['comment', 'Comment', 'pin', 'C', 'Click the plan to pin a comment'],
  ['region', 'Markup', 'region', 'R', 'Drag a region; bimp answers from what is inside it only'],
  ['measure', 'Measure', 'ruler', 'M', 'Click two points to measure; Shift keeps the line straight'],
];

export function ProjectPage({ id }: { id: string }) {
  const phone = useMedia(PHONE);
  const [data, setData] = useState<ProjectData | null>(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState<string[]>([]);
  const [tab, setTabState] = useState<Tab>(() => stored('bimp.tab', 'comments' as Tab, (v) => TABS.some((t) => t[0] === v), (v) => v as Tab));
  const [mPane, setMPane] = useState<MPane>('plan');
  const [sheetFull, setSheetFull] = useState(false);
  const [leftW, setLeftW] = useState(() => stored('bimp.leftW', 300, (v) => +v >= 240, Number));
  const [rightW, setRightW] = useState(() => stored('bimp.panelW', 340, (v) => +v >= 280, Number));
  const [filesH, setFilesH] = useState(() => stored('bimp.filesH', 42, (v) => +v >= 15 && +v <= 85, Number)); // % of the left column
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(() => innerWidth >= 1200);
  const [tool, setToolState] = useState<CanvasTool>('select');
  // revisions
  const plans = useRef(new Map<string, Plan>());
  const [, bump] = useState(0);
  const [viewRev, setViewRev] = useState<string | null>(null); // null = latest
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const [loadingRev, setLoadingRev] = useState<string | null>(null);
  // comments
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt | null>(null);
  const [posting, setPosting] = useState(false);
  const [focusAt, setFocusAt] = useState<{ p: Pt; key: number } | null>(null);
  const [threadErr, setThreadErr] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState(false);

  const setTab = (t: Tab) => { setTabState(t); store('bimp.tab', t); setRightOpen(true); if (phone) setMPane(t); };
  const load = () => api<ProjectData>(`/projects/${id}`).then((d) => { if (d.plan && d.plan_id) plans.current.set(d.plan_id, d.plan); setData(d); }).catch((e) => setErr(e.message));
  useEffect(() => {
    hoverRoom.value = null; selectedRooms.value = []; chatPrompt.value = null; region.value = null; visualsOpen.value = false;
    load();
    api<{ comments: Comment[] }>(`/projects/${id}/comments`).then((d) => setComments(d.comments)).catch(() => setComments([]));
    return () => { region.value = null; };
  }, [id]);
  useEffect(() => { document.title = `${data?.project.name ?? 'Project'} · bimp`; }, [data?.project.name]);
  // a question from the canvas or the overview goes to the chat: on a phone, open the chat sheet
  useEffect(() => { if (chatPrompt.value) { if (phone) setMPane('chat'); else setLeftOpen(true); } }, [chatPrompt.value]);
  // the welcome tour, once, the first time a workspace opens on this device
  useEffect(() => { if (data && !stored('bimp.toured', false, () => true, () => true)) { store('bimp.toured', '1'); tourStep.value = 0; } }, [!!data]);

  async function fetchPlan(rid: string) {
    if (plans.current.has(rid)) return plans.current.get(rid)!;
    setLoadingRev(rid);
    try { const d = await api<{ plan: Plan }>(`/projects/${id}/revisions/${rid}`); plans.current.set(rid, d.plan); bump((n) => n + 1); return d.plan; }
    finally { setLoadingRev(null); }
  }
  const view = async (rid: string | null) => {
    setCompare(null); setDraft(null); region.value = null;
    if (!rid) { setViewRev(null); return say('Showing the latest revision'); }
    try { await fetchPlan(rid); setViewRev(rid); selectedRooms.value = []; say(`Showing r${revOf(rid)}`); if (phone) setMPane('plan'); }
    catch (e) { setErr((e as Error).message); }
  };
  const startCompare = async (pair: [string, string] | null) => {
    setCompare(pair); setDraft(null); if (tool === 'comment') setToolState('select');
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
  const setTool = (t: CanvasTool) => {
    if (t === 'comment' && !canComment) return say('Exit compare to comment');
    if (!shownPlan) return;
    setToolState(t); setDraft(null);
    if (phone) setMPane('plan');
    say({ select: 'Select tool', comment: 'Comment tool on. Click the plan, or tab to a room and press Enter, to pin a comment. Escape to stop.',
      region: 'Markup tool on. Drag a rectangle over the area to ask about. Escape to stop.', measure: 'Measure tool on. Click two points. Escape to stop.' }[t]);
  };
  const place = (p: Pt, roomId?: string) => {
    setDraft(p); setActive(null);
    const r = roomId ? shownPlan?.rooms.find((x) => x.id === roomId) : shownPlan?.rooms.find((x) => inside(p, x.polygon));
    say(`Pin placed${r ? ` in ${r.name}` : ''}. Write your comment.`);
  };
  const markRegion = (r: Region | null) => {
    region.value = r;
    if (r) { const { w, h } = regionSize(r); say(`Region marked, ${w} by ${h} metres. Questions in bimp AI now use only what is inside it.`); }
  };
  async function post(body: string, askAi: boolean) {
    if (!draft || !shownId) return;
    setPosting(true);
    try {
      const d = await api<{ comment: Comment; reply: Comment | null; ai_error?: string }>(`/projects/${id}/comments`, { json: { body, x: draft[0], y: draft[1], plan_id: shownId, ask_ai: askAi || undefined } });
      setComments((cs) => [...(cs ?? []), d.comment, ...(d.reply ? [d.reply] : [])]);
      if (d.ai_error) setThreadErr((e) => ({ ...e, [d.comment.id]: d.ai_error! }));
      setDraft(null); setToolState('select'); setActive(d.comment.id); setTab('comments');
      say(d.reply ? 'Comment posted. bimp replied.' : 'Comment posted');
    } catch (e) { setErr((e as Error).message); }
    finally { setPosting(false); }
  }
  // V C R M: tools; Escape: drop the pin being written, then back to Select; ?: shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open], .cm, .tour-card')) return;
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t) { e.preventDefault(); setTool(tool === t && t !== 'select' ? 'select' : t); }
      else if (e.key === 'Escape' && (draft || tool !== 'select')) { if (draft) setDraft(null); else setTool('select'); }
      else if (e.key === '?') { e.preventDefault(); setShowKeys(true); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const resizer = (get: () => number, set: (v: number) => void, key: string, min: number, max: () => number, sign: 1 | -1) => ({
    onPointerDown: (e: PointerEvent) => {
      const x0 = e.clientX, w0 = get();
      const move = (m: PointerEvent) => { const v = Math.round(Math.min(Math.max(w0 + sign * (m.clientX - x0), min), max())); set(v); store(key, String(v)); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    },
    onKeyDown: (e: KeyboardEvent) => { const d = { ArrowLeft: -20, ArrowRight: 20 }[e.key]; if (d) { e.preventDefault(); const v = Math.min(Math.max(get() + sign * d, min), max()); set(v); store(key, String(v)); } },
  });
  const leftCol = useRef<HTMLElement>(null);
  const rowResize = {
    onPointerDown: (e: PointerEvent) => {
      const box = leftCol.current!.getBoundingClientRect();
      const move = (m: PointerEvent) => { const v = Math.round(Math.min(Math.max(((m.clientY - box.top) / box.height) * 100, 15), 85)); setFilesH(v); store('bimp.filesH', String(v)); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    },
    onKeyDown: (e: KeyboardEvent) => { const d = { ArrowUp: -5, ArrowDown: 5 }[e.key]; if (d) { e.preventDefault(); const v = Math.min(Math.max(filesH + d, 15), 85); setFilesH(v); store('bimp.filesH', String(v)); } },
  };
  const upload = () => (document.getElementById('plan-file') as HTMLInputElement | null)?.click();
  const tabKeys = (e: KeyboardEvent, list: string[]) => {
    const i = list.indexOf((e.currentTarget as HTMLElement).dataset.tab!), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = list[(i + d + list.length) % list.length];
    (e.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };
  const openCount = threads.filter((t) => !t.root.resolved).length;
  const count = (t: MPane) => (t === 'comments' ? openCount : t === 'revisions' ? data?.revisions.length ?? 0 : 0);
  const team = data?.project.team;
  const rev = viewRev ? data?.revisions.find((r) => r.id === viewRev) : null;
  const banner = compare
    ? <>Comparing <span class="mono">r{revOf(compare[0])}</span> → <span class="mono">r{revOf(compare[1])}</span><span class="cmp-key" aria-hidden="true"><span class="k add" />added <span class="k del" />removed <span class="k chg" />resized</span><button class="link" onClick={() => startCompare(null)}>Exit compare</button></>
    : rev ? <>Viewing <span class="mono">r{rev.rev}</span>{rev.note ? ` · ${rev.note}` : ''} · read-only<button class="link" onClick={() => view(null)}>Back to latest</button></> : null;
  const sheet = phone && mPane !== 'plan';
  const rightTab: Tab = phone && (mPane === 'comments' || mPane === 'revisions' || mPane === 'info') ? mPane : tab;
  const refused = (why: string[]) => setNotice(why);

  return (
    <>
      <PageHeader
        crumbs={[team ? { label: team.name, href: `#/team/${team.id}` } : { label: 'Personal', href: '#/personal' }]}
        title={data?.project.name ?? '…'}
        actions={data && <>
          <Menu label="Help" icon="help" class="help-menu" items={[
            { label: 'Welcome tour', onSelect: () => (tourStep.value = 0) },
            { label: tutorialOpen.value ? 'Hide the first-project guide' : 'First-project guide', onSelect: () => { tutorialOpen.value = !tutorialOpen.value; store('bimp.tutorial', tutorialOpen.value ? 'open' : 'closed'); } },
            { label: 'Keyboard shortcuts', hint: '?', onSelect: () => setShowKeys(true) },
          ]} />
          <button class="btn ghost sm hide-sm" onClick={upload}><Icon name="upload" size={16} />Add drawings</button>
          <span class="tb-sep hide-sm" aria-hidden="true" />
          <button class="icon-btn hide-sm" aria-pressed={leftOpen} aria-controls="ws-left" onClick={() => setLeftOpen(!leftOpen)} aria-label="Files and bimp AI panel" title={leftOpen ? 'Hide files and bimp AI' : 'Show files and bimp AI'}><Icon name="sidebar" /></button>
          <button class="icon-btn hide-sm flip-x" aria-pressed={rightOpen} aria-controls="ws-panel" onClick={() => setRightOpen(!rightOpen)} aria-label="Overview panel" title={rightOpen ? 'Hide overview panel' : 'Show overview panel'}><Icon name="sidebar" /></button>
        </>} />
      <main id="main" class="ws-main" tabIndex={-1}>
        {err && <p class="err pad-x" role="alert">{err} <button class="link small" onClick={() => setErr('')}>Dismiss</button></p>}
        {!data && !err && <div class="loading-block grow"><Spinner size={48} label="Loading project" /></div>}
        {data && (
          <>
            <div class={`ws3${leftOpen ? '' : ' no-left'}${rightOpen ? '' : ' no-right'} m-${mPane}${sheetFull ? ' sheet-full' : ''}`}
              style={{ '--left-w': `${leftW}px`, '--right-w': `${rightW}px`, '--files-h': `${filesH}%` }}>
              <aside ref={leftCol} class={`col col-left${sheet && (mPane === 'files' || mPane === 'chat') ? ' is-sheet' : ''}`} id="ws-left" aria-label="Files and bimp AI">
                {phone && <SheetGrip full={sheetFull} onFull={setSheetFull} onClose={() => setMPane('plan')} label={mPane === 'files' ? 'Files' : 'bimp AI'} />}
                <FileTree name={data.project.name} files={data.files as FileRow[]} revisions={data.revisions} plan={shownPlan} latestId={latestId} viewedId={compare ? null : shownId}
                  onViewRev={view} onAdd={upload} onRefused={refused} />
                <div class="row-handle" role="separator" aria-orientation="horizontal" tabIndex={0} aria-label="Resize files and chat"
                  aria-valuenow={filesH} aria-valuemin={15} aria-valuemax={85} {...rowResize} />
                <Chat projectId={id} messages={data.messages} hasPlan={!!data.plan} shared={!!team} resumeJob={data.jobs[0]?.id} onRefused={refused}
                  onMessages={(messages) => setData((d) => d && { ...d, messages })}
                  onPlan={(plan) => { setData((d) => d && { ...d, plan }); setViewRev(null); setCompare(null); load(); projectsVersion.value++; }} />
              </aside>
              <div class="ws-handle h-left" role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize files panel" aria-controls="ws-left"
                aria-valuenow={leftW} aria-valuemin={240} aria-valuemax={480} {...resizer(() => leftW, setLeftW, 'bimp.leftW', 240, () => Math.min(480, innerWidth * 0.3), 1)} />
              <CanvasPane plan={shownPlan} projectId={id} name={data.project.name} onUpload={upload} onRefused={refused} loading={!!(shownId && !shownPlan)}
                banner={banner} notice={notice} onNotice={() => setNotice([])} diff={diff} pins={compare ? [] : pins} activePin={active} onPin={onPin}
                tool={tool} onTool={setTool} canComment={canComment} onPlace={place} draft={draft} focusAt={focusAt} onRegion={markRegion}
                popover={draft && <PinComposer busy={posting} onSubmit={post} onCancel={() => setDraft(null)} />}
                onAsk={(q) => { chatPrompt.value = q; }}
                onChecks={() => { setTab('info'); requestAnimationFrame(() => document.getElementById('checks-h')?.focus()); }} />
              <div class="ws-handle h-right" role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize overview panel" aria-controls="ws-panel"
                aria-valuenow={rightW} aria-valuemin={280} aria-valuemax={560} {...resizer(() => rightW, setRightW, 'bimp.panelW', 280, () => Math.min(560, innerWidth * 0.35), -1)} />
              <aside class={`col col-right panel${sheet && (mPane === 'comments' || mPane === 'revisions' || mPane === 'info') ? ' is-sheet' : ''}`} id="ws-panel" aria-label="Project overview" data-tour="right">
                {phone && <SheetGrip full={sheetFull} onFull={setSheetFull} onClose={() => setMPane('plan')} label={TABS.find((t) => t[0] === rightTab)?.[1] ?? ''} />}
                <div class="p-tabs" role="tablist" aria-label="Panel">
                  {TABS.map(([t, l]) => (
                    <button key={t} id={`tab-${t}`} role="tab" data-tab={t} aria-selected={rightTab === t} aria-controls={`panel-${t}`} tabIndex={rightTab === t ? 0 : -1}
                      onKeyDown={(e) => tabKeys(e, TABS.map((x) => x[0]))} onClick={() => setTab(t)}>
                      {l}{!!count(t) && <span class="count">{count(t)}</span>}
                    </button>
                  ))}
                </div>
                <Comments projectId={id} comments={comments} onComments={(f) => setComments((c) => f(c ?? []))} hidden={rightTab !== 'comments'}
                  active={active} onActive={(cid) => openThread(cid)} viewedPlanId={shownId} revOf={revOf} roomName={roomName}
                  isOwner={data.project.role === 'owner'} onNew={() => setTool('comment')} onShowOn={(pid) => view(pid === latestId ? null : pid).then(() => openThread(active))}
                  errors={threadErr} setError={(cid, e) => setThreadErr((x) => ({ ...x, [cid]: e }))} />
                <Revisions revisions={data.revisions} latestId={latestId} viewedId={compare ? null : shownId} loading={loadingRev} compare={compare} diff={diff}
                  hidden={rightTab !== 'revisions'} onView={view} onCompare={startCompare}
                  onNote={async (rid, note) => {
                    const d = await api<{ revision: { note: string | null } }>(`/projects/${id}/revisions/${rid}`, { method: 'PATCH', json: { note } });
                    setData((x) => x && { ...x, revisions: x.revisions.map((r) => (r.id === rid ? { ...r, note: d.revision?.note ?? note } : r)) });
                    say('Note saved');
                  }} />
                {shownPlan
                  ? <InfoPanelHost plan={shownPlan} hidden={rightTab !== 'info'} />
                  : <section class="tabpanel" id="panel-info" role="tabpanel" aria-labelledby="tab-info" hidden={rightTab !== 'info'}><p class="muted small pad-x">No plan yet. Upload a drawing to see its rooms, areas and checks.</p></section>}
              </aside>
              {sheet && <div class="sheet-scrim" aria-hidden="true" onClick={() => setMPane('plan')} />}
              {tutorialOpen.value && <Tutorial data={data} comments={comments ?? []} isSample={data.plan?.method === 'sample' && !data.files.length} onTool={setTool} onUpload={upload} onTab={setTab} onPane={setMPane} phone={phone} />}
            </div>
            <nav class="m-bar" aria-label="Workspace" data-tour="mbar">
              {M_TABS.map(([t, l, ic]) => (
                <button key={t} type="button" aria-pressed={mPane === t} onClick={() => { setMPane(mPane === t && t !== 'plan' ? 'plan' : t); setSheetFull(false); }}>
                  <Icon name={ic} size={20} /><span>{l}</span>{!!count(t) && <span class="count">{count(t)}</span>}
                </button>
              ))}
            </nav>
          </>
        )}
      </main>
      {tourStep.value !== null && <Tour phone={phone} onPane={setMPane} />}
      {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
    </>
  );
}

function SheetGrip({ full, onFull, onClose, label }: { full: boolean; onFull(v: boolean): void; onClose(): void; label: string }) {
  const y0 = useRef<number | null>(null);
  return (
    <div class="sheet-grip" onPointerDown={(e) => { y0.current = e.clientY; }} onPointerUp={(e) => {
      if (y0.current === null) return;
      const d = e.clientY - y0.current; y0.current = null;
      if (d < -30) onFull(true); else if (d > 30) { if (full) onFull(false); else onClose(); }
    }}>
      <button type="button" class="grip-bar" aria-label={full ? `Shrink ${label}` : `Expand ${label}`} aria-expanded={full} onClick={() => onFull(!full)}><i /></button>
      <span class="sheet-title">{label}</span>
      <button type="button" class="icon-btn" aria-label={`Close ${label}`} onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
  );
}

/** Suggested furniture is per-session view state; it lives with the Overview tab and the canvas reads it. */
const suggestOn = signal(false);
function InfoPanelHost({ plan, hidden }: { plan: Plan; hidden: boolean }) {
  return <InfoPanel plan={plan} suggest={suggestOn.value} onSuggest={(v) => (suggestOn.value = v)} hidden={hidden} />;
}

// ---------------------------------------------------------------- canvas
type Mode = '2d' | '3d' | 'split';
type CanvasProps = {
  plan: Plan | null; projectId: string; name: string; loading: boolean; onUpload(): void; onRefused(why: string[]): void; onChecks(): void;
  banner: ComponentChildren; notice: string[]; onNotice(): void; diff: PlanDiff | null; pins: PinMark[]; activePin: string | null; onPin(id: string): void;
  tool: CanvasTool; onTool(t: CanvasTool): void; canComment: boolean; onPlace(p: Pt, roomId?: string): void; draft: Pt | null; focusAt: { p: Pt; key: number } | null;
  popover: ComponentChildren; onRegion(r: Region | null): void; onAsk(q: string): void;
};
const LAYER_LABEL: [keyof Layers, string][] = [['fills', 'Room fills'], ['furniture', 'Furniture and fittings'], ['dims', 'Dimensions'], ['labels', 'Room labels'], ['pins', 'Comment pins']];

function CanvasPane({ plan: drawn, projectId, name, loading, onUpload, onRefused, onChecks, banner, notice, onNotice, diff, pins, activePin, onPin, tool, onTool, canComment, onPlace, draft, focusAt, popover, onRegion, onAsk }: CanvasProps) {
  const [mode, setModeState] = useState<Mode>(() => stored('bimp.view', '2d' as Mode, (v) => ['2d', '3d', 'split'].includes(v), (v) => v as Mode));
  const setMode = (m: Mode) => { setModeState(m); store('bimp.view', m); };
  const [rot, setRot] = useState(0);
  const [source, setSource] = useState(false);
  const [walls, setWalls] = useState<'dollhouse' | 'cut' | 'full'>('dollhouse');
  const [proj, setProj] = useState<Projection>('persp');
  const [layers, setLayers] = useState<Layers>(() => ({ ...ALL_LAYERS, ...stored('bimp.layers', {}, (v) => v.startsWith('{'), (v) => JSON.parse(v)) }));
  const [menu, setMenu] = useState<(MenuAt & { kind: 'canvas' | 'layers' | 'view' }) | null>(null);
  const [over, setOver] = useState(false);
  const p2 = useRef<Plan2DApi | null>(null), p3 = useRef<Plan3DApi | null>(null);
  const suggest = suggestOn.value && !diff;
  const reg = region.value;
  const setLayer = (k: keyof Layers, v: boolean) => setLayers((l) => { const n = { ...l, [k]: v }; store('bimp.layers', JSON.stringify(n)); return n; });
  // pins and the comment tool live on the 2D plan
  useEffect(() => { if (tool === 'comment' && mode === '3d') setMode('2d'); if (tool === 'measure' && mode === '3d') setMode('2d'); }, [tool]);
  // 1 2 3: views; F: fit
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open], .cm, .tour-card')) return;
      const m = ({ 1: '2d', 2: '3d', 3: 'split' } as Record<string, Mode>)[e.key];
      if (m) { e.preventDefault(); setMode(m); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fit(); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  // Suggested furniture is shown alongside the drawing's own items and marked as a suggestion; never saved as drawing data.
  const plan = useMemo(() => (drawn && suggest ? { ...drawn, fixtures: [...(drawn.fixtures ?? []), ...suggestLayout(drawn)] } : drawn), [drawn, suggest]);
  const dropProps = {
    onDragEnter: (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) setOver(false); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); const fs = e.dataTransfer?.files; if (fs?.length) { const no = queueFiles([...fs]); if (no.length) onRefused(no); } },
  };
  const noticeBar = notice.length > 0 && (
    <div class="plan-banner warn-banner" role="alert">
      <span><b>Not added:</b> {notice.join(' · ')}</span><button class="link" onClick={onNotice}>Dismiss</button>
    </div>
  );
  if (loading) return <section class="canvas empty-canvas" id="pane-canvas" aria-label="Canvas"><Spinner size={40} label="Loading revision" /></section>;
  if (!plan) return (
    <section class={`canvas empty-canvas${over ? ' over' : ''}`} id="pane-canvas" aria-label="Canvas" data-tour="canvas" {...dropProps}>
      {noticeBar}
      <div class="drop">
        <h2>No drawing yet</h2>
        <p class="muted">Drop a floor plan here or on the file list. bimp reads it into rooms, walls and openings, drawn here in 2D and 3D.</p>
        <button class="btn sm" onClick={onUpload}><Icon name="upload" size={16} />Add a floor plan</button>
        <p class="muted small">PDF, DXF, PNG, JPG or WebP · up to 50 MB</p>
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
  const fit = () => { if (mode !== '3d') p2.current?.fit(); if (mode !== '2d') p3.current?.view('iso'); };
  const roomAsk = (rid: string) => { const r = plan.rooms.find((x) => x.id === rid); if (r) { selectedRooms.value = [rid]; onAsk(`Tell me about the ${r.name}: its size, doors, windows and fittings.`); } };
  const roomRegion = (rid: string) => {
    const r = plan.rooms.find((x) => x.id === rid);
    if (!r) return;
    const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
    onRegion({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  };
  const openMenu = (m: MenuAt) => setMenu({ ...m, kind: 'canvas' });
  const btnMenu = (kind: 'layers' | 'view') => (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(menu?.kind === kind ? null : { x: r.left, y: r.bottom + 4, p: null, roomId: null, kind });
  };
  const toolItems = TOOLS.map(([t, l, ic, k]) => ({ label: t === 'comment' && menu?.p ? 'Comment here' : l, icon: ic, hint: k, checked: undefined as boolean | undefined, disabled: t === 'comment' && !canComment,
    onSelect: () => { if (t === 'comment' && menu?.p) { onTool('comment'); setMode(mode === '3d' ? '2d' : mode); onPlace(menu.p, menu.roomId ?? undefined); } else onTool(t); } }));
  const viewItems: CmSection['items'] = [
    ...(['2d', '3d', 'split'] as Mode[]).map((m, i) => ({ label: m === 'split' ? 'Split 2D and 3D' : `${m.toUpperCase()} view`, hint: String(i + 1), checked: mode === m, onSelect: () => setMode(m) })),
    { label: 'Fit to view', icon: 'fit', hint: 'F', onSelect: fit },
    ...(mode !== '3d' ? [
      { label: 'Dimensioned drawing', checked: p2.current?.mode() === 'dims', onSelect: () => p2.current?.setMode(p2.current.mode() === 'dims' ? 'plan' : 'dims') },
      { label: 'Escape routes', checked: !!p2.current?.escape(), onSelect: () => p2.current?.toggleEscape() },
      { label: 'Print to scale…', icon: 'file', onSelect: () => p2.current?.print() },
    ] : []),
    ...(show3d ? [
      ...([['iso', 'Isometric'], ['top', 'Top'], ['front', 'Front (south)'], ['side', 'Side (east)'], ['eye', 'Low angle']] as [ViewPreset, string][]).map(([v, l]) => ({ label: `${l} view`, icon: 'orbit', onSelect: () => p3.current?.view(v) })),
      { label: 'Parallel projection', checked: proj === 'ortho', onSelect: () => setProj(proj === 'ortho' ? 'persp' : 'ortho') },
      { label: 'Generate an image of this view…', icon: 'sparkle', onSelect: () => (visualsOpen.value = true) },
    ] : []),
  ];
  const layerItems: CmSection['items'] = [
    ...LAYER_LABEL.map(([k, l]) => ({ label: l, checked: layers[k], onSelect: () => setLayer(k, !layers[k]) })),
    ...((plan.source?.renderSha || plan.source?.mime.startsWith('image/')) && !diff ? [{ label: 'Source drawing underlay', checked: source, onSelect: () => setSource(!source) }] : []),
  ];
  const room = menu?.roomId ? plan.rooms.find((r) => r.id === menu.roomId) : null;
  const sections: CmSection[] = !menu ? [] : menu.kind === 'layers' ? [{ title: 'Layers', items: layerItems }] : menu.kind === 'view' ? [{ title: 'View', items: viewItems }] : [
    ...(room ? [{ title: room.name, items: [
      { label: 'Ask bimp about this room', icon: 'sparkle', onSelect: () => roomAsk(room.id) },
      { label: 'Mark this room as the region', icon: 'region', onSelect: () => roomRegion(room.id) },
      { label: selectedRooms.value.includes(room.id) ? 'Deselect room' : 'Select room', icon: 'cursor', onSelect: () => { selectedRooms.value = selectedRooms.value.includes(room.id) ? [] : [room.id]; } },
    ] }] : []),
    { title: 'Tools', items: [
      ...toolItems,
      ...(reg ? [{ label: 'Clear the region', icon: 'close', onSelect: () => onRegion(null) }] : []),
      ...(p2.current?.measures() ? [{ label: 'Clear measurements', icon: 'close', onSelect: () => p2.current?.clearMeasures() }] : []),
    ] },
    { title: 'View', items: viewItems },
    { title: 'Layers', items: layerItems },
    ...(menu.p ? [{ items: [{ label: `Copy point (${menu.p[0].toFixed(2)}, ${menu.p[1].toFixed(2)} m)`, icon: 'copy', onSelect: () => { navigator.clipboard?.writeText(`x ${menu.p![0].toFixed(3)} m, y ${menu.p![1].toFixed(3)} m`).then(() => say('Point copied')).catch(() => {}); } }] }] : []),
  ];

  return (
    <section class={`canvas${tool !== 'select' ? ` tool-${tool}` : ''}${over ? ' over' : ''}`} id="pane-canvas" aria-label="Canvas" data-tour="canvas" {...dropProps}>
      <div class="toolbar">
        <div class="seg sm" role="group" aria-label="View">
          {(['2d', '3d', 'split'] as Mode[]).map((m, i) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} title={`${m === 'split' ? 'Split' : m.toUpperCase()} (${i + 1})`}>{m === 'split' ? 'Split' : m.toUpperCase()}</button>
          ))}
        </div>
        <div class="seg sm tools" role="group" aria-label="Tools" data-tour="tools">
          {TOOLS.map(([t, l, ic, k, tip]) => (
            <button key={t} aria-pressed={tool === t} onClick={() => onTool(tool === t && t !== 'select' ? 'select' : t)} disabled={t === 'comment' && !canComment}
              title={`${l} (${k}): ${t === 'comment' && !canComment ? 'exit compare to comment' : tip}`} aria-keyshortcuts={k}>
              <Icon name={ic} size={16} /><span class="tool-l">{l}</span>
            </button>
          ))}
        </div>
        {show3d && (<>
          <div class="seg sm hide-sm" role="group" aria-label="3D camera">
            <button onClick={() => setRot((r) => r - 1)} title="Orbit left 90°" aria-label="Orbit left">⟲</button>
            <button onClick={() => setRot((r) => r + 1)} title="Orbit right 90°" aria-label="Orbit right">⟳</button>
            <button aria-pressed={proj === 'ortho'} onClick={() => setProj(proj === 'ortho' ? 'persp' : 'ortho')} title="Parallel projection (no perspective)">Parallel</button>
          </div>
          <div class="seg sm hide-sm" role="group" aria-label="Walls">
            {([['dollhouse', 'Dollhouse', 'Walls facing the camera lowered, the rest full height'], ['cut', 'Cut 1.2 m', 'All walls cut at 1.2 m, like a plan section'], ['full', 'Full', 'All walls full height']] as const).map(([m, label, title]) => (
              <button key={m} aria-pressed={walls === m} title={title} onClick={() => setWalls(m)}>{label}</button>
            ))}
          </div>
        </>)}
        <button class="tool" onClick={() => { if (mode === '2d') setMode('3d'); visualsOpen.value = true; }} title="Generate architectural images from the 3D model (Cloudinary)"><Icon name="sparkle" size={16} /><span class="tool-l">Images</span></button>
        <button class="tool" onClick={btnMenu('view')} aria-haspopup="menu" aria-expanded={menu?.kind === 'view'}><Icon name="view" size={16} /><span class="tool-l">View</span></button>
        <button class="tool" onClick={btnMenu('layers')} aria-haspopup="menu" aria-expanded={menu?.kind === 'layers'}><Icon name="layers" size={16} /><span class="tool-l">Layers</span></button>
        <span class="spacer" />
        <span class={`pill${plan.measured ? ' ok' : ' warn'}`} title={plan.assumptions.join('\n')}>
          {plan.measured ? `Measured · ${plan.scale.source}` : 'Preview, not measured'}
        </span>
      </div>
      {noticeBar}
      {banner && <div class="plan-banner" role="status">{banner}</div>}
      {tool !== 'select' && (
        <div class="tool-hint" aria-hidden="true">
          {{ comment: 'Click the plan to pin a comment', region: 'Drag over the area to ask about', measure: 'Click two points · Shift keeps it straight' }[tool]} · Esc to stop
        </div>
      )}

      <div class={`views mode-${mode}`}>
        {mode !== '3d' && (
          <div class="view">
            <Plan2D plan={plan} sourceUrl={sourceUrl} title={name} pins={pins} activePin={activePin} onPin={onPin}
              placing={tool === 'comment' && canComment} onPlace={onPlace} draft={draft} popover={popover} diff={diff} focusAt={focusAt}
              tool={tool} region={reg} onRegion={onRegion} layers={layers} apiRef={p2} onMenu={openMenu} />
          </div>
        )}
        {mode !== '2d' && (
          <div class="view">
            <Plan3D plan={plan} rotation={rot} walls={walls} furniture={layers.furniture} labels={layers.labels} projection={proj}
              tool={tool === 'region' ? 'region' : 'select'} region={reg} onRegion={onRegion} apiRef={p3} onMenu={openMenu} />
            <div class="nav-hint" aria-hidden="true">Drag to orbit · right-drag to pan · scroll to zoom</div>
          </div>
        )}
        <div class="hover-readout" aria-hidden="true">
          {focus
            ? <><i class="sw" style={{ background: ROOM_COLORS[focus.type] }} /><b>{focus.name}</b> · {focus.type} · <span class="mono">{round(area(focus.polygon), 1)} m²</span></>
            : <span class="muted">{matchMedia('(pointer: coarse)').matches ? 'Tap a room · press and hold for tools' : 'Hover a room · right-click or double-click for tools'}</span>}
        </div>
        {reg && <RegionCard plan={plan} r={reg} onClear={() => onRegion(null)} onAsk={onAsk} />}
        {over && <div class="drop-veil" aria-hidden="true"><Icon name="upload" size={22} /><b>Drop to add to {name}</b><span>Each drawing becomes the next revision</span></div>}
      </div>

      <div class="legend small">
        <button class={`link small checks-btn${warns ? ' has' : ''}`} onClick={onChecks}>
          {warns ? <><span aria-hidden="true">△ </span>{warns} check{warns > 1 ? 's' : ''} to review</> : `Checks (${checks.length})`}
        </button>
        {types.map((t) => <span key={t} class="lg-type"><i class="sw" style={{ background: ROOM_COLORS[t] }} />{t}</span>)}
        <span class="muted">· {plan.rooms.length} rooms · <span class="mono">{plan.width} × {plan.height} m</span></span>
      </div>
      {visualsOpen.value && <VisualsDialog projectId={projectId} snapshot={mode !== '2d' ? () => p3.current?.snapshot() ?? null : null}
        onShow3D={() => setMode('3d')} onClose={() => (visualsOpen.value = false)} />}
      {menu && <CanvasMenu x={menu.x} y={menu.y} title={menu.kind === 'canvas' ? (room ? room.name : 'Plan') : undefined} sections={sections} onClose={() => setMenu(null)} />}
    </section>
  );
}

/** What the marked region holds, computed from the geometry, with questions scoped to it. */
function RegionCard({ plan, r, onClear, onAsk }: { plan: Plan; r: Region; onClear(): void; onAsk(q: string): void }) {
  const c = useMemo(() => regionContents(plan, r), [plan, r]);
  const { w, h, area: a } = regionSize(r);
  const doors = c.openings.filter((o) => o.kind === 'door').length, windows = c.openings.length - doors;
  const floor = round(c.rooms.reduce((s, x) => s + x.area_in_region_m2, 0), 2);
  const qs = ['What is in this area?', 'What is the floor area of each room here?', 'Do the rooms here meet the minimum sizes?'];
  return (
    <div class="region-card" role="region" aria-label="Marked region">
      <div class="rc-head">
        <span class="scope-k" aria-hidden="true" />
        <b>Region</b><span class="mono muted">{w.toFixed(2)} × {h.toFixed(2)} m · {a} m²</span>
        <span class="spacer" />
        <button class="icon-btn xs" onClick={onClear} aria-label="Clear the region" title="Clear the region (questions cover the whole plan again)"><Icon name="close" size={14} /></button>
      </div>
      <ul class="rc-rooms">
        {c.rooms.length ? c.rooms.map((x) => (
          <li key={x.id}><i class="sw" style={{ background: ROOM_COLORS[x.type] }} aria-hidden="true" />{x.name}
            <span class="mono muted">{x.area_in_region_m2} m²{x.share_of_room < 0.98 ? ` · ${Math.round(x.share_of_room * 100)}%` : ''}</span></li>
        )) : <li class="muted">No rooms inside</li>}
      </ul>
      <p class="small muted rc-sum">Floor inside <span class="mono">{floor} m²</span> · {doors} door{doors === 1 ? '' : 's'} · {windows} window{windows === 1 ? '' : 's'} · {c.fixtures.length} fitting{c.fixtures.length === 1 ? '' : 's'}</p>
      <div class="chips">{qs.map((q) => <button key={q} type="button" class="chip" onClick={() => onAsk(q)}>{q}</button>)}</div>
      <p class="small muted rc-note">bimp AI answers from inside this region only.</p>
    </div>
  );
}
