-- Save pictures atomically with their immutable message, including lost-response retries.
-- At most two normalized 400 KB JPEGs per message, below the D1 row limit.
ALTER TABLE idea_messages ADD COLUMN screenshots TEXT NOT NULL DEFAULT '[]';
