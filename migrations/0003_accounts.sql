-- Unreleased account migration: optional passkeys, no social-provider configuration.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner INTEGER NOT NULL DEFAULT 0,
  requested INTEGER NOT NULL DEFAULT 0,
  member_id TEXT UNIQUE REFERENCES idea_members(id),
  created INTEGER NOT NULL
);
CREATE TABLE account_sessions (
  hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires INTEGER NOT NULL
);
CREATE INDEX account_sessions_expiry ON account_sessions(expires);
CREATE TABLE account_passkeys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX account_passkeys_owner ON account_passkeys(account_id);
CREATE TABLE account_ceremonies (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('register','login','add','recover')),
  challenge TEXT NOT NULL,
  account_id TEXT,
  name TEXT,
  recovery_hash TEXT,
  expires INTEGER NOT NULL
);
CREATE INDEX account_ceremonies_expiry ON account_ceremonies(expires);
CREATE TABLE account_recoveries (
  hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  expires INTEGER NOT NULL
);
