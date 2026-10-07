-- 2026-10-07 AI teammates, Phase 2 (docs/plans/ai-teammates-phase2.md).
--
-- Group chats with several teammates, Chief of Staff delegation, teammates
-- in Talk and in Automations, and the old scheduled agents moved onto
-- routines. Additive and idempotent: it runs on every deploy
-- (scripts/deploy-migrations.mjs SQL_MANIFEST) under its lock timeout.
--
-- EXISTING ROWS ARE UNCHANGED. Every new column is nullable. Two CHECKs are
-- widened, each to a superset of what it allowed ('TEAMMATE_GROUP' chats,
-- routines made 'legacy'), so every row valid before is valid after, and the
-- previous release, if it serves again, writes only rows both versions allow.
--
-- WIDENING A CHECK. 2026-10-06-ai-teammates.sql adds "ChatSession_kind_check"
-- and "AgentRoutine_values_check" when no constraint of that name exists, and
-- it runs first on every deploy. This file replaces each one, under the same
-- name and inside one DO block, only while its definition lacks the new
-- value; on every later deploy both files find what they want and do
-- nothing. The ChatSession one stays NOT VALID: a big table, and no existing
-- row can hold the new value, so the skipped scan could not fail.
--
-- NO BACKFILL. The old schedules are moved by the cron
-- (src/lib/agents/legacy-schedules.ts), one compare-and-swap per agent.

-- ── ChatSession: group chats and their read cursor ─────────────────
ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "lastReadAt" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChatSession_kind_check'
      AND conrelid = '"ChatSession"'::regclass
      AND strpos(pg_get_constraintdef(oid), 'TEAMMATE_GROUP') = 0
  ) THEN
    ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_kind_check";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatSession_kind_check' AND conrelid = '"ChatSession"'::regclass
  ) THEN
    ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_kind_check"
      CHECK ("kind" IS NULL OR "kind" IN ('TEAMMATE', 'TEAMMATE_GROUP')) NOT VALID;
  END IF;
END
$$;

-- ── ChatSessionTeammate: who is in a group chat ────────────────────
CREATE TABLE IF NOT EXISTS "ChatSessionTeammate" (
  "sessionId" TEXT NOT NULL,
  "agentId"   TEXT NOT NULL,
  "position"  INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSessionTeammate_pkey" PRIMARY KEY ("sessionId", "agentId")
);

CREATE INDEX IF NOT EXISTS "ChatSessionTeammate_agentId_idx" ON "ChatSessionTeammate" ("agentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatSessionTeammate_sessionId_fkey') THEN
    ALTER TABLE "ChatSessionTeammate" ADD CONSTRAINT "ChatSessionTeammate_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatSessionTeammate_agentId_fkey') THEN
    ALTER TABLE "ChatSessionTeammate" ADD CONSTRAINT "ChatSessionTeammate_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatSessionTeammate_values_check') THEN
    ALTER TABLE "ChatSessionTeammate" ADD CONSTRAINT "ChatSessionTeammate_values_check"
      CHECK ("position" >= 0 AND "position" < 100);
  END IF;
END
$$;

-- ── Agent: where an old schedule went ──────────────────────────────
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "scheduleMovedAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "scheduleRoutineId" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "scheduleMoveReason" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Agent_schedule_move_check') THEN
    ALTER TABLE "Agent" ADD CONSTRAINT "Agent_schedule_move_check" CHECK (
      "scheduleMoveReason" IS NULL OR "scheduleMoveReason" IN (
        'no_creator', 'person_gone', 'guest', 'agent_account', 'no_access',
        'unsupported_schedule', 'no_schedule', 'agent_removed'
      )
    ) NOT VALID;
  END IF;
END
$$;

-- ── AgentRun: the caller of a delegated turn, the automation of a step ──
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "parentRunId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "automationWorkflowId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "automationRunId" TEXT;

-- Partial: only automation turns are indexed (the daily cap per workflow).
CREATE INDEX IF NOT EXISTS "AgentRun_automationWorkflowId_startedAt_idx"
  ON "AgentRun" ("automationWorkflowId", "startedAt")
  WHERE "automationWorkflowId" IS NOT NULL;

-- ── AgentRoutine: a routine moved from Workspace agents ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AgentRoutine_values_check'
      AND conrelid = '"AgentRoutine"'::regclass
      AND strpos(pg_get_constraintdef(oid), 'legacy') = 0
  ) THEN
    ALTER TABLE "AgentRoutine" DROP CONSTRAINT "AgentRoutine_values_check";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgentRoutine_values_check' AND conrelid = '"AgentRoutine"'::regclass
  ) THEN
    ALTER TABLE "AgentRoutine" ADD CONSTRAINT "AgentRoutine_values_check" CHECK (
      "status" IN ('active', 'paused')
      AND "createdVia" IN ('chat', 'settings', 'legacy')
      AND ("lastStatus" IS NULL OR "lastStatus" IN ('SUCCEEDED', 'FAILED', 'SKIPPED'))
    );
  END IF;
END
$$;
