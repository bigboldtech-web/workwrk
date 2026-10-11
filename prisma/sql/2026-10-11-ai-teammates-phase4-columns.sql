-- 2026-10-11 AI teammates, Phase 4, the two columns (docs/plans/ai-teammates-phase4.md,
-- review of step 1).
--
-- "Agent"."browserSites" (the sites a teammate may open, none until picked)
-- and "AgentAction"."readWeb" (asked after the turn read a web page), with
-- the CHECK on "Agent". Additive and idempotent: it runs on every deploy
-- (scripts/deploy-migrations.mjs SQL_MANIFEST) under its lock timeout.
--
-- EXISTING ROWS ARE UNCHANGED. Both columns have a constant default that
-- changes nothing: catalogue only on Postgres 11 and later. The CHECK is
-- NOT VALID: the column is new, so no row can fail it, and no scan runs
-- under the table's lock.
--
-- ITS OWN FILE, SO ITS OWN SHORT TRANSACTION (review of step 1). Each
-- manifest file runs as one transaction, and these two ALTER TABLEs take
-- ACCESS EXCLUSIVE on "Agent" and "AgentAction", the tables every teammate
-- turn and every card read touch. In the first version they sat in
-- 2026-10-11-ai-teammates-phase4.sql, after the four CREATE TABLEs and
-- before the foreign keys, so on the first deploy both locks were held while
-- that transaction waited on "Organization" and "User" for its keys: a long
-- transaction there (the nightly backup, an export) queued every teammate
-- read behind this deploy, and two deploys or a deploy beside the hard
-- delete could deadlock. Here the locks are taken, the catalogue written and
-- the transaction committed before the next file waits on anything. Listed
-- in SQL_MANIFEST before that file, since the code reads these columns
-- whether or not the tables exist.
--
-- CATALOGUE-GUARDED. Each ALTER runs only when pg_attribute or
-- pg_constraint says it is missing, so a deploy after the first takes no
-- lock at all (ALTER TABLE ... ADD COLUMN IF NOT EXISTS would take its
-- ACCESS EXCLUSIVE lock before it looked, review round 6 of Phase 3).
--
-- NO BACKFILL.
-- Rollback: nothing reads these unless the Phase 4 code runs. To remove them:
--   ALTER TABLE "Agent" DROP CONSTRAINT IF EXISTS "Agent_browserSites_check";
--   ALTER TABLE "Agent" DROP COLUMN IF EXISTS "browserSites";
--   ALTER TABLE "AgentAction" DROP COLUMN IF EXISTS "readWeb";

-- ── Agent and AgentAction: the two new columns and the Agent CHECK (catalogue-guarded) ──
DO $$
BEGIN
  -- The sites this teammate may open (none until picked).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"Agent"'::regclass AND attname = 'browserSites' AND NOT attisdropped
  ) THEN
    ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "browserSites" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;
  -- Asked after the turn read a web page.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"AgentAction"'::regclass AND attname = 'readWeb' AND NOT attisdropped
  ) THEN
    ALTER TABLE "AgentAction" ADD COLUMN IF NOT EXISTS "readWeb" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  -- At most 50 sites a teammate (NOT VALID: the column is new, so no row can fail it).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Agent_browserSites_check') THEN
    ALTER TABLE "Agent" ADD CONSTRAINT "Agent_browserSites_check" CHECK (cardinality("browserSites") <= 50) NOT VALID;
  END IF;
END
$$;
