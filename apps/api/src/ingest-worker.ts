// Second Worker ("bimp-ingest"): hosts the ingestion Workflow and the Container.
// Kept apart from the web/API Worker because Workers with Durable Objects (Containers are one) get no preview URLs.
export { IngestContainer } from './ingest';
export { IngestWorkflow } from './workflow';

export default {
  fetch: () => new Response('bimp ingestion worker', { status: 404 }),
} satisfies ExportedHandler;
