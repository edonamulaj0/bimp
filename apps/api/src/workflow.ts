import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { buildPlan, readDrawing, traceRequest, type Measured, type Raw } from './extract';
import { analyze, trace, type Analysis } from './ingest';
import { checkPlan } from '../../shared/standards';
import { type Env, failJob, now, sha256, toBase64 } from './util';

export type IngestParams = { jobId: string; projectId: string; fileId: string };
type Summary = Omit<Analysis, 'render_png' | 'segments' | 'texts'> & { renderSha: string; analysisKey: string; renderKey: string };
type PageResult = { page: number; rooms: number; doors: number; windows: number; warns: number; scale: string; measured: boolean; assumptions: string[]; usd: number } | { page: number; skipped: string };

const RETRY: WorkflowStepConfig = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' };
/** Pages of one PDF read in a run: each costs two model calls. Later pages are named in the result, not read. */
export const MAX_PAGES = 8;
const cents = (usd: number) => (usd <= 0 ? '0' : usd < 0.0001 ? '<0.01' : (usd * 100).toFixed(usd < 0.01 ? 2 : 1));

/**
 * Durable, resumable ingestion of one drawing, page by page:
 *   analyze (container: exact geometry, text, scale, render) -> read (Gemini, cached) -> trace (container: exact room
 *   outlines from the wall lines) -> measure + save (code).
 * Each step is retried on its own; large intermediate results live in R2, steps return only small summaries.
 * Every page that holds a floor plan becomes a plan of its own; page 1 is the one the project opens on.
 */
