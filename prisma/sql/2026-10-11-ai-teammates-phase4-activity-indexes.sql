-- AI teammates, Phase 4, review round 3 of the whole phase
-- (docs/plans/ai-teammates-phase4.md, "After Phase 4").
--
-- A person's data export (GET /api/me/export, GDPR Article 15) reads their
-- activity rows by src/lib/access/personal-activity.ts exportActivityWhere,
-- in every workspace: the rows they wrote (by "actorId", which has its own
-- index), the personal teammate rows that act for them (by "actingForId")
-- and their Google connection's rows (by "targetId", a "user" target).
-- "ActivityLog" had no index on either of the last two, so those arms could
-- read only by the type index, across every workspace's teammate rows. Two
-- partial indexes, each holding only rows of the kind its arm reads:
--   "ActivityLog" ("actingForId", "createdAt") WHERE "actingForId" IS NOT NULL
--   "ActivityLog" ("targetId", "createdAt") WHERE "targetType" = 'user'
-- Prisma cannot declare a partial index, so neither is in schema.prisma; a
-- comment on the ActivityLog model there names this file.
--
-- LOCKS. Each statement runs only when its index is missing, checked in the
-- catalogue first (as 2026-10-11-ai-teammates-phase3-round7.sql), so a
-- deploy after the first takes no lock on this table. The first build is a
-- plain CREATE INDEX, not CONCURRENTLY: it holds a SHARE lock on
-- "ActivityLog" while it reads the table (until the second build ends too,
-- when the file runs as one transaction), so every insert, update and
-- delete of "ActivityLog" waits for the build: every audited write in the
-- app, and every transaction queued behind one of those, holding its own
-- locks while it waits.
-- In production on 2026-10-11 the table is small, so that is a moment. On a
-- large "ActivityLog" (another database, a restore), build them by hand
-- first, in a quiet window, with
--   CREATE INDEX CONCURRENTLY "ActivityLog_actedFor_actingForId_createdAt_idx"
--     ON "ActivityLog" ("actingForId", "createdAt") WHERE "actingForId" IS NOT NULL;
--   CREATE INDEX CONCURRENTLY "ActivityLog_userTarget_targetId_createdAt_idx"
--     ON "ActivityLog" ("targetId", "createdAt") WHERE "targetType" = 'user';
-- and this file then skips them. CONCURRENTLY cannot run inside a DO block
-- or a transaction, which is why this file does not use it.
--
-- Additive and idempotent: indexes only, no row read for its content or
-- written. Either order with the code works: without them the export still
-- runs, reading those arms by the type index.
-- Rollback: DROP INDEX IF EXISTS "ActivityLog_actedFor_actingForId_createdAt_idx";
--           DROP INDEX IF EXISTS "ActivityLog_userTarget_targetId_createdAt_idx";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ActivityLog_actedFor_actingForId_createdAt_idx'
  ) THEN
    CREATE INDEX "ActivityLog_actedFor_actingForId_createdAt_idx" ON "ActivityLog" ("actingForId", "createdAt")
      WHERE "actingForId" IS NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ActivityLog_userTarget_targetId_createdAt_idx'
  ) THEN
    CREATE INDEX "ActivityLog_userTarget_targetId_createdAt_idx" ON "ActivityLog" ("targetId", "createdAt")
      WHERE "targetType" = 'user';
  END IF;
END
$$;
