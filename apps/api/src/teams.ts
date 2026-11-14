import { Hono } from 'hono';
import { requireUser } from './auth';
import { type AppEnv, type Env, fail, now, uid } from './util';

export async function myTeams(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name COLLATE NOCASE')
    .bind(userId).all<{ id: string; name: string; role: 'owner' | 'member' }>();
  return results;
}

async function membership(env: Env, teamId: string, userId: string) {
  const m = await env.DB.prepare('SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.team_id = ? AND m.user_id = ?')
    .bind(teamId, userId).first<{ id: string; name: string; role: 'owner' | 'member' }>();
  if (!m) throw fail(404, 'Team not found.');
  return m;
}
const owner = (m: { role: string }) => { if (m.role !== 'owner') throw fail(403, 'Only a team owner can do that.'); };
const teamName = (v: unknown) => { const n = typeof v === 'string' ? v.trim().slice(0, 80) : ''; if (!n) throw fail(400, 'Give the team a name.'); return n; };

export const teams = new Hono<AppEnv>();
teams.use('*', requireUser);
teams.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, m.role, (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS members,
            (SELECT COUNT(*) FROM projects p WHERE p.team_id = t.id) AS projects
     FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name COLLATE NOCASE`,
  ).bind(c.get('user').id).all();
  return c.json({ teams: results });
});
teams.post('/', async (c) => {
  const name = teamName(((await c.req.json().catch(() => ({}))) as { name?: unknown }).name);
  const mine = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE created_by = ?").bind(c.get('user').id).first<{ n: number }>();
  if ((mine?.n ?? 0) >= 20) throw fail(429, 'You can create up to 20 teams.');
  const id = uid(), t = now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)').bind(id, name, c.get('user').id, t),
    c.env.DB.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?,?,'owner',?)").bind(id, c.get('user').id, t),
  ]);
  return c.json({ team: { id, name, role: 'owner' } });
});
teams.get('/:id', async (c) => {
  const team = await membership(c.env, c.req.param('id'), c.get('user').id);
  const { results } = await c.env.DB.prepare('SELECT m.user_id, u.email, m.role FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.role DESC, u.email')
    .bind(team.id).all();
  return c.json({ team, members: results });
});
teams.patch('/:id', async (c) => {
  const team = await membership(c.env, c.req.param('id'), c.get('user').id); owner(team);
  const name = teamName(((await c.req.json().catch(() => ({}))) as { name?: unknown }).name);
  await c.env.DB.prepare('UPDATE teams SET name = ? WHERE id = ?').bind(name, team.id).run();
  return c.json({ team: { ...team, name } });
});
teams.post('/:id/members', async (c) => {
  const team = await membership(c.env, c.req.param('id'), c.get('user').id); owner(team);
  const { email, role } = (await c.req.json().catch(() => ({}))) as { email?: unknown; role?: unknown };
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const u = e && (await c.env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(e).first<{ id: string; email: string }>());
  // Accepted trade-off: inviting reveals whether an email has an account, to team owners only (sign-up already does).
  if (!u) throw fail(404, 'No bimp account uses that email. Ask them to sign up first, then add them.');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').bind(team.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 50) throw fail(429, 'A team can have up to 50 members during the pilot.');
  const r = role === 'owner' ? 'owner' : 'member';
  await c.env.DB.prepare('INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?,?,?,?) ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role')
    .bind(team.id, u.id, r, now()).run();
  return c.json({ member: { user_id: u.id, email: u.email, role: r } });
});
teams.delete('/:id/members/:uid', async (c) => {
  const me = c.get('user').id, team = await membership(c.env, c.req.param('id'), me), target = c.req.param('uid');
  if (target !== me) owner(team);
  const owners = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'owner' AND user_id != ?").bind(team.id, target).first<{ n: number }>();
  if (!owners?.n) throw fail(409, 'A team needs at least one owner. Make someone else an owner first, or delete the team.');
  await c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(team.id, target).run();
  return c.json({ ok: true });
});
teams.delete('/:id', async (c) => {
  const team = await membership(c.env, c.req.param('id'), c.get('user').id); owner(team);
  // Projects go back to the people who created them (team_id set to null by the foreign key).
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE projects SET team_id = NULL WHERE team_id = ?').bind(team.id),
    c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(team.id),
  ]);
  return c.json({ ok: true });
});
