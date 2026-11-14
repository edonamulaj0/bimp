import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { loadMe } from './api';
import { Login } from './Login';
import { Projects } from './Projects';
import { ProjectPage } from './Project';
import { TeamSettings } from './TeamSettings';
import { announce, parsed, route, sidebarCollapsed, user } from './state';
import { Spinner } from './brand';
import { ShellDialogs, Sidebar } from './Shell';
import './app.css';
import { showSplash, splashPending } from './brand/wordmark';

// launch splash (once per session): fades when its animation has run and we know who is signed in
if (splashPending()) showSplash({ ready: new Promise<void>((ok) => { const stop = user.subscribe((u) => { if (u !== undefined) { ok(); queueMicrotask(() => stop()); } }); }) });

function App() {
  useEffect(() => { loadMe().catch(() => (user.value = null)); }, []);
  // After a route change (not the first load), move focus to the new page's heading so screen readers announce it.
  const first = useRef(true), key = `${!!user.value}${route.value}`;
  useEffect(() => {
    if (user.value === undefined) return;
    if (first.current) { first.current = false; return; }
    if (!user.value) return; // the sign-in form focuses its own field
    (document.querySelector('h1[tabindex="-1"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }, [key]);
  if (user.value === undefined) return <div class="boot"><Spinner size={56} /></div>;
  if (!user.value) return <Login />;
  const r = parsed.value;
  return (
    <div class={`app${sidebarCollapsed.value ? ' sb-collapsed' : ''}${r.page === 'project' ? ' in-ws' : ''}`}>
      <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <Sidebar />
      <div class="main-col">
        {r.page === 'project' ? <ProjectPage key={r.id} id={r.id} />
          : r.page === 'team' ? <TeamSettings key={r.id} id={r.id} />
          : <Projects key={r.team ?? 'all'} team={r.team} />}
      </div>
      <ShellDialogs />
      <p class="sr-only" role="status" aria-live="polite">{announce.value}</p>
    </div>
  );
}

render(<App />, document.getElementById('root')!);
