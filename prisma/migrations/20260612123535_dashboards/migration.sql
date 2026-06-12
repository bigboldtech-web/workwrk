-- User-created dashboards (the sidebar "+" menu → Dashboard). Additive.
CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "spaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dashboard_organizationId_archivedAt_idx" ON "Dashboard"("organizationId", "archivedAt");
CREATE INDEX "Dashboard_organizationId_ownerId_idx" ON "Dashboard"("organizationId", "ownerId");
CREATE INDEX "Dashboard_spaceId_idx" ON "Dashboard"("spaceId");

ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
