import { useEffect, useRef, useState } from 'preact/hooks';
import { api, loadMe } from './api';
import { go, projectsVersion, say, user } from './state';
import { PageHeader } from './Shell';
import { Spinner } from './brand';
import { Icon } from './icons';

type Member = { user_id: string; email: string; role: 'owner' | 'member' };
type Data = { team: { id: string; name: string; role: 'owner' | 'member' }; members: Member[] };

/** A team's members: invite by email, remove, leave, delete the team. */
export function TeamSettings({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement>(null), field = useRef<HTMLInputElement>(null);
  useEffect(() => { api<Data>(`/teams/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id]);
  useEffect(() => { document.title = `${d?.team.name ?? 'Team'} members · bimp`; }, [d?.team.name]);
  const owner = d?.team.role === 'owner', me = user.value?.id;
  const owners = d?.members.filter((m) => m.role === 'owner').length ?? 0;

  async function invite(e: Event) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ member: Member }>(`/teams/${id}/members`, { json: { email: email.trim() } });
      setD((x) => x && { ...x, members: [...x.members.filter((m) => m.user_id !== r.member.user_id), r.member] });
      say(`${r.member.email} added to the team`); setEmail('');
    } catch (e) { setErr((e as Error).message.includes('404') || /no account|not found/i.test((e as Error).message) ? `No bimp account uses ${email.trim()}. Ask them to sign up first, then invite them again.` : (e as Error).message); }
    finally { setBusy(false); field.current?.focus(); }
  }
  async function remove(m: Member) {
    const self = m.user_id === me;
    if (!confirm(self ? `Leave ${d!.team.name}? You'll lose access to its projects.` : `Remove ${m.email} from ${d!.team.name}?`)) return;
    const i = d!.members.indexOf(m);
    try { await api(`/teams/${id}/members/${m.user_id}`, { method: 'DELETE' }); }
    catch (e) { return setErr((e as Error).message); }
    if (self) { await loadMe().catch(() => {}); projectsVersion.value++; say(`You left ${d!.team.name}`); return go('#/'); }
    setD((x) => x && { ...x, members: x.members.filter((y) => y.user_id !== m.user_id) });
    say(`${m.email} removed`);
    requestAnimationFrame(() => { const b = list.current?.querySelectorAll<HTMLElement>('button'); (b?.[Math.min(i, b.length - 1)] ?? field.current)?.focus(); });
  }
  async function del() {
    if (!confirm(`Delete the team ${d!.team.name}? Its projects go back to the people who created them.`)) return;
    try { await api(`/teams/${id}`, { method: 'DELETE' }); await loadMe().catch(() => {}); projectsVersion.value++; say('Team deleted'); go('#/'); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <>
      <PageHeader crumbs={[{ label: d?.team.name ?? 'Team', href: `#/team/${id}` }]} title="Members"
        actions={<a class="btn ghost sm" href={`#/team/${id}`}><Icon name="folder" size={16} />Projects</a>} />
      <main class="page-body settings" id="main" tabIndex={-1}>
        {!d && !err && <div class="loading-block"><Spinner /></div>}
        <p class="err" role="alert">{err}</p>
        {d && (
          <>
            <section class="set-section" aria-labelledby="mem-h">
              <div class="set-head"><h2 id="mem-h">Members <span class="muted mono">{d.members.length}</span></h2></div>
              {owner && (
                <form class="invite" onSubmit={invite}>
                  <label class="sr-only" for="invite">Invite by email</label>
                  <input id="invite" ref={field} type="email" required placeholder="colleague@studio.com" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="off" />
                  <button class="btn sm" disabled={busy || !email.trim()}>Invite</button>
                </form>
              )}
              {owner && <p class="hint">They need a bimp account. Members can open every project in the team, upload drawings, ask and comment; owners also manage members.</p>}
              <ul class="members" ref={list}>
                {d.members.map((m) => (
                  <li key={m.user_id}>
                    <span class="avatar" aria-hidden="true">{m.email.slice(0, 1).toUpperCase()}</span>
                    <span class="m-email">{m.email}{m.user_id === me && <span class="muted"> (you)</span>}</span>
                    <span class="pill">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
                    {m.user_id === me
                      ? <button class="btn ghost sm" onClick={() => remove(m)} disabled={m.role === 'owner' && owners < 2} title={m.role === 'owner' && owners < 2 ? 'The last owner can’t leave. Delete the team instead.' : undefined}>Leave</button>
                      : owner ? <button class="btn ghost sm" onClick={() => remove(m)} aria-label={`Remove ${m.email}`}>Remove</button> : <span />}
                  </li>
                ))}
              </ul>
            </section>
            {owner && (
              <section class="set-section danger-zone" aria-labelledby="del-h">
                <h2 id="del-h">Delete team</h2>
                <p class="muted">Members lose access. Projects go back to the people who created them; nothing else is deleted.</p>
                <button class="btn ghost sm danger" onClick={del}>Delete {d.team.name}</button>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
