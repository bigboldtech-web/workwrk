-- 2026-10-17 AI teammates, Phase 5, the columns (docs/plans/ai-teammates-phase5.md).
--
-- Learning by showing: "TeammateBrowserPolicy"."skillsEnabled" (the
-- workspace's switch, off), "TeammateBrowserSession"."skillId",
-- "skillVersion", "skillStepAt" and "recordingSkillId" (the skill a browser
-- follows or records, none), and "AgentRoutine"."skillId" (a routine that
-- reminds a person of a skill, none). Additive and idempotent: it runs on
-- every deploy (scripts/deploy-migrations.mjs SQL_MANIFEST) under its lock
-- timeout.
--
-- EXISTING ROWS ARE UNCHANGED. Every column is nullable or has a constant
-- default: catalogue only on Postgres 11 and later. The CHECK on
-- "TeammateBrowserSession" is NOT VALID: its columns are new, so every row
-- holds NULL, none can fail it, and no scan runs under the table's lock.
--
-- ITS OWN FILE, SO ITS OWN SHORT TRANSACTION (Phase 4 step 1's review): the
-- ALTER TABLEs take ACCESS EXCLUSIVE on tables every browser call and every
-- routine tick read, and commit here before the next file waits on keys.
-- Listed in SQL_MANIFEST before 2026-10-17-ai-teammates-phase5.sql, since
-- Prisma selects every column of a model on a read with no select.
--
-- CATALOGUE-GUARDED. Each ALTER runs only when pg_attribute or
-- pg_constraint says it is missing, so a deploy after the first takes no
-- lock (ALTER TABLE ... ADD COLUMN IF NOT EXISTS would take its ACCESS
-- EXCLUSIVE lock before it looked, review round 6 of Phase 3).
--
-- NO BACKFILL.
-- Rollback: nothing reads these unless the Phase 5 code runs. To remove them:
--   ALTER TABLE "AgentRoutine" DROP COLUMN IF EXISTS "skillId";
--   ALTER TABLE "TeammateBrowserSession" DROP CONSTRAINT IF EXISTS "TeammateBrowserSession_skill_check";
--   ALTER TABLE "TeammateBrowserSession" DROP COLUMN IF EXISTS "recordingSkillId";
--   ALTER TABLE "TeammateBrowserSession" DROP COLUMN IF EXISTS "skillStepAt";
--   ALTER TABLE "TeammateBrowserSession" DROP COLUMN IF EXISTS "skillVersion";
--   ALTER TABLE "TeammateBrowserSession" DROP COLUMN IF EXISTS "skillId";
--   ALTER TABLE "TeammateBrowserPolicy" DROP COLUMN IF EXISTS "skillsEnabled";
-- (2026-10-17-ai-teammates-phase5.sql's keys on these columns go first: see its rollback.)

-- ── The six new columns and the session CHECK (catalogue-guarded) ──
DO $$
BEGIN
  -- The workspace's switch: people may teach its teammates by showing (off).
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"TeammateBrowserPolicy"'::regclass AND attname = 'skillsEnabled' AND NOT attisdropped) THEN
    ALTER TABLE "TeammateBrowserPolicy" ADD COLUMN IF NOT EXISTS "skillsEnabled" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  -- The skill this browser follows, pinned at its version, and the last step of it an approved act matched.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"TeammateBrowserSession"'::regclass AND attname = 'skillId' AND NOT attisdropped) THEN
    ALTER TABLE "TeammateBrowserSession" ADD COLUMN IF NOT EXISTS "skillId" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"TeammateBrowserSession"'::regclass AND attname = 'skillVersion' AND NOT attisdropped) THEN
    ALTER TABLE "TeammateBrowserSession" ADD COLUMN IF NOT EXISTS "skillVersion" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"TeammateBrowserSession"'::regclass AND attname = 'skillStepAt' AND NOT attisdropped) THEN
    ALTER TABLE "TeammateBrowserSession" ADD COLUMN IF NOT EXISTS "skillStepAt" INTEGER;
  END IF;
  -- The skill being recorded in this browser while its person shows (a take over with the recorder on).
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"TeammateBrowserSession"'::regclass AND attname = 'recordingSkillId' AND NOT attisdropped) THEN
    ALTER TABLE "TeammateBrowserSession" ADD COLUMN IF NOT EXISTS "recordingSkillId" TEXT;
  END IF;
  -- A routine that only reminds its person to run this skill (Decision 22).
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"AgentRoutine"'::regclass AND attname = 'skillId' AND NOT attisdropped) THEN
    ALTER TABLE "AgentRoutine" ADD COLUMN IF NOT EXISTS "skillId" TEXT;
  END IF;
  -- The new columns' values (NOT VALID: every row holds NULL, so none can fail it, and no scan runs).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_skill_check') THEN
    -- No pairing of skillId with skillVersion here: the key ON DELETE SET NULL
    -- clears skillId alone when a skill is deleted mid-run, and a pairing
    -- check would refuse that delete. sessions.ts sessionSkill reads a row
    -- with no skillId as following nothing, whatever skillVersion says.
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_skill_check" CHECK (
      ("skillVersion" IS NULL OR "skillVersion" >= 1)
      AND ("skillStepAt" IS NULL OR "skillStepAt" BETWEEN -1 AND 100)
    ) NOT VALID;
  END IF;
END
$$;
