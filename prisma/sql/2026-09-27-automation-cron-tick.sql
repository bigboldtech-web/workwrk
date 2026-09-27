-- 2026-09-27 - Phase 7 (AI, automation and add-ons), stage C review: the time
-- triggers tell the truth.
--
-- One new table, nothing else. No existing table gains, loses, renames or
-- retypes a column, and no existing row is read or written by this file.
--
--   "AutomationCronTick"  one row per cron endpoint, stamped on every tick.
--                         POST /api/cron/automation-schedule writes the
--                         "automation-schedule" row; GET /api/automation/
--                         triggers reads it and marks the two time triggers
--                         "Not live yet" while the row is older than twenty
--                         minutes (the cron runs every five), so an
--                         automation on a schedule is never shown as live on
--                         a host where the cron row was not installed.
--
-- DEPLOY ORDER IS FREE. Both the writer and the reader catch a missing
-- relation: the tick is dropped and the triggers read as not live, which is
-- the safe reading until the file is applied and the cron row runs.
--
-- Idempotent: run it twice and the second run changes nothing.

CREATE TABLE IF NOT EXISTS "AutomationCronTick" (
  "name"       TEXT NOT NULL,
  "lastTickAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationCronTick_pkey" PRIMARY KEY ("name")
);
