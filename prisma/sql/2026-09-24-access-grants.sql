-- One access model (2026-09-24): the "AccessGrant" table.
--
-- WHAT IT ADDS. One new table and nothing else: a person's grant on one
-- table, canvas or form, the three node kinds that had no person grant store
-- of their own. Its role reuses the existing "SpaceRole" enum on the ladder
-- the Manage access dialog speaks: ADMIN is Full access, MEMBER is Can edit,
-- GUEST is Can view. OWNER is never written: an object's creator or owner is
-- its own column and keeps Full access for life.
--
-- WHY TABLES, CANVASES AND FORMS ONLY. Spaces, Folders and Lists keep
-- "SpaceMember", "FolderMember" and "BoardMember"; docs keep
-- Organization.settings.docSharing. Reusing what exists is the rule for this
-- release (decision A9), so no existing grant moves and a rollback leaves
-- every one of them in place.
--
-- WHY NO NEW ENUM. "objectType" and "subjectType" are TEXT with CHECK
-- constraints rather than Postgres enums, so a later kind is one ALTER of a
-- constraint instead of an enum migration that cannot run inside a
-- transaction.
--
-- DEPLOY ORDER IS FREE, AND CHECKED RATHER THAN ASSERTED. No existing model
-- gains a column. The only reader, src/lib/access/access-grant-store.ts,
-- checks to_regclass('"AccessGrant"') and answers "nobody holds a grant"
-- while the table is absent, and the only writer (src/lib/access/grants.ts)
-- answers a named 503 grants_unavailable. It is in the deploy manifest
-- (scripts/deploy-migrations.mjs) so the release that ships the code is the
-- release that can use it.
--
-- IDEMPOTENT. Every statement is guarded (IF NOT EXISTS, or a pg_constraint
-- check), so running this file twice is a no-op.

CREATE TABLE IF NOT EXISTS "AccessGrant" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "objectType"     TEXT NOT NULL,
  "objectId"       TEXT NOT NULL,
  "subjectType"    TEXT NOT NULL DEFAULT 'USER',
  "subjectId"      TEXT NOT NULL,
  "role"           "SpaceRole" NOT NULL,
  "grantedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccessGrant_objectType_check" CHECK ("objectType" IN ('TABLE', 'WHITEBOARD', 'FORM')),
  CONSTRAINT "AccessGrant_subjectType_check" CHECK ("subjectType" IN ('USER')),
  CONSTRAINT "AccessGrant_role_check" CHECK ("role" IN ('ADMIN', 'MEMBER', 'GUEST'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccessGrant_objectType_objectId_subjectType_subjectId_key"
  ON "AccessGrant" ("objectType", "objectId", "subjectType", "subjectId");
CREATE INDEX IF NOT EXISTS "AccessGrant_organizationId_subjectType_subjectId_idx"
  ON "AccessGrant" ("organizationId", "subjectType", "subjectId");
CREATE INDEX IF NOT EXISTS "AccessGrant_objectType_objectId_idx"
  ON "AccessGrant" ("objectType", "objectId");

-- Deleting the organization or the person deletes their grants, and only
-- their grants (the member tables' precedent). "objectId" has no foreign key
-- because it names a row in one of three tables; an object's own delete path
-- (Trash purge) removes its grants in the same transaction. "grantedById" has
-- none on purpose, like "addedById": removing a person never removes what
-- they shared.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_organizationId_fkey') THEN
    ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_subjectId_fkey') THEN
    ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_subjectId_fkey"
      FOREIGN KEY ("subjectId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
