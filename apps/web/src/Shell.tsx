import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, loadMe } from './api';
import { drawerOpen, go, newProject, newTeam, parsed, projectsVersion, route, sidebarCollapsed, teams, user } from './state';
import { Logo } from './brand';
import { Icon } from './icons';
import { Dialog, Menu } from './ui';

const narrow = () => matchMedia('(max-width: 899px)').matches;
const setCollapsed = (v: boolean) => { sidebarCollapsed.value = v; try { localStorage.setItem('bimp.sidebar', v ? 'collapsed' : 'open'); } catch { /* private mode */ } };

/** Left sidebar of the signed-in app: projects, teams and the account. A drawer under 900 px. */
export function Sidebar() {
  const r = parsed.value;
  const here = (team: string | null) => r.page === 'projects' && r.team === team;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { drawerOpen.value = false; }, [route.value]);
  useEffect(() => {
    if (!drawerOpen.value) return;
    ref.current?.querySelector<HTMLElement>('a, button')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { drawerOpen.value = false; (document.querySelector('.nav-toggle') as HTMLElement | null)?.focus(); } };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [drawerOpen.value]);
  const out = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); user.value = null; go('#/'); };
  const ctx = r.page === 'projects' && r.team ? r.team : r.page === 'team' ? r.id : 'personal';
  const email = user.value?.email ?? '';

  return (
    <>
      {drawerOpen.value && <div class="scrim" onClick={() => (drawerOpen.value = false)} aria-hidden="true" />}
      <nav ref={ref} class={`sidebar${drawerOpen.value ? ' open' : ''}`} aria-label="Workspace">
        <div class="sb-head">
          <a class="logo" href="#/" aria-label="bimp: all projects"><Logo height={26} /></a>
          <button class="icon-btn sb-collapse" onClick={() => (narrow() ? (drawerOpen.value = false) : setCollapsed(true))} aria-label="Hide sidebar" title="Hide sidebar">
            <Icon name="sidebar" />
          </button>
        </div>
        <button class="btn sm sb-new" onClick={() => (newProject.value = ctx)}><Icon name="plus" size={16} />New project</button>
        <ul class="sb-nav">
          <li><a href="#/" aria-current={here(null) ? 'page' : undefined}><Icon name="folder" />All projects</a></li>
          <li><a href="#/personal" aria-current={here('personal') ? 'page' : undefined}><Icon name="user" />Personal</a></li>
        </ul>
        <h2 class="sb-h" id="sb-teams">Teams</h2>
        <ul class="sb-nav" aria-labelledby="sb-teams">
          {teams.value.map((t) => (
            <li key={t.id} class="sb-team">
              <a href={`#/team/${t.id}`} aria-current={here(t.id) ? 'page' : undefined}><Icon name="team" /><span class="sb-name">{t.name}</span></a>
              <a class="sb-gear" href={`#/team/${t.id}/settings`} aria-label={`${t.name} members and settings`} title="Members and settings"
                aria-current={r.page === 'team' && r.id === t.id ? 'page' : undefined}><Icon name="gear" size={16} /></a>
            </li>
          ))}
          <li><button class="sb-add" onClick={() => (newTeam.value = true)}><Icon name="plus" />New team</button></li>
        </ul>
        <div class="sb-foot">
          <Menu label="Account" align="up" class="sb-user" items={[{ label: 'Sign out', onSelect: out }]}
            text={<><span class="avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span><span class="sb-email">{email}</span></>} />
        </div>
      </nav>
    </>
  );
}

export type Crumb = { label: string; href?: string };
/** The page's top bar: sidebar toggle, breadcrumbs ending in the page's h1, and page actions. */
export function PageHeader({ crumbs = [], title, actions }: { crumbs?: Crumb[]; title: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <header class="topbar">
      <button class={`icon-btn nav-toggle${sidebarCollapsed.value ? ' show' : ''}`} aria-label="Show sidebar" title="Show sidebar"
        aria-expanded={narrow() ? drawerOpen.value : !sidebarCollapsed.value}
        onClick={() => (narrow() ? (drawerOpen.value = true) : setCollapsed(false))}><Icon name={sidebarCollapsed.value ? 'sidebar' : 'menu'} /></button>
      <nav class="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} class="crumb-item">{c.href ? <a class="crumb" href={c.href}>{c.label}</a> : <span class="crumb">{c.label}</span>}<span class="crumb-sep" aria-hidden="true">/</span></span>
        ))}
        <h1 class="crumb-h1" tabIndex={-1}>{title}</h1>
      </nav>
      {actions && <div class="page-actions">{actions}</div>}
    </header>
  );
}

/** Dialogs opened from anywhere in the shell. */
export function ShellDialogs() {
  return <>{newProject.value !== null && <NewProject at={newProject.value} />}{newTeam.value && <NewTeam />}</>;
}

function NewProject({ at }: { at: string }) {
  const [name, setName] = useState('');
  const [where, setWhere] = useState(teams.value.some((t) => t.id === at) ? at : 'personal');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const close = () => (newProject.value = null);
  async function create(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api('/projects', { json: { name: name.trim(), ...(where !== 'personal' ? { team_id: where } : {}) } });
      projectsVersion.value++; close(); go(`#/p/${d.project.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Dialog title="New project" onClose={close}>
      <form class="dlg-body" onSubmit={create}>
        <label class="field"><span>Name</span>
          <input autoFocus required maxLength={120} placeholder="e.g. Riverside block B" value={name} onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label class="field"><span>Shared with</span>
          <select value={where} onChange={(e) => setWhere(e.currentTarget.value)}>
            <option value="personal">Only me (personal)</option>
            {teams.value.map((t) => <option key={t.id} value={t.id}>{t.name} (team)</option>)}
          </select></label>
        <p class="hint">Team members can open the project, upload drawings, ask and comment.</p>
        <p class="err" role="alert">{err}</p>
        <div class="dlg-actions"><button type="button" class="btn ghost sm" onClick={close}>Cancel</button><button class="btn sm" disabled={!name.trim() || busy}>Create project</button></div>
      </form>
    </Dialog>
  );
}

function NewTeam() {
  const [name, setName] = useState('');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const close = () => (newTeam.value = false);
  async function create(e: Event) {
    e.preventDefault();
    setBusy(true);
    try { const d = await api('/teams', { json: { name: name.trim() } }); await loadMe(); close(); go(`#/team/${d.team.id}/settings`); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Dialog title="New team" onClose={close}>
      <form class="dlg-body" onSubmit={create}>
        <label class="field"><span>Team name</span>
          <input autoFocus required maxLength={80} placeholder="e.g. Studio North" value={name} onInput={(e) => setName(e.currentTarget.value)} /></label>
        <p class="hint">You'll be its owner. Invite people by email next.</p>
        <p class="err" role="alert">{err}</p>
        <div class="dlg-actions"><button type="button" class="btn ghost sm" onClick={close}>Cancel</button><button class="btn sm" disabled={!name.trim() || busy}>Create team</button></div>
      </form>
    </Dialog>
  );
}
