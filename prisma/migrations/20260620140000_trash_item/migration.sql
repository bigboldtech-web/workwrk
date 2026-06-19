-- Org-wide recycle bin (snapshot + restore).
CREATE TABLE "TrashItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "deletedById" TEXT,
  "deletedByName" TEXT,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrashItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrashItem_organizationId_entityType_idx" ON "TrashItem" ("organizationId", "entityType");
CREATE INDEX "TrashItem_deletedAt_idx" ON "TrashItem" ("deletedAt");
