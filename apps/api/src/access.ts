import { type Env, fail, now } from './util';

export type Access = { id: string; name: string; created_at: number; updated_at: number; user_id: string; team_id: string | null;
  role: 'owner' | 'member'; team: { id: string; name: string } | null };

/** A project its creator or any member of its team can open. Owner = creator or team owner. 404 otherwise (no existence leak). */
export async function projectAccess(c: { env: Env; get: (k: 'user') => { id: string } }, id: string): Promise<Access> {
  const me = c.get('user').id;
  const p = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.created_at, p.updated_at, p.user_id, p.team_id, t.name AS team_name,
            (SELECT role FROM team_members m WHERE m.team_id = p.team_id AND m.user_id = ?) AS team_role
     FROM projects p LEFT JOIN teams t ON t.id = p.team_id WHERE p.id = ?`,
  ).bind(me, id).first<{ id: string; name: string; created_at: number; updated_at: number; user_id: string; team_id: string | null; team_name: string | null; team_role: string | null }>();
  if (!p || (p.user_id !== me && !p.team_role)) throw fail(404, 'Project not found.');
  const { team_name, team_role, ...rest } = p;
  return { ...rest, role: p.user_id === me || team_role === 'owner' ? 'owner' : 'member', team: p.team_id ? { id: p.team_id, name: team_name ?? '' } : null };
}

/** Per-user cap on questions: each one can make several model calls. */
/** Questions in chat and to bimp in comments count together. */
export async function chatQuota(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM messages WHERE user_id = ?1 AND role = 'user' AND content NOT LIKE ?2 AND created_at > ?3) + (SELECT COUNT(*) FROM comments WHERE user_id = ?1 AND author = 'ai' AND created_at > ?3) AS n")
    .bind(userId, '{"text":"Uploaded %', now() - 24 * 3600_000).first<{ n: number }>();
  if ((row?.n ?? 0) >= 200) throw fail(429, 'You have reached today\'s limit of questions. Try again tomorrow.');
}

