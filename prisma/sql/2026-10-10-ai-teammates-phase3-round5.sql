-- AI teammates, Phase 3, review round 5 of the whole phase
-- (docs/plans/ai-teammates-phase3.md, "After Phase 3").
--
-- An account erasure (POST /api/me/delete) blanked the person's whole
-- teammate history inside its one 20 second transaction, which a heavy
-- person's history timed out every time. Its transaction is now short, and
-- the words are blanked after it commits, in batches of 500 rows, by the
-- erasure's own request and then by the teammates cron
-- (src/lib/agents/erasure-sweep.ts). Each batch of the person's runs is read
-- in id order from where the last stopped; "AgentRun" had no index by
-- person at all, so every batch read the whole table. This index reads one
-- person's runs in id order:
--   "AgentRun" ("triggeredBy", "id")
-- Every run that acts for a person was claimed by them (budget.ts
-- claimTeammateTurn writes "triggeredBy" and "actingForId" alike), and an Ask
-- AI tool run has only "triggeredBy", so this one column finds them all.
--
-- LOCKS. The statement runs only when the index is missing, checked in the
-- catalogue first (as 2026-10-03-message-client-id.sql), so a deploy after
-- the first takes NO lock on this table (CREATE INDEX ... IF NOT EXISTS takes
-- its table lock before it looks). The first build is a plain CREATE INDEX,
-- not CONCURRENTLY: it holds a SHARE lock on "AgentRun" for the whole build,
-- so every insert, update and delete of "AgentRun" waits until the build
-- ends (every teammate turn, routine run, Ask AI tool run and run sweep), and
-- so does every transaction queued behind one of those writes, holding its
-- own locks while it waits. (Corrected in review round 6 of Phase 3: this
-- said only a teammate turn's run writes wait.) It ran in production on
-- 2026-10-10, while "AgentRun" was small, and the guard means it never
-- builds there again. On a large "AgentRun" (another database, a restore),
-- build it by hand first, in a quiet window, with
--   CREATE INDEX CONCURRENTLY "AgentRun_triggeredBy_id_idx" ON "AgentRun" ("triggeredBy", "id");
-- after which the guard skips it. CONCURRENTLY cannot run inside a DO block
-- or a transaction, which is why this file does not use it.
--
-- Additive and idempotent: an index only, no row read for its content or
-- written. Either order with the code works: without it the batches still
-- run, each reading the whole table, as the erasure's transaction did.
-- Rollback: DROP INDEX IF EXISTS "AgentRun_triggeredBy_id_idx";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'AgentRun_triggeredBy_id_idx'
  ) THEN
    CREATE INDEX "AgentRun_triggeredBy_id_idx" ON "AgentRun" ("triggeredBy", "id");
  END IF;
END $$;
