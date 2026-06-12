-- Task Types (ClickUp parity) — org-level presentational re-skin of an Item.
CREATE TABLE "ItemType" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "singular"       TEXT NOT NULL,
  "plural"         TEXT NOT NULL,
  "icon"           TEXT NOT NULL DEFAULT 'CircleDot',
  "description"    TEXT,
  "category"       TEXT,
  "isDefault"      BOOLEAN NOT NULL DEFAULT false,
  "builtIn"        BOOLEAN NOT NULL DEFAULT false,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemType_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ItemType_organizationId_idx" ON "ItemType"("organizationId");

-- Item gains the FK column + index.
ALTER TABLE "Item" ADD COLUMN "itemTypeId" TEXT;
CREATE INDEX "Item_itemTypeId_idx" ON "Item"("itemTypeId");

-- Seed the 4 built-in types for every existing org.
INSERT INTO "ItemType" ("id","organizationId","singular","plural","icon","description","isDefault","builtIn","createdAt","updatedAt")
SELECT gen_random_uuid()::text, o."id", t.singular, t.plural, t.icon, t.description, t."isDefault", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('Task',          'Tasks',          'CircleDot',     'A standard task',        true),
  ('Milestone',     'Milestones',     'Diamond',       'A key checkpoint',       false),
  ('Form Response', 'Form Responses', 'ClipboardList', 'A submitted form entry', false),
  ('Meeting Note',  'Meeting Notes',  'NotebookPen',   'Notes from a meeting',   false)
) AS t(singular, plural, icon, description, "isDefault");

-- Migrate the legacy metadata.taskType onto the new column.
UPDATE "Item" i
SET "itemTypeId" = it."id"
FROM "ItemType" it
WHERE it."organizationId" = i."organizationId"
  AND it."builtIn" = true
  AND i."itemTypeId" IS NULL
  AND (
    (i."metadata"->>'taskType' = 'TASK'          AND it."singular" = 'Task') OR
    (i."metadata"->>'taskType' = 'MILESTONE'     AND it."singular" = 'Milestone') OR
    (i."metadata"->>'taskType' = 'FORM_RESPONSE' AND it."singular" = 'Form Response') OR
    (i."metadata"->>'taskType' = 'MEETING_NOTE'  AND it."singular" = 'Meeting Note')
  );
