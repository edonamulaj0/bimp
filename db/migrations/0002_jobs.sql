-- One row per ingestion run (a Cloudflare Workflow instance with the same id).
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status TEXT NOT NULL,          -- queued | running | done | failed
  stage TEXT NOT NULL,           -- human-readable progress
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_project ON jobs(project_id, created_at DESC);
