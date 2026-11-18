-- A failed check may recover only the request that produced this preview.
-- Historical failed builder runs are ambiguous. An operator can adopt their PR.
ALTER TABLE ideas ADD COLUMN preview_revision INTEGER;
UPDATE ideas SET preview_revision=revision
  WHERE pr IS NOT NULL AND (status IN ('checking','ready','shipped') OR (lane='hand' AND status='failed'));
