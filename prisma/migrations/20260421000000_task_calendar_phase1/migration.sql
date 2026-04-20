-- Task Calendar Phase 1: schema foundation.
--
-- Task additions:
--   startAt/endAt/allDay  — hour-precise + multi-day spans (allDay defaults true so existing rows stay legacy-compatible).
--   estimateHours          — manager "given X hours to finish".
--   completedAt            — drives Gantt elapsed-time rendering.
--   parentTaskId           — one-level sub-tasks (depth enforced at API layer, not DB).
--   externalId/source/syncedAt — Google Calendar two-way sync idempotency.
-- Dropped startTime/endTime strings — unused by the UI (only passthrough in tasks POST).

-- Drop unused string time columns
ALTER TABLE "Task" DROP COLUMN IF EXISTS "startTime";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "endTime";

-- Add scheduling + sub-task + sync columns
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "startAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "allDay"          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "estimateHours"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "completedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "parentTaskId"    TEXT,
  ADD COLUMN IF NOT EXISTS "externalId"      TEXT,
  ADD COLUMN IF NOT EXISTS "externalSource"  TEXT,
  ADD COLUMN IF NOT EXISTS "syncedAt"        TIMESTAMP(3);

-- Back-fill completedAt for historical COMPLETED rows so Gantt has data
-- from day one. Uses updatedAt as the best available approximation.
UPDATE "Task" SET "completedAt" = "updatedAt"
 WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Task_parentTaskId_idx"                     ON "Task"("parentTaskId");
CREATE INDEX IF NOT EXISTS "Task_externalSource_externalId_idx"        ON "Task"("externalSource", "externalId");
CREATE INDEX IF NOT EXISTS "Task_organizationId_assigneeId_startAt_idx" ON "Task"("organizationId", "assigneeId", "startAt");

-- TaskComment: notes thread per task
CREATE TABLE IF NOT EXISTS "TaskComment" (
  "id"         TEXT PRIMARY KEY,
  "taskId"     TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskComment_taskId_fkey"   FOREIGN KEY ("taskId")   REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TaskComment_taskId_idx"   ON "TaskComment"("taskId");
CREATE INDEX IF NOT EXISTS "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- TaskLabel: per-org tags
CREATE TABLE IF NOT EXISTS "TaskLabel" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "color"          TEXT NOT NULL DEFAULT '#d4ff2e',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskLabel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaskLabel_organizationId_name_key" ON "TaskLabel"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "TaskLabel_organizationId_idx" ON "TaskLabel"("organizationId");

-- TaskLabelOnTask: many-to-many join
CREATE TABLE IF NOT EXISTS "TaskLabelOnTask" (
  "taskId"   TEXT NOT NULL,
  "labelId"  TEXT NOT NULL,
  PRIMARY KEY ("taskId", "labelId"),
  CONSTRAINT "TaskLabelOnTask_taskId_fkey"  FOREIGN KEY ("taskId")  REFERENCES "Task"("id")      ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskLabelOnTask_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "TaskLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TaskLabelOnTask_labelId_idx" ON "TaskLabelOnTask"("labelId");

-- CalendarSubscription: per-user OAuth state + calendar picker + ICS export
CREATE TABLE IF NOT EXISTS "CalendarSubscription" (
  "id"                 TEXT PRIMARY KEY,
  "userId"             TEXT NOT NULL,
  "provider"           TEXT NOT NULL,
  "externalCalendarId" TEXT,
  "shareTitles"        BOOLEAN NOT NULL DEFAULT FALSE,
  "accessToken"        TEXT,
  "refreshToken"       TEXT,
  "expiresAt"          TIMESTAMP(3),
  "syncToken"          TEXT,
  "lastSyncAt"         TIMESTAMP(3),
  "direction"          TEXT NOT NULL DEFAULT 'BOTH',
  "enabled"            BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarSubscription_userId_provider_externalCalendarId_key"
  ON "CalendarSubscription"("userId", "provider", "externalCalendarId");
CREATE INDEX IF NOT EXISTS "CalendarSubscription_userId_idx" ON "CalendarSubscription"("userId");
