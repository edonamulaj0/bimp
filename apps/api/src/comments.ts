import { Hono } from 'hono';
import { type Plan, type Pt, area, dist, round } from '../../shared/plan';
import { inside } from '../../shared/rooms';
import { chatQuota, projectAccess } from './access';
import { type Answer, ask } from './agent';
import type { Part } from './gemini';
import { type AppEnv, type Env, fail, now, toBase64, uid } from './util';

type Row = { id: string; parent_id: string | null; plan_id: string | null; author: 'user' | 'ai'; user_id: string | null; user_email: string | null;
  x: number | null; y: number | null; room_id: string | null; body: string; answer: string | null; resolved: number; created_at: number };
const SELECT = `SELECT k.id, k.parent_id, k.plan_id, k.author, k.user_id, u.email AS user_email, k.x, k.y, k.room_id, k.body, k.answer, k.resolved, k.created_at
  FROM comments k LEFT JOIN users u ON u.id = k.user_id`;
const out = ({ user_id: _u, answer, resolved, ...r }: Row) => ({ ...r, answer: answer ? (JSON.parse(answer) as Answer) : null, resolved: !!resolved });

const one = async (env: Env, projectId: string, id: string) => {
  const r = await env.DB.prepare(`${SELECT} WHERE k.id = ? AND k.project_id = ?`).bind(id, projectId).first<Row>();
  if (!r) throw fail(404, 'Comment not found.');
  return r;
};
const planRow = async (env: Env, projectId: string, planId?: unknown) => {
  const r = typeof planId === 'string' && planId
    ? await env.DB.prepare('SELECT id, data FROM plans WHERE id = ? AND project_id = ?').bind(planId, projectId).first<{ id: string; data: string }>()
    : await env.DB.prepare('SELECT id, data FROM plans WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').bind(projectId).first<{ id: string; data: string }>();
  if (!r) throw fail(409, 'Upload a floor plan first, then comment on it.');
  return { id: r.id, plan: JSON.parse(r.data) as Plan };
};

/**
 * What bimp is told about a pin: the room under it, the openings and fittings within 1.5 m, and, when the plan was read
 * from a drawing, the drawing sheet itself with the pin's position on it, so the answer can come from the page.
 */
async function spotContext(env: Env, projectId: string, plan: Plan, x: number, y: number): Promise<Part[]> {
  const p: Pt = [x, y], room = plan.rooms.find((r) => inside(p, r.polygon));
  const near = (q: Pt) => dist(p, q) <= 1.5;
  const mid = (o: { a: Pt; b: Pt }): Pt => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  const ops = plan.openings.filter((o) => near(mid(o))).map((o) => `${o.kind} ${o.id} (${round(dist(o.a, o.b), 2)} m wide, ${round(dist(p, mid(o)), 2)} m away)`);
  const fx = (plan.fixtures ?? []).filter((f) => near(f.center)).map((f) => `${f.kind} ${f.id} (${round(dist(p, f.center), 2)} m away)`);
  const lines = [
    `The question is about a comment pinned on the plan at x = ${round(x, 2)} m, y = ${round(y, 2)} m.`,
    room ? `The pin is inside ${room.name} (${room.id}, ${round(area(room.polygon), 2)} m²).` : 'The pin is not inside any room (outside, or on a wall).',
    ops.length ? `Openings within 1.5 m: ${ops.join('; ')}.` : 'No doors or windows within 1.5 m.',
    fx.length ? `Fittings within 1.5 m: ${fx.join('; ')}.` : '',
  ];
  const parts: Part[] = [];
  const src = plan.source, mpp = plan.scale.metersPerPx;
  if (src?.renderSha && mpp) {
    const obj = await env.FILES.get(`projects/${projectId}/renders/${src.renderSha}.png`);
    if (obj && obj.size < 15 * 1024 * 1024) {
      const px = (x - src.offset[0]) / mpp, py = (y - src.offset[1]) / mpp;
      parts.push({ inlineData: { mimeType: 'image/png', data: toBase64(await obj.arrayBuffer()) } });
      lines.push(`The image is the drawing sheet this plan was read from. The pin is at [y, x] = [${Math.round((py / src.imageHeight) * 1000)}, ${Math.round((px / src.imageWidth) * 1000)}] on a 0–1000 scale of the image. Read the sheet around that point (labels, dimensions, notes, symbols) to answer, and say when something comes from the sheet rather than the plan data.`);
    }
  }
  parts.push({ text: lines.filter(Boolean).join('\n') });
  return parts;
}

/** bimp answers in a thread, using the whole thread as the conversation. */
async function answerThread(env: Env, projectId: string, root: Row, question: string, userId: string) {
  if (root.x == null || root.y == null) throw fail(400, 'This comment has no pin.');
  await chatQuota(env, userId);
  const { id: planId, plan } = await planRow(env, projectId, root.plan_id);
  const { results: thread } = await env.DB.prepare('SELECT author, body FROM comments WHERE id = ? OR parent_id = ? ORDER BY created_at').bind(root.id, root.id).all<{ author: string; body: string }>();
  const history: { role: 'user' | 'model'; text: string }[] = [];
  for (const m of thread) {
    const role = m.author === 'ai' ? ('model' as const) : ('user' as const), last = history[history.length - 1];
    if (last?.role === role) last.text += `\n${m.body}`; else if (history.length || role === 'user') history.push({ role, text: m.body });
  }
  if (history[history.length - 1]?.role === 'user') history.pop(); // the question below repeats it
  const answer = await ask(env, plan, question, history, await spotContext(env, projectId, plan, root.x, root.y));
  const id = uid();
  await env.DB.prepare("INSERT INTO comments (id, project_id, plan_id, parent_id, user_id, author, body, answer, created_at) VALUES (?,?,?,?,?, 'ai', ?,?,?)")
    .bind(id, projectId, planId, root.id, userId, answer.text, JSON.stringify(answer), now()).run();
  return out(await one(env, projectId, id));
}

