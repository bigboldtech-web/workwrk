-- 2026-06-02 — Phase 1: ClickUp parity shell substrate
--   1. Visibility enum + SpaceRole enum
--   2. Folder model (Space > Folder > Board nesting)
--   3. SpaceMember model (per-Space ACL)
--   4. UserPreference (per-user shell state) + OrgPreference (org defaults + locks)
--   5. UserDottedLine (matrix reporting)
--   6. HRSegment (HR scope ownership)
--   7. ALTER Space: add visibility + (org, archivedAt) index
--   8. ALTER Board: add folderId + visibility + indexes + FK to Folder
-- Additive-only. Existing rows get safe defaults; no data loss possible.

-- ──────────────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'WORKSPACE', 'ORG');

CREATE TYPE "SpaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'GUEST');

-- ──────────────────────────────────────────────────────────────────
-- 2. Folder — Space > Folder > Board nesting (folders can nest)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "ownerId" TEXT,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Folder_organizationId_archivedAt_idx" ON "Folder"("organizationId", "archivedAt");
CREATE INDEX "Folder_spaceId_parentFolderId_position_idx" ON "Folder"("spaceId", "parentFolderId", "position");
CREATE INDEX "Folder_parentFolderId_idx" ON "Folder"("parentFolderId");

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentFolderId_fkey"
    FOREIGN KEY ("parentFolderId") REFERENCES "Folder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 3. SpaceMember — per-Space ACL (admin access is implicit, no row)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "SpaceMember" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SpaceRole" NOT NULL DEFAULT 'MEMBER',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaceMember_spaceId_userId_key" ON "SpaceMember"("spaceId", "userId");
CREATE INDEX "SpaceMember_userId_idx" ON "SpaceMember"("userId");
CREATE INDEX "SpaceMember_spaceId_role_idx" ON "SpaceMember"("spaceId", "role");

ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 4. UserPreference + OrgPreference (shell state)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "sidebar" JSONB,
    "home" JSONB,
    "theme" JSONB,
    "density" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrgPreference" (
    "organizationId" TEXT NOT NULL,
    "sidebarDefault" JSONB,
    "homeDefault" JSONB,
    "themeDefault" JSONB,
    "densityDefault" TEXT,
    "lockedKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgPreference_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "OrgPreference" ADD CONSTRAINT "OrgPreference_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 5. UserDottedLine — matrix reporting
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "UserDottedLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "role" TEXT,
    "weight" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserDottedLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDottedLine_userId_managerId_key" ON "UserDottedLine"("userId", "managerId");
CREATE INDEX "UserDottedLine_managerId_idx" ON "UserDottedLine"("managerId");
CREATE INDEX "UserDottedLine_userId_idx" ON "UserDottedLine"("userId");

ALTER TABLE "UserDottedLine" ADD CONSTRAINT "UserDottedLine_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDottedLine" ADD CONSTRAINT "UserDottedLine_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 6. HRSegment — HR scope ownership (which slice of the org)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "HRSegment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HRSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HRSegment_organizationId_ownerId_idx" ON "HRSegment"("organizationId", "ownerId");
CREATE INDEX "HRSegment_organizationId_isActive_idx" ON "HRSegment"("organizationId", "isActive");

ALTER TABLE "HRSegment" ADD CONSTRAINT "HRSegment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 7. ALTER Space — add visibility + (org, archivedAt) index
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE "Space"
    ADD COLUMN "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE';

CREATE INDEX "Space_organizationId_archivedAt_idx" ON "Space"("organizationId", "archivedAt");

-- ──────────────────────────────────────────────────────────────────
-- 8. ALTER Board — add folderId + visibility + FK + indexes
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE "Board"
    ADD COLUMN "folderId" TEXT,
    ADD COLUMN "visibility" "Visibility" NOT NULL DEFAULT 'WORKSPACE';

CREATE INDEX "Board_organizationId_archivedAt_idx" ON "Board"("organizationId", "archivedAt");
CREATE INDEX "Board_folderId_idx" ON "Board"("folderId");

ALTER TABLE "Board" ADD CONSTRAINT "Board_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "Folder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
