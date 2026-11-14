import { type Env, fail, now, sha256 } from './util';

export type Part = { text?: string; inlineData?: { mimeType: string; data: string }; functionCall?: { name: string; args: any }; functionResponse?: { name: string; response: any }; thought?: boolean };
export type Content = { role: 'user' | 'model'; parts: Part[] };

/**
 * Calls Gemini generateContent, through Cloudflare AI Gateway when configured. Pass cacheKey to never pay twice;
 * only complete responses (finishReason STOP) that pass `check` are cached, so a bad reply is retried, not replayed.
 */
export async function generate(env: Env, body: Record<string, unknown>, cacheKey?: string, check?: (c: Content) => void): Promise<Content> {
  if (!env.GEMINI_API_KEY) throw fail(503, 'AI answers are switched off on this server right now.');
  let model = await currentModel(env);
  const key = cacheKey && (await sha256(`${model}:${cacheKey}`));
  if (key) {
    const hit = await env.DB.prepare('SELECT response FROM model_cache WHERE key = ?').bind(key).first<{ response: string }>();
    if (hit) return JSON.parse(hit.response);
  }
  const call = (m: string) => fetch(`${apiBase(env)}/v1beta/models/${m}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify(body),
  });
  let res = await call(model);
  // 404: the model was retired or renamed. Pick the newest Flash model this key can use, remember it, try once more.
  if (res.status === 404) {
    const next = await newestFlash(env, model);
    if (next) { console.warn('gemini', `model ${model} not found, using ${next}`); model = next; res = await call(model); }
  }
  if (!res.ok) {
    console.error('gemini', res.status, (await res.text()).slice(0, 500));
    throw fail(502, res.status === 404 ? `The AI model "${model}" isn't available to this API key. Set GEMINI_MODEL to a current model (for example gemini-flash-latest).` : `The AI service returned an error (${res.status}). Try again.`);
  }
  const json = (await res.json()) as { candidates?: { content?: Content; finishReason?: string }[] };
  const content = json.candidates?.[0]?.content, fr = json.candidates?.[0]?.finishReason;
  if (!content?.parts?.length) throw fail(502, 'The AI service returned an empty response.');
  if (fr && fr !== 'STOP') throw fail(502, `The AI response was incomplete (${fr}). Try again.`);
  check?.(content);
  if (key) await env.DB.prepare('INSERT OR REPLACE INTO model_cache (key, model, response, created_at) VALUES (?, ?, ?, ?)')
    .bind(key, model, JSON.stringify(content), now()).run();
  return content;
}

const apiBase = (env: Env) => (env.AI_GATEWAY_URL ? `${env.AI_GATEWAY_URL.replace(/\/$/, '')}/google-ai-studio` : 'https://generativelanguage.googleapis.com');

/** The model in use: GEMINI_MODEL, unless it was found missing earlier in this isolate and replaced. */
let replaced: { from: string; to: string } | null = null;
async function currentModel(env: Env) {
  const configured = env.GEMINI_MODEL || 'gemini-flash-latest';
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
    if (pick) replaced = { from: env.GEMINI_MODEL || 'gemini-flash-latest', to: pick };
    return pick;
  } catch {
    return null;
  }
}

export const textOf = (c: Content) => c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
