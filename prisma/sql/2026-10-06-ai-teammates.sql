-- 2026-10-06 AI teammates, Phase 1 (docs/plans/ai-teammates.md).
--
-- Named AI teammates a person chats with. A teammate acts AS the person it
-- works for, asks before anything other people will see, remembers things
-- and runs routines. Additive and idempotent: it runs on every deploy
-- (scripts/deploy-migrations.mjs SQL_MANIFEST) under its lock timeout.
--
-- EXISTING ROWS BEHAVE EXACTLY AS TODAY. Every new "Agent" column defaults to
-- what every agent already was: usable by the whole workspace ("visibility"
-- WORKSPACE), no owner, no colour, no approval tightening, the legacy tool set
-- ("toolNames" NULL) and no monthly limit of its own. Every existing
-- "ChatSession" and "ChatMessage" gets "kind" NULL: an Ask AI chat and an
-- ordinary message, read exactly as before.
--
-- CHECKS ON THE TWO CHAT TABLES ARE NOT VALID. Those tables can be large and a
-- CHECK added normally scans every row under an ACCESS EXCLUSIVE lock. The
-- columns are new, so every existing row is NULL and the skipped scan could
-- not fail; NOT VALID still checks every row written from now on.
--
-- NEW TABLES. "AgentAction": the approval queue and the record of every
-- outward action. "AgentRoutine": a schedule that runs one teammate for one
-- person. "AgentPersonSetting": one person's own approval choices and read
-- cursor for one teammate. People ids carry no foreign key on purpose
-- ("ownerId", "actingForId", "userId"): a person who leaves takes nothing with
-- them, and the runner stops their teammates and routines.

-- ── Agent ──────────────────────────────────────────────────────────
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'WORKSPACE';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "hue" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "approvalRules" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "template" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "toolNames" JSONB;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "monthlyQuestionCap" INTEGER;

