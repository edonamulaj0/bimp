import { type Env, fail, now, sha256 } from './util';

export type Part = { text?: string; inlineData?: { mimeType: string; data: string }; functionCall?: { name: string; args: any }; functionResponse?: { name: string; response: any }; thought?: boolean };
export type Content = { role: 'user' | 'model'; parts: Part[] };

/** Calls Gemini generateContent, through Cloudflare AI Gateway when configured. Pass cacheKey to never pay twice. */
export async function generate(env: Env, body: Record<string, unknown>, cacheKey?: string): Promise<Content> {
  if (!env.GEMINI_API_KEY) throw fail(503, 'AI is not configured yet: set the GEMINI_API_KEY secret.');
  const model = env.GEMINI_MODEL;
  const key = cacheKey && (await sha256(`${model}:${cacheKey}`));
  if (key) {
    const hit = await env.DB.prepare('SELECT response FROM model_cache WHERE key = ?').bind(key).first<{ response: string }>();
    if (hit) return JSON.parse(hit.response);
  }
  const base = env.AI_GATEWAY_URL ? `${env.AI_GATEWAY_URL.replace(/\/$/, '')}/google-ai-studio` : 'https://generativelanguage.googleapis.com';
  const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('gemini', res.status, (await res.text()).slice(0, 500));
    throw fail(502, `The AI service returned an error (${res.status}). Try again.`);
  }
  const json = (await res.json()) as { candidates?: { content?: Content }[] };
  const content = json.candidates?.[0]?.content;
  if (!content?.parts?.length) throw fail(502, 'The AI service returned an empty response.');
  if (key) await env.DB.prepare('INSERT OR REPLACE INTO model_cache (key, model, response, created_at) VALUES (?, ?, ?, ?)')
    .bind(key, model, JSON.stringify(content), now()).run();
  return content;
}

export const textOf = (c: Content) => c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
