import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { type AppEnv, type Env, fail, now, sha256, uid } from './util';

// Workers cap PBKDF2 at 100k iterations.
const ITER = 100_000;
const COOKIE = '__Host-bimp_session';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function validate(body: unknown) {
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') throw fail(400, 'Email and password are required.');
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw fail(400, 'Enter a valid email address.');
  if (password.length > 256) throw fail(400, 'Password is too long.');
  return { email: e, password };
}

export async function createUser(env: Env, email: string, password: string) {
  if (password.length < 10) throw fail(400, 'Use at least 10 characters for your password.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITER);
  const id = uid();
  try {
    await env.DB.prepare('INSERT INTO users (id, email, pw_hash, pw_salt, pw_iter, created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, email, b64(hash), b64(salt), ITER, now()).run();
  } catch (e) {
    if (!String(e).includes('UNIQUE')) throw e;
    throw fail(409, 'An account with this email already exists. Sign in instead.');
  }
  return { id, email };
}

export async function checkLogin(env: Env, email: string, password: string, ip: string) {
  const since = now() - WINDOW_MS;
  const keys = [`e:${email}`, `ip:${ip}`];
  const { results } = await env.DB.prepare('SELECT key, COUNT(*) AS n FROM login_failures WHERE key IN (?, ?) AND at > ? GROUP BY key')
    .bind(...keys, since).all();
  const counts = Object.fromEntries((results as { key: string; n: number }[]).map((r) => [r.key, r.n]));
  if ((counts[keys[0]] ?? 0) >= 8 || (counts[keys[1]] ?? 0) >= 30) throw fail(429, 'Too many attempts. Wait 15 minutes and try again.');

  const row = await env.DB.prepare('SELECT id, pw_hash, pw_salt, pw_iter FROM users WHERE email = ?').bind(email)
    .first<{ id: string; pw_hash: string; pw_salt: string; pw_iter: number }>();
  // Hash even when the user doesn't exist so timing doesn't reveal which emails have accounts.
  const hash = await pbkdf2(password, row ? unb64(row.pw_salt) : new Uint8Array(16), row?.pw_iter ?? ITER);
  if (row && equal(hash, unb64(row.pw_hash))) return { id: row.id, email };

  await env.DB.batch([
    ...keys.map((k) => env.DB.prepare('INSERT INTO login_failures (key, at) VALUES (?, ?)').bind(k, now())),
    env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(now() - 24 * 3600 * 1000),
  ]);
  throw fail(401, 'Email or password is incorrect.');
}

export async function startSession(c: Context<AppEnv>, userId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + SESSION_MS).run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MS / 1000 });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/', secure: true });
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw fail(401, 'Sign in to continue.');
  const user = await c.env.DB.prepare(
    'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).bind(await sha256(token), now()).first<{ id: string; email: string }>();
  if (!user) throw fail(401, 'Your session has expired. Sign in again.');
  c.set('user', user);
  await next();
};

/** CSRF: SameSite=Lax cookie plus a same-origin check on every state-changing request. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (!origin || origin !== new URL(c.req.url).origin) throw fail(403, 'Cross-origin request blocked.');
  }
  await next();
};
