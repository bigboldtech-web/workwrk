-- Phase 4: Universal Doc + version history (additive-only)

CREATE TABLE "Doc" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "excerpt" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Doc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocVersion" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Doc_organizationId_idx" ON "Doc"("organizationId");
CREATE INDEX "Doc_entityType_entityId_idx" ON "Doc"("entityType", "entityId");
CREATE INDEX "Doc_createdById_idx" ON "Doc"("createdById");
CREATE INDEX "DocVersion_docId_idx" ON "DocVersion"("docId");
CREATE INDEX "DocVersion_createdAt_idx" ON "DocVersion"("createdAt");
CREATE UNIQUE INDEX "DocVersion_docId_version_key" ON "DocVersion"("docId", "version");

ALTER TABLE "Doc" ADD CONSTRAINT "Doc_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocVersion" ADD CONSTRAINT "DocVersion_docId_fkey"
    FOREIGN KEY ("docId") REFERENCES "Doc"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
