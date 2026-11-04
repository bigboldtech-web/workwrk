/* 2026-11-04 A person's weekly check-in and timesheet in each workspace
   (docs/plans/workspace-status-2.md, the final review, security M1).
   WHAT THIS FILE DOES, in order, each step catalogue-guarded, so a deploy
   after the first reads only the catalogue and changes nothing:
   1. THE CHECK. Every "WeeklyReview" row and every "Timesheet" row names
      its workspace: "organizationId" has been NOT NULL in both since each
      table was made, so this is a guard, not a repair. If a row has none
      (a column whose NOT NULL was dropped by hand), the file stops with an
      exception naming the table and how many rows, before it changes
      anything: the file rolls back whole, the deploy stops before the
      build and the release before keeps serving on the old keys. Such a
      row would be unique to nothing under the new key (NULLs are distinct
      in a unique index), so a second week row of the same person could
      be written beside it. Nothing is guessed and nothing is deleted:
      give each such row its workspace by hand (the workspace of its time
      entries, or its person's) and deploy again.
   2. THE NEW UNIQUE KEYS, ADDED FIRST:
      "WeeklyReview_userId_organizationId_periodStart_key" on ("userId",
      "organizationId", "periodStart") and
      "Timesheet_userId_organizationId_weekStartDate_key" on ("userId",
      "organizationId", "weekStartDate"). Each always builds: the old key it
      widens already holds one row per person and week.
   3. THE OLD UNIQUE KEYS, DROPPED AFTER: "WeeklyReview_userId_periodStart_key"
      and "Timesheet_userId_weekStartDate_key", as an index or as a
      constraint, whichever the catalogue holds. The plain index
      "Timesheet_userId_weekStartDate_idx" stays.
   Nothing is deleted and no row is written. From here on a person holds one
   week row per workspace.

   WHY. A weekly check-in and a timesheet belong to a workspace (each row
   names one), but the old keys allowed one row per account and week,
   whichever workspace made it first. Pat, anchored at her agency A and
   working for client B through a membership, logged A hours on Monday, so
   the week's timesheet was A's, approved by Max. Her B hours on Wednesday
   were written onto A's timesheet, so Max read B's task titles and hours
   and decided them, and Dana's B queue never held Pat's week; her B
   check-in was saved onto A's row and went to Max. With the keys per
   workspace, the code finds and makes a person's week by person, workspace
   and week (src/lib/weekly-review.ts, src/lib/timesheet.ts and the routes
   that use them), and reads a week's entries, KPI snapshots and notes for
   the workspace it is read in.

   THE ROWS ALREADY THERE are left exactly as they are: a row written before
   this file keeps its workspace. A week whose B check-in or B hours were
   saved onto A's row stays A's row (its B entries keep their own
   workspace, and are left off A's timesheet when it is read in A); the plan
   says how to count them (Known limits).

   THE KEYS' LOCKS. Each CREATE UNIQUE INDEX holds off writes of its table
   for the length of its build (a share lock; reads go on), and each DROP
   takes its table for a moment. The tables are a row per person and week.

   BEFORE OR AFTER THE CODE. Either order reads: the new release looks a
   week up by the three columns, which the database answers with or without
   the new key, and the release before looks one up by person and week. The
   new key is what refuses a second row of the same person, workspace and
   week (two tabs saving at once), so the manifest applies this file before
   the reload, last, after 2026-11-03-workspace-lines.sql. In the minutes
   between this file and the reload the release before still looks a week
   up by person and week, so someone who already has another workspace's
   row of that week is answered that row, exactly as before this file.

   Rollback: the old keys come back only while nobody holds two rows of one
   week, which this release writes as soon as someone works in two
   workspaces in a week. List them first, SELECT "userId", "periodStart",
   count(*) FROM "WeeklyReview" GROUP BY 1, 2 HAVING count(*) > 1, and
   SELECT "userId", "weekStartDate", count(*) FROM "Timesheet" GROUP BY 1, 2
   HAVING count(*) > 1, and decide each by hand (nothing here merges or
   deletes a person's week). Then CREATE UNIQUE INDEX IF NOT EXISTS
   "WeeklyReview_userId_periodStart_key" ON "WeeklyReview"("userId",
   "periodStart"); CREATE UNIQUE INDEX IF NOT EXISTS
   "Timesheet_userId_weekStartDate_key" ON "Timesheet"("userId",
   "weekStartDate"); DROP INDEX IF EXISTS
   "WeeklyReview_userId_organizationId_periodStart_key"; DROP INDEX IF
   EXISTS "Timesheet_userId_organizationId_weekStartDate_key". The release
   before this one reads one row per person and week. */

/* 1. The check: every week row names its workspace. */
DO $$
DECLARE
  reviews bigint;
  sheets bigint;
BEGIN
  SELECT count(*) INTO reviews FROM "WeeklyReview" WHERE "organizationId" IS NULL;
  SELECT count(*) INTO sheets FROM "Timesheet" WHERE "organizationId" IS NULL;
  IF reviews > 0 OR sheets > 0 THEN
    RAISE EXCEPTION '2026-11-04-week-rows-per-workspace.sql changed nothing: % "WeeklyReview" row(s) and % "Timesheet" row(s) name no workspace ("organizationId" is NULL). Give each its workspace by hand (the workspace of its time entries, or its person''s), then deploy again.', reviews, sheets;
  END IF;
END
$$;

/* 2. The new keys first, each only while the catalogue lacks it; 3. then the old ones go, as an index or a constraint. */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'WeeklyReview_userId_organizationId_periodStart_key') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyReview_userId_organizationId_periodStart_key" ON "WeeklyReview"("userId", "organizationId", "periodStart");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'Timesheet_userId_organizationId_weekStartDate_key') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "Timesheet_userId_organizationId_weekStartDate_key" ON "Timesheet"("userId", "organizationId", "weekStartDate");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WeeklyReview_userId_periodStart_key' AND conrelid = '"WeeklyReview"'::regclass) THEN
    ALTER TABLE "WeeklyReview" DROP CONSTRAINT "WeeklyReview_userId_periodStart_key";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'WeeklyReview_userId_periodStart_key') THEN
    DROP INDEX IF EXISTS "WeeklyReview_userId_periodStart_key";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Timesheet_userId_weekStartDate_key' AND conrelid = '"Timesheet"'::regclass) THEN
    ALTER TABLE "Timesheet" DROP CONSTRAINT "Timesheet_userId_weekStartDate_key";
  ELSIF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'Timesheet_userId_weekStartDate_key') THEN
    DROP INDEX IF EXISTS "Timesheet_userId_weekStartDate_key";
  END IF;
END
$$;
