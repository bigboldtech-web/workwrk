-- AI teammates, Phase 2 review round 8 (docs/plans/ai-teammates-phase2.md,
-- "After Phase 2"): two partial indexes for reads that ran on every tick or
-- every claim and grew with the workspace.
--   "AutomationRun": the retry cron reads only runs that still hold retry
--   state (src/lib/automation/retry.ts processAutomationRetries); the index
--   holds just those, so failures that can never be retried no longer fill
--   its 100 places or make it read the whole table.
--   "AgentRun": a capped teammate's month of kept questions is counted under
--   its row lock on every claim (src/lib/agents/budget.ts monthUsageIn); the
--   index answers the count from the index alone.
-- IF NOT EXISTS, so a second run changes nothing. Additive.
-- Rollback: DROP INDEX IF EXISTS "AutomationRun_retry_due_idx";
--           DROP INDEX IF EXISTS "AgentRun_kept_question_idx";

CREATE INDEX IF NOT EXISTS "AutomationRun_retry_due_idx"
  ON "AutomationRun" ("completedAt")
  WHERE "status" IN ('FAILED', 'PARTIAL') AND "triggerPayload" ? '__retryState';

CREATE INDEX IF NOT EXISTS "AgentRun_kept_question_idx"
  ON "AgentRun" ("agentId", "startedAt")
  WHERE "questionId" IS NOT NULL;
