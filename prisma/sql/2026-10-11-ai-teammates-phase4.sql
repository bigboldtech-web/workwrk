-- 2026-10-11 AI teammates, Phase 4 (docs/plans/ai-teammates-phase4.md).
--
-- The computer: a web browser rented from a browser provider, at most one
-- at a time per person in a workspace, for one teammate in one chat, driven
-- only through src/lib/browser. Additive and idempotent: it runs on every
-- deploy (scripts/deploy-migrations.mjs SQL_MANIFEST) under its lock timeout.
--
-- EXISTING ROWS ARE UNCHANGED. Four new tables, their indexes, foreign keys
-- and value checks. The two columns on "Agent" and "AgentAction" and the
-- CHECK on "Agent" are in 2026-10-11-ai-teammates-phase4-columns.sql, which
-- runs before this file as its own short transaction (review of step 1).
--
-- LOCKS. The four tables are new and empty when this first runs, and nothing
-- reads them yet, so their indexes and checks lock nothing anyone waits on.
-- The foreign keys take SHARE ROW EXCLUSIVE on "Organization", "User" and
-- "Agent" for a moment, once, under the deploy's lock timeout
-- (scripts/deploy-migrations.mjs LOCK_TIMEOUT), and may wait there behind a
-- long transaction; while they wait this transaction holds no ACCESS
-- EXCLUSIVE lock on any table the app reads, since the two ADD COLUMNs and
-- the "Agent" CHECK committed in their own file before this one started
-- (review of step 1: with them in this file, "Agent" and "AgentAction" were
-- held exclusively while the keys waited, queueing every teammate read and
-- risking a deadlock beside the hard delete). Every statement after the
-- CREATE TABLEs is catalogue-guarded, so a deploy after the first takes no
-- lock at all (CREATE INDEX ... IF NOT EXISTS would take its table lock
-- before it looked, review round 6 of Phase 3).
--
-- TIMES. The new tables' timestamp defaults are (now() AT TIME ZONE 'UTC'),
-- as Prisma writes them and as every sweep compares them, so a row a raw
-- statement inserts never carries the database session's local time (on a
-- server east of UTC, "endsBy" > "startedAt" would refuse every start).
--
-- FOREIGN KEYS. A policy goes with its workspace; a browser session with its
-- workspace, its person and its teammate (ON DELETE CASCADE); steps and
-- pictures with their session. A session row deleted while its browser still
-- runs at the provider is found by its tag and released by the sweep
-- (src/lib/browser/sessions.ts sweepBrowserSessions), and the provider ends
-- it anyway at its own time limit.
--
-- WHAT IS NOT HERE. No page text, no typed text and no picture: pictures are
-- sealed files outside the database (src/lib/browser/shots.ts), so no backup
-- holds them. The partial unique index below is declared here only (Prisma
-- cannot express it), as the Phase 2 partial index on "AgentRun" is.
--
-- NO BACKFILL.
-- Rollback: nothing reads these unless the Phase 4 code runs. To remove them
-- (the two columns and the "Agent" CHECK: see the columns file):
--   DROP TABLE IF EXISTS "TeammateBrowserShot", "TeammateBrowserStep", "TeammateBrowserSession", "TeammateBrowserPolicy";

-- ── TeammateBrowserPolicy: whether a workspace's teammates may browse, and where ──
CREATE TABLE IF NOT EXISTS "TeammateBrowserPolicy" (
  "organizationId" TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "allowSites"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockSites"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "TeammateBrowserPolicy_pkey" PRIMARY KEY ("organizationId")
);

-- ── TeammateBrowserSession: one rented browser, for one person and one teammate ──
CREATE TABLE IF NOT EXISTS "TeammateBrowserSession" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "agentId"           TEXT NOT NULL,
  "chatSessionId"     TEXT,
  "provider"          TEXT NOT NULL,
  "providerSessionId" TEXT,
  "region"            TEXT,
  "status"            TEXT NOT NULL DEFAULT 'starting',
  "endReason"         TEXT,
  "bootId"            TEXT NOT NULL,
  "reservedMinutes"   INTEGER NOT NULL,
  "startedAt"         TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "endsBy"            TIMESTAMP(3) NOT NULL,
  "lastActiveAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "lastRunId"         TEXT,
  "waitingSince"      TIMESTAMP(3),
  "handedOverAt"      TIMESTAMP(3),
  "currentSite"       TEXT,
  "endedAt"           TIMESTAMP(3),
  "billedMinutes"     INTEGER,
  "stopAttempts"      INTEGER NOT NULL DEFAULT 0,
  "nextStopAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "TeammateBrowserSession_pkey" PRIMARY KEY ("id")
);

-- ── TeammateBrowserStep: what a session did, as kinds and sites only ──
CREATE TABLE IF NOT EXISTS "TeammateBrowserStep" (
  "id"               TEXT NOT NULL,
  "browserSessionId" TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "seq"              INTEGER NOT NULL,
  "kind"             TEXT NOT NULL,
  "site"             TEXT,
  "outcome"          TEXT NOT NULL,
  "code"             TEXT,
  "actionId"         TEXT,
  "shotId"           TEXT,
  "at"               TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "TeammateBrowserStep_pkey" PRIMARY KEY ("id")
);

-- ── TeammateBrowserShot: a picture's facts; the picture is a sealed file ──
CREATE TABLE IF NOT EXISTS "TeammateBrowserShot" (
  "id"               TEXT NOT NULL,
  "browserSessionId" TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "kind"             TEXT NOT NULL,
  "width"            INTEGER NOT NULL,
  "height"           INTEGER NOT NULL,
  "bytes"            INTEGER NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeammateBrowserShot_pkey" PRIMARY KEY ("id")
);

