import type { ComponentChildren } from 'preact';
import { api } from './api';
import { go, user } from './state';

export function Topbar({ children }: { children?: ComponentChildren }) {
  const out = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); user.value = null; go('#/'); };
  return (
    <header class="topbar">
      <a class="logo" href="#/">bimp.</a>
      <div class="topbar-mid">{children}</div>
      <span class="muted small hide-sm">{user.value?.email}</span>
      <button class="btn ghost sm" onClick={out}>Sign out</button>
    </header>
  );
}
