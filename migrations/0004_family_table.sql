-- One standing family table, found again by every account with family access.
CREATE TABLE family_table (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