-- ── Indexes (catalogue-guarded) ──
DO $$
BEGIN
  -- One live browser per person in a workspace. Declared here only: Prisma
  -- cannot express a partial index.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_one_live_per_person') THEN
    CREATE UNIQUE INDEX "TeammateBrowserSession_one_live_per_person"
      ON "TeammateBrowserSession" ("organizationId", "userId")
      WHERE "status" IN ('starting', 'live', 'waiting', 'handed_over');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_providerSessionId_key') THEN
    CREATE UNIQUE INDEX "TeammateBrowserSession_providerSessionId_key" ON "TeammateBrowserSession" ("providerSessionId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_organizationId_startedAt_idx') THEN
    CREATE INDEX "TeammateBrowserSession_organizationId_startedAt_idx" ON "TeammateBrowserSession" ("organizationId", "startedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_userId_startedAt_idx') THEN
    CREATE INDEX "TeammateBrowserSession_userId_startedAt_idx" ON "TeammateBrowserSession" ("userId", "startedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_status_lastActiveAt_idx') THEN
    CREATE INDEX "TeammateBrowserSession_status_lastActiveAt_idx" ON "TeammateBrowserSession" ("status", "lastActiveAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_agentId_idx') THEN
    CREATE INDEX "TeammateBrowserSession_agentId_idx" ON "TeammateBrowserSession" ("agentId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserSession_chatSessionId_startedAt_idx') THEN
    CREATE INDEX "TeammateBrowserSession_chatSessionId_startedAt_idx" ON "TeammateBrowserSession" ("chatSessionId", "startedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserStep_browserSessionId_seq_key') THEN
    CREATE UNIQUE INDEX "TeammateBrowserStep_browserSessionId_seq_key" ON "TeammateBrowserStep" ("browserSessionId", "seq");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserStep_at_idx') THEN
    CREATE INDEX "TeammateBrowserStep_at_idx" ON "TeammateBrowserStep" ("at");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserShot_browserSessionId_idx') THEN
    CREATE INDEX "TeammateBrowserShot_browserSessionId_idx" ON "TeammateBrowserShot" ("browserSessionId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'TeammateBrowserShot_expiresAt_idx') THEN
    CREATE INDEX "TeammateBrowserShot_expiresAt_idx" ON "TeammateBrowserShot" ("expiresAt");
  END IF;
END
$$;

-- ── Foreign keys and value checks (catalogue-guarded) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserPolicy_organizationId_fkey') THEN
    ALTER TABLE "TeammateBrowserPolicy" ADD CONSTRAINT "TeammateBrowserPolicy_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_organizationId_fkey') THEN
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_userId_fkey') THEN
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_agentId_fkey') THEN
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserStep_browserSessionId_fkey') THEN
    ALTER TABLE "TeammateBrowserStep" ADD CONSTRAINT "TeammateBrowserStep_browserSessionId_fkey"
      FOREIGN KEY ("browserSessionId") REFERENCES "TeammateBrowserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserShot_browserSessionId_fkey') THEN
    ALTER TABLE "TeammateBrowserShot" ADD CONSTRAINT "TeammateBrowserShot_browserSessionId_fkey"
      FOREIGN KEY ("browserSessionId") REFERENCES "TeammateBrowserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserPolicy_values_check') THEN
    ALTER TABLE "TeammateBrowserPolicy" ADD CONSTRAINT "TeammateBrowserPolicy_values_check" CHECK (
      cardinality("allowSites") <= 200 AND cardinality("blockSites") <= 500
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserSession_values_check') THEN
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_values_check" CHECK (
      "provider" IN ('browserbase', 'stand-in')
      AND "status" IN ('starting', 'live', 'waiting', 'handed_over', 'ending', 'ended')
      AND ("endReason" IS NULL OR "endReason" IN ('idle', 'time_cap', 'waited_too_long', 'take_over_too_long', 'stopped',
           'closed_by_teammate', 'turned_off', 'plan', 'left', 'deactivated', 'no_access', 'workspace_closed', 'teammate_off',
           'restarted', 'start_failed', 'provider_ended', 'admin_stopped'))
      AND "reservedMinutes" BETWEEN 1 AND 120
      AND ("billedMinutes" IS NULL OR "billedMinutes" >= 0)
      AND "stopAttempts" >= 0
      AND "endsBy" > "startedAt"
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserStep_values_check') THEN
    ALTER TABLE "TeammateBrowserStep" ADD CONSTRAINT "TeammateBrowserStep_values_check" CHECK (
      "kind" IN ('open', 'read', 'find', 'scroll', 'show', 'click', 'type', 'select', 'take_over', 'give_back', 'close', 'end')
      AND "outcome" IN ('ok', 'refused', 'failed', 'waiting', 'practice')
      AND "seq" >= 1
      AND ("site" IS NULL OR char_length("site") <= 253)
      AND ("code" IS NULL OR char_length("code") <= 40)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateBrowserShot_values_check') THEN
    ALTER TABLE "TeammateBrowserShot" ADD CONSTRAINT "TeammateBrowserShot_values_check" CHECK (
      "kind" IN ('page', 'element') AND "bytes" BETWEEN 1 AND 2000000 AND "expiresAt" > "createdAt"
    );
  END IF;
END
$$;
