-- OrganizationMembership — foundation for the org-switcher flow.
--
-- Backfill: every existing User gets exactly one membership row
-- pointing at their User.organizationId, marked isPrimary=true.
-- This keeps the runtime contract "organizationId is always set"
-- intact while opening up the data model for multi-org users.
--
-- Role is mirrored from User.accessLevel so per-org permissioning
-- can be implemented later without revisiting the backfill.

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" "AccessLevel" NOT NULL DEFAULT 'EMPLOYEE',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMembership_userId_organizationId_key"
  ON "OrganizationMembership"("userId", "organizationId");
CREATE INDEX "OrganizationMembership_userId_idx"
  ON "OrganizationMembership"("userId");
CREATE INDEX "OrganizationMembership_organizationId_idx"
  ON "OrganizationMembership"("organizationId");

ALTER TABLE "OrganizationMembership"
  ADD CONSTRAINT "OrganizationMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationMembership"
  ADD CONSTRAINT "OrganizationMembership_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing Users. md5(...)::text gives us a stable
-- (idempotent across reruns) ID that is unique because (userId,
-- organizationId) is. We use gen_random_uuid()-style cuid-shaped
-- IDs everywhere else, but a hash here is sufficient — backfill
-- rows never collide with application-generated ones.
INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "isPrimary", "createdAt", "updatedAt")
SELECT
  'mig_' || substr(md5("id" || "organizationId"), 1, 24),
  "id",
  "organizationId",
  "accessLevel",
  true,
  COALESCE("createdAt", NOW()),
  NOW()
FROM "User"
WHERE "deletedAt" IS NULL
ON CONFLICT ("userId", "organizationId") DO NOTHING;