export const comments = new Hono<AppEnv>();
comments.get('/', async (c) => {
  const project = await projectAccess(c, c.req.param('id')!);
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE k.project_id = ? ORDER BY k.created_at, k.id`).bind(project.id).all<Row>();
  return c.json({ comments: results.map(out) });
});
comments.post('/', async (c) => {
  const project = await projectAccess(c, c.req.param('id')!);
  const b = (await c.req.json().catch(() => ({}))) as { body?: unknown; x?: unknown; y?: unknown; plan_id?: unknown; parent_id?: unknown; ask_ai?: unknown };
  const body = typeof b.body === 'string' ? b.body.trim().slice(0, 4000) : '';
  if (!body) throw fail(400, 'Write a comment.');
  const me = c.get('user').id, id = uid();
  let root: Row;
  if (typeof b.parent_id === 'string' && b.parent_id) {
    root = await one(c.env, project.id, b.parent_id);
    if (root.parent_id) root = await one(c.env, project.id, root.parent_id); // replies are flat under the pin
    await c.env.DB.prepare("INSERT INTO comments (id, project_id, plan_id, parent_id, user_id, author, body, created_at) VALUES (?,?,?,?,?, 'user', ?,?)")
      .bind(id, project.id, root.plan_id, root.id, me, body, now()).run();
  } else {
    const x = Number(b.x), y = Number(b.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 10_000 || Math.abs(y) > 10_000) throw fail(400, 'Pin the comment to a spot on the plan.');
    const { id: planId, plan } = await planRow(c.env, project.id, b.plan_id);
    const room = plan.rooms.find((r) => inside([x, y], r.polygon));
    await c.env.DB.prepare("INSERT INTO comments (id, project_id, plan_id, user_id, author, x, y, room_id, body, created_at) VALUES (?,?,?,?, 'user', ?,?,?,?,?)")
      .bind(id, project.id, planId, me, round(x, 3), round(y, 3), room?.id ?? null, body, now()).run();
  }
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now(), project.id).run();
  const comment = await one(c.env, project.id, id);
  root ??= comment;
  if (!b.ask_ai) return c.json({ comment: out(comment), reply: null });
  try { return c.json({ comment: out(comment), reply: await answerThread(c.env, project.id, root, body, me) }); }
  catch (e) { return c.json({ comment: out(comment), reply: null, ai_error: (e as Error).message }); }
});
comments.post('/:cid/ask', async (c) => {
  const project = await projectAccess(c, c.req.param('id')!);
  let root = await one(c.env, project.id, c.req.param('cid'));
  if (root.parent_id) root = await one(c.env, project.id, root.parent_id);
  const { question } = (await c.req.json().catch(() => ({}))) as { question?: unknown };
  let q = typeof question === 'string' ? question.trim().slice(0, 2000) : '';
  if (!q) q = (await c.env.DB.prepare("SELECT body FROM comments WHERE (id = ? OR parent_id = ?) AND author = 'user' ORDER BY created_at DESC LIMIT 1").bind(root.id, root.id).first<{ body: string }>())?.body ?? '';
  if (!q) throw fail(400, 'Ask a question.');
  return c.json({ reply: await answerThread(c.env, project.id, root, q, c.get('user').id) });
});
comments.patch('/:cid', async (c) => {
  const project = await projectAccess(c, c.req.param('id')!);
  const k = await one(c.env, project.id, c.req.param('cid'));
  const b = (await c.req.json().catch(() => ({}))) as { resolved?: unknown; body?: unknown };
  if (typeof b.body === 'string') {
    if (k.author !== 'user' || k.user_id !== c.get('user').id) throw fail(403, 'Only the author can edit a comment.');
    const body = b.body.trim().slice(0, 4000);
    if (!body) throw fail(400, 'Write a comment.');
    await c.env.DB.prepare('UPDATE comments SET body = ? WHERE id = ?').bind(body, k.id).run();
  }
  if (typeof b.resolved === 'boolean') await c.env.DB.prepare('UPDATE comments SET resolved = ? WHERE id = ?').bind(b.resolved ? 1 : 0, k.parent_id ?? k.id).run();
  return c.json({ comment: out(await one(c.env, project.id, k.id)) });
});
comments.delete('/:cid', async (c) => {
  const project = await projectAccess(c, c.req.param('id')!);
  const k = await one(c.env, project.id, c.req.param('cid'));
  if (project.role !== 'owner' && !(k.author === 'user' && k.user_id === c.get('user').id)) throw fail(403, 'Only the author or the project owner can delete a comment.');
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(k.id).run();
  return c.json({ ok: true });
});
