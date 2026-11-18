-- Invites: a family member saves a named seat for someone. The account exists with
-- family access and no passkey until the invited person opens the link and makes one.
-- The link's secret lives in account_recoveries, so claiming it is a recovery of an
-- account that never had a passkey.
ALTER TABLE accounts ADD COLUMN invited_by TEXT REFERENCES accounts(id);
