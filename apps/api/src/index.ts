import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { samplePlan } from '../../shared/sample-plan';
import type { Plan } from '../../shared/plan';
import { ask } from './agent';
import { checkLogin, createUser, endSession, requireUser, sameOrigin, startSession, validate } from './auth';
import { type AppEnv, type Env, fail, now, sha256, uid } from './util';

const MAX_UPLOAD = 50 * 1024 * 1024; // the model gets the container's render, not the original
const MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/dxf']);

const app = new Hono<AppEnv>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong on our side.' }, 500);
});
app.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });
app.use('*', sameOrigin);

// --- auth
app.post('/auth/signup', async (c) => {
  if (c.env.ALLOW_SIGNUP !== 'true') throw fail(403, 'Sign-up is closed. Ask your admin for an account.');
  const { email, password } = validate(await c.req.json().catch(() => null));
  const user = await createUser(c.env, email, password);
  await createProject(c.env, user.id, 'Sample house', samplePlan());
  await startSession(c, user.id);
  return c.json({ user });
});
app.post('/auth/login', async (c) => {
  const { email, password } = validate(await c.req.json().catch(() => null));
  const user = await checkLogin(c.env, email, password, c.req.header('cf-connecting-ip') ?? 'local');
  await startSession(c, user.id);
  return c.json({ user });
});
app.post('/auth/logout', async (c) => { await endSession(c); return c.json({ ok: true }); });
app.get('/me', requireUser, (c) => c.json({ user: c.get('user') }));

// --- projects
async function createProject(env: Env, userId: string, name: string, plan?: Plan) {
  const id = uid(), t = now();
  const stmts = [env.DB.prepare('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?,?,?,?,?)').bind(id, userId, name, t, t)];
  if (plan) stmts.push(env.DB.prepare('INSERT INTO plans (id, project_id, file_id, data, created_at) VALUES (?,?,?,?,?)').bind(uid(), id, null, JSON.stringify(plan), t));
  await env.DB.batch(stmts);
  return { id, name, created_at: t, updated_at: t };
}

async function ownProject(c: { env: Env; get: (k: 'user') => { id: string } }, id: string) {
  const p = await c.env.DB.prepare('SELECT id, name, created_at, updated_at FROM projects WHERE id = ? AND user_id = ?').bind(id, c.get('user').id)
    .first<{ id: string; name: string; created_at: number; updated_at: number }>();
  if (!p) throw fail(404, 'Project not found.');
  return p;
}

const latestPlan = async (env: Env, projectId: string) => {
  const row = await env.DB.prepare('SELECT data FROM plans WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').bind(projectId).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Plan) : null;
};

const projects = new Hono<AppEnv>();
projects.use('*', requireUser);
projects.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.updated_at, (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS files,
            EXISTS (SELECT 1 FROM plans x WHERE x.project_id = p.id) AS has_plan
     FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
  ).bind(c.get('user').id).all();
  return c.json({ projects: results });
});
projects.post('/', async (c) => {
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const n = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  if (!n) throw fail(400, 'Give the project a name.');
  return c.json({ project: await createProject(c.env, c.get('user').id, n) });
});
projects.get('/:id', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  const [files, messages, jobs] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, filename, mime, size, created_at FROM files WHERE project_id = ? ORDER BY created_at').bind(project.id),
    c.env.DB.prepare('SELECT id, role, content, created_at FROM messages WHERE project_id = ? ORDER BY id').bind(project.id),
    c.env.DB.prepare("SELECT id, status, stage FROM jobs WHERE project_id = ? AND status IN ('queued', 'running') ORDER BY created_at").bind(project.id),
  ]);
  return c.json({
    project,
    plan: await latestPlan(c.env, project.id),
    files: files.results,
    jobs: jobs.results,
    messages: (messages.results as { content: string }[]).map((m) => ({ ...m, content: JSON.parse(m.content) })),
  });
});
projects.delete('/:id', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  let cursor: string | undefined;
  do {
    const page = await c.env.FILES.list({ prefix: `projects/${project.id}/`, cursor });
    if (page.objects.length) await c.env.FILES.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();
  return c.json({ ok: true });
});

