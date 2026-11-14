import type { ComponentChildren } from 'preact';
import { api } from './api';
import { go, user } from './state';
import { Logo } from './brand';

export function Topbar({ children }: { children?: ComponentChildren }) {
  const out = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); user.value = null; go('#/'); };
  return (
    <header class="topbar">
      <a class="logo" href="#/" aria-label="bimp: projects"><Logo height={30} /></a>
      <div class="topbar-mid">{children}</div>
      <span class="who">{user.value?.email}</span>
      <button class="btn ghost sm" onClick={out}>Sign out</button>
    </header>
  );
}
