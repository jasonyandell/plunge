-- An authenticated owner accepts one exact preview, independently of build access.
CREATE TABLE idea_releases (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  revision INTEGER NOT NULL,
  pr INTEGER NOT NULL,
  sha TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL CHECK(status IN ('queued','releasing','deploying','shipped','blocked')),
  note TEXT NOT NULL,
  lease TEXT,
  lease_until INTEGER,
  merge_sha TEXT,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  UNIQUE(idea_id,revision,pr,sha)
);
CREATE UNIQUE INDEX idea_release_active ON idea_releases(idea_id)
  WHERE status IN ('queued','releasing','deploying');
