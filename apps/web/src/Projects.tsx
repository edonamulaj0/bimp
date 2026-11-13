import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { go } from './state';
import { Topbar } from './Topbar';

type P = { id: string; name: string; updated_at: number; files: number; has_plan: number };

export function Projects() {
  const [list, setList] = useState<P[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api<{ projects: P[] }>('/projects').then((d) => setList(d.projects)).catch((e) => setErr(e.message)); }, []);

  async function create(e: Event) {
    e.preventDefault();
    try { const d = await api('/projects', { json: { name } }); go(`#/p/${d.project.id}`); }
    catch (e) { setErr((e as Error).message); }
  }
  async function remove(p: P) {
    if (!confirm(`Delete "${p.name}" and its files? This can't be undone.`)) return;
    await api(`/projects/${p.id}`, { method: 'DELETE' }).catch((e) => setErr(e.message));
    setList((l) => l?.filter((x) => x.id !== p.id) ?? null);
  }

  return (
    <div class="page">
      <Topbar />
      <main class="projects">
        <h1>Projects</h1>
        <p class="err" role="alert">{err}</p>
        <div class="cards">
          <form class="card new" onSubmit={create}>
            <label for="pname" class="small muted">New project</label>
            <input id="pname" placeholder="e.g. Riverside block B" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={120} />
            <button class="btn" disabled={!name.trim()}>Create</button>
          </form>
          {list === null && !err && <p class="muted">Loading…</p>}
          {list?.map((p) => (
            <article class="card" key={p.id}>
              <a class="card-link" href={`#/p/${p.id}`}><h2>{p.name}</h2></a>
              <p class="small muted">{p.has_plan ? 'Plan ready' : 'No plan yet'} · {p.files} file{p.files === 1 ? '' : 's'}</p>
              <p class="small muted">Updated {new Date(p.updated_at).toLocaleDateString()}</p>
              <button class="btn ghost sm card-del" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>Delete</button>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
