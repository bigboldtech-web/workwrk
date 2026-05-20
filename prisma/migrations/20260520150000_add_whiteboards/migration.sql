-- CreateTable
CREATE TABLE "Whiteboard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scene" JSONB NOT NULL DEFAULT '{}',
    "thumbnail" TEXT,
    "ownerId" TEXT,
    "lastEditedById" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "spaceId" TEXT,
    "productSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Whiteboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Whiteboard_organizationId_archivedAt_idx" ON "Whiteboard"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Whiteboard_organizationId_ownerId_idx" ON "Whiteboard"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Whiteboard_spaceId_idx" ON "Whiteboard"("spaceId");

-- CreateIndex
CREATE INDEX "Whiteboard_productSlug_idx" ON "Whiteboard"("productSlug");

-- AddForeignKey
ALTER TABLE "Whiteboard" ADD CONSTRAINT "Whiteboard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