CREATE INDEX IF NOT EXISTS "Agent_organizationId_ownerId_idx" ON "Agent" ("organizationId", "ownerId");
CREATE INDEX IF NOT EXISTS "Agent_organizationId_visibility_status_idx" ON "Agent" ("organizationId", "visibility", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Agent_teammate_values_check') THEN
    ALTER TABLE "Agent" ADD CONSTRAINT "Agent_teammate_values_check" CHECK (
      "visibility" IN ('PRIVATE', 'WORKSPACE')
      AND ("visibility" = 'WORKSPACE' OR "ownerId" IS NOT NULL)
      AND ("hue" IS NULL OR "hue" IN ('sky', 'teal', 'moss', 'sand', 'clay', 'rose', 'slate', 'stone'))
      AND ("monthlyQuestionCap" IS NULL OR "monthlyQuestionCap" BETWEEN 1 AND 100000)
    );
  END IF;
END
$$;

-- ── ChatSession: the teammate chat ─────────────────────────────────
ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "kind" TEXT;

-- One live teammate chat per person and teammate.
CREATE UNIQUE INDEX IF NOT EXISTS "ChatSession_teammate_agent_user_key"
  ON "ChatSession" ("agentId", "userId")
  WHERE "kind" = 'TEAMMATE' AND "archivedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatSession_kind_check') THEN
    ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_kind_check"
      CHECK ("kind" IS NULL OR "kind" IN ('TEAMMATE')) NOT VALID;
  END IF;
END
$$;

-- ── ChatMessage: event lines, approval cards, routine reports ──────
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "meta" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_kind_check') THEN
    ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_kind_check"
      CHECK ("kind" IS NULL OR "kind" IN ('EVENT', 'APPROVAL', 'REPORT')) NOT VALID;
  END IF;
END
$$;

-- ── AgentRun: which chat, routine, person and AI question ──────────
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "routineId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "actingForId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "questionId" TEXT;

CREATE INDEX IF NOT EXISTS "AgentRun_sessionId_startedAt_idx" ON "AgentRun" ("sessionId", "startedAt");
CREATE INDEX IF NOT EXISTS "AgentRun_routineId_startedAt_idx" ON "AgentRun" ("routineId", "startedAt");

-- ── AgentMemory: who saved it, and where ───────────────────────────
ALTER TABLE "AgentMemory" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "AgentMemory" ADD COLUMN IF NOT EXISTS "source" TEXT;

-- ── AgentAction ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentAction" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId"        TEXT NOT NULL,
  "actingForId"    TEXT NOT NULL,
  "sessionId"      TEXT,
  "runId"          TEXT,
  "routineId"      TEXT,
  "toolName"       TEXT NOT NULL,
  "risk"           TEXT NOT NULL,
  "input"          JSONB NOT NULL DEFAULT '{}',
  "editedInput"    JSONB,
  "preview"        JSONB NOT NULL DEFAULT '{}',
  "targetKey"      TEXT,
  "groupKey"       TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "decidedVia"     TEXT,
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "executedAt"     TIMESTAMP(3),
  "result"         JSONB,
  "error"          TEXT,
  "reportedAt"     TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentAction_actingForId_status_createdAt_idx" ON "AgentAction" ("actingForId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentAction_agentId_status_idx" ON "AgentAction" ("agentId", "status");
CREATE INDEX IF NOT EXISTS "AgentAction_sessionId_createdAt_idx" ON "AgentAction" ("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentAction_status_expiresAt_idx" ON "AgentAction" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "AgentAction_organizationId_createdAt_idx" ON "AgentAction" ("organizationId", "createdAt");

-- ── AgentRoutine ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentRoutine" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId"        TEXT NOT NULL,
  "actingForId"    TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "prompt"         TEXT NOT NULL,
  "schedule"       TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "pausedReason"   TEXT,
  "nextRunAt"      TIMESTAMP(3),
  "lastRunAt"      TIMESTAMP(3),
  "lastRunId"      TEXT,
  "lastStatus"     TEXT,
  "lastReason"     TEXT,
  "createdVia"     TEXT NOT NULL DEFAULT 'chat',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentRoutine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentRoutine_status_nextRunAt_idx" ON "AgentRoutine" ("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "AgentRoutine_agentId_actingForId_idx" ON "AgentRoutine" ("agentId", "actingForId");

-- ── AgentPersonSetting ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentPersonSetting" (
  "id"            TEXT NOT NULL,
  "agentId"       TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "approvalRules" JSONB NOT NULL DEFAULT '{}',
  "lastReadAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPersonSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentPersonSetting_agentId_userId_key" ON "AgentPersonSetting" ("agentId", "userId");
CREATE INDEX IF NOT EXISTS "AgentPersonSetting_userId_idx" ON "AgentPersonSetting" ("userId");

-- ── Foreign keys and value checks (catalogue-guarded) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentAction_organizationId_fkey') THEN
    ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentAction_agentId_fkey') THEN
    ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentRoutine_organizationId_fkey') THEN
    ALTER TABLE "AgentRoutine" ADD CONSTRAINT "AgentRoutine_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentRoutine_agentId_fkey') THEN
    ALTER TABLE "AgentRoutine" ADD CONSTRAINT "AgentRoutine_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentPersonSetting_agentId_fkey') THEN
    ALTER TABLE "AgentPersonSetting" ADD CONSTRAINT "AgentPersonSetting_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentAction_values_check') THEN
    ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_values_check" CHECK (
      "risk" IN ('INTERNAL', 'OUTWARD', 'IRREVERSIBLE')
      AND "status" IN ('PENDING', 'RUNNING', 'EXECUTED', 'FAILED', 'DENIED', 'EXPIRED', 'CANCELLED')
      AND ("decidedVia" IS NULL OR "decidedVia" IN ('person', 'rule', 'expiry', 'system'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentRoutine_values_check') THEN
    ALTER TABLE "AgentRoutine" ADD CONSTRAINT "AgentRoutine_values_check" CHECK (
      "status" IN ('active', 'paused')
      AND "createdVia" IN ('chat', 'settings')
      AND ("lastStatus" IS NULL OR "lastStatus" IN ('SUCCEEDED', 'FAILED', 'SKIPPED'))
    );
  END IF;
END
$$;
