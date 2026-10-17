-- Authenticated authorship is recorded by the server, never accepted from message JSON.
ALTER TABLE idea_messages ADD COLUMN account_id TEXT REFERENCES accounts(id);
-- Account-backed members cannot authenticate with invitation tokens (their marker is not a hash).
UPDATE idea_messages SET account_id=(
  SELECT a.id FROM accounts a JOIN idea_members m ON m.id=a.member_id
  WHERE a.member_id=idea_messages.member_id AND m.token_hash='account:'||a.id
) WHERE role='family';
CREATE TABLE idea_approvals (
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  revision INTEGER NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created TEXT NOT NULL,
  PRIMARY KEY(idea_id,revision,account_id)
);
