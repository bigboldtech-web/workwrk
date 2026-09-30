-- FUTURE FILE. NOT APPLIED. NOT IN THE DEPLOY MANIFEST (scripts/deploy-migrations.mjs).
--
-- Access migration step 8 (access-model-spec section 10 step 8): the drops.
-- Written in Phase 8 stage F as the plan, so nobody has to reconstruct it; it
-- is run only by the founder, only after ALL of these hold in production:
--
--   1. ACCESS_V2_TABLES=true and ACCESS_V2_RESOLVER=true have run for a full
--      release with the nightly parity job clean (zero UNEXPECTED, both
--      sections, run with --prove-tables --prove-resolver).
--   2. scripts/access-retire-matrix.ts --write --strip has run for every
--      workspace (the access.matrix_retired rows hold every stored grid).
--   3. The member-table mirror is installed (or every writer moved onto
--      src/lib/access/grants.ts) and scripts/access-migrate-container-rows.ts
--      --verify reports zero drift, and the loader reads the AccessGrant
--      copies (MIGRATIONS.md, Phase 8 stage E, step 7's deviation).
--   4. The code that reads every column below is gone: `grep -rn accessLevel
--      src` returns zero, and the legacy layer (src/lib/access/legacy-*.ts,
--      legacy-resolve.ts, use-legacy-permissions.tsx, permissions.ts,
--      page-gates.ts, alignment-scope.ts, hr-segment.ts, sop-access.ts,
--      doc-access.ts, the gate halves of space.ts, board.ts, folder.ts) is
--      deleted in the same release.
--   5. A full backup of the production database was taken the same day.
--
-- The guard below makes an accidental run fail before any statement: remove
-- it deliberately, in a reviewed change, on the day.

DO $$ BEGIN
  RAISE EXCEPTION 'access-step8-drops.sql is a future file and must not be applied yet (see its header)';
END $$;

-- ── A. Let non-User subjects land, then write the deferred rows ──────────
-- AccessGrant.subjectId keeps a foreign key to "User" until here; EVERYONE,
-- TEAM, DEPARTMENT, ROLE and TAG subjects need it replaced by a check.
ALTER TABLE "AccessGrant" DROP CONSTRAINT IF EXISTS "AccessGrant_subjectId_fkey";
ALTER TABLE "AccessGrant" ALTER COLUMN "subjectId" DROP NOT NULL;
ALTER TABLE "AccessGrant" DROP CONSTRAINT IF EXISTS "AccessGrant_subjectType_check";
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_subjectType_v2_check"
  CHECK ("subjectType" IN ('USER', 'TEAM', 'DEPARTMENT', 'ROLE', 'TAG', 'EVERYONE'));
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_subject_shape_check"
  CHECK (("subjectType" = 'EVERYONE' AND "subjectId" IS NULL) OR ("subjectType" <> 'EVERYONE' AND "subjectId" IS NOT NULL));
-- Then run the EVERYONE backfill (ORG Spaces and Lists, org-visible
-- standalone Docs, org-wide Whiteboards, unscoped Tables), which
-- scripts/access-backfill.ts counts today and does not write, and the
-- Department, Role and Tag goal audiences from "GoalAssignee".

-- ── B. The org role becomes the authority ────────────────────────────────
-- Re-derive every row from the live rule in the same transaction that makes
-- the column authoritative (MIGRATIONS.md stage E: OWNER for the live Owner
-- pick, ADMIN for other admins, MEMBER for the rest, GUEST for Guests).
-- UPDATE "User" SET "orgRole" = ... ;  (the statement ships with the code)
ALTER TABLE "User" ALTER COLUMN "orgRole" SET NOT NULL;

-- ── C. Drop the legacy columns ────────────────────────────────────────────
ALTER TABLE "User" DROP COLUMN IF EXISTS "accessLevel";
ALTER TABLE "Invitation" DROP COLUMN IF EXISTS "accessLevel";
ALTER TABLE "Role" DROP COLUMN IF EXISTS "level";
ALTER TABLE "Space" DROP COLUMN IF EXISTS "visibility";
ALTER TABLE "Folder" DROP COLUMN IF EXISTS "visibility";
ALTER TABLE "Board" DROP COLUMN IF EXISTS "visibility";

-- ── D. Drop the legacy tables (their rows live in AccessGrant by now) ────
DROP TABLE IF EXISTS "SpaceMember";
DROP TABLE IF EXISTS "FolderMember";
DROP TABLE IF EXISTS "BoardMember";
DROP TABLE IF EXISTS "SOPFolderAccess";
DROP TABLE IF EXISTS "HRSegment";
DROP TABLE IF EXISTS "GoalAssignee";

-- ── E. Drop the legacy enums ──────────────────────────────────────────────
-- Two columns still use SpaceRole: AccessGrant.role (objectRole, TEXT, is the
-- role from here; fill it from role first) and Invitation.spaceRole (the
-- Space invite's role, re-expressed as an object role).
UPDATE "AccessGrant" SET "objectRole" = CASE role::text WHEN 'OWNER' THEN 'FULL' WHEN 'ADMIN' THEN 'FULL' WHEN 'MEMBER' THEN 'EDIT' ELSE 'VIEW' END WHERE "objectRole" IS NULL;
ALTER TABLE "AccessGrant" ALTER COLUMN "objectRole" SET NOT NULL;
ALTER TABLE "AccessGrant" DROP COLUMN IF EXISTS "role";
ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "spaceObjectRole" TEXT;
UPDATE "Invitation" SET "spaceObjectRole" = CASE "spaceRole"::text WHEN 'OWNER' THEN 'FULL' WHEN 'ADMIN' THEN 'FULL' WHEN 'MEMBER' THEN 'EDIT' WHEN 'GUEST' THEN 'VIEW' END WHERE "spaceRole" IS NOT NULL AND "spaceObjectRole" IS NULL;
ALTER TABLE "Invitation" DROP COLUMN IF EXISTS "spaceRole";
DROP TYPE IF EXISTS "AccessLevel";
DROP TYPE IF EXISTS "SpaceRole";
DROP TYPE IF EXISTS "SOPFolderRole";
DROP TYPE IF EXISTS "Visibility";

-- ── F. The stored permission grid ─────────────────────────────────────────
-- Already removed per workspace by access-retire-matrix.ts --strip; this is
-- the belt and braces for any row the script skipped.
UPDATE "Organization" SET settings = settings - 'permissions' WHERE settings ? 'permissions';

-- Rollback: restore from the backup taken the same day (step 5 above). There
-- is no in-place rollback for a DROP.
