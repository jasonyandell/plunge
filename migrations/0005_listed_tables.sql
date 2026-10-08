-- Tables a signed-in family member opened, so the home screen can list who is playing.
-- Rows expire on read: a room the coordinator no longer has is dropped when listed.
CREATE TABLE listed_tables (
  room_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
