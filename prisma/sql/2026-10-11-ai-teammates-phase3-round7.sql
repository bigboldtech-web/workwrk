-- AI teammates, Phase 3, review round 7 of the whole phase
-- (docs/plans/ai-teammates-phase3.md, "After Phase 3").
--
-- Account erasures made before round 3 of Phase 3 (POST /api/me/delete)
-- blanked an Ask AI question's text but kept the person's chats, the
-- requests they approved, their runs' output, their memories and their
-- routines' words. Round 6's bridge gave an AccountErasure row only to
-- erasures from 2026-10-10 on, so those older ones were never swept. The
-- bridge (src/lib/agents/erasure-sweep.ts bridgeUnsweptErasures) now reads
-- every erasure consent record, with no date bound, a few hundred a tick.
-- This index holds only the erasure records, in the order the bridge reads
-- them, so each tick reads that short list and never the whole table of
-- banner choices:
--   "ConsentRecord" ("userId", "createdAt") WHERE "method" = 'erasure'
--
-- LOCKS. The statement runs only when the index is missing, checked in the
-- catalogue first, so a deploy after the first takes no lock on this table.
-- The first build holds a SHARE lock on "ConsentRecord" while it reads the
-- table once: every consent write (the cookie banner's choice, an erasure's
-- record) waits for the whole build. In production on 2026-10-11 the table
-- is small, so that is a moment. On a large table, build it by hand first
-- in a quiet window with
--   CREATE INDEX CONCURRENTLY "ConsentRecord_erasure_userId_createdAt_idx"
--     ON "ConsentRecord" ("userId", "createdAt") WHERE "method" = 'erasure';
-- and this file then skips it.
--
-- Additive and idempotent: an index only. Either order with the code works:
-- without it the bridge still runs, reading the whole table each tick.
-- Rollback: DROP INDEX IF EXISTS "ConsentRecord_erasure_userId_createdAt_idx";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ConsentRecord_erasure_userId_createdAt_idx'
  ) THEN
    CREATE INDEX "ConsentRecord_erasure_userId_createdAt_idx" ON "ConsentRecord" ("userId", "createdAt")
      WHERE "method" = 'erasure';
  END IF;
END
$$;
