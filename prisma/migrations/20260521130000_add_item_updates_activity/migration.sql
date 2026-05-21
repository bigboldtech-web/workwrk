-- Phase 5: Item updates + activity log (additive-only)

CREATE TABLE "ItemUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ItemUpdate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ItemUpdate_organizationId_entityType_entityId_idx" ON "ItemUpdate"("organizationId", "entityType", "entityId");
CREATE INDEX "ItemUpdate_authorId_idx" ON "ItemUpdate"("authorId");
CREATE INDEX "ItemActivity_organizationId_entityType_entityId_idx" ON "ItemActivity"("organizationId", "entityType", "entityId");
CREATE INDEX "ItemActivity_createdAt_idx" ON "ItemActivity"("createdAt");
CREATE INDEX "ItemActivity_actorId_idx" ON "ItemActivity"("actorId");

ALTER TABLE "ItemUpdate" ADD CONSTRAINT "ItemUpdate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ItemActivity" ADD CONSTRAINT "ItemActivity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
