-- SOP folder tree + tags + per-SOP icon (Phase 1 of unification)
--
-- Strictly additive. The existing org-wide unique on SOPFolder(name)
-- is replaced by a sibling-scoped unique so two folders under
-- different parents can share a name. Top-level uniqueness is kept
-- via a partial index because Postgres treats NULLs as distinct in
-- multi-column unique constraints.
--
-- No data is dropped. Old SOPCategory/SOPSubcategory tables and
-- SOP.category/SOP.subcategory columns remain in place so the data-
-- migration script can run idempotently and the old code path keeps
-- working until Phase 2 ships.

-- 1. Folder tree + presentation extras
ALTER TABLE "SOPFolder"
  ADD COLUMN IF NOT EXISTS "parentId" TEXT;

ALTER TABLE "SOPFolder"
  ADD COLUMN IF NOT EXISTS "icon" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SOPFolder_parentId_fkey'
  ) THEN
    ALTER TABLE "SOPFolder"
      ADD CONSTRAINT "SOPFolder_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "SOPFolder"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "SOPFolder_parentId_idx" ON "SOPFolder"("parentId");

-- 2. Switch the uniqueness from org-wide to sibling-scoped.
ALTER TABLE "SOPFolder" DROP CONSTRAINT IF EXISTS "SOPFolder_organizationId_name_key";
DROP INDEX IF EXISTS "SOPFolder_organizationId_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SOPFolder_org_parent_name_key"
  ON "SOPFolder"("organizationId", "parentId", "name")
  WHERE "parentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "SOPFolder_org_root_name_key"
  ON "SOPFolder"("organizationId", "name")
  WHERE "parentId" IS NULL;

-- 3. SOP tags (cross-cutting, free-form, multi-value).
ALTER TABLE "SOP"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "SOP_tags_idx" ON "SOP" USING GIN ("tags");
