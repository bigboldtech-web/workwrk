-- AI teammates, Phase 2 review round 5 (docs/plans/ai-teammates-phase2.md,
-- "After Phase 2"): two cron sweeps close a run whose process stopped part
-- way, so it no longer reads "Running" for good. Each reads only open rows
-- started before a cutoff, every tick, so each gets a partial index over the
-- few rows still open instead of a scan of the whole table:
--   "AgentRun" PENDING or RUNNING (src/lib/agents/budget.ts sweepStaleRuns)
--   "AutomationRun" RUNNING (src/lib/automation/retry.ts failStaleRuns)
-- IF NOT EXISTS, so a second run changes nothing. Additive.
-- Rollback: DROP INDEX IF EXISTS "AgentRun_open_startedAt_idx";
--           DROP INDEX IF EXISTS "AutomationRun_running_startedAt_idx";

CREATE INDEX IF NOT EXISTS "AgentRun_open_startedAt_idx"
  ON "AgentRun" ("startedAt")
  WHERE "status" IN ('PENDING', 'RUNNING');

CREATE INDEX IF NOT EXISTS "AutomationRun_running_startedAt_idx"
  ON "AutomationRun" ("startedAt")
  WHERE "status" = 'RUNNING';
