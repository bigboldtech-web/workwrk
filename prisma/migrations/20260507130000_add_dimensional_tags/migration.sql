-- Dimensional tags (Worktags equivalent). Polymorphic tagging so any
-- entity (User, Task, KRA, OKR, Expense…) can carry one or more tags
-- for cost-center / business-unit / region / project slicing on
-- reports and budgets. New taggable entities only need a new
-- TagEntityType enum value, not a schema change.

CREATE TYPE "TagType" AS ENUM (
  'COST_CENTER',
  'BUSINESS_UNIT',
  'LOCATION',
  'REGION',
  'PROJECT',
  'FUNCTION',
  'CUSTOM'
);

CREATE TYPE "TagEntityType" AS ENUM (
  'USER',
  'TASK',
  'KRA',
  'KPI',
  'OKR',
  'SOP',
  'REVIEW',
  'REVIEW_CYCLE',
  'ASSET',
  'EXPENSE',
  'MEETING'
);

CREATE TABLE "Tag" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "type"           "TagType" NOT NULL DEFAULT 'CUSTOM',
  "color"          TEXT,
  "description"    TEXT,
  "archived"       BOOLEAN NOT NULL DEFAULT false,
  "organizationId" TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tag_organizationId_type_name_key"
  ON "Tag"("organizationId", "type", "name");
CREATE INDEX "Tag_organizationId_idx" ON "Tag"("organizationId");
CREATE INDEX "Tag_organizationId_type_idx" ON "Tag"("organizationId", "type");
CREATE INDEX "Tag_organizationId_archived_idx" ON "Tag"("organizationId", "archived");

ALTER TABLE "Tag"
  ADD CONSTRAINT "Tag_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TagAssignment" (
  "id"             TEXT NOT NULL,
  "tagId"          TEXT NOT NULL,
  "entityType"     "TagEntityType" NOT NULL,
  "entityId"       TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "assignedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TagAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TagAssignment_tagId_entityType_entityId_key"
  ON "TagAssignment"("tagId", "entityType", "entityId");
CREATE INDEX "TagAssignment_entityType_entityId_idx"
  ON "TagAssignment"("entityType", "entityId");
CREATE INDEX "TagAssignment_organizationId_entityType_idx"
  ON "TagAssignment"("organizationId", "entityType");
CREATE INDEX "TagAssignment_tagId_idx" ON "TagAssignment"("tagId");

ALTER TABLE "TagAssignment"
  ADD CONSTRAINT "TagAssignment_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TagAssignment"
  ADD CONSTRAINT "TagAssignment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
