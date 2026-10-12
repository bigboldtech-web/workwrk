-- 2026-10-12 Docs-found fixes batch 6: a check-in names the workspace it
-- was written in (docs/plans/docs-found-fixes.md, "Batch 6: check-ins by
-- workspace, private digests, webhook claims").
--
-- "CheckIn"."organizationId" TEXT, nullable: the workspace POST
-- /api/check-ins wrote the row in (the session's workspace). A check-in
-- named no workspace, so someone who belongs to two workspaces had one set
-- of check-ins (mood, what went well, challenges), read in each by that
-- workspace's Admins, People team and org-wide levels: an agency person's
-- notes about their own employer reached every client workspace they were
-- invited into. Reads now take only the rows of the workspace being read
-- (src/lib/check-in-access.server.ts).
--
-- EXISTING ROWS ARE UNCHANGED, NO BACKFILL. They keep a null here, and no
-- guess is written: a person's anchor is only the last workspace they
-- switched to. A null row is read by others only where its person holds a
-- level in exactly one workspace, the one being read; otherwise only by the
-- person.
--
-- FOREIGN KEY, ON DELETE CASCADE: a workspace deleted for good takes its
-- check-ins with it. Never SET NULL, which would turn them into rows of no
-- workspace, readable where their person now works alone. No Prisma
-- relation (as on "AgentAction"), so the Organization model is unchanged.
-- Every row is null when the key is added, so its check reads nothing.
--
-- INDEX ("organizationId", "createdAt"): the AI digest and the list read a
-- workspace's rows of the last week, newest first.
--
-- CATALOGUE-GUARDED. Each statement runs only when pg_attribute,
-- pg_constraint or pg_indexes says it is missing, so a deploy after the
-- first takes no lock at all. The first run's ALTERs take a brief ACCESS
-- EXCLUSIVE lock on "CheckIn" (catalogue only: a nullable column with no
-- default) and the key a SHARE ROW EXCLUSIVE lock on "Organization" for its
-- check; the index is a plain CREATE INDEX (a SHARE lock on "CheckIn" while
-- it reads the table). "CheckIn" is small: nothing in the app writes it.
--
-- APPLY THIS FILE BEFORE THE CODE. GET /api/check-ins and GET /api/me/export
-- read "CheckIn" with no select, so the new build's client asks for the
-- column on every read. It runs on every deploy (scripts/deploy-migrations.mjs
-- SQL_MANIFEST), before the reload.
-- Rollback: ALTER TABLE "CheckIn" DROP CONSTRAINT IF EXISTS "CheckIn_organizationId_fkey";
--           DROP INDEX IF EXISTS "CheckIn_organizationId_createdAt_idx";
--           ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "organizationId";
-- (the code before this file never reads it).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"CheckIn"'::regclass AND attname = 'organizationId' AND NOT attisdropped
  ) THEN
    ALTER TABLE "CheckIn" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CheckIn_organizationId_fkey') THEN
    ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'CheckIn_organizationId_createdAt_idx'
  ) THEN
    CREATE INDEX "CheckIn_organizationId_createdAt_idx" ON "CheckIn" ("organizationId", "createdAt");
  END IF;
END $$;
