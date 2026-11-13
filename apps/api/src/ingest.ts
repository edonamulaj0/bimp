import { Container, getRandom } from '@cloudflare/containers';
import type { Env } from './util';

/** Python ingestion service (ingest/service.py) running in Cloudflare Containers. */
export class IngestContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
}

export type Analysis = {
  kind: 'pdf-vector' | 'pdf-scan' | 'image' | 'dxf';
  width: number;
  height: number;
  render_png: string;
  segments: [number, number, number, number][];
  texts: { text: string; bbox: [number, number, number, number] }[];
  scale: { meters_per_px: number; source: string; ratio?: number; all_ratios?: number[] } | null;
  /** Size of one render pixel on the paper sheet (PDF page size, image DPI); null when unknown. */
  paper_mm_per_px?: number | null;
};

export async function analyze(env: Env, data: ArrayBuffer, mime: string): Promise<Analysis> {
  const init = { method: 'POST', headers: { 'content-type': mime }, body: data };
  // Local dev without Docker: run `npm run ingest:dev` and set INGEST_URL in .dev.vars.
  const res = env.INGEST_URL
    ? await fetch(`${env.INGEST_URL.replace(/\/$/, '')}/analyze`, init)
    : await (await getRandom(env.INGEST, 3)).fetch(new Request('http://ingest/analyze', init));
  const json = (await res.json().catch(() => ({ error: `ingestion service returned ${res.status}` }))) as Analysis & { error?: string };
  if (!res.ok || json.error) throw Object.assign(new Error(json.error ?? `ingestion service returned ${res.status}`), { status: res.status });
  return json;
}
