import { type Env, fail, now, sha256 } from './util';

export type Part = { text?: string; inlineData?: { mimeType: string; data: string }; functionCall?: { name: string; args: any }; functionResponse?: { name: string; response: any }; thought?: boolean };
export type Content = { role: 'user' | 'model'; parts: Part[] };

/**
 * Calls Gemini generateContent, through Cloudflare AI Gateway when configured. Pass cacheKey to never pay twice;
 * only complete responses (finishReason STOP) that pass `check` are cached, so a bad reply is retried, not replayed.
 */
export async function generate(env: Env, body: Record<string, unknown>, cacheKey?: string, check?: (c: Content) => void, meter?: Meter): Promise<Content> {
  if (!env.GEMINI_API_KEY) throw fail(503, 'AI answers are switched off on this server right now.');
  let model = await currentModel(env);
  const key = cacheKey && (await sha256(`${model}:${cacheKey}`));
  if (key) {
    const hit = await env.DB.prepare('SELECT response FROM model_cache WHERE key = ?').bind(key).first<{ response: string }>();
    if (hit) { if (meter) meter.cached++; return JSON.parse(hit.response); }
  }
  // Streamed: a long reading sends bytes as it goes, so the connection is not cut while the model is still working (524).
  const call = (m: string) => fetch(`${apiBase(env)}/v1beta/models/${m}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify(forModel(env, m, body)),
  });
  let res = await call(model);
  // 404: the model was retired or renamed. Pick the newest Flash model this key can use, remember it, try once more.
  if (res.status === 404) {
    const next = await newestFlash(env, model);
    if (next) { console.warn('gemini', `model ${model} not found, using ${next}`); model = next; res = await call(model); }
  }
  if (!res.ok) {
    console.error('gemini', res.status, (await res.text()).slice(0, 500));
    throw fail(502, res.status === 404 ? `The AI model "${model}" isn't available to this API key. Set GEMINI_MODEL to a current model (for example gemini-4-hydrogen).` : `The AI service returned an error (${res.status}). Try again.`);
  }
  const { content, finishReason: fr, usage } = joinStream(await res.text());
  if (meter) { meter.calls++; meter.tokens_in += usage.in; meter.tokens_out += usage.out; }
  if (!content?.parts?.length) throw fail(502, 'The AI service returned an empty response.');
  if (fr && fr !== 'STOP') throw fail(502, `The AI response was incomplete (${fr}). Try again.`);
  check?.(content);
  if (key) await env.DB.prepare('INSERT OR REPLACE INTO model_cache (key, model, response, created_at) VALUES (?, ?, ?, ?)')
    .bind(key, model, JSON.stringify(content), now()).run();
  return content;
}

const DEFAULT_MODEL = 'gemini-4-hydrogen';
const LEVELS = ['low', 'medium', 'high', 'xhigh'];

/**
 * The request as the model in use wants it. Gemini 4 models take no sampling parameters (temperature, topP, topK) and
 * think at a level instead: GEMINI_THINKING (low | medium | high | xhigh), else the model's own default. Older models
 * get the request unchanged.
 */
export function forModel(env: Pick<Env, 'GEMINI_THINKING'>, model: string, body: Record<string, unknown>): Record<string, unknown> {
  if (!/^gemini-4/.test(model)) return body;
  const { temperature: _t, topP: _p, topK: _k, ...config } = (body.generationConfig ?? {}) as Record<string, unknown>;
  const level = (env.GEMINI_THINKING ?? '').toLowerCase();
  if (LEVELS.includes(level)) config.thinkingConfig = { ...(config.thinkingConfig as object | undefined), thinkingLevel: level };
  return { ...body, generationConfig: config };
}

type Chunk = { candidates?: { content?: Partial<Content>; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };

/** What a run of model calls used: calls made, answers served from the cache (free), and tokens in and out (thinking counts as out). */
export type Meter = { calls: number; cached: number; tokens_in: number; tokens_out: number };
export const meter = (): Meter => ({ calls: 0, cached: 0, tokens_in: 0, tokens_out: 0 });
/**
 * Cost in US dollars at the list price per million tokens: GEMINI_PRICE_IN / GEMINI_PRICE_OUT, by default the paid-tier
 * price of Gemini 4 Hydrogen (1.50 in, 7.50 out). An estimate: the free tier, batch and cached-input prices are lower.
 */
export function costUsd(env: Env, m: Meter) {
  const price = (v: string | undefined, d: number) => { const n = Number(v); return v && Number.isFinite(n) && n >= 0 ? n : d; };
  return (m.tokens_in * price(env.GEMINI_PRICE_IN, 1.5) + m.tokens_out * price(env.GEMINI_PRICE_OUT, 7.5)) / 1e6;
}

/** Joins a streamed reply (server-sent events, or one plain JSON body) into a single Content. Text pieces are concatenated; other parts are kept as sent. */
export function joinStream(body: string): { content: Content | null; finishReason?: string; usage: { in: number; out: number } } {
  const events = body.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter((l) => l && l !== '[DONE]');
  const chunks: Chunk[] = events.length ? events.map((e) => JSON.parse(e)) : [JSON.parse(body)];
  const parts: Part[] = [];
  let finishReason: string | undefined;
  const usage = { in: 0, out: 0 };
  for (const chunk of chunks) {
    // each chunk reports the running totals; the last one is the whole call
    const u = chunk.usageMetadata;
    if (u) { usage.in = u.promptTokenCount ?? usage.in; usage.out = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || usage.out; }
    const cand = chunk.candidates?.[0];
    if (cand?.finishReason) finishReason = cand.finishReason;
    for (const part of cand?.content?.parts ?? []) {
      const last = parts[parts.length - 1];
      const plain = (p: Part) => typeof p.text === 'string' && !p.functionCall && !p.functionResponse && !p.inlineData;
      if (last && plain(last) && plain(part) && !!last.thought === !!part.thought) parts[parts.length - 1] = { ...last, ...part, text: last.text! + part.text! };
      else parts.push({ ...part });
    }
  }
  return { content: parts.length ? { role: 'model', parts } : null, finishReason, usage };
}

const apiBase = (env: Env) => (env.AI_GATEWAY_URL ? `${env.AI_GATEWAY_URL.replace(/\/$/, '')}/google-ai-studio` : 'https://generativelanguage.googleapis.com');

/** The model in use: GEMINI_MODEL, unless it was found missing earlier in this isolate and replaced. */
let replaced: { from: string; to: string } | null = null;
async function currentModel(env: Env) {
  const configured = env.GEMINI_MODEL || DEFAULT_MODEL;
  return replaced?.from === configured ? replaced.to : configured;
}

/** Lists the models this key can call and returns the best Flash model for generateContent (not the one that failed). */
async function newestFlash(env: Env, failed: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase(env)}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY! } });
    if (!res.ok) return null;
    const { models = [] } = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const names = models.filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).filter((n) => n !== failed);
    const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const stable = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => version(b) - version(a));
    const pick = names.includes('gemini-flash-latest') && failed !== 'gemini-flash-latest' ? 'gemini-flash-latest'
      : stable[0] ?? names.filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio|embedding/.test(n)).sort((a, b) => version(b) - version(a))[0] ?? null;
    if (pick) replaced = { from: env.GEMINI_MODEL || DEFAULT_MODEL, to: pick };
    return pick;
  } catch {
    return null;
  }
}

export const textOf = (c: Content) => c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
