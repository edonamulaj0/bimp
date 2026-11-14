import { HTTPException } from 'hono/http-exception';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  AI_GATEWAY_URL?: string;
  ALLOW_SIGNUP?: string;
  /** Only bound in the bimp-ingest Worker. */
  INGEST: DurableObjectNamespace<import('./ingest').IngestContainer>;
  INGEST_URL?: string;
  INGEST_WORKFLOW: Workflow<import('./workflow').IngestParams>;
}
export type User = { id: string; email: string };
export type AppEnv = { Bindings: Env; Variables: { user: User } };

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 502 | 503, message: string) => new HTTPException(status, { message });
export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (data: string | ArrayBuffer) =>
  hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
