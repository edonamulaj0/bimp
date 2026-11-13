import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { api } from './api';
import { Login } from './Login';
import { Projects } from './Projects';
import { ProjectPage } from './Project';
import { route, user } from './state';
import './app.css';

function App() {
  useEffect(() => { api('/me').then((d) => (user.value = d.user)).catch(() => (user.value = null)); }, []);
  if (user.value === undefined) return <div class="boot logo">bimp.</div>;
  if (!user.value) return <Login />;
  const m = route.value.match(/^#\/p\/([\w-]+)/);
  return m ? <ProjectPage key={m[1]} id={m[1]} /> : <Projects />;
}

render(<App />, document.getElementById('root')!);
