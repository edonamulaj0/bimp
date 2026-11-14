import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CanvasTool } from './canvas/Plan2D';
import { newProject, tourStep, tutorialOpen } from './state';
import { Icon } from './icons';
import { Dialog } from './ui';
import type { Comment, ProjectData } from './types';

const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

type Step = { target?: string; title: string; body: string; pane?: 'files' | 'chat' | 'plan' };
const DESKTOP: Step[] = [
  { title: 'Welcome to your workspace', body: 'Three columns, like an editing suite: your files and bimp AI on the left, the drawing in the middle, the project overview on the right. Drag the dividers to size them; the buttons top right hide either side.' },
  { target: '[data-tour="files"]', title: 'Files and drop zone', body: 'Every drawing, revision and room in the project, as a tree. Drop PDFs, DXF files or scans anywhere on it; each one is read into the next revision. Click a room to find it on the plan.' },
  { target: '[data-tour="chat"]', title: 'bimp AI, docked', body: 'Ask about the plan in your own words while you look at it. Every answer lists the rooms it came from, and numbers that can\'t be traced to the plan are marked unverified.' },
  { target: '[data-tour="canvas"]', title: 'The canvas', body: 'The plan in 2D, the model in 3D, or both side by side (keys 1, 2, 3). In 3D, drag to orbit, right-drag to pan and scroll to zoom. Right-click or double-click anywhere for tools, layers and views.' },
  { target: '[data-tour="tools"]', title: 'Tools', body: 'Select (V), Comment (C) to pin a thread to a spot, Measure (M) between snapped points, and Markup (R): drag a region and bimp AI answers from what lies inside it only.' },
  { target: '[data-tour="right"]', title: 'Overview', body: 'Comments, revisions you can compare, and the project overview with areas and design-standard checks.' },
  { target: '.help-menu', title: 'Help is here', body: 'Replay this tour, see keyboard shortcuts, or follow the first-project guide to set up a project of your own from scratch.' },
];
const PHONE: Step[] = [
  { title: 'Welcome to your workspace', body: 'The drawing fills the screen. Files, bimp AI, comments and the overview open as sheets from the bar at the bottom; swipe a sheet up to expand it, down to close it.' },
  { target: '[data-tour="mbar"]', title: 'Everything one tap away', body: 'Plan, Files (drop or pick drawings), Ask (bimp AI), Comments and Overview. The badge counts open comments.' },
  { target: '[data-tour="canvas"]', title: 'The canvas', body: 'Pinch to zoom and drag to pan; in 3D, one finger orbits and two fingers pan. Press and hold for tools, layers and views.' },
  { target: '[data-tour="tools"]', title: 'Tools', body: 'Comment pins a thread to a spot. Markup marks a region so bimp AI answers from inside it only. Measure snaps to corners.' },
  { target: '.help-menu', title: 'Help is here', body: 'Replay this tour or follow the first-project guide.' },
];

