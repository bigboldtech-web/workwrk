-- 2026-06-03 — Phase 7: EntityLink (universal polymorphic graph edges).
--   1. Enums: EntityLinkType, EntityLinkRelation
--   2. EntityLink table — (sourceType, sourceId) → (targetType, targetId)
-- Additive-only. No existing rows touched.

-- ──────────────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE "EntityLinkType" AS ENUM (
    'TASK',
    'BOARD',
    'BOARD_ITEM',
    'SPACE',
    'FOLDER',
    'KRA',
    'KPI',
    'KPI_PROMPT',
    'SOP',
    'REVIEW',
    'REVIEW_CYCLE',
    'WEEKLY_REVIEW',
    'NOTE',
    'DOC',
    'WHITEBOARD',
    'FILE',
    'FORM',
    'TABLE',
    'USER',
    'DEPARTMENT',
    'ROLE',
    'ANNOUNCEMENT',
    'KUDOS',
    'CANDOR',
    'SURVEY',
    'CONTRACT',
    'CANDIDATE',
    'JOB'
);

CREATE TYPE "EntityLinkRelation" AS ENUM (
    'LINKED',
    'EMBEDDED',
    'REQUIRED_READING',
    'REFERENCES'
);

-- ──────────────────────────────────────────────────────────────────
-- 2. EntityLink table
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceType" "EntityLinkType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" "EntityLinkType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationKind" "EntityLinkRelation" NOT NULL DEFAULT 'LINKED',
    "position" INTEGER NOT NULL DEFAULT 0,
    "context" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntityLink_source_target_relation_key"
    ON "EntityLink"("sourceType", "sourceId", "targetType", "targetId", "relationKind");

CREATE INDEX "EntityLink_org_source_idx"
    ON "EntityLink"("organizationId", "sourceType", "sourceId");

CREATE INDEX "EntityLink_org_target_idx"
    ON "EntityLink"("organizationId", "targetType", "targetId");

CREATE INDEX "EntityLink_org_relation_idx"
    ON "EntityLink"("organizationId", "relationKind");

ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
