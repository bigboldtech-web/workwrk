-- 2026-10-17 AI teammates, Phase 5 (docs/plans/ai-teammates-phase5.md).
--
-- Learning by showing: a person shows a teammate how to do a job once in its
-- browser, reviews the steps, and the teammate follows them as a guide.
-- "TeammateSkill" is one person's skill for one teammate. Additive and
-- idempotent: it runs on every deploy under its lock timeout.
--
-- EXISTING ROWS ARE UNCHANGED. One new table, its indexes, its keys and its
-- value check, one partial index on "AgentRoutine", and the keys from
-- "AgentRoutine" and "TeammateBrowserSession" to the new table. Their
-- columns are in 2026-10-17-ai-teammates-phase5-columns.sql, which runs
-- before this file as its own short transaction.
--
-- WHAT IS NOT HERE. Nothing typed or chosen while recording: the recorder
-- never reads a field's value or an option chosen (src/lib/browser/
-- page-recorder.ts). A step keeps a control's role, kind, type and form
-- host, the words on a button or link outside a list, the label of a field
-- or list, the host and first path part it was on, and, only where the
-- person typed one at review, the words to type each time. Pictures are
-- Phase 4's sealed files (src/lib/browser/shots.ts), never here.
--
-- FOREIGN KEYS. A skill goes with its workspace, its person and its teammate
-- (CASCADE); a routine with its skill (CASCADE); a browser session forgets a
-- skill that is gone (SET NULL). A removed teammate is ARCHIVED, not
-- deleted, so its skills are deleted by "orphanedAt" (the sweep, 30 days),
-- not by a key. The keys on the existing tables are NOT VALID: their
-- columns are new, so no row can fail them, and no scan runs.
--
-- LOCKS. The table is new and empty when this first runs, so its own
-- indexes, keys and check lock nothing anyone waits on. Its keys take SHARE
-- ROW EXCLUSIVE on "Organization", "User" and "Agent" for a moment, once,
-- under the deploy's lock timeout. "AgentRoutine_skillId_idx" holds a SHARE
-- lock on "AgentRoutine" (a small table) while it is built, once: a
-- routine's write waits for it. The NOT VALID keys from "AgentRoutine" and
-- "TeammateBrowserSession" take SHARE ROW EXCLUSIVE on those tables for a
-- moment and scan nothing. No ACCESS EXCLUSIVE lock on a table the app
-- reads is held while a key waits: the ADD COLUMNs committed in their own
-- file first.
--
-- TIMES. The new table's timestamp defaults are (now() AT TIME ZONE 'UTC'),
-- as Prisma writes them and as every sweep compares them.
--
-- The partial and expression indexes are declared here only (Prisma cannot
-- express them). Every index, key and check is catalogue-guarded, so a later
-- deploy takes no lock.
--
-- NO BACKFILL.
-- Rollback: nothing reads it unless the Phase 5 code runs. To remove it:
--   ALTER TABLE "AgentRoutine" DROP CONSTRAINT IF EXISTS "AgentRoutine_skillId_fkey";
--   DROP INDEX IF EXISTS "AgentRoutine_skillId_idx";
--   ALTER TABLE "TeammateBrowserSession" DROP CONSTRAINT IF EXISTS "TeammateBrowserSession_skillId_fkey";
--   ALTER TABLE "TeammateBrowserSession" DROP CONSTRAINT IF EXISTS "TeammateBrowserSession_recordingSkillId_fkey";
--   DROP TABLE IF EXISTS "TeammateSkill";

-- ── TeammateSkill: one person's skill for one teammate ──
CREATE TABLE IF NOT EXISTS "TeammateSkill" (
  "id"                 TEXT NOT NULL,
  "organizationId"     TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "agentId"            TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "description"        TEXT NOT NULL DEFAULT '',
  "status"             TEXT NOT NULL DEFAULT 'recording',
  "version"            INTEGER NOT NULL DEFAULT 1,
  "steps"              JSONB NOT NULL DEFAULT '[]'::jsonb,
  "stepCount"          INTEGER NOT NULL DEFAULT 0,
  "sites"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "startUrl"           TEXT,
  "recordingSessionId" TEXT,
  "recordingFull"      BOOLEAN NOT NULL DEFAULT false,
  "recordingEndedAt"   TIMESTAMP(3),
  "recordingEndReason" TEXT,
  "orphanedAt"         TIMESTAMP(3),
  "lastRunAt"          TIMESTAMP(3),
  "runCount"           INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "TeammateSkill_pkey" PRIMARY KEY ("id")
);

