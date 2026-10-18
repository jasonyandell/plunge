-- Replay practice is separate from actual hand results. The earliest attempt
-- remains the counted attempt. Later attempts may improve a personal best.
CREATE TABLE replay_attempts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  hand_id TEXT NOT NULL REFERENCES hands(id),
  seat INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
  attempt_id TEXT NOT NULL,
  choices TEXT NOT NULL,
  matched INTEGER NOT NULL,
  total INTEGER NOT NULL,
  done INTEGER NOT NULL CHECK(done IN (0,1)),
  UNIQUE(account_id, hand_id, seat, attempt_id)
);
CREATE UNIQUE INDEX replay_one_active ON replay_attempts(account_id, hand_id, seat) WHERE done=0;
