-- Notion-style page tree for Docs (additive, non-destructive).
ALTER TABLE "Doc" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Doc" ADD COLUMN "isFolder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Doc" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "Doc_parentId_idx" ON "Doc"("parentId");

ALTER TABLE "Doc" ADD CONSTRAINT "Doc_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Doc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
