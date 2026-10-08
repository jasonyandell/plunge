-- Finished-hand stats connected to optional accounts. One row per hand per
-- device: the first upload of a hand is kept exactly as written, and the same
-- account's devices merge here without overwriting each other.
CREATE TABLE account_hands (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL,
  hand_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  ended_at TEXT NOT NULL,
  game_over INTEGER NOT NULL,
  thrown_in INTEGER NOT NULL,
  player TEXT NOT NULL,
  payload TEXT NOT NULL,
  received TEXT NOT NULL,
  PRIMARY KEY (account_id, device_id, hand_id)
);
CREATE INDEX account_hands_received ON account_hands(account_id, received, device_id, hand_id);
CREATE INDEX account_hands_ended ON account_hands(account_id, ended_at);
