import { useEffect, useRef, useState } from 'preact/hooks';
import type { RoomType } from '../../shared/plan';
import { api } from './api';
import { go } from './state';
import { Topbar } from './Topbar';
import { Spinner } from './brand';
import { ROOM_COLORS } from './canvas/colors';

type Thumb = { w: number; h: number; measured: boolean; method: string; rooms: { t: RoomType; p: [number, number][] }[]; net_m2: number };
type P = { id: string; name: string; updated_at: number; files: number; has_plan: number; thumb: Thumb | null };

const when = (t: number) => {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

/** The project's plan as a small drawing: room fills and outlines, nothing else. */
function PlanThumb({ t }: { t: Thumb }) {
  const pad = Math.max(t.w, t.h) * 0.06;
  return (
    <svg viewBox={`${-pad} ${-pad} ${t.w + 2 * pad} ${t.h + 2 * pad}`} aria-hidden="true">
      {t.rooms.map((r, i) => (
        <polygon key={i} points={r.p.map((q) => q.join(',')).join(' ')} fill={ROOM_COLORS[r.t] ?? '#ddd'} fill-opacity="0.55"
          stroke="var(--ink)" stroke-width={Math.max(t.w, t.h) / 90} stroke-linejoin="miter" />
      ))}
    </svg>
  );
}

export function Projects() {
  const [list, setList] = useState<P[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const cards = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { document.title = 'Projects · bimp'; api<{ projects: P[] }>('/projects').then((d) => setList(d.projects)).catch((e) => setErr(e.message)); }, []);

  async function create(e: Event) {
    e.preventDefault();
    try { const d = await api('/projects', { json: { name } }); go(`#/p/${d.project.id}`); }
    catch (e) { setErr((e as Error).message); }
  }
  async function remove(p: P) {
    if (!confirm(`Delete "${p.name}" and its files? This can't be undone.`)) return;
    const i = list?.findIndex((x) => x.id === p.id) ?? -1;
    try { await api(`/projects/${p.id}`, { method: 'DELETE' }); setErr(''); setList((l) => l?.filter((x) => x.id !== p.id) ?? null); }
    catch (e) { return setErr(`Couldn't delete "${p.name}": ${(e as Error).message}`); }
    // keep the keyboard in place: the next card (or the previous one), else the new-project field
    requestAnimationFrame(() => {
      const links = cards.current?.querySelectorAll<HTMLElement>('.card-link');
      (links?.[Math.min(i, links.length - 1)] ?? input.current)?.focus();
    });
  }
  const total = list?.reduce((s, p) => s + (p.thumb?.net_m2 ?? 0), 0) ?? 0;

  return (
    <div class="page">
      <Topbar />
      <main class="projects" id="main">
        <header class="dash-head">
          <div>
            <p class="label">Workspace</p>
            <h1 tabIndex={-1}>Projects</h1>
          </div>
          {list && (
            <div class="dash-stats" aria-label="Summary">
              <div><b>{list.length}</b><span class="label">projects</span></div>
              <div><b>{list.filter((p) => p.has_plan).length}</b><span class="label">plans</span></div>
              <div><b>{Math.round(total)}</b><span class="label">m² read</span></div>
            </div>
          )}
        </header>

        <form class="new-form" onSubmit={create}>
          <label for="pname" class="sr-only">New project name</label>
          <input id="pname" ref={input} placeholder="Name a new project, e.g. Riverside block B" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={120} />
          <button class="btn" disabled={!name.trim()}>New project</button>
        </form>
        <p class="err" role="alert">{err}</p>

        {list === null && !err && <div class="loading-block"><Spinner /></div>}
        {list?.length === 0 && <p class="muted">No projects yet. Name one above, then upload a drawing in it.</p>}
        <div class="cards" ref={cards}>
          {list?.map((p) => (
            <article class="card" key={p.id}>
              <div class="card-thumb">{p.thumb ? <PlanThumb t={p.thumb} /> : <span class="none">No plan yet</span>}</div>
              <div class="card-body">
                <a class="card-link" href={`#/p/${p.id}`}><h2>{p.name}</h2></a>
                <div class="card-meta">
                  {p.thumb ? <>
                    <span>{p.thumb.rooms.length} rooms</span><span>{p.thumb.net_m2} m²</span>
                    <span class={`tag ${p.thumb.measured ? 'ok' : 'warn'}`}>{p.thumb.method === 'sample' ? 'Sample' : p.thumb.measured ? 'Measured' : 'Preview'}</span>
                  </> : <span>{p.files} file{p.files === 1 ? '' : 's'}</span>}
                </div>
                <p class="card-meta">Updated {when(p.updated_at)}</p>
              </div>
              <button class="card-del" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>Delete</button>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
