-- AcceptanceCriterion: enforce XOR between taskId and userStoryId.
-- An AC must belong to exactly one of: a Task (technical AC) or a UserStory (product AC).
-- Audit run on 2026-05-05: 0 orphans, 0 doubly-linked, 75 task-only, 0 story-only.

ALTER TABLE "AcceptanceCriterion"
  ADD CONSTRAINT "AcceptanceCriterion_xor_parent"
  CHECK (("taskId" IS NULL) <> ("userStoryId" IS NULL));