-- ── Indexes (catalogue-guarded) ──
DO $$
BEGIN
  -- One recording at a time per person in a workspace (one browser, Phase 4 Decision 6).
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateSkill_one_recording_per_person') THEN
    CREATE UNIQUE INDEX "TeammateSkill_one_recording_per_person" ON "TeammateSkill" ("organizationId", "userId") WHERE "status" = 'recording';
  END IF;
  -- use_skill finds a skill by its name (Decision 10).
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateSkill_userId_agentId_name_key') THEN
    CREATE UNIQUE INDEX "TeammateSkill_userId_agentId_name_key" ON "TeammateSkill" ("userId", "agentId", lower("name"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateSkill_userId_createdAt_idx') THEN
    CREATE INDEX "TeammateSkill_userId_createdAt_idx" ON "TeammateSkill" ("userId", "createdAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateSkill_organizationId_idx') THEN
    CREATE INDEX "TeammateSkill_organizationId_idx" ON "TeammateSkill" ("organizationId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateSkill_agentId_idx') THEN
    CREATE INDEX "TeammateSkill_agentId_idx" ON "TeammateSkill" ("agentId");
  END IF;
  -- The sweep's 30-day delete (Decision 14).
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateSkill_orphaned_orphanedAt_idx') THEN
    CREATE INDEX "TeammateSkill_orphaned_orphanedAt_idx" ON "TeammateSkill" ("orphanedAt") WHERE "orphanedAt" IS NOT NULL;
  END IF;
  -- A skill's routines, by the key's cascade and the reminder's reads.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'AgentRoutine_skillId_idx') THEN
    CREATE INDEX "AgentRoutine_skillId_idx" ON "AgentRoutine" ("skillId") WHERE "skillId" IS NOT NULL;
  END IF;
END
$$;

-- ── Foreign keys and the value check (catalogue-guarded) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateSkill_organizationId_fkey') THEN
    ALTER TABLE "TeammateSkill" ADD CONSTRAINT "TeammateSkill_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateSkill_userId_fkey') THEN
    ALTER TABLE "TeammateSkill" ADD CONSTRAINT "TeammateSkill_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateSkill_agentId_fkey') THEN
    ALTER TABLE "TeammateSkill" ADD CONSTRAINT "TeammateSkill_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- The keys on the existing tables (NOT VALID: their columns are new, so no row can fail them, and no scan runs).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentRoutine_skillId_fkey') THEN
    ALTER TABLE "AgentRoutine" ADD CONSTRAINT "AgentRoutine_skillId_fkey"
      FOREIGN KEY ("skillId") REFERENCES "TeammateSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_skillId_fkey') THEN
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_skillId_fkey"
      FOREIGN KEY ("skillId") REFERENCES "TeammateSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_recordingSkillId_fkey') THEN
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_recordingSkillId_fkey"
      FOREIGN KEY ("recordingSkillId") REFERENCES "TeammateSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateSkill_values_check') THEN
    ALTER TABLE "TeammateSkill" ADD CONSTRAINT "TeammateSkill_values_check" CHECK (
      "status" IN ('recording', 'draft', 'ready')
      AND char_length("name") BETWEEN 1 AND 80
      AND char_length("description") <= 500
      AND "version" >= 1
      AND jsonb_typeof("steps") = 'array'
      AND jsonb_array_length("steps") <= 100
      AND "stepCount" = jsonb_array_length("steps")
      AND pg_column_size("steps") <= 400000
      AND cardinality("sites") <= 20
      AND ("startUrl" IS NULL OR char_length("startUrl") <= 2000)
      AND ("recordingEndReason" IS NULL OR "recordingEndReason" IN ('done', 'time', 'ended', 'turned_off', 'skills_off'))
      AND ("status" <> 'ready' OR jsonb_array_length("steps") BETWEEN 1 AND 50)
      AND "runCount" >= 0
    );
  END IF;
END
$$;