// --- files: raw body upload, deduplicated by content hash per project
projects.post('/:id/files', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  const filename = decodeURIComponent(c.req.header('x-filename') ?? 'drawing').slice(0, 200);
  if (/\.dwg$/i.test(filename)) throw fail(415, 'DWG is a closed format: export it to DXF (or PDF) and upload that.');
  const mime = /\.dxf$/i.test(filename) ? 'application/dxf' : (c.req.header('content-type') ?? '').split(';')[0];
  if (!MIMES.has(mime)) throw fail(415, 'Upload a PDF, DXF, PNG, JPG or WebP drawing.');
  if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD) throw fail(413, 'Files up to 50 MB for now.');
  const data = await c.req.arrayBuffer();
  if (data.byteLength > MAX_UPLOAD) throw fail(413, 'Files up to 50 MB for now.');
  if (!data.byteLength) throw fail(400, 'The file is empty.');
  const hash = await sha256(data);
  const existing = await c.env.DB.prepare('SELECT id, filename, mime, size, created_at FROM files WHERE project_id = ? AND sha256 = ?').bind(project.id, hash).first<{ id: string }>();
  if (existing) return c.json({ file: existing, duplicate: true, job: await startJob(c.env, project.id, existing.id) });
  const dim = (h: string) => { const n = Number(c.req.header(h)); return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null; };
  const id = uid(), key = `projects/${project.id}/${hash}`;
  await c.env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO files (id, project_id, filename, mime, size, sha256, r2_key, width, height, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, project.id, filename, mime, data.byteLength, hash, key, dim('x-image-width'), dim('x-image-height'), now()),
    c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now(), project.id),
  ]);
  return c.json({ file: { id, filename, mime, size: data.byteLength }, job: await startJob(c.env, project.id, id) });
});

/** One Workflow instance per ingestion run; the jobs row mirrors its progress for the UI. */
async function startJob(env: Env, projectId: string, fileId: string) {
  const id = uid(), t = now();
  await env.DB.prepare("INSERT INTO jobs (id, project_id, file_id, status, stage, created_at, updated_at) VALUES (?,?,?,'queued','Queued',?,?)").bind(id, projectId, fileId, t, t).run();
  await env.INGEST_WORKFLOW.create({ id, params: { jobId: id, projectId, fileId } });
  return { id, status: 'queued', stage: 'Queued' };
}

projects.get('/:id/jobs/:jid', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  const job = await c.env.DB.prepare('SELECT id, status, stage, error FROM jobs WHERE id = ? AND project_id = ?').bind(c.req.param('jid'), project.id)
    .first<{ id: string; status: string; stage: string; error: string | null }>();
  if (!job) throw fail(404, 'Job not found.');
  if (job.status === 'queued' || job.status === 'running') {
    // The workflow can die outside a step (e.g. terminated); don't leave the UI waiting forever.
    const st = await (await c.env.INGEST_WORKFLOW.get(job.id)).status().catch(() => null);
    if (st && (st.status === 'errored' || st.status === 'terminated')) {
      job.status = 'failed'; job.error = job.error ?? (typeof st.error === 'string' ? st.error : st.error?.message) ?? 'Ingestion stopped';
      await c.env.DB.prepare("UPDATE jobs SET status = 'failed', stage = 'Failed', error = ?, updated_at = ? WHERE id = ?").bind(job.error, now(), job.id).run();
    }
  }
  if (job.status !== 'done') return c.json({ job });
  const last = await c.env.DB.prepare("SELECT content FROM messages WHERE project_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").bind(project.id).first<{ content: string }>();
  return c.json({ job, plan: await latestPlan(c.env, project.id), message: last && { role: 'assistant', content: JSON.parse(last.content) } });
});

projects.get('/:id/render/:sha', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) throw fail(404, 'Not found.');
  const obj = await c.env.FILES.get(`projects/${project.id}/renders/${sha}.png`);
  if (!obj) throw fail(404, 'Render not found.');
  return new Response(obj.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400, immutable', 'x-content-type-options': 'nosniff' } });
});
projects.get('/:id/files/:fid', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  const f = await c.env.DB.prepare('SELECT r2_key, mime FROM files WHERE id = ? AND project_id = ?').bind(c.req.param('fid'), project.id).first<{ r2_key: string; mime: string }>();
  const obj = f && (await c.env.FILES.get(f.r2_key));
  if (!obj) throw fail(404, 'File not found.');
  return new Response(obj.body, { headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
});
// --- chat
projects.post('/:id/chat', async (c) => {
  const project = await ownProject(c, c.req.param('id'));
  const { message } = (await c.req.json().catch(() => ({}))) as { message?: unknown };
  const q = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
  if (!q) throw fail(400, 'Type a question.');
  const plan = await latestPlan(c.env, project.id);
  if (!plan) throw fail(409, 'Upload a floor plan first, then ask about it.');
  const { results } = await c.env.DB.prepare('SELECT role, content FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT 10').bind(project.id).all<{ role: string; content: string }>();
  const history = results.reverse().map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('model' as const), text: JSON.parse(m.content).text as string }));
  const answer = await ask(c.env, plan, q, history);
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO messages (project_id, role, content, created_at) VALUES (?,?,?,?)').bind(project.id, 'user', JSON.stringify({ text: q }), t),
    c.env.DB.prepare('INSERT INTO messages (project_id, role, content, created_at) VALUES (?,?,?,?)').bind(project.id, 'assistant', JSON.stringify(answer), t),
    c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(t, project.id),
  ]);
  return c.json({ message: { role: 'assistant', content: answer } });
});

app.route('/projects', projects);
app.all('*', () => { throw fail(404, 'Not found.'); });

export default app;
