import { Container, getRandom } from '@cloudflare/containers';
import type { Env } from './util';

/** Python ingestion service (ingest/service.py) running in Cloudflare Containers. */
export class IngestContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
}

export type Analysis = {
  kind: 'pdf-vector' | 'pdf-scan' | 'image' | 'dxf';
  /** PDFs: the page that was read (1-based) and how many the file has. */
  page?: number;
  pages?: number;
  width: number;
  height: number;
  render_png: string;
  segments: [number, number, number, number][];
  texts: { text: string; bbox: [number, number, number, number] }[];
  scale: { meters_per_px: number; source: string; ratio?: number; all_ratios?: number[] } | null;
  /** Size of one render pixel on the paper sheet (PDF page size, image DPI); null when unknown. */
  paper_mm_per_px?: number | null;
  /** Scans and images: symbols found by the fixture detector, boxes in render pixels. null/absent = detector not installed. */
  detections?: { kind: string; conf: number; bbox: [number, number, number, number] }[] | null;
};

async function call<T>(env: Env, path: string, init: RequestInit): Promise<T> {
  // Local dev without Docker: run `npm run ingest:dev` and set INGEST_URL in .dev.vars.
  const res = env.INGEST_URL
    ? await fetch(`${env.INGEST_URL.replace(/\/$/, '')}${path}`, init)
    : await (await getRandom(env.INGEST, 3)).fetch(new Request(`http://ingest${path}`, init));
  const json = (await res.json().catch(() => ({ error: `ingestion service returned ${res.status}` }))) as T & { error?: string };
  if (!res.ok || json.error) throw Object.assign(new Error(json.error ?? `ingestion service returned ${res.status}`), { status: res.status });
  return json;
}

/** Exact geometry, text, scale and a render of one drawing; `page` picks the page of a PDF (1-based). */
export const analyze = (env: Env, data: ArrayBuffer, mime: string, page = 1) =>
  call<Analysis>(env, '/analyze', { method: 'POST', headers: { 'content-type': mime, 'x-page': String(page) }, body: data });

/**
 * What the render itself shows: exact room outlines from its wall lines, the boxes of fittings and furniture tightened
 * onto their lines, and the thickness of the outside walls. One answer per room and box asked for, null where unclear.
 */
export const trace = (env: Env, png: string, req: { rooms: number[][][]; close: number[][]; boxes: number[][] }) =>
  call<import('./extract').Measured>(env, '/trace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ png, ...req }) });

/** Enlarged, overlapping pieces of the part of the render that holds the plan (`box`, render pixels), for a second reading of small things. */
export const tiles = (env: Env, png: string, box: number[]) =>
  call<{ tiles: { png: string; box: number[] }[] }>(env, '/tiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ png, box }) });
