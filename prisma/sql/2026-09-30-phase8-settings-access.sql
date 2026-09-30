-- 2026-09-30 - Phase 8, settings, sign-in and the access surfaces. The ONE
-- schema file for the phase: later stages append their statements below
-- this block, each guarded the same way.
--
-- Stage B (sign-in and the wizard): TWO NEW NULLABLE COLUMNS ON "User",
-- NOTHING ELSE.
--
--   * "User"."termsAcceptedAt": when the person agreed to the Terms and the
--     Privacy Policy at /signup (spec-account-auth `/signup` field 5). The
--     policy version is recorded on the `terms.accepted` ActivityLog row the
--     same request writes. Null for every account made before this release
--     ("not recorded"), never back-filled with a guess.
--   * "User"."passwordChangedAt": the last time the person chose a password
--     (signup, join, reset, change password). Null reads as "unknown" and
--     no policy acts on a null.
--
-- No existing row is read or written, no backfill. APPLY THIS BEFORE THE
-- CODE: the new release writes both columns on signup, join and reset, so
-- until this file lands those three writes fail with a 500 (nothing is
-- half written: each is one statement or one transaction). The running
-- release never names either column, so applying it early is safe.
--
-- Idempotent: every statement is guarded, so running this file twice is a
-- no-op.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Stage D (workspace settings): WHO DID IT, ON EVERY AUDIT ROW.
--
--   * "ActivityLog"."actorType": what kind of actor wrote the row: 'user'
--     (a person, every row before this release), 'api_key', 'agent',
--     'system', 'scim' or 'platform_staff' (a WorkwrK staff change from the
--     Staff console). NOT NULL with a constant default, so every existing
--     row reads 'user' without a rewrite (Postgres 11+ stores the default in
--     the catalogue; no table rewrite, no lock beyond the brief ALTER).
--   * "ActivityLog"."actorLabel": the name shown when the actor is not a
--     person ("WorkwrK Support", "API key wk_ab12"). Null for people.
--   * "ActivityLog"."actingForId": the person a key or an agent acted as.
--   * "ActivityLog"."actorId" becomes NULLABLE: a WorkwrK staff row names no
--     user of the customer's organisation (src/lib/staff-audit.ts held those
--     rows until this column set existed). Relaxing NOT NULL rewrites
--     nothing and loses nothing; every existing row keeps its actor.
--
-- Rollback (only if the release is rolled back AND no staff row was
-- written): DELETE the rows WHERE "actorId" IS NULL, then
-- ALTER COLUMN "actorId" SET NOT NULL. The three new columns can stay.

ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actorType" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actorLabel" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actingForId" TEXT;
ALTER TABLE "ActivityLog" ALTER COLUMN "actorId" DROP NOT NULL;

