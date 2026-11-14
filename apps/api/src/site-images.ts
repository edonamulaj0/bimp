// Marketing-site images: on first request, each render in SITE_IMAGES is uploaded to Cloudinary by URL (Cloudinary
// fetches it from this site) with its image as an eager transformation; later requests just return the URLs.
// Public and cheap: generation happens at most once per image (or when its transformation changes), in waitUntil.
import { Hono } from 'hono';
import { SITE_IMAGES } from '../../shared/site-images';
import { signParams, visualsOn } from './visuals';
import { type AppEnv, type Env, now } from './util';

type Row = { key: string; public_id: string | null; transformation: string; status: string; updated_at: number };
const RETRY_MS = 30 * 60 * 1000;

async function generate(env: Env, origin: string, key: string) {
  const img = SITE_IMAGES.find((i) => i.key === key)!;
  try {
    const params: Record<string, string> = {
      eager: img.transformation, eager_async: 'true', overwrite: 'true', public_id: `bimp-site/${img.key}`, tags: 'bimp,site', timestamp: String(Math.floor(now() / 1000)),
    };
    const form = new FormData();
    form.set('file', `${origin}${img.source}`);
    for (const [k, v] of Object.entries(params)) form.set(k, v);
    form.set('api_key', env.CLOUDINARY_API_KEY!);
    form.set('signature', await signParams(params, env.CLOUDINARY_API_SECRET!));
    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME!)}/image/upload`, { method: 'POST', body: form });
    const d = (await res.json().catch(() => ({}))) as { public_id?: string; error?: { message?: string } };
    if (!res.ok || !d.public_id) throw new Error(d.error?.message ?? `HTTP ${res.status}`);
    await env.DB.prepare("UPDATE site_images SET public_id = ?, status = 'ready', error = NULL, updated_at = ? WHERE key = ?").bind(d.public_id, now(), key).run();
  } catch (e) {
    await env.DB.prepare("UPDATE site_images SET status = 'failed', error = ?, updated_at = ? WHERE key = ?").bind(String((e as Error).message).slice(0, 300), now(), key).run();
  }
}

export const site = new Hono<AppEnv>();

site.get('/images', async (c) => {
  if (!visualsOn(c.env)) return c.json({ images: {} });
  const origin = new URL(c.req.url).origin;
  const { results } = await c.env.DB.prepare('SELECT key, public_id, transformation, status, updated_at FROM site_images').all<Row>();
  const rows = new Map(results.map((r) => [r.key, r]));
  // Cloudinary can only fetch the renders from a public origin, so nothing is generated from a local dev server
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin);
  const todo = SITE_IMAGES.filter((i) => {
    const r = rows.get(i.key);
    return !r || r.transformation !== i.transformation || (r.status === 'failed' && now() - r.updated_at > RETRY_MS) || (r.status === 'pending' && now() - r.updated_at > RETRY_MS);
  });
  if (todo.length && !local) {
    for (const i of todo) {
      // claim it first, so concurrent visitors don't start the same generation
      const claim = await c.env.DB.prepare(`INSERT INTO site_images (key, public_id, transformation, status, updated_at) VALUES (?, NULL, ?, 'pending', ?)
        ON CONFLICT(key) DO UPDATE SET transformation = excluded.transformation, status = 'pending', updated_at = excluded.updated_at
        WHERE site_images.transformation <> excluded.transformation OR site_images.updated_at < ?`).bind(i.key, i.transformation, now(), now() - RETRY_MS).run();
      if (claim.meta.changes) c.executionCtx.waitUntil(generate(c.env, origin, i.key));
    }
  }
  const base = `https://res.cloudinary.com/${c.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const images: Record<string, string> = {};
  for (const i of SITE_IMAGES) {
    const r = rows.get(i.key);
    if (r?.status === 'ready' && r.public_id && r.transformation === i.transformation) images[i.key] = `${base}/${i.transformation}/${r.public_id}.jpg`;
  }
  return c.json({ images }, 200, { 'cache-control': 'public, max-age=120' });
});
