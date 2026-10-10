-- AI teammates, Phase 3, review round 6 of the whole phase
-- (docs/plans/ai-teammates-phase3.md, "After Phase 3").
--
-- An account erasure (POST /api/me/delete) blanks the person's teammate
-- words after its short transaction commits, and the teammates cron finishes
-- what that pass left (src/lib/agents/erasure-sweep.ts, review round 5). The
-- sweep started every erasure again from its first row on every tick, gave
-- the oldest unfinished one the whole budget, and gave up on any older than
-- 30 days, so one history of about a million rows could never finish, held
-- up every erasure after it with no alert, and their words stayed for good.
-- It also found erasures by their consent record alone, which a request to
-- POST /api/consent could write for a living account. Each erasure now keeps
-- its progress on a row of its own:
--   "AccountErasure", one row a person, written by the erasure's own
--   transaction (and, for the erasures made on round 5's code, by the cron's
--   bridge): the part of the pass and the cursor where it stopped, when the
--   pass started, when it was last tried and how often, and when it finished.
-- The sweep reads the unfinished rows, least recently tried first, by a
-- partial index over them; finished rows are never read again.
--
-- LOCKS. The table is new and empty when this first runs, and nothing reads
-- it yet, so its CREATE TABLE, CHECK and index lock nothing anyone waits on.
-- The foreign key to "User", added once, takes a SHARE ROW EXCLUSIVE lock on
-- "User" for a moment (an empty table has no row to check against it), under
-- the deploy's lock timeout (scripts/deploy-migrations.mjs LOCK_TIMEOUT). The
-- constraints and the index are catalogue-guarded, so a deploy after the
-- first takes no lock at all (CREATE INDEX ... IF NOT EXISTS takes its table
-- lock before it looks).
--
-- Additive and idempotent: a new table only, no existing row read or written.
-- Before the reload: the new build's delete route writes this table inside
-- its transaction, so an account erasure fails without it.
-- Rollback: DROP TABLE IF EXISTS "AccountErasure";
--   (the build before this one never reads it; erasures still unfinished at
--   that moment are then found again by round 5's consent-record sweep).

CREATE TABLE IF NOT EXISTS "AccountErasure" (
  "userId"        TEXT NOT NULL,
  "erasedAt"      TIMESTAMP(3) NOT NULL,
  "part"          TEXT NOT NULL,
  "cursor"        JSONB,
  "passStartedAt" TIMESTAMP(3),
  "lastTriedAt"   TIMESTAMP(3),
  "tries"         INTEGER NOT NULL DEFAULT 0,
  "finishedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "AccountErasure_pkey" PRIMARY KEY ("userId")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountErasure_userId_fkey') THEN
    ALTER TABLE "AccountErasure" ADD CONSTRAINT "AccountErasure_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- The parts of one pass, in order (src/lib/agents/erasure-sweep.ts ERASURE_PARTS).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountErasure_values_check') THEN
    ALTER TABLE "AccountErasure" ADD CONSTRAINT "AccountErasure_values_check" CHECK (
      "part" IN ('chats', 'requests', 'runs', 'questions', 'activity', 'memories', 'routines')
      AND "tries" >= 0
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'AccountErasure_lastTriedAt_idx'
  ) THEN
    -- In the sweep's own order (lastTriedAt NULLS FIRST), over the unfinished rows only.
    CREATE INDEX "AccountErasure_lastTriedAt_idx" ON "AccountErasure" ("lastTriedAt" ASC NULLS FIRST)
      WHERE "finishedAt" IS NULL;
  END IF;
END
$$;
