-- 2026-10-04 - Batch 8: AI fields in Lists, and scheduled AI updates in Talk.
--
-- "AiUsageDay": one workspace's AI use in one UTC day, by kind ("field_fill"
-- for Fill with AI on a List field, "talk_update" for a scheduled update). It is the daily guard rail on cost
-- (src/lib/ai-usage.ts claimAiUse): each use is claimed by ONE atomic
-- INSERT ... ON CONFLICT DO UPDATE that never takes the count past the day's
-- cap, so two people filling at once can never both slip past it. Nothing
-- else reads or writes it. Deleting a workspace deletes its rows.
--
-- "TalkUpdate": a scheduled AI update in one private channel or group chat
-- (src/lib/talk-updates.ts), a Daily standup or a Weekly project update
-- written from one List or one Space and posted as the person who set it up.
-- "createdById" has no foreign key on purpose: a person who leaves pauses
-- their updates, and nothing is deleted with them. Deleting the conversation
-- or the workspace deletes its updates. "nextRunAt" is claimed by one
-- compare-and-swap per due instant.
--
-- "TalkUpdateRun": one run, scheduled (one row per due instant: the unique
-- key is the second guard against a double post) or Post now. Counts and a
-- reason only; the post itself is the message.
--
-- ADDITIVE ONLY. New tables. No existing table gains, loses, renames or
-- retypes a column, and no existing row is read or written. The Prisma field
-- on "Organization" is a relation field with no column.
--
-- Apply it BEFORE the code: the new release claims a row on every fill and
-- answers "not ready" (nothing sent to the AI provider, nothing written)
-- until this table exists. Both opt-ins are off by default, so a workspace
-- that never turns them on never touches it.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS and every foreign key guarded by a
-- catalogue lookup. Running it twice is a no-op.

CREATE TABLE IF NOT EXISTS "AiUsageDay" (
  "organizationId" TEXT NOT NULL,
  "day"            DATE NOT NULL,
  "kind"           TEXT NOT NULL,
  "count"          INTEGER NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("organizationId", "day", "kind")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiUsageDay_organizationId_fkey'
  ) THEN
    ALTER TABLE "AiUsageDay"
      ADD CONSTRAINT "AiUsageDay_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "TalkUpdate" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "createdById"    TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "scopeKind"      TEXT NOT NULL,
  "scopeId"        TEXT NOT NULL,
  "cadence"        TEXT NOT NULL,
  "weekday"        INTEGER,
  "timeOfDay"      TEXT NOT NULL,
  "timezone"       TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "pausedReason"   TEXT,
  "nextRunAt"      TIMESTAMP(3),
  "lastPostedAt"   TIMESTAMP(3),
  "lastManualAt"   TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TalkUpdate_pkey" PRIMARY KEY ("id")
);

-- The same column on a table made by an earlier copy of this file.
ALTER TABLE "TalkUpdate" ADD COLUMN IF NOT EXISTS "lastManualAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "TalkUpdate_status_nextRunAt_idx" ON "TalkUpdate" ("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "TalkUpdate_conversationId_idx" ON "TalkUpdate" ("conversationId");

CREATE TABLE IF NOT EXISTS "TalkUpdateRun" (
  "id"             TEXT NOT NULL,
  "updateId"       TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "dueAt"          TIMESTAMP(3) NOT NULL,
  "trigger"        TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "reason"         TEXT,
  "messageId"      TEXT,
  "taskCount"      INTEGER,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  CONSTRAINT "TalkUpdateRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TalkUpdateRun_updateId_dueAt_key" ON "TalkUpdateRun" ("updateId", "dueAt");
CREATE INDEX IF NOT EXISTS "TalkUpdateRun_updateId_startedAt_idx" ON "TalkUpdateRun" ("updateId", "startedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TalkUpdate_organizationId_fkey') THEN
    ALTER TABLE "TalkUpdate"
      ADD CONSTRAINT "TalkUpdate_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TalkUpdate_conversationId_fkey') THEN
    ALTER TABLE "TalkUpdate"
      ADD CONSTRAINT "TalkUpdate_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TalkUpdateRun_updateId_fkey') THEN
    ALTER TABLE "TalkUpdateRun"
      ADD CONSTRAINT "TalkUpdateRun_updateId_fkey"
      FOREIGN KEY ("updateId") REFERENCES "TalkUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TalkUpdate_values_check') THEN
    ALTER TABLE "TalkUpdate"
      ADD CONSTRAINT "TalkUpdate_values_check" CHECK (
        "kind" IN ('standup', 'project')
        AND "scopeKind" IN ('list', 'space')
        AND "cadence" IN ('weekdays', 'weekly')
        AND "status" IN ('active', 'paused')
        AND ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TalkUpdateRun_values_check') THEN
    ALTER TABLE "TalkUpdateRun"
      ADD CONSTRAINT "TalkUpdateRun_values_check" CHECK (
        "trigger" IN ('schedule', 'manual')
        AND "status" IN ('running', 'posted', 'skipped', 'failed')
      );
  END IF;
END
$$;
