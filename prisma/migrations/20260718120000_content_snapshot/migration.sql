-- Content version history (never-lose-it safety net). Additive only.
CREATE TABLE "ContentSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContentSnapshot_entityType_entityId_createdAt_idx" ON "ContentSnapshot"("entityType", "entityId", "createdAt");
CREATE INDEX "ContentSnapshot_organizationId_createdAt_idx" ON "ContentSnapshot"("organizationId", "createdAt");
