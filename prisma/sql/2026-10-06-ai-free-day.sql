-- Batch 13 round 3: the platform's daily ceiling on free AI, and which AI
-- questions were free.
--
-- "AiFreeDay": one row per UTC day and kind ("question", "auto", "fill"),
-- counted across EVERY free (Starter) workspace (src/lib/ai-allowance.ts
-- claimFreeDay). Anyone can sign up, and each new account brings a new free
-- workspace, so caps per workspace and per person bound nothing in total; this
-- ceiling bounds what free AI can cost WorkwrK in a day however many accounts
-- are made.
--
-- "AIQuery"."freeTier": true for a question asked in a free workspace, so the
-- free questions one person gets across free workspaces count only those
-- (a question asked while a workspace paid stays its own). Older rows are
-- false and are not counted.
--
-- Additive and idempotent: a new table, a column with a default, an index.
-- It runs on every deploy (manifest in scripts/deploy-migrations.mjs), under
-- its lock timeout.

CREATE TABLE IF NOT EXISTS "AiFreeDay" (
  "day"       DATE         NOT NULL,
  "kind"      TEXT         NOT NULL,
  "count"     INTEGER      NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiFreeDay_pkey" PRIMARY KEY ("day", "kind")
);

ALTER TABLE "AIQuery" ADD COLUMN IF NOT EXISTS "freeTier" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "AIQuery_userId_freeTier_idx" ON "AIQuery" ("userId", "freeTier");
