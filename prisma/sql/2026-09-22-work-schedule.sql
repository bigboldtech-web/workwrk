-- 2026-09-22 - Phase 4, Time and Talk - the org working calendar and the
-- two time-tracking-depth columns on a time entry.
--
-- Decided additions (docs/plans/competitor-gap-2026-09.md section 7):
--   (b) WORK SCHEDULE   "an org-wide working calendar (workweek days,
--       hours, holidays) as a settings record"
--   (c) TIME TRACKING DEPTH   "a billable flag, notes and tags on entries"
--       (notes already exist: TimeEntry."description")
--
-- One new table and two new columns. Nothing is renamed, retyped, dropped
-- or made required, and no existing row changes value: the two columns
-- default to exactly what the product did before them (not billable, no
-- tags), and an organization with no "WorkSchedule" row reads the same
-- Monday-to-Friday 8-hour defaults the two consuming surfaces hard-coded.
--
-- DEPLOY ORDER IS FREE FOR THIS FILE, unlike 2026-09-22-time-and-talk.sql.
-- Be precise about why, because the two files sit next to each other:
--
--   * "WorkSchedule" is read through ONE function,
--     readOrgWorkSchedule() in src/lib/work-schedule.ts, which wraps the
--     query in a try and returns WORK_SCHEDULE_DEFAULTS when the table is
--     not there. A release deployed ahead of this file shows every
--     organization the default calendar rather than an error.
--   * "TimeEntry"."billable" and "tags" are named in exactly TWO places,
--     and both are routes that SET them: POST /api/time-entries and
--     PATCH /api/time-entries/[id]. Everything else on the entry path names
--     its columns explicitly and leaves the two out, so the punch, the
--     timer bridge, the timesheet read and the calendar footer all keep
--     working against a database that does not have them.
--
--     THIS IS A STANDING RULE AND IT IS EASY TO BREAK. Prisma emits EVERY
--     scalar of a model on a query with no `select`, so ONE bare
--     findFirst / findMany / create / update on "TimeEntry" is enough to
--     make a release that shipped ahead of this file 500 on the clock.
--     That is exactly what the first draft of this header missed: it
--     considered only findMany, and only one route, while the punch route
--     had four bare queries on the two shapes that matter most. Before
--     adding any TimeEntry query, give it a `select`. Do not trust this
--     paragraph; run:
--
--         grep -n "prisma\.timeEntry\.\|tx\.timeEntry\." -r src \
--           | grep -v "select"
--
-- Apply it first anyway: "free" means nothing breaks in either order, not
-- that the order does not matter to what people see.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, and one FK guarded by a catalogue lookup.

-- 1. The working calendar. One row per organization, enforced by the
--    unique index below rather than by application code.
CREATE TABLE IF NOT EXISTS "WorkSchedule" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workdays"       INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
  "hoursPerDay"    DECIMAL(4, 2) NOT NULL DEFAULT 8,
  "timezone"       TEXT,
  "holidays"       JSONB NOT NULL DEFAULT '[]',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkSchedule_organizationId_key"
  ON "WorkSchedule" ("organizationId");

-- 2. The foreign key, added only when it is not already there. ADD
--    CONSTRAINT has no IF NOT EXISTS in PostgreSQL, so the catalogue is
--    asked first: that is what makes a second run a no-op instead of a
--    "constraint already exists" error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkSchedule_organizationId_fkey'
  ) THEN
    ALTER TABLE "WorkSchedule"
      ADD CONSTRAINT "WorkSchedule_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 3. Time-tracking depth on a single entry.
--
--    "billable" defaults to false on purpose. Defaulting it true would
--    mark every hour already worked in every workspace as billable, which
--    is inventing revenue in somebody else's books.
--
--    "tags" is entry-level and is NOT the cost-center TagAssignment that
--    rides the parent Timesheet: that one labels a whole week, this one
--    labels one hour. Both can be set; neither reads the other.
--
--    Notes already exist as "TimeEntry"."description", so nothing is added
--    for them.
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "billable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "TimeEntry_organizationId_billable_idx"
  ON "TimeEntry" ("organizationId", "billable");
