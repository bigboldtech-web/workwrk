-- 2026-10-17 AI teammates, Phase 5, step 1's review (docs/plans/ai-teammates-phase5.md,
-- "After Phase 5", Step 1 review).
--
-- WHY. Two things the step 1 files got wrong, put right in a file of their
-- own, since 2026-10-17-ai-teammates-phase5-columns.sql and
-- 2026-10-17-ai-teammates-phase5.sql were already being deployed:
--
-- 1. "TeammateSkill_values_check" read jsonb_array_length("steps") beside
--    jsonb_typeof("steps") = 'array' in one AND. SQL does not promise the
--    order an AND is evaluated in, so a value that is no array could raise
--    22023 ("cannot get array length of a non-array") rather than fail the
--    check with 23514. The write is refused either way; only the code
--    differs. Replaced UNDER ITS OWN NAME, every length test inside a CASE
--    that reads them only for an array (a CASE is evaluated in order),
--    guarded on its definition holding that CASE, as
--    2026-10-12-check-in-erasure.sql replaces "AccountErasure_values_check".
--    Not under a new name: the table file's own guard (IF NOT EXISTS on the
--    name "TeammateSkill_values_check") would then add the old CHECK back on
--    every deploy, scanning the table under ACCESS EXCLUSIVE each time, and
--    the old one would still be the one that raises. Every row the old CHECK
--    allowed the new one allows (the same tests, for an array), so its scan
--    cannot fail; the table is new and empty in production (nothing writes a
--    skill before step 2).
--
-- 2. The two ON DELETE SET NULL keys on "TeammateBrowserSession"
--    ("TeammateBrowserSession_skillId_fkey" and
--    "TeammateBrowserSession_recordingSkillId_fkey") had no index, so each
--    skill deleted ran two scans of the whole session table (Postgres's key
--    trigger runs UPDATE ... SET col = NULL WHERE col = $1 once a key):
--    "Delete every skill", the 30-day sweep, the erasure's part "browser"
--    and a workspace's hard delete would each scan it once a skill a key.
--    Two partial indexes, WHERE the column IS NOT NULL (a session follows or
--    records a skill rarely, so they stay small).
--
-- BUILT PLAINLY, NOT CONCURRENTLY. This file runs as one transaction under
-- prisma db execute (scripts/deploy-migrations.mjs), where CREATE INDEX
-- CONCURRENTLY cannot run. "TeammateBrowserSession" is small today: the
-- computer is off in production, so it holds next to no rows, and a plain
-- build takes a moment. On a large session table, build them by hand first,
-- outside a transaction (psql, one statement at a time), and this file's
-- guards then find them and do nothing:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "TeammateBrowserSession_skillId_idx"
--     ON "TeammateBrowserSession" ("skillId") WHERE "skillId" IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "TeammateBrowserSession_recordingSkillId_idx"
--     ON "TeammateBrowserSession" ("recordingSkillId") WHERE "recordingSkillId" IS NOT NULL;
-- A concurrent build that fails leaves an INVALID index of that name, which
-- the guards below would skip: drop it by hand
-- (DROP INDEX CONCURRENTLY IF EXISTS "<name>";) and build it again.
--
-- LOCKS. Block 1, first: ACCESS EXCLUSIVE on "TeammateSkill" (new, empty in
-- production, read by no code before step 2) for its DROP and ADD, and the
-- ADD's scan of its rows. Block 2, last, so it is held for the shortest
-- time: SHARE on "TeammateBrowserSession" while each index builds, held to
-- the end of the file with nothing after it; a browser call's write to its
-- session waits for that. Each lock taken only on the deploy that builds or
-- replaces it, under the deploy's 5 s lock_timeout and its retries (a
-- deadlock is tried again too). A deploy after the first reads only the
-- catalogue.
--
-- Additive and idempotent. Declared in prisma/schema.prisma by comment only
-- (Prisma cannot express a partial index or a CHECK). Listed last in
-- scripts/deploy-migrations.mjs SQL_MANIFEST, after the two step 1 files.
-- Never run here: no SQL was executed, the text is held by
-- src/lib/skills/types.test.ts.
-- Rollback: nothing needs undoing (the build before this writes nothing the
-- new CHECK refuses). To remove the indexes:
--   DROP INDEX IF EXISTS "TeammateBrowserSession_recordingSkillId_idx";
--   DROP INDEX IF EXISTS "TeammateBrowserSession_skillId_idx";

-- ── 1. The value check, its length tests read only for an array ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'TeammateSkill_values_check'
       AND conrelid = '"TeammateSkill"'::regclass
       AND pg_get_constraintdef(oid) LIKE '%CASE%WHEN%jsonb_typeof%THEN%jsonb_array_length%ELSE false%END%'
  ) THEN
    ALTER TABLE "TeammateSkill" DROP CONSTRAINT IF EXISTS "TeammateSkill_values_check";
    -- The words src/lib/skills/types.ts writes (SKILL_STATUSES, RECORDING_ENDS) and its caps (SKILL_LIMITS).
    ALTER TABLE "TeammateSkill" ADD CONSTRAINT "TeammateSkill_values_check" CHECK (
      "status" IN ('recording', 'draft', 'ready')
      AND char_length("name") BETWEEN 1 AND 80
      AND char_length("description") <= 500
      AND "version" >= 1
      AND CASE WHEN jsonb_typeof("steps") = 'array' THEN
            jsonb_array_length("steps") <= 100
            AND "stepCount" = jsonb_array_length("steps")
            AND ("status" <> 'ready' OR jsonb_array_length("steps") BETWEEN 1 AND 50)
          ELSE false END
      AND pg_column_size("steps") <= 400000
      AND cardinality("sites") <= 20
      AND ("startUrl" IS NULL OR char_length("startUrl") <= 2000)
      AND ("recordingEndReason" IS NULL OR "recordingEndReason" IN ('done', 'time', 'ended', 'turned_off', 'skills_off'))
      AND "runCount" >= 0
    );
  END IF;
END
$$;

-- ── 2. The session keys' indexes (catalogue-guarded) ──
DO $$
BEGIN
  -- "TeammateBrowserSession_skillId_fkey" ON DELETE SET NULL: the skill a browser follows.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_skillId_idx') THEN
    CREATE INDEX "TeammateBrowserSession_skillId_idx" ON "TeammateBrowserSession" ("skillId") WHERE "skillId" IS NOT NULL;
  END IF;
  -- "TeammateBrowserSession_recordingSkillId_fkey" ON DELETE SET NULL: the skill being recorded in it.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_recordingSkillId_idx') THEN
    CREATE INDEX "TeammateBrowserSession_recordingSkillId_idx" ON "TeammateBrowserSession" ("recordingSkillId") WHERE "recordingSkillId" IS NOT NULL;
  END IF;
END
$$;