export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep) {
    const { jobId, projectId, fileId } = event.payload;
    const db = this.env.DB;
    // Each step first checks the project still exists: a deleted project stops its reading instead of retrying.
    const stage = async (s: string) => {
      if (!(await db.prepare('SELECT 1 FROM projects WHERE id = ?').bind(projectId).first())) throw new NonRetryableError('The project was deleted.');
      // a reading that was stopped (or already failed) stays stopped: nothing brings it back to running
      const r = await db.prepare("UPDATE jobs SET status = 'running', stage = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')").bind(s, now(), jobId).run();
      if (!r.meta.changes) throw new NonRetryableError('The reading was stopped.');
    };

    const analyzePage = (page: number, of: string) => step.do(`analyze page ${page}`, RETRY, async (): Promise<Summary> => {
      await stage(`${of}Extracting line work, text and scale…`);
      const f = await db.prepare('SELECT r2_key, mime FROM files WHERE id = ?').bind(fileId).first<{ r2_key: string; mime: string }>();
      const obj = f && (await this.env.FILES.get(f.r2_key));
      if (!f || !obj) throw new NonRetryableError('The uploaded file is missing.');
      let an: Analysis;
      try { an = await analyze(this.env, await obj.arrayBuffer(), f.mime, page); }
      catch (e) { if ((e as { status?: number }).status === 422 || (e as { status?: number }).status === 415) throw new NonRetryableError((e as Error).message); throw e; }
      const png = Uint8Array.from(atob(an.render_png), (c) => c.charCodeAt(0));
      const renderSha = await sha256(png.buffer);
      const renderKey = `projects/${projectId}/renders/${renderSha}.png`;
      const analysisKey = `projects/${projectId}/analysis/${renderSha}.json`;
      const { render_png, ...rest } = an;
      await Promise.all([
        this.env.FILES.put(renderKey, png, { httpMetadata: { contentType: 'image/png' } }),
        this.env.FILES.put(analysisKey, JSON.stringify(rest), { httpMetadata: { contentType: 'application/json' } }),
      ]);
      // the canvas shows this sheet while the model is being read
      await db.prepare("UPDATE jobs SET render_sha = ?, updated_at = ? WHERE id = ? AND status != 'done'").bind(renderSha, now(), jobId).run();
      return { kind: an.kind, width: an.width, height: an.height, scale: an.scale, page: an.page ?? 1, pages: an.pages ?? 1, renderSha, renderKey, analysisKey };
    });

    try {
      const first = await analyzePage(1, '');
      const total = first.pages ?? 1, pages = Math.min(total, MAX_PAGES);
      const results: PageResult[] = [];
      for (let n = 1; n <= pages; n++) {
        const of = pages > 1 ? `Page ${n} of ${pages}: ` : '';
        const sum = n === 1 ? first : await analyzePage(n, of);
        const loadAnalysis = async () => (await (await this.env.FILES.get(sum.analysisKey))!.json()) as Omit<Analysis, 'render_png'>;
        const loadPng = () => this.env.FILES.get(sum.renderKey).then((o) => o!.arrayBuffer()).then(toBase64);

        const raw = await step.do(`read page ${n} with AI`, RETRY, async (): Promise<Raw> => {
          await stage(`${of}Reading rooms, labels and openings…`);
          const [png, an] = await Promise.all([loadPng(), loadAnalysis()]);
          return readDrawing(this.env, png, sum.renderSha, an);
        });

        // Exact outlines from the wall lines. The plan stands without them, so a failure here is not a failed reading.
        const traced = await step.do(`trace page ${n}`, { retries: { limit: 1, delay: '3 seconds' }, timeout: '3 minutes' }, async (): Promise<Measured> => {
          await stage(`${of}Measuring walls and fittings on the drawing…`);
          try {
            const [png, an] = await Promise.all([loadPng(), loadAnalysis()]);
            const req = traceRequest(raw, an);
            if (!req.rooms.some((r) => r.length)) return { rooms: [] };
            const m = await trace(this.env, png, req);
            return { rooms: m.rooms ?? [], how: m.how, boxes: m.boxes, exterior_px: m.exterior_px ?? null };
          } catch (e) { console.warn('trace', jobId, (e as Error).message); return { rooms: [] }; }
        });

        results.push(await step.do(`measure and save page ${n}`, RETRY, async (): Promise<PageResult> => {
          await stage(`${of}Measuring and building the 2D and 3D plan…`);
          const an = await loadAnalysis();
          let plan;
          try { plan = buildPlan(raw, an, fileId, sum.renderSha, traced); }
          catch (e) {
            // a page without a floor plan (a title sheet, a section, a detail) is skipped; a file with no plan at all fails below
            if (pages > 1 && (e as { fatal?: boolean }).fatal) return { page: n, skipped: (e as Error).message };
            throw new NonRetryableError((e as Error).message);
          }
          const doors = plan.openings.filter((o) => o.kind === 'door').length;
          // Idempotent: the plan id comes from the job id and the page. Plans are dated by the upload, so a slow older
          // reading never replaces a newer drawing's plan; page 1 is dated last, so it is the one the project opens on.
          const job = await db.prepare('SELECT created_at FROM jobs WHERE id = ?').bind(jobId).first<{ created_at: number }>();
          await db.prepare('INSERT OR REPLACE INTO plans (id, project_id, file_id, data, note, created_at) VALUES (?,?,?,?,?,?)')
            .bind(n === 1 ? jobId : `${jobId}-p${n}`, projectId, fileId, JSON.stringify(plan), total > 1 ? `Page ${n} of ${total}` : null, (job?.created_at ?? now()) + (pages - n)).run();
          return { page: n, rooms: plan.rooms.length, doors, windows: plan.openings.length - doors, warns: checkPlan(plan).filter((c) => c.level === 'warn').length,
            scale: plan.scale.source, measured: plan.measured, assumptions: plan.assumptions, usd: raw.usage?.usd ?? 0 };
        }));
      }

      await step.do('finish', RETRY, async () => {
        const read = results.filter((r): r is Extract<PageResult, { rooms: number }> => 'rooms' in r);
        if (!read.length) throw new NonRetryableError('No rooms could be read from this drawing. Is it a floor plan?');
        const f = await db.prepare('SELECT filename FROM files WHERE id = ?').bind(fileId).first<{ filename: string }>();
        const one = (r: (typeof read)[number]) => `${r.rooms} rooms, ${r.doors} doors, ${r.windows} windows. Scale: ${r.scale}. ${r.measured ? 'Measured from the drawing.' : 'Preview, not measured.'}${r.warns ? ` ${r.warns} check${r.warns > 1 ? 's' : ''} to review in the canvas.` : ''}`;
        const usd = read.reduce((s, r) => s + r.usd, 0);
        const skipped = results.filter((r) => 'skipped' in r).map((r) => r.page);
        const text = total === 1
          ? `Read ${f?.filename ?? 'the drawing'}: ${one(read[0])}`
          : [`Read ${f?.filename ?? 'the drawing'}: **${read.length} floor plan${read.length > 1 ? 's' : ''}** on ${total} pages. Each is a revision; page ${read[0].page} is shown.`, '',
            ...read.map((r) => `- **Page ${r.page}:** ${one(r)}`),
            ...(skipped.length ? ['', `No floor plan found on page${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')}.`] : []),
            ...(total > pages ? ['', `Pages ${pages + 1} to ${total} were not read: ${MAX_PAGES} pages per file for now.`] : [])].join('\n');
        const note = { kind: 'system', claims: [], assumptions: read[0].assumptions, text,
          cost: { by: 'reading', usd, note: usd ? `Reading cost about ${cents(usd)}¢ in model calls; questions are answered from the stored plan.` : 'Read from the cache: no model calls.' } };
        // The message is written only by the run that flips the job to done.
        const done = await db.prepare("UPDATE jobs SET status = 'done', stage = 'Done', updated_at = ? WHERE id = ? AND status != 'done'").bind(now(), jobId).run();
        if (done.meta.changes) await db.batch([
          db.prepare('INSERT INTO messages (project_id, role, content, created_at) VALUES (?,?,?,?)').bind(projectId, 'assistant', JSON.stringify(note), now()),
          db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now(), projectId),
        ]);
      });
    } catch (e) {
      const msg = ((e as Error).message || '').replace(/^(\w*Error:\s*)+/, ''); // a step's error arrives with its class name in front
      console.error('ingest', jobId, msg);
      // Only messages written for users reach the chat; library and infrastructure errors get a fixed text.
      const safe = /^(This |The |No rooms|Files up to|Upload a |The AI )/.test(msg) && msg.length < 300 ? msg : 'the reading failed. Try again, or upload a clearer PDF or image.';
      if (!/project was deleted|reading was stopped/.test(msg)) await failJob(this.env, jobId, projectId, safe).catch(() => {});
      throw e;
    }
  }
}
