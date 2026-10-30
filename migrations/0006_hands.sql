-- Every hand attempt a human played, solo or family room: finished hands and
-- the branches left behind by a takeback or an abandoned game. Written once
-- (first write kept). `payload` is the recorder's hand record with the engine
-- replay of every bid, call and play. The other columns are what SQL cannot
-- read from that replay, decoded by the worker at insert time.
CREATE TABLE hands (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  deal TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  received TEXT NOT NULL,
  walt TEXT,
  finished INTEGER NOT NULL,
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
  payload TEXT NOT NULL
);
CREATE INDEX hands_deal ON hands(deal);
CREATE INDEX hands_ended ON hands(ended_at);
-- The humans at the table. Stats are greedy: every account that uploads a
-- device's hand claims its seat, so one seat may carry several accounts.
-- A seat's team is seat % 2, so "won" is result_team = seat % 2.
CREATE TABLE hand_players (
  hand_id TEXT NOT NULL REFERENCES hands(id),
  seat INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
  account_id TEXT REFERENCES accounts(id),
  device_id TEXT,
  name TEXT,
  UNIQUE(hand_id, seat, account_id)
);
CREATE INDEX hand_players_account ON hand_players(account_id, hand_id);
