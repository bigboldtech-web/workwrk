-- 2026-05-22 — Autonomous-agent scheduling.
-- Adds the columns the cron-tickable endpoint needs to fire agents
-- on a beat without a user prompt. Additive-only; existing agents
-- stay manual until an admin toggles autonomousEnabled.

ALTER TABLE "Agent"
    ADD COLUMN "autonomousEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "scheduleCron" TEXT,
    ADD COLUMN "autonomousPrompt" TEXT,
    ADD COLUMN "lastRunAt" TIMESTAMP(3),
    ADD COLUMN "nextRunAt" TIMESTAMP(3);

CREATE INDEX "Agent_autonomousEnabled_nextRunAt_idx"
    ON "Agent"("autonomousEnabled", "nextRunAt");
