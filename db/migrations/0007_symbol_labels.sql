-- What people say a symbol is, when bimp could not name it (or named it wrongly): the place on the sheet and the name.
-- Kept apart from the plans so the examples outlive them: they are the training set for the next symbol model.
CREATE TABLE symbol_labels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  render_sha TEXT,              -- the sheet as rendered (projects/<id>/renders/<sha>.png in R2)
  page INTEGER,
  x0 INTEGER, y0 INTEGER, x1 INTEGER, y1 INTEGER,  -- the symbol's box on that render, pixels
  kind TEXT NOT NULL,           -- a fixture kind, or 'unknown' with a label
  label TEXT,                   -- the name as typed, when it is not one of the known kinds
  was_kind TEXT NOT NULL,       -- what bimp had read it as
  created_at INTEGER NOT NULL
);
CREATE INDEX symbol_labels_project ON symbol_labels(project_id, created_at DESC);
