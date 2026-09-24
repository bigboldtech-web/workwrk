-- 2026-09-24 - Phase 5b, the data layer: tasks in more than one List, and
-- scheduled email reports.
--
-- Decided additions (docs/plans/competitor-gap-2026-09.md section 7):
--   (e) TASKS IN MORE THAN ONE LIST (decision 7). A task keeps its HOME List
--       exactly as today ("Item"."boardId", untouched, no data migration). A
--       row in the new "ItemListLink" table shows the task, with its subtask
--       tree, in ONE more List. Reading List B returns B's own tasks plus the
--       tasks linked into B.
--   (b) SCHEDULED EMAIL REPORTS (gap 16). A row in the new "ReportSchedule"
--       table emails a dashboard or a saved view on a cadence to org
--       members, each copy computed under that recipient's own access at
--       send time.
--
-- Additions (a), (d) and (f) need no schema. Dashboards use the existing
-- "Dashboard" table. Connect and mirror columns are field config in
-- "Board"."schema". A secondary List's own field values are stored on the
-- task, inside the existing "Item"."metadata" JSON under the reserved key
-- "$lists" (a field key is a slug of letters, digits and underscores, so no
-- field can ever be called that). List comfort lives in "Board"."settings"
-- and "View"."config".
--
-- TWO NEW TABLES, NOTHING ELSE. No existing table gains, loses, renames or
-- retypes a column, and no existing row is read or written by this file.
--
-- DEPLOY ORDER IS FREE, and here is why rather than a promise:
--   * No existing model gains a column. The new Prisma fields on "Item",
--     "Board" and "Organization" are RELATION fields, which have no column,
--     so a findMany with no select on those models asks for exactly what it
--     asked for before, with or without this file.
--   * Every reader of "ItemListLink" goes through
--     src/lib/list-links-server.ts, which checks to_regclass once (and again
--     every five minutes while the table is absent) and answers the
--     home-only read, which is exactly today's behaviour, when it is missing.
--     A raw query that meets 42P01 degrades the same way. The link write
--     routes answer a named 503.
--   * "ReportSchedule" is read only by the new report routes and the new
--     cron, which answer a named 503 (routes) or a no-op (cron) while the
--     table is absent.
-- It is in the deploy manifest (scripts/deploy-migrations.mjs) anyway, so the
-- release that ships the code is the release that can use it.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- every foreign key guarded by a catalogue lookup (ADD CONSTRAINT has no IF
-- NOT EXISTS in PostgreSQL). Running it twice is a no-op.

-- 1. A task shown in one more List.
--
--    The primary key IS the decided "unique on (itemId, boardId)": a task
--    appears in a given List at most once. "position" is the task's order
--    inside THIS List, in the same order space as that List's own tasks, and
--    never touches "Item"."position", so ordering a shared task in List B
--    cannot reorder List A. "addedById" has no foreign key on purpose, like
--    "archivedById": removing a person must never remove what they shared.
CREATE TABLE IF NOT EXISTS "ItemListLink" (
  "itemId"    TEXT NOT NULL,
  "boardId"   TEXT NOT NULL,
  "position"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemListLink_pkey" PRIMARY KEY ("itemId", "boardId")
);

-- 2. The read List B makes: its linked tasks, in its own order. Lookups by
--    task ("which Lists is this task in") use the primary key, whose leading
--    column is "itemId", so they need no second index.
CREATE INDEX IF NOT EXISTS "ItemListLink_boardId_position_idx"
  ON "ItemListLink" ("boardId", "position");

-- 3. Deleting the task or the List deletes the link, and only the link.
--    Trash snapshots the link rows before either delete and restores them
--    (src/lib/trash.ts), so a recoverable delete stays recoverable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItemListLink_itemId_fkey'
  ) THEN
    ALTER TABLE "ItemListLink"
      ADD CONSTRAINT "ItemListLink_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "Item" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItemListLink_boardId_fkey'
  ) THEN
    ALTER TABLE "ItemListLink"
      ADD CONSTRAINT "ItemListLink_boardId_fkey"
      FOREIGN KEY ("boardId") REFERENCES "Board" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 4. A scheduled email report.
--
--    "targetKind" and "cadence" are text rather than enums, so a new kind is
--    a release and not a migration (the "CalendarEvent" precedent).
--    "recipientUserIds" holds org member ids and nothing else: a free-text
--    address is refused by the API and has no column to land in. "targetId"
--    has no foreign key because it names a row in one of two tables. A
--    target that is archived or in Trash only records a skip in "runLog"
--    and moves "nextRunAt" forward, so a restore resumes the schedule; only
--    a target that is gone for good sets "active" to false.
CREATE TABLE IF NOT EXISTS "ReportSchedule" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "createdById"      TEXT NOT NULL,
  "targetKind"       TEXT NOT NULL,
  "targetId"         TEXT NOT NULL,
  "cadence"          TEXT NOT NULL,
  "weekday"          INTEGER,
  "monthDay"         INTEGER,
  "timeOfDay"        TEXT NOT NULL,
  "timezone"         TEXT NOT NULL,
  "recipientUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "lastSentAt"       TIMESTAMP(3),
  "nextRunAt"        TIMESTAMP(3),
  -- The last 20 runs, counts only and never recipient ids.
  "runLog"           JSONB NOT NULL DEFAULT '[]',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- 5. The cron's scan: active schedules whose next instant has arrived.
CREATE INDEX IF NOT EXISTS "ReportSchedule_active_nextRunAt_idx"
  ON "ReportSchedule" ("active", "nextRunAt");

-- 6. "Schedules on this dashboard or view", "the schedules I made", and
--    "the reports I receive".
CREATE INDEX IF NOT EXISTS "ReportSchedule_organizationId_targetKind_targetId_idx"
  ON "ReportSchedule" ("organizationId", "targetKind", "targetId");
CREATE INDEX IF NOT EXISTS "ReportSchedule_organizationId_createdById_idx"
  ON "ReportSchedule" ("organizationId", "createdById");
CREATE INDEX IF NOT EXISTS "ReportSchedule_recipientUserIds_idx"
  ON "ReportSchedule" USING GIN ("recipientUserIds");

-- 7. Deleting an organization takes its schedules with it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReportSchedule_organizationId_fkey'
  ) THEN
    ALTER TABLE "ReportSchedule"
      ADD CONSTRAINT "ReportSchedule_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
