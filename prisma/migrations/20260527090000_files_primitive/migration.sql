-- Files primitive: FileFolder + FileEntry.
-- Drives the /files surface and is embeddable in any block-based doc.

CREATE TABLE "FileFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FileEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "folderId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "description" TEXT,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileFolder_organizationId_parentId_idx" ON "FileFolder"("organizationId", "parentId");
CREATE INDEX "FileEntry_organizationId_folderId_idx" ON "FileEntry"("organizationId", "folderId");
CREATE INDEX "FileEntry_uploadedById_idx" ON "FileEntry"("uploadedById");

ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "FileFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FileEntry" ADD CONSTRAINT "FileEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileEntry" ADD CONSTRAINT "FileEntry_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "FileFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
