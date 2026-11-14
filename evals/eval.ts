// Run: npm run eval -- --sample 500 [--split dev|held-out] [--seed 1] [--all]
// Scores bimp on the challenge questions with the official rules: counts exact; areas, lengths and volumes within 2 %.
// Text answers are not scored here (they are free-form and need review).
//
// Needs: the ingestion service on INGEST_URL (default http://127.0.0.1:8090, `npm run ingest:dev`), and either
// DATASET_DIR (a local copy holding questions.jsonl and data/) or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID to read
// r2://bimp-files/dataset/. Drawings and their analyses are cached in evals/.cache, so a second run is fast and
// gives the same numbers.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { route, templateOf, type Evidence } from '../apps/shared/templates';

type Question = { path: string; question: string; answer: number | string; unit: string | null; type: string };
type Result = Question & { source: string; template: string | null; got: number | null; correct: boolean | null; error?: string };

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const SPLIT = flag('split', 'dev'), SEED = flag('seed', '1'), SAMPLE = args.includes('--all') ? Infinity : Number(flag('sample', '500'));
const CACHE = join(process.cwd(), 'evals', '.cache'), REPORTS = join(process.cwd(), 'evals', 'reports');
const INGEST = (process.env.INGEST_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const HELD_OUT = 0.2;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const frac = (s: string) => parseInt(hash(s).slice(0, 8), 16) / 0x100000000;
const sourceOf = (path: string) => path.split('/')[1];
/** Split by drawing, never by question: every question about a drawing lands on the same side. */
export const splitOf = (path: string) => (frac(`split:${path}`) < HELD_OUT ? 'held-out' : 'dev');

/** Official scoring. null = not scored automatically (text answers). */
export function score(q: Pick<Question, 'type' | 'answer'>, got: number | null): boolean | null {
  if (q.type === 'text' || q.type === 'other' || typeof q.answer !== 'number') return null;
  if (got === null || !Number.isFinite(got)) return false;
  if (q.type === 'count') return got === q.answer;
  return q.answer === 0 ? got === 0 : Math.abs(got - q.answer) / Math.abs(q.answer) <= 0.02;
}

async function datasetFile(rel: string): Promise<Buffer> {
  if (process.env.DATASET_DIR) return readFileSync(join(process.env.DATASET_DIR, rel));
  const file = join(CACHE, 'dataset', rel);
  if (existsSync(file)) return readFileSync(file);
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!token || !account) throw new Error('Set DATASET_DIR, or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to read the dataset from R2.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/bimp-files/objects/${encodeURIComponent(`dataset/${rel}`)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
      return data;
    }
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`dataset/${rel}: R2 returned ${res.status}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', dxf: 'application/dxf' };

/** What the ingestion service measured on a drawing (no language model), cached by drawing and detector model. */
async function evidence(path: string): Promise<Evidence> {
  const mime = MIME[path.split('.').pop()!.toLowerCase()];
  if (!mime) throw new Error('format not read yet');
  const file = join(CACHE, 'analysis', `${hash(path).slice(0, 16)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(`${INGEST}/analyze`, { method: 'POST', headers: { 'content-type': mime }, body: await datasetFile(path) });
  const json = (await res.json().catch(() => ({ error: `ingestion service returned ${res.status}` }))) as Evidence & { error?: string; texts?: unknown };
  if (!res.ok || json.error) throw new Error(json.error ?? `ingestion service returned ${res.status}`);
  const ev = { kind: json.kind, detections: json.detections ?? null, texts: json.texts };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(ev));
  return ev;
}

