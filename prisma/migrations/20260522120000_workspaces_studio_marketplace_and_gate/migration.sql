-- 2026-05-22 batch:
--   1. Role-definition entry gate (Invitation.kraIds + sopIds)
--   2. Board-context Sidekick (ChatSession.productContext + boardContext)
--   3. Multi-workspace inside an app (Workspace + WorkspaceMember)
--   4. Studio board builder (StudioBoard + StudioItem)
--   5. Marketplace MVP (BoardTemplate)
-- Additive-only. Existing rows get safe defaults.

-- ──────────────────────────────────────────────────────────────────
-- 1. Role-definition entry gate
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE "Invitation"
    ADD COLUMN "kraIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "sopIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ──────────────────────────────────────────────────────────────────
-- 2. Board-context Sidekick
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE "ChatSession"
    ADD COLUMN "productContext" TEXT,
    ADD COLUMN "boardContext" TEXT;

-- ──────────────────────────────────────────────────────────────────
-- 3. Workspaces
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE "WorkspaceMemberRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_organizationId_productSlug_slug_key"
    ON "Workspace"("organizationId", "productSlug", "slug");
CREATE INDEX "Workspace_organizationId_productSlug_idx"
    ON "Workspace"("organizationId", "productSlug");

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceMemberRole" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key"
    ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "WorkspaceMember_workspaceId_role_idx"
    ON "WorkspaceMember"("workspaceId", "role");

ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 4. Studio boards (user-built)
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE "StudioLayout" AS ENUM ('TABLE', 'KANBAN');

CREATE TABLE "StudioBoard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "productSlug" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "layout" "StudioLayout" NOT NULL DEFAULT 'TABLE',
    "fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "color" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioBoard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioBoard_organizationId_slug_key"
    ON "StudioBoard"("organizationId", "slug");
CREATE INDEX "StudioBoard_organizationId_workspaceId_idx"
    ON "StudioBoard"("organizationId", "workspaceId");
CREATE INDEX "StudioBoard_organizationId_productSlug_idx"
    ON "StudioBoard"("organizationId", "productSlug");

ALTER TABLE "StudioBoard" ADD CONSTRAINT "StudioBoard_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioBoard" ADD CONSTRAINT "StudioBoard_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StudioItem" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudioItem_boardId_position_idx"
    ON "StudioItem"("boardId", "position");
CREATE INDEX "StudioItem_boardId_status_idx"
    ON "StudioItem"("boardId", "status");

ALTER TABLE "StudioItem" ADD CONSTRAINT "StudioItem_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "StudioBoard"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 5. Marketplace (BoardTemplate)
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE "BoardTemplateVisibility" AS ENUM ('ORG', 'PUBLIC');

CREATE TABLE "BoardTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceBoardId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "productSlug" TEXT,
    "layout" "StudioLayout" NOT NULL DEFAULT 'TABLE',
    "fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "color" TEXT,
    "visibility" "BoardTemplateVisibility" NOT NULL DEFAULT 'ORG',
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoardTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BoardTemplate_organizationId_idx" ON "BoardTemplate"("organizationId");
CREATE INDEX "BoardTemplate_visibility_installCount_idx"
    ON "BoardTemplate"("visibility", "installCount");

ALTER TABLE "BoardTemplate" ADD CONSTRAINT "BoardTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardTemplate" ADD CONSTRAINT "BoardTemplate_sourceBoardId_fkey"
    FOREIGN KEY ("sourceBoardId") REFERENCES "StudioBoard"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
