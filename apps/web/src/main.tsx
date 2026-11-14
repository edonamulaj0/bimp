import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { loadMe } from './api';
import { Login } from './Login';
import { Projects } from './Projects';
import { ProjectPage } from './Project';
import { route, user } from './state';
import { Spinner } from './brand';
import './app.css';

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
  const m = route.value.match(/^#\/p\/([\w-]+)/);
  return m ? <ProjectPage key={m[1]} id={m[1]} /> : <Projects />;
}

render(<App />, document.getElementById('root')!);
