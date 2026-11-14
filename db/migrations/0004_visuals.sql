-- Architectural images generated with Cloudinary from a project's 3D model (see apps/api/src/visuals.ts).
CREATE TABLE visuals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  public_id TEXT NOT NULL,       -- Cloudinary public id of the uploaded model snapshot
  format TEXT NOT NULL,          -- delivery extension of the snapshot (png)
  style TEXT NOT NULL,           -- preset key, or 'custom'
  prompt TEXT,                   -- the scene prompt used, when generative
  transformation TEXT NOT NULL,  -- the eager (pre-generated) Cloudinary transformation
  created_at INTEGER NOT NULL
);
CREATE INDEX visuals_project ON visuals(project_id, created_at);
CREATE INDEX visuals_user ON visuals(user_id, created_at);
