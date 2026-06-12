-- Template Center (ClickUp parity) — one reusable template store for any kind.
CREATE TYPE "TemplateKind" AS ENUM ('TASK','LIST','SPACE','FOLDER','DOC','VIEW','WHITEBOARD');
CREATE TYPE "TemplateComplexity" AS ENUM ('BEGINNER','INTERMEDIATE','ADVANCED');

CREATE TABLE "Template" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT,
  "createdById"    TEXT,
  "kind"           "TemplateKind" NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "complexity"     "TemplateComplexity",
  "category"       TEXT,
  "useCases"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tags"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "builtIn"        BOOLEAN NOT NULL DEFAULT false,
  "payload"        JSONB NOT NULL DEFAULT '{}',
  "usedCount"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Template_organizationId_kind_idx" ON "Template"("organizationId","kind");
CREATE INDEX "Template_kind_builtIn_idx" ON "Template"("kind","builtIn");

-- Migrate existing task templates (ItemTemplate.config) into Template(kind=TASK).
INSERT INTO "Template" ("id","organizationId","createdById","kind","name","payload","createdAt","updatedAt")
SELECT "id","organizationId","createdById",'TASK',"name","config","createdAt","updatedAt"
FROM "ItemTemplate"
ON CONFLICT ("id") DO NOTHING;
