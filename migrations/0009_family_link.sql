-- One shared family link for bootstrapping: the owner posts it in the family chat,
-- people make their own accounts through it, and the owner lets each one in.
-- An account made this way starts as a request (accounts.requested=1) with
-- invited_by set to the link's maker. It gets nothing until the owner grants it.
CREATE TABLE family_links (
  hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  expires INTEGER NOT NULL
);
-- Seats saved through the family link, kept apart from personal invites.
ALTER TABLE accounts ADD COLUMN via_link INTEGER NOT NULL DEFAULT 0;
