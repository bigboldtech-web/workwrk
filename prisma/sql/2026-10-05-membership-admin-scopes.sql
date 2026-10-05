-- Admin scopes are held per workspace, on the membership (Batch 9, 2026-10-05).
--
-- WHY. User.adminScopes (the billing and security scopes an Owner gives a
-- non-Owner Admin, prisma/sql/2026-09-30-phase8-settings-access.sql) sat on
-- the account, and a move between workspaces (the switcher, the sign-in
-- fallback, the hard delete's move of people who belong elsewhere) never
-- touched it: one workspace's grant counted in the next workspace the person
-- was anchored to. Now the move keeps the scopes on the membership of the
-- workspace being left and takes the ones held in the workspace it goes to
-- (src/lib/access/workspace-anchor.ts reanchorUser). User.adminScopes stays
-- the scopes held in the anchored workspace, which every reader already
-- requires (they read it only there).
--
-- Additive and idempotent: the deploy runs this file on every deploy.

ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "adminScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationMembership_adminScopes_check') THEN
    ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_adminScopes_check"
      CHECK ("adminScopes" <@ ARRAY['billing', 'security']::TEXT[]);
  END IF;
END $$;

-- ONE TIME (marker on the new column): scopes a person carried into another
-- workspace go back to the workspace that granted them, read from its latest
-- org_role.scopes_changed audit row, onto that workspace's membership; and
-- the account keeps scopes only when that grant was made where it is anchored
-- now. Scopes no audit row explains are cleared rather than trusted: they
-- count only with ACCESS_V2_TABLES on (off in production), and an Owner
-- gives them again in one step.
DO $$
BEGIN
  IF COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'adminScopes')), '')
     NOT LIKE '%admin-scopes-per-workspace-2026-10-05%' THEN
    WITH latest AS (
      SELECT DISTINCT ON (a."targetId") a."targetId" AS uid, a."organizationId" AS org
        FROM "ActivityLog" a
       WHERE a."type" = 'org_role.scopes_changed' AND a."targetId" IS NOT NULL
       ORDER BY a."targetId", a."createdAt" DESC
    )
    UPDATE "OrganizationMembership" m
       SET "adminScopes" = u."adminScopes"
      FROM "User" u JOIN latest l ON l.uid = u."id"
     WHERE m."userId" = u."id" AND m."organizationId" = l.org
       AND u."organizationId" <> l.org AND cardinality(u."adminScopes") > 0;
    WITH latest AS (
      SELECT DISTINCT ON (a."targetId") a."targetId" AS uid, a."organizationId" AS org
        FROM "ActivityLog" a
       WHERE a."type" = 'org_role.scopes_changed' AND a."targetId" IS NOT NULL
       ORDER BY a."targetId", a."createdAt" DESC
    )
    UPDATE "User" u
       SET "adminScopes" = ARRAY[]::TEXT[]
     WHERE cardinality(u."adminScopes") > 0
       AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.uid = u."id" AND l.org = u."organizationId");
    COMMENT ON COLUMN "OrganizationMembership"."adminScopes" IS
      'The Admin scopes held in this workspace while the account is anchored elsewhere. admin-scopes-per-workspace-2026-10-05';
  END IF;
END $$;
