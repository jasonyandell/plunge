-- Accounts do not imply family access, and never claim anonymous game records.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('apple','google')),
  subject TEXT NOT NULL,
  email TEXT,
  owner INTEGER NOT NULL DEFAULT 0,
  requested INTEGER NOT NULL DEFAULT 0,
  member_id TEXT UNIQUE REFERENCES idea_members(id),
  created INTEGER NOT NULL,
  UNIQUE(provider,subject)
);
CREATE TABLE account_sessions (
  hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires INTEGER NOT NULL
);
CREATE INDEX account_sessions_expiry ON account_sessions(expires);
CREATE TABLE account_logins (
  hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX account_logins_expiry ON account_logins(expires);
