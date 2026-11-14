-- Teams share projects: every member can open, upload, ask and comment; owners manage members and delete.
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,            -- owner | member
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members(user_id);
ALTER TABLE projects ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX projects_team ON projects(team_id, updated_at DESC);
-- Who asked (shared projects).
ALTER TABLE messages ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
-- Every plan row is a revision; a short label people can give it.
ALTER TABLE plans ADD COLUMN note TEXT;
-- Comments pinned to a spot on a plan revision; replies by people or by bimp.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author TEXT NOT NULL,          -- user | ai
  x REAL, y REAL,                -- plan metres, top-level comments only
  room_id TEXT,
  body TEXT NOT NULL,
  answer TEXT,                   -- JSON Answer for ai replies
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_project ON comments(project_id, created_at);
-- Who started a reading: the one-at-a-time limit is per person, also in shared projects.
ALTER TABLE jobs ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
