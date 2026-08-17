-- Audience by tag.
--
-- Person-tags become a real audience subject: a goal can target a tag and a
-- pulse survey can target tags, both resolved to the tag's current holders at
-- READ time (a person tagged later inherits the goal / survey automatically —
-- never a frozen list). Everything here is additive and idempotent so a
-- partial or repeated run converges on the same state.

-- ---------------------------------------------------------------
-- (1) GoalAssignee.tagId — a fourth one-of subject next to user/dept/role.
-- ---------------------------------------------------------------
ALTER TABLE "GoalAssignee" ADD COLUMN IF NOT EXISTS "tagId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAssignee_tagId_fkey') THEN
    ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "GoalAssignee_tagId_idx" ON "GoalAssignee"("tagId");

-- One row per (okr, tag) — the partial-unique pattern used for the other
-- subjects (NULLs are distinct in Postgres, so a plain UNIQUE cannot do this).
CREATE UNIQUE INDEX IF NOT EXISTS "GoalAssignee_okr_tag_key"
  ON "GoalAssignee"("okrId", "tagId") WHERE "tagId" IS NOT NULL;

-- Extend the one-subject CHECK to count tagId. Existing rows have tagId NULL
-- and exactly one of user/dept/role set, so num_nonnulls stays 1 and the
-- re-added constraint validates cleanly against all current data.
-- Drop-then-add (both guarded) keeps this idempotent.
DO $$
BEGIN
  ALTER TABLE "GoalAssignee" DROP CONSTRAINT IF EXISTS "GoalAssignee_one_subject";
  ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_one_subject"
    CHECK (num_nonnulls("userId", "departmentId", "roleId", "tagId") = 1);
END $$;

-- ---------------------------------------------------------------
-- (2) PulseSurvey.tagIds — audienceType "TAGS" targets these person-tags.
-- ---------------------------------------------------------------
ALTER TABLE "PulseSurvey" ADD COLUMN IF NOT EXISTS "tagIds" TEXT[] NOT NULL DEFAULT '{}';
