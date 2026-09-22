-- 2026-09-22 - Phase 4, Time and Talk - the personal calendar entry.
--
-- spec-planner.md section 2 `/planner` Data and section 4 step 5.
--
-- WHAT IT ADDS. One new table, "CalendarEvent". Nothing is renamed,
-- retyped, dropped or made required, and not one existing row changes
-- value. The table is empty on creation and stays empty until either a
-- person creates an event on the Calendar or the Google sync cron writes
-- one, so applying this file changes nothing anybody can see.
--
-- WHY IT EXISTS. Two defects shared one cause: personal events had no
-- home.
--
--   * "New event" on the Calendar posted to /api/me/work, so a block of
--     focus time became a personal TASK. It then appeared in My work, in
--     the task counts and in every "what is still open" list, because a
--     task is a thing you finish and an event is a thing that happens.
--   * The Google sync cron wrote into the LEGACY "Task" table with
--     "externalSource" = 'GCAL' while the Planner read "Item". A
--     connected Google Calendar therefore produced rows that no surface
--     in the product rendered at all.
--
-- DEPLOY ORDER IS FREE. Every reader of this table is wrapped and answers
-- "no events" when the relation is absent:
--   src/app/api/calendar/events/route.ts        (the calendar read)
--   src/app/api/calendar/events/[id]/route.ts   (edit and delete)
--   src/services/googleCalendarSync.ts          (the sync write)
-- so a release deployed ahead of this file shows exactly what the release
-- before it showed. Apply it early anyway: until it is applied, "New
-- event" answers a surfaced "Couldn't create it" rather than saving.
--
-- THE EXISTING ROWS ARE NOT TOUCHED BY THIS FILE. Copying the GCAL and
-- personal-event rows out of "Task" is a DATA migration and lives in
-- scripts/backfill-calendar-events.mjs, which is dry-run by default,
-- prints a per-organization report, asserts its counts, is idempotent and
-- never deletes or mutates a source row. See scripts/MIGRATIONS.md.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- two foreign keys each guarded by a catalogue lookup (ADD CONSTRAINT has
-- no IF NOT EXISTS in PostgreSQL).

-- 1. The table.
CREATE TABLE IF NOT EXISTS "CalendarEvent" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  -- 'EVENT' | 'FOCUS' | 'OOO'. A text column and not an enum, so a new
  -- kind is a release and not a migration.
  "kind"           TEXT NOT NULL DEFAULT 'EVENT',
  "startAt"        TIMESTAMP(3) NOT NULL,
  "endAt"          TIMESTAMP(3) NOT NULL,
  "allDay"         BOOLEAN NOT NULL DEFAULT false,
  "description"    TEXT,
  -- 'GCAL' on a row the sync cron wrote; NULL on one a person created.
  "externalSource" TEXT,
  -- `${calendarId}::${eventId}` for a Google row: the sync's idempotency
  -- key, and the reason the unique index below exists.
  "externalId"     TEXT,
  "subscriptionId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- 2. One Google event lands once per person, however many times the sync
--    runs. PostgreSQL treats NULLs as distinct in a unique index, so rows
--    a person created by hand (both external columns NULL) are unaffected
--    by it and any number of them can exist.
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_userId_externalSource_externalId_key"
  ON "CalendarEvent" ("userId", "externalSource", "externalId");

-- 3. The read the Calendar actually makes: this person, this window.
CREATE INDEX IF NOT EXISTS "CalendarEvent_organizationId_userId_startAt_idx"
  ON "CalendarEvent" ("organizationId", "userId", "startAt");

-- 4. Disconnecting a calendar removes the rows it brought in, by
--    subscription.
CREATE INDEX IF NOT EXISTS "CalendarEvent_subscriptionId_idx"
  ON "CalendarEvent" ("subscriptionId");

-- 5. The two foreign keys. Deleting a person or an organization takes
--    their private calendar rows with them; a dangling event row owned by
--    nobody is not a thing this product should be able to hold.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_organizationId_fkey'
  ) THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_userId_fkey'
  ) THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
