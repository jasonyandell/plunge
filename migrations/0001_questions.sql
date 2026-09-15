CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  answer TEXT,
  answered_at TEXT
);
CREATE INDEX questions_owner_id ON questions(owner_hash, id);
CREATE INDEX questions_created ON questions(created, id);
