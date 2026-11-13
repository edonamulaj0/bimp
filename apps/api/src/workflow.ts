import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { buildPlan, readDrawing, type Raw } from './extract';
import { analyze, type Analysis } from './ingest';
import { type Env, now, sha256, toBase64 } from './util';

export type IngestParams = { jobId: string; projectId: string; fileId: string };
type Summary = Omit<Analysis, 'render_png' | 'segments' | 'texts'> & { renderSha: string; analysisKey: string; renderKey: string };

const RETRY: WorkflowStepConfig = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' };

/**
 * Durable, resumable ingestion of one drawing:
 *   analyze (container: exact geometry, text, scale, render) -> read (Gemini, cached) -> measure + save (code).
 * Each step is retried on its own; large intermediate results live in R2, steps return only small summaries.
 */
export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep) {
    const { jobId, projectId, fileId } = event.payload;
    const db = this.env.DB;
    const stage = (s: string) => db.prepare("UPDATE jobs SET status = 'running', stage = ?, updated_at = ? WHERE id = ? AND status != 'done'").bind(s, now(), jobId).run();

    try {
      const sum = await step.do('analyze drawing', RETRY, async (): Promise<Summary> => {
        await stage('Extracting line work, text and scale…');
        const f = await db.prepare('SELECT r2_key, mime FROM files WHERE id = ?').bind(fileId).first<{ r2_key: string; mime: string }>();
        const obj = f && (await this.env.FILES.get(f.r2_key));
        if (!f || !obj) throw new NonRetryableError('The uploaded file is missing.');
        let an: Analysis;
        try { an = await analyze(this.env, await obj.arrayBuffer(), f.mime); }
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
        return { kind: an.kind, width: an.width, height: an.height, scale: an.scale, renderSha, renderKey, analysisKey };
      });

      const loadAnalysis = async () => (await (await this.env.FILES.get(sum.analysisKey))!.json()) as Omit<Analysis, 'render_png'>;

      const raw = await step.do('read with AI', RETRY, async (): Promise<Raw> => {
        await stage('Reading rooms, labels and openings…');
        const [png, an] = await Promise.all([this.env.FILES.get(sum.renderKey).then((o) => o!.arrayBuffer()), loadAnalysis()]);
        return readDrawing(this.env, toBase64(png), sum.renderSha, an);
      });

      await step.do('measure and save', RETRY, async () => {
        await stage('Measuring and building the 2D and 3D plan…');
        const an = await loadAnalysis();
        let plan;
        try { plan = buildPlan(raw, an, fileId, sum.renderSha); }
        catch (e) { throw new NonRetryableError((e as Error).message); }
        const f = await db.prepare('SELECT filename FROM files WHERE id = ?').bind(fileId).first<{ filename: string }>();
        const doors = plan.openings.filter((o) => o.kind === 'door').length, windows = plan.openings.length - doors;
        const note = {
          kind: 'system', claims: [], assumptions: plan.assumptions,
          text: `Read ${f?.filename ?? 'the drawing'}: ${plan.rooms.length} rooms, ${doors} doors, ${windows} windows. Scale: ${plan.scale.source}. ${plan.measured ? 'Measured from the drawing.' : 'Preview, not measured.'}`,
        };
        // Idempotent: the plan id is the job id, and the message is written only by the run that flips the job to done.
        await db.prepare('INSERT OR REPLACE INTO plans (id, project_id, file_id, data, created_at) VALUES (?,?,?,?,?)').bind(jobId, projectId, fileId, JSON.stringify(plan), now()).run();
        const done = await db.prepare("UPDATE jobs SET status = 'done', stage = 'Done', updated_at = ? WHERE id = ? AND status != 'done'").bind(now(), jobId).run();
        if (done.meta.changes) await db.batch([
          db.prepare('INSERT INTO messages (project_id, role, content, created_at) VALUES (?,?,?,?)').bind(projectId, 'assistant', JSON.stringify(note), now()),
          db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now(), projectId),
        ]);
      });
    } catch (e) {
      const msg = (e as Error).message || 'Ingestion failed';
      await db.prepare("UPDATE jobs SET status = 'failed', stage = 'Failed', error = ?, updated_at = ? WHERE id = ?").bind(msg.slice(0, 500), now(), jobId).run();
      throw e;
    }
  }
}
