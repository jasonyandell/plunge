-- Finished-hand stats connected to optional accounts. One row per hand per
-- device: the first upload of a hand is kept exactly as written, and the same
-- account's devices merge here without overwriting each other. The payload is
-- the device record verbatim. The other columns are read from its replay by
-- the worker so leaderboards and same-deal play need no decoding.
CREATE TABLE account_hands (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL,
  hand_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  ended_at TEXT NOT NULL,
  game_over INTEGER NOT NULL,
  thrown_in INTEGER NOT NULL,
  practice INTEGER NOT NULL,
  player TEXT NOT NULL,
  deal TEXT NOT NULL,
  bidder INTEGER,
  bid INTEGER,
  contract TEXT,
  declaration TEXT,
  result_team INTEGER,
  result_marks INTEGER,
  won INTEGER,
  team0_points INTEGER NOT NULL,
  team1_points INTEGER NOT NULL,
  team0_tricks INTEGER NOT NULL,
  team1_tricks INTEGER NOT NULL,
  marks_before_0 INTEGER NOT NULL,
  marks_before_1 INTEGER NOT NULL,
  marks_after_0 INTEGER NOT NULL,
  marks_after_1 INTEGER NOT NULL,
  payload TEXT NOT NULL,
  received TEXT NOT NULL,
  PRIMARY KEY (account_id, device_id, hand_id)
);
CREATE INDEX account_hands_received ON account_hands(account_id, received, device_id, hand_id);
CREATE INDEX account_hands_ended ON account_hands(account_id, ended_at);
CREATE INDEX account_hands_deal ON account_hands(deal);
