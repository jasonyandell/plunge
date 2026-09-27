-- Player records (docs-data-model.md). Hands are written once and never
-- updated. `partition` comes from the Worker's own configuration (prod, pr-N),
-- never from a request. The body is the full validated record; the other
-- columns are indexes over it.
CREATE TABLE hands (
  partition TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  schema TEXT NOT NULL,
  app TEXT NOT NULL,
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  started TEXT NOT NULL,
  ended TEXT NOT NULL,
  body TEXT NOT NULL,
  received TEXT NOT NULL,
  PRIMARY KEY (partition, id)
);
CREATE INDEX hands_owner ON hands(partition, owner_hash, ended);
-- Walt builds a deployment has served, by content address. A hand naming an
-- id absent from the prod partition was played against an unreleased Walt.
CREATE TABLE walts (
  partition TEXT NOT NULL,
  id TEXT NOT NULL,
  manifest TEXT NOT NULL,
  registered TEXT NOT NULL,
  PRIMARY KEY (partition, id)
);
