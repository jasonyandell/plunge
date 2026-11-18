-- A hand-built lane: Jason (or a session working with him) makes the change and links
-- its PR to a card with `scripts/ideas/admin.mjs adopt`. The automatic builder never
-- claims these cards, and a family reply stays conversation instead of queueing a build.
-- Preview tracking (checking -> ready -> shipped) is shared with builder cards.
ALTER TABLE ideas ADD COLUMN lane TEXT NOT NULL DEFAULT 'builder' CHECK(lane IN ('builder','hand'));
DROP TRIGGER idea_reply;
CREATE TRIGGER idea_reply AFTER INSERT ON idea_messages WHEN NEW.role = 'family'
BEGIN
  UPDATE ideas SET revision = revision + 1, updated = NEW.created,
    status = CASE WHEN status = 'building' OR lane = 'hand' THEN status ELSE 'queued' END
    WHERE id = NEW.idea_id;
END;
