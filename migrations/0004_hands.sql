-- Finished hands, one shape for solo play and family rooms. A hand is written
-- once (first write kept) with the facts read from its replay by the worker.
-- The payload is the hand record as the recorder wrote it, verbatim.
CREATE TABLE hands (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('solo','room')),
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  room_id TEXT,
  deal TEXT NOT NULL,
  code TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  received TEXT NOT NULL,
  game_over INTEGER NOT NULL,
  thrown_in INTEGER NOT NULL,
  practice INTEGER NOT NULL,
  bidder INTEGER,
  bid INTEGER,
  contract TEXT,
  declaration TEXT,
  result_team INTEGER,
  result_marks INTEGER,
  team0_points INTEGER NOT NULL,
  team1_points INTEGER NOT NULL,
  team0_tricks INTEGER NOT NULL,
  team1_tricks INTEGER NOT NULL,
  marks_before_0 INTEGER NOT NULL,
  marks_before_1 INTEGER NOT NULL,
  marks_after_0 INTEGER NOT NULL,
  marks_after_1 INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX hands_received ON hands(received, id);
CREATE INDEX hands_deal ON hands(deal);
CREATE INDEX hands_ended ON hands(ended_at);
-- Who sat where. Humans carry an account when signed in, a device for solo
-- play, and a name in rooms. Walt seats carry the Walt version when known.
-- A player's team is seat % 2, so "won" is result_team = seat % 2.
CREATE TABLE hand_players (
  hand_id TEXT NOT NULL REFERENCES hands(id),
  seat INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
  kind TEXT NOT NULL CHECK(kind IN ('human','walt')),
  account_id TEXT REFERENCES accounts(id),
  device_id TEXT,
  name TEXT,
  player TEXT,
  PRIMARY KEY (hand_id, seat)
);
CREATE INDEX hand_players_account ON hand_players(account_id, hand_id);