-- Stage E (the access flip, flag-gated; access-model-spec section 10 steps
-- 3, 4 and 7). ADDITIVE ONLY: new nullable or defaulted columns, three new
-- tables, and two CHECK constraints on "AccessGrant" WIDENED (the old set is
-- a strict subset of the new one, so no existing row can fail). Nothing is
-- renamed, retyped or dropped; no existing row is read or written here. The
-- data steps are scripts, dry-run by default:
--   scripts/access-backfill.ts               (step 4: orgRole, People team,
--                                            restricted and findable, the
--                                            reach-preservation grants)
--   scripts/access-migrate-container-rows.ts (step 7: member rows copied into
--                                            AccessGrant, old tables untouched)
--   scripts/access-retire-matrix.ts          (the matrix export)
-- The running release never names any of these columns, so applying this
-- block before the code is safe; the new release reads them only behind
-- ACCESS_V2_TABLES (default OFF), and writes AccessRequest rows (the Request
-- access flow) and Team rows (Members > Teams) whatever the flag says.
--
--   * "User"."orgRole": OWNER | ADMIN | MEMBER | GUEST. NULL until the
--     backfill writes it; every reader falls back to orgRoleOf(accessLevel)
--     while it is NULL (spec 10.1).
--   * "User"."isAgent", "User"."adminScopes": the Agent flag and the Admin
--     scopes (billing, security). Defaults false and empty, which is exactly
--     what every reader derives today.
--   * "Invitation"."orgRole", "Invitation"."isAgent": what the invite makes
--     the person. NULL / false on every row sent before this release; accept
--     keeps using "accessLevel" for those.
--   * "Space" | "Folder" | "Board"."restricted" and "findable": the section 3.2
--     columns. Default false; the backfill writes restricted = PRIVATE for
--     Folders and Lists and findable = (visibility = ORG) for Spaces. Read
--     only with ACCESS_V2_TABLES on; "visibility" stays the authority until
--     step 8.
--   * "AccessGrant"."expiresAt" (rule 20, an expired row contributes
--     nothing) and "AccessGrant"."objectRole" (FULL | EDIT | COMMENT | VIEW,
--     the four-role ladder; NULL means derive it from "role" as today).
--   * "AccessGrant" CHECKs widened: objectType gains SPACE, FOLDER, LIST,
--     SOP_FOLDER, GOAL, TOOL, TEAM; role gains OWNER (a Space owner row
--     copied by step 7). subjectType stays USER only and the subjectId FK
--     to "User" stays: group grants (Department, Role, Tag audiences of a
--     goal) stay in GoalAssignee until a later file replaces that FK.
--   * "Team", "TeamMember": Members > Teams (spec 3.4 group principals).
--   * "AccessRequest": the Request access flow (spec 5.6); one PENDING row
--     per person per object (partial unique index), so a double click or a
--     second tab can never file two.
--
-- Rollback: every statement below can stay under the previous release (it
-- names none of them). To remove the block: DROP TABLE "AccessRequest",
-- "TeamMember", "Team"; DELETE FROM "AccessGrant" WHERE "objectType" NOT IN
-- ('TABLE','WHITEBOARD','FORM') OR "role" = 'OWNER' (the step-7 copies; the
-- member tables still hold every original) BEFORE restoring the narrow
-- CHECKs; the columns can then be dropped.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "orgRole" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "orgRole" TEXT;
ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "isAgent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "findable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Folder" ADD COLUMN IF NOT EXISTS "restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Folder" ADD COLUMN IF NOT EXISTS "findable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "findable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "objectRole" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_orgRole_check') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_orgRole_check"
      CHECK ("orgRole" IS NULL OR "orgRole" IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_adminScopes_check') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_adminScopes_check"
      CHECK ("adminScopes" <@ ARRAY['billing', 'security']::TEXT[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invitation_orgRole_check') THEN
    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgRole_check"
      CHECK ("orgRole" IS NULL OR "orgRole" IN ('ADMIN', 'MEMBER', 'GUEST'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_objectRole_check') THEN
    ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_objectRole_check"
      CHECK ("objectRole" IS NULL OR "objectRole" IN ('FULL', 'EDIT', 'COMMENT', 'VIEW'));
  END IF;
  -- Widen the two CHECKs: add the wide constraint first, then drop the
  -- narrow one, so there is no instant with neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_objectType_v2_check') THEN
    ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_objectType_v2_check"
      CHECK ("objectType" IN ('TABLE', 'WHITEBOARD', 'FORM', 'SPACE', 'FOLDER', 'LIST', 'SOP_FOLDER', 'GOAL', 'TOOL', 'TEAM'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_objectType_check') THEN
    ALTER TABLE "AccessGrant" DROP CONSTRAINT "AccessGrant_objectType_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_role_v2_check') THEN
    ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_role_v2_check"
      CHECK ("role" IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessGrant_role_check') THEN
    ALTER TABLE "AccessGrant" DROP CONSTRAINT "AccessGrant_role_check";
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Team" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "createdById"    TEXT,
  "archivedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Team_organizationId_name_key" ON "Team" ("organizationId", "name");

CREATE TABLE IF NOT EXISTS "TeamMember" (
  "id"        TEXT NOT NULL,
  "teamId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "lead"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_teamId_userId_key" ON "TeamMember" ("teamId", "userId");
CREATE INDEX IF NOT EXISTS "TeamMember_userId_idx" ON "TeamMember" ("userId");

CREATE TABLE IF NOT EXISTS "AccessRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requesterId"    TEXT NOT NULL,
  "objectType"     TEXT NOT NULL,
  "objectId"       TEXT NOT NULL,
  "role"           TEXT NOT NULL DEFAULT 'VIEW',
  "message"        TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccessRequest_role_check" CHECK ("role" IN ('FULL', 'EDIT', 'COMMENT', 'VIEW')),
  CONSTRAINT "AccessRequest_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccessRequest_one_pending_key"
  ON "AccessRequest" ("requesterId", "objectType", "objectId") WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "AccessRequest_organizationId_status_idx" ON "AccessRequest" ("organizationId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Team_organizationId_fkey') THEN
    ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamMember_teamId_fkey') THEN
    ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey"
      FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeamMember_userId_fkey') THEN
    ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessRequest_organizationId_fkey') THEN
    ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessRequest_requesterId_fkey') THEN
    ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requesterId_fkey"
      FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Stage E fix: where an "AccessGrant" row came from. The step-7 container
-- copy (scripts/access-migrate-container-rows.ts) diffs only its own rows
-- ('copy.step7'); the step-4 backfill's reach-preservation rows
-- ('backfill.g5', the Space owner's Full on a Private List) have no member
-- twin by design and must never be read as orphaned copies. NULL is every
-- row written before this column (the share dialog's Table, Canvas and Form
-- grants, and any earlier run); the copy script adopts an untagged container
-- row only when it is not a G5-shaped row (objectRole FULL). Additive,
-- nullable, no row written.
ALTER TABLE "AccessGrant" ADD COLUMN IF NOT EXISTS "source" TEXT;
