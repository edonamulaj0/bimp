import { user } from './state';

type Opts = { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> };

export async function api<T = any>(path: string, o: Opts = {}): Promise<T> {
  const hasBody = o.json !== undefined || o.body !== undefined;
  const res = await fetch(`/api${path}`, {
    method: o.method ?? (hasBody ? 'POST' : 'GET'),
    headers: { ...(o.json !== undefined ? { 'content-type': 'application/json' } : {}), ...o.headers },
    body: o.json !== undefined ? JSON.stringify(o.json) : o.body,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth')) user.value = null;
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}