/** Proportional sample over source × type (at least one per stratum), in an order fixed by the seed. */
function sample(all: Question[], n: number): Question[] {
  if (n >= all.length) return all;
  const strata = new Map<string, Question[]>();
  for (const q of all) { const k = `${sourceOf(q.path)}|${q.type}`; (strata.get(k) ?? strata.set(k, []).get(k)!).push(q); }
  const out: Question[] = [];
  for (const qs of strata.values()) {
    const take = Math.max(1, Math.round((qs.length / all.length) * n));
    out.push(...qs.map((q) => [hash(`${SEED}:${q.path}:${q.question}`), q] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, take).map((x) => x[1]));
  }
  return out;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
function table(title: string, rows: Result[], key: (r: Result) => string) {
  const groups = new Map<string, Result[]>();
  for (const r of rows) (groups.get(key(r)) ?? groups.set(key(r), []).get(key(r))!).push(r);
  const lines = [...groups.entries()].sort().map(([k, rs]) => {
    const scored = rs.filter((r) => r.correct !== null), answered = scored.filter((r) => r.got !== null), right = scored.filter((r) => r.correct);
    return { k, n: rs.length, scored: scored.length, answered: answered.length, right: right.length };
  });
  const w = Math.max(title.length, ...lines.map((l) => l.k.length));
  const row = (k: string, ...c: (string | number)[]) => `${k.padEnd(w)}  ${c.map((x) => String(x).padStart(9)).join('  ')}`;
  return [row(title, 'questions', 'scored', 'answered', 'correct', 'accuracy', 'if answ.'),
    ...lines.map((l) => row(l.k, l.n, l.scored, l.answered, l.right, pct(l.right, l.scored), pct(l.right, l.answered)))].join('\n');
}

async function main() {
  const all = (await datasetFile('questions.jsonl')).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Question);
  const pool = all.filter((q) => splitOf(q.path) === SPLIT);
  const picked = sample(pool, SAMPLE);
  const drawings = [...new Set(picked.map((q) => q.path))];
  console.log(`${all.length} questions; ${SPLIT} split: ${pool.length} questions on ${new Set(pool.map((q) => q.path)).size} drawings; scoring ${picked.length} on ${drawings.length} drawings (seed ${SEED})`);

  // Only drawings with a routable question are read; everything else is unanswered for now and scores as wrong.
  const needed = [...new Set(picked.filter((q) => templateOf(q.question)).map((q) => q.path))];
  const evs = new Map<string, Evidence | Error>();
  let done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let path = needed.pop(); path; path = needed.pop()) {
      evs.set(path, await evidence(path).catch((e: Error) => e));
      if (++done % 50 === 0) console.log(`  read ${done} drawings`);
    }
  }));

  const results: Result[] = picked.map((q) => {
    const base = { ...q, source: sourceOf(q.path), template: templateOf(q.question) };
    const ev = evs.get(q.path);
    if (!base.template || !ev) return { ...base, got: null, correct: score(q, null) };
    if (ev instanceof Error) return { ...base, got: null, correct: score(q, null), error: ev.message };
    const got = route(q.question, ev)?.answer ?? null;
    return { ...base, got, correct: score(q, got) };
  });

  const report = [
    `bimp eval · ${SPLIT} split · ${results.length} questions · seed ${SEED}`,
    'accuracy = correct / scored (unanswered counts as wrong); "if answ." = correct / answered; text answers are not scored',
    '', table('source · type', results, (r) => `${r.source} · ${r.type}`),
    '', table('template', results.filter((r) => r.template), (r) => `${r.source} · ${r.template}`),
    '', table('total', results, () => 'all'),
  ].join('\n');
  console.log(`\n${report}`);
  const errors = results.filter((r) => r.error);
  if (errors.length) console.log(`\n${errors.length} questions on drawings that could not be read, e.g. ${errors[0].path}: ${errors[0].error}`);
  mkdirSync(REPORTS, { recursive: true });
  const name = `${SPLIT}-${results.length}-seed${SEED}`;
  writeFileSync(join(REPORTS, `${name}.txt`), `${report}\n`);
  writeFileSync(join(REPORTS, `${name}.jsonl`), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nSaved evals/reports/${name}.txt and .jsonl`);
}

if (process.argv[1]?.includes('eval')) main().catch((e) => { console.error(e.message); process.exit(1); });