/** The welcome tour: a spotlight on each part of the workspace with a short card. Arrow keys step, Escape ends. */
export function Tour({ phone, onPane }: { phone: boolean; onPane(p: 'plan'): void }) {
  const steps = phone ? PHONE : DESKTOP;
  const i = Math.min(tourStep.value ?? 0, steps.length - 1), s = steps[i];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => { tourStep.value = null; store('bimp.toured', '1'); };
  const go = (n: number) => { if (n < 0) return; if (n >= steps.length) close(); else tourStep.value = n; };
  useEffect(() => { onPane('plan'); }, []);
  useLayoutEffect(() => {
    const measure = () => {
      const el = s.target ? document.querySelector<HTMLElement>(s.target) : null;
      const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      setRect(r && r.width > 0 ? r : null);
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [i, phone]);
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const w = c.offsetWidth, h = c.offsetHeight, m = 12, W = innerWidth, H = innerHeight;
    if (!rect || phone) { setPos(phone ? null : { left: (W - w) / 2, top: (H - h) / 2 }); return; }
    const clampY = (y: number) => Math.max(m, Math.min(y, H - h - m)), clampX = (x: number) => Math.max(m, Math.min(x, W - w - m));
    if (rect.right + m + w < W) setPos({ left: rect.right + m, top: clampY(rect.top) });
    else if (rect.left - m - w > 0) setPos({ left: rect.left - m - w, top: clampY(rect.top) });
    else if (rect.bottom + m + h < H) setPos({ left: clampX(rect.left), top: rect.bottom + m });
    else setPos({ left: clampX(rect.left), top: Math.max(m, rect.top - m - h) });
  }, [rect, i, phone]);
  useEffect(() => { card.current?.querySelector<HTMLElement>('.tour-next')?.focus(); }, [i]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  };
  const last = i === steps.length - 1;
  return (
    <div class="tour" onKeyDown={keys}>
      {rect
        ? <div class="tour-spot" aria-hidden="true" style={{ left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` }} />
        : <div class="tour-dim" aria-hidden="true" />}
      <div ref={card} class={`tour-card${phone ? ' as-sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tour-h" aria-describedby="tour-b"
        style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : undefined}>
        <div class="tour-top">
          <span class="tour-n mono" aria-label={`Step ${i + 1} of ${steps.length}`}>{String(i + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          <button type="button" class="icon-btn xs" aria-label="End the tour" onClick={close}><Icon name="close" size={14} /></button>
        </div>
        <h2 id="tour-h">{s.title}</h2>
        <p id="tour-b">{s.body}</p>
        <div class="tour-bar" aria-hidden="true"><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
        <div class="tour-actions">
          {i > 0 ? <button type="button" class="btn ghost sm" onClick={() => go(i - 1)}>Back</button> : <button type="button" class="link small" onClick={close}>Skip tour</button>}
          <span class="spacer" />
          {last && <button type="button" class="btn ghost sm" onClick={() => { close(); tutorialOpen.value = true; store('bimp.tutorial', 'open'); }}>First-project guide</button>}
          <button type="button" class="btn sm tour-next" onClick={() => go(i + 1)}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}

type TStep = { key: string; title: string; body: string; done: boolean; action?: [string, () => void] };

/**
 * The first-project guide: a checklist that follows a new project from creation to its first labelled revision.
 * Steps tick themselves off from the project's own data.
 */
export function Tutorial({ data, comments, isSample, onTool, onUpload, onTab, onPane, phone }: {
  data: ProjectData; comments: Comment[]; isSample: boolean; onTool(t: CanvasTool): void; onUpload(): void;
  onTab(t: 'info' | 'revisions'): void; onPane(p: 'chat' | 'files' | 'plan'): void; phone: boolean;
}) {
  const pid = data.project.id;
  const [checked, setChecked] = useState(() => read(`bimp.tut.${pid}.check`) === '1');
  const [min, setMin] = useState(false);
  useEffect(() => setChecked(read(`bimp.tut.${pid}.check`) === '1'), [pid]);
  const asked = data.messages.filter((m) => m.role === 'user' && !/^Uploaded /.test(m.content.text));
  const hasDrawing = !!data.plan && data.files.length > 0;
  const focusChat = () => { if (phone) onPane('chat'); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()); };
  const steps: TStep[] = [
    { key: 'project', title: 'Create a project of your own', body: isSample ? 'The pilot house is for exploring. Your own project starts empty; name it after the job.' : 'Done: this project is yours.', done: !isSample,
      action: ['New project', () => (newProject.value = data.project.team?.id ?? 'personal')] },
    { key: 'drawing', title: 'Add a floor plan', body: 'Drop a PDF, DXF or scan on Files. bimp reads walls, rooms and openings and builds the 2D plan and 3D model.', done: hasDrawing,
      action: ['Add drawings', () => { if (phone) onPane('files'); onUpload(); }] },
    { key: 'check', title: 'Check how it was read', body: 'Open the Overview: the scale source, room areas and checks. A preview (not measured) means sizes are approximate.', done: hasDrawing && checked,
      action: ['Open the overview', () => { onTab('info'); setChecked(true); store(`bimp.tut.${pid}.check`, '1'); }] },
    { key: 'ask', title: 'Ask bimp a question', body: 'For example "What is the total floor area?" or "How many windows does bedroom 2 have?"', done: hasDrawing && asked.some((m) => !m.content.region),
      action: ['Ask', focusChat] },
    { key: 'region', title: 'Mark a region and ask about it', body: 'Pick Markup (R), drag over part of the plan, then ask. The answer uses only what lies inside.', done: hasDrawing && asked.some((m) => !!m.content.region),
      action: ['Markup tool', () => onTool('region')] },
    { key: 'comment', title: 'Pin a comment', body: 'Pick Comment (C) and click the spot you mean. Tick "Ask bimp" to get an answer in the thread.', done: hasDrawing && comments.length > 0,
      action: ['Comment tool', () => onTool('comment')] },
    { key: 'label', title: 'Label the revision', body: 'In Revisions, give the drawing issue a short note, like "Stage 2 issue". The next upload becomes r2, and you can compare them.', done: data.revisions.some((r) => !!r.note),
      action: ['Open revisions', () => onTab('revisions')] },
  ];
  const n = steps.filter((s) => s.done).length, next = steps.find((s) => !s.done);
  const close = () => { tutorialOpen.value = false; store('bimp.tutorial', 'closed'); };
  return (
    <aside class={`tutorial${min ? ' min' : ''}`} aria-labelledby="tut-h">
      <div class="tut-head">
        <h2 id="tut-h">First-project guide</h2>
        <span class="mono muted small">{n}/{steps.length}</span>
        <span class="spacer" />
        <button type="button" class="icon-btn xs" aria-expanded={!min} aria-label={min ? 'Expand the guide' : 'Collapse the guide'} onClick={() => setMin(!min)}><Icon name="chevron" size={14} /></button>
        <button type="button" class="icon-btn xs" aria-label="Close the guide" onClick={close}><Icon name="close" size={14} /></button>
      </div>
      <div class="tour-bar" aria-hidden="true"><i style={{ width: `${(n / steps.length) * 100}%` }} /></div>
      {!min && (
        <ol class="tut-steps">
          {steps.map((s, k) => {
            const cur = s === next;
            return (
              <li key={s.key} class={`${s.done ? 'done' : ''}${cur ? ' cur' : ''}`} aria-current={cur ? 'step' : undefined}>
                <span class="tut-mark" aria-hidden="true">{s.done ? <Icon name="check" size={12} /> : k + 1}</span>
                <div>
                  <b>{s.title}</b><span class="sr-only">{s.done ? ' (done)' : ''}</span>
                  {cur && <p class="small muted">{s.body}</p>}
                  {cur && s.action && <button type="button" class="btn sm" onClick={s.action[1]}>{s.action[0]}</button>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {!min && !next && <p class="small tut-done">All set. This project is ready for your team.</p>}
    </aside>
  );
}

const KEYS: [string, string][] = [
  ['V', 'Select'], ['C', 'Comment tool'], ['R', 'Markup region'], ['M', 'Measure'], ['Esc', 'Back to Select'],
  ['1 · 2 · 3', '2D · 3D · Split'], ['F', 'Fit to view'], ['+ / −', 'Zoom'], ['Arrows', 'Pan (2D), orbit (3D)'], ['Shift + arrows', 'Pan (3D)'],
  ['Right-click · double-click', 'Tools, layers and views'], ['?', 'This list'],
];
export function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div class="dlg-body"><dl class="keys">{KEYS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl></div>
    </Dialog>
  );
}
