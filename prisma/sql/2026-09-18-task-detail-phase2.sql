-- Phase 2, Stage A: the additive item API contract.
-- docs/plans/ui-refresh/spec-task-detail.md section 4 step 1
-- docs/plans/ui-refresh/spec-work-home.md section 4, data migrations item 3
--
-- ADDITIVE ONLY. Three new tables and two new enum values. Nothing existing is
-- renamed, retyped, dropped or made required, so this file can be applied to a
-- live database while the current release is serving traffic, and the release
-- that follows it tolerates every one of these objects being absent.
--
-- IDEMPOTENT. Re-running it is a no-op. Every statement is guarded.
--
-- HOW TO APPLY IN PRODUCTION (founder, on the aaPanel Postgres):
--   npx prisma db execute --file prisma/sql/2026-09-18-task-detail-phase2.sql
-- then `npx prisma generate`. Never `prisma migrate dev` and never `db push`:
-- this database has drift that both of those would try to "fix" destructively.
--
-- NOTE on the flags: prisma 7's `db execute` no longer takes `--schema`; it
-- reads the schema path and the datasource URL from prisma.config.ts, which
-- resolves DIRECT_URL first and DATABASE_URL second. Passing `--schema` is a
-- hard CLI error, so the command above is the whole command.
--
-- Local (already applied by the authoring session, against .env.local only):
--   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
--     npx prisma db execute --file prisma/sql/2026-09-18-task-detail-phase2.sql

-- ── 1. Comment attachments ────────────────────────────────────────
-- A FileEntry attached to one ItemUpdate. fileId is deliberately NOT a foreign
-- key: deleting a file must never cascade a comment out of a thread.
CREATE TABLE IF NOT EXISTS "ItemUpdateAttachment" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "updateId"       TEXT NOT NULL,
  "fileId"         TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemUpdateAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ItemUpdateAttachment_updateId_fileId_key"
  ON "ItemUpdateAttachment" ("updateId", "fileId");

CREATE INDEX IF NOT EXISTS "ItemUpdateAttachment_organizationId_fileId_idx"
  ON "ItemUpdateAttachment" ("organizationId", "fileId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItemUpdateAttachment_updateId_fkey'
  ) THEN
    ALTER TABLE "ItemUpdateAttachment"
      ADD CONSTRAINT "ItemUpdateAttachment_updateId_fkey"
      FOREIGN KEY ("updateId") REFERENCES "ItemUpdate" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. Comment reactions ──────────────────────────────────────────
-- The unique key is what makes POST idempotent and DELETE exact.
CREATE TABLE IF NOT EXISTS "ItemUpdateReaction" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "updateId"       TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "emoji"          TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemUpdateReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ItemUpdateReaction_updateId_userId_emoji_key"
  ON "ItemUpdateReaction" ("updateId", "userId", "emoji");

CREATE INDEX IF NOT EXISTS "ItemUpdateReaction_updateId_idx"
  ON "ItemUpdateReaction" ("updateId");

CREATE INDEX IF NOT EXISTS "ItemUpdateReaction_organizationId_userId_idx"
  ON "ItemUpdateReaction" ("organizationId", "userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItemUpdateReaction_updateId_fkey'
  ) THEN
    ALTER TABLE "ItemUpdateReaction"
      ADD CONSTRAINT "ItemUpdateReaction_updateId_fkey"
      FOREIGN KEY ("updateId") REFERENCES "ItemUpdate" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 3. Legacy id redirects ────────────────────────────────────────
-- Written later by the Task and Ideas migrations (spec-work-home W4 and W5) so
-- a bookmarked /tasks/<id> keeps resolving after the source rows are gone.
-- Nothing reads it until those migrations run.
CREATE TABLE IF NOT EXISTS "LegacyRedirect" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "legacyId"       TEXT NOT NULL,
  "target"         TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyRedirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegacyRedirect_organizationId_kind_legacyId_key"
  ON "LegacyRedirect" ("organizationId", "kind", "legacyId");

CREATE INDEX IF NOT EXISTS "LegacyRedirect_organizationId_kind_idx"
  ON "LegacyRedirect" ("organizationId", "kind");

-- ── 4. Dependency link kinds ──────────────────────────────────────
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is itself idempotent, and adding a
-- value to an enum never rewrites a row.
ALTER TYPE "EntityLinkRelation" ADD VALUE IF NOT EXISTS 'BLOCKS';
ALTER TYPE "EntityLinkRelation" ADD VALUE IF NOT EXISTS 'WAITING_ON';
