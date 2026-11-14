import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { newProject, projectsVersion, say, teams } from './state';
import { PageHeader } from './Shell';
import { Spinner } from './brand';
import { ROOM_COLORS } from './canvas/colors';
import { Icon } from './icons';
import { Dialog, Menu, fullDate, when } from './ui';
import type { ProjectRow, Thumb } from './types';

type View = 'list' | 'grid';

/** The project's plan as a small drawing: room fills and outlines, nothing else. */
export function PlanThumb({ t }: { t: Thumb }) {
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

export function Projects({ team }: { team: string | null }) {
  const [list, setList] = useState<ProjectRow[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>(() => { try { return localStorage.getItem('bimp.projectsView') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<ProjectRow | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const t = teams.value.find((x) => x.id === team);
  const title = team === null ? 'All projects' : team === 'personal' ? 'Personal' : t?.name ?? 'Team';
  useEffect(() => { document.title = `${title} · bimp`; }, [title]);
  useEffect(() => {
    api<{ projects: ProjectRow[] }>(`/projects${team ? `?team=${encodeURIComponent(team)}` : ''}`).then((d) => setList(d.projects)).catch((e) => setErr(e.message));
  }, [team, projectsVersion.value]);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem('bimp.projectsView', v); } catch { /* private mode */ } };

  async function rename(p: ProjectRow, name: string) {
    setRenaming(null);
    name = name.trim();
    if (!name || name === p.name) return;
    try { await api(`/projects/${p.id}`, { method: 'PATCH', json: { name } }); setList((l) => l?.map((x) => (x.id === p.id ? { ...x, name } : x)) ?? null); say(`Renamed to ${name}`); }
    catch (e) { setErr(`Couldn't rename "${p.name}": ${(e as Error).message}`); }
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-id="${p.id}"] .row-link`)?.focus());
  }
  async function remove(p: ProjectRow) {
    if (!confirm(`Delete "${p.name}" with its drawings, revisions and comments? This can't be undone.`)) return;
    const i = shown.findIndex((x) => x.id === p.id);
    try { await api(`/projects/${p.id}`, { method: 'DELETE' }); setErr(''); setList((l) => l?.filter((x) => x.id !== p.id) ?? null); say(`Deleted ${p.name}`); }
    catch (e) { return setErr(`Couldn't delete "${p.name}": ${(e as Error).message}`); }
    // keep the keyboard in place: the next project (or the previous one), else the heading
    requestAnimationFrame(() => {
      const links = box.current?.querySelectorAll<HTMLElement>('.row-link');
      (links?.[Math.min(i, links.length - 1)] ?? document.querySelector<HTMLElement>('h1[tabindex="-1"]'))?.focus();
    });
  }
  async function move(p: ProjectRow, to: string) {
    const team_id = to === 'personal' ? null : to;
    try {
      await api(`/projects/${p.id}`, { method: 'PATCH', json: { team_id } });
      const nt = teams.value.find((x) => x.id === to);
      setList((l) => l?.map((x) => (x.id === p.id ? { ...x, team: nt ? { id: nt.id, name: nt.name } : null } : x)).filter((x) => !team || team === (x.team?.id ?? 'personal')) ?? null);
      setMoving(null); say(`Moved ${p.name} to ${nt?.name ?? 'Personal'}`);
    } catch (e) { setErr(`Couldn't move "${p.name}": ${(e as Error).message}`); setMoving(null); }
  }

  const shown = (list ?? []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const items = (p: ProjectRow) => [
    { label: 'Open', onSelect: () => (location.hash = `#/p/${p.id}`) },
    { label: 'Rename…', onSelect: () => setRenaming(p.id) },
    { label: 'Move to team…', onSelect: () => setMoving(p), disabled: p.role !== 'owner', hint: p.role !== 'owner' ? 'Only the owner can move it' : undefined },
    'sep' as const,
    { label: 'Delete…', onSelect: () => remove(p), danger: true, disabled: p.role !== 'owner', hint: p.role !== 'owner' ? 'Only the owner can delete it' : undefined },
  ];
  const nameCell = (p: ProjectRow) => renaming === p.id
    ? <RenameInput value={p.name} onDone={(v) => (v === null ? (setRenaming(null), requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-id="${p.id}"] .row-link`)?.focus())) : rename(p, v))} />
    : <a class="row-link" href={`#/p/${p.id}`}>{p.name}</a>;
  const status = (p: ProjectRow) => p.thumb ? (p.thumb.method === 'sample' ? 'Sample' : p.thumb.measured ? 'Measured' : 'Preview') : p.files ? 'Reading' : 'No drawing';

  return (
    <>
      <PageHeader crumbs={team && team !== 'personal' ? [{ label: 'Teams' }] : []} title={title}
        actions={<>
          {t && <a class="btn ghost sm" href={`#/team/${t.id}/settings`}><Icon name="team" size={16} />Members</a>}
          <button class="btn sm" onClick={() => (newProject.value = team ?? 'personal')}><Icon name="plus" size={16} /><span class="hide-sm">New project</span><span class="sr-only show-sm">New project</span></button>
        </>} />
      <main class="page-body projects" id="main" tabIndex={-1}>
        <div class="list-tools">
          <label class="search"><span class="sr-only">Filter projects</span>
            <input type="search" placeholder="Filter projects" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label>
          <span class="muted small count" aria-live="polite">{list ? `${shown.length} project${shown.length === 1 ? '' : 's'}` : ''}</span>
          <span class="spacer" />
          <div class="seg sm" role="group" aria-label="Layout">
            <button aria-pressed={view === 'list'} onClick={() => pickView('list')} aria-label="List" title="List"><Icon name="list" size={16} /></button>
            <button aria-pressed={view === 'grid'} onClick={() => pickView('grid')} aria-label="Grid with plans" title="Grid with plans"><Icon name="grid" size={16} /></button>
          </div>
        </div>
        <p class="err" role="alert">{err}</p>
        {list === null && !err && <div class="loading-block"><Spinner /></div>}
        {list?.length === 0 && (
          <div class="empty-state">
            <h2>No projects {team === 'personal' ? 'of your own ' : team ? 'in this team ' : ''}yet</h2>
            <p class="muted">Create a project, then upload a floor plan (PDF, DXF or an image). bimp reads it into rooms, walls and openings you can ask about.</p>
            <button class="btn sm" onClick={() => (newProject.value = team ?? 'personal')}><Icon name="plus" size={16} />New project</button>
          </div>
        )}
        <div ref={box}>
          {!!list?.length && view === 'list' && (
            <table class="table">
              <thead><tr>
                <th scope="col">Name</th><th scope="col" class="c-team">Team</th><th scope="col" class="num c-rev">Revisions</th>
                <th scope="col" class="num c-com">Comments</th><th scope="col" class="c-area num">Net area</th><th scope="col" class="c-upd">Updated</th><th scope="col"><span class="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} data-id={p.id}>
                    <td><div class="c-name"><span class="row-thumb">{p.thumb ? <PlanThumb t={p.thumb} /> : null}</span>{nameCell(p)}
                      <span class={`pill ${p.thumb?.measured ? 'ok' : ''}`}>{status(p)}</span></div></td>
                    <td class="c-team">{p.team ? <a href={`#/team/${p.team.id}`} class="quiet">{p.team.name}</a> : <span class="muted">Personal</span>}</td>
                    <td class="num mono c-rev">{p.revisions ?? 0}</td>
                    <td class="num mono c-com">{p.comments ?? 0}</td>
                    <td class="num mono c-area">{p.thumb ? `${p.thumb.net_m2} m²` : '–'}</td>
                    <td class="c-upd" title={fullDate(p.updated_at)}>{when(p.updated_at)}</td>
                    <td class="c-menu"><Menu label={`Actions for ${p.name}`} items={items(p)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!list?.length && view === 'grid' && (
            <ul class="cards">
              {shown.map((p) => (
                <li class="card" key={p.id} data-id={p.id}>
                  <div class="card-thumb">{p.thumb ? <PlanThumb t={p.thumb} /> : <span class="none">{status(p)}</span>}</div>
                  <div class="card-body">
                    <div class="card-title">{nameCell(p)}<Menu label={`Actions for ${p.name}`} items={items(p)} /></div>
                    <div class="card-meta">
                      <span>{p.team?.name ?? 'Personal'}</span>
                      <span><span class="mono">{p.revisions ?? 0}</span> rev</span>
                      <span><span class="mono">{p.comments ?? 0}</span> comments</span>
                      <span title={fullDate(p.updated_at)}>{when(p.updated_at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {list && !!list.length && !shown.length && <p class="muted">No project matches "{q}".</p>}
        </div>
      </main>
      {moving && <MoveDialog p={moving} onMove={(to) => move(moving, to)} onClose={() => setMoving(null)} />}
    </>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (x: string | null) => { if (done.current) return; done.current = true; onDone(x); };
  return (
    <input class="rename" autoFocus aria-label="Project name" maxLength={120} value={v} onFocus={(e) => e.currentTarget.select()}
      onInput={(e) => setV(e.currentTarget.value)} onBlur={() => finish(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(v); } else if (e.key === 'Escape') { e.preventDefault(); finish(null); } }} />
  );
}

function MoveDialog({ p, onMove, onClose }: { p: ProjectRow; onMove(to: string): void; onClose(): void }) {
  const [to, setTo] = useState(p.team?.id ?? 'personal');
  return (
    <Dialog title={`Move "${p.name}"`} onClose={onClose}>
      <form class="dlg-body" onSubmit={(e) => { e.preventDefault(); onMove(to); }}>
        <label class="field"><span>Shared with</span>
          <select autoFocus value={to} onChange={(e) => setTo(e.currentTarget.value)}>
            <option value="personal">Only me (personal)</option>
            {teams.value.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        <p class="hint">Members of the team can open it, upload, ask and comment. You stay its owner.</p>
        <div class="dlg-actions"><button type="button" class="btn ghost sm" onClick={onClose}>Cancel</button><button class="btn sm" disabled={to === (p.team?.id ?? 'personal')}>Move</button></div>
      </form>
    </Dialog>
  );
}
