CREATE TABLE idea_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ideas (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL REFERENCES idea_members(id),
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  run_id TEXT,
  lease_until INTEGER,
  pr INTEGER,
  sha TEXT,
  preview TEXT
);
CREATE TABLE idea_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  member_id TEXT REFERENCES idea_members(id),
  role TEXT NOT NULL CHECK(role IN ('family','builder')),
  body TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX idea_messages_card ON idea_messages(idea_id,seq);
CREATE INDEX ideas_queue ON ideas(status,lease_until);
CREATE TABLE idea_runs (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  revision INTEGER NOT NULL,
  through_seq INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created TEXT NOT NULL
);
CREATE TRIGGER idea_reply AFTER INSERT ON idea_messages WHEN NEW.role = 'family'
BEGIN
  UPDATE ideas SET revision = revision + 1, updated = NEW.created,
    status = CASE WHEN status = 'building' THEN status ELSE 'queued' END
    WHERE id = NEW.idea_id;
END;
