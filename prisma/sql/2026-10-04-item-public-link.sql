-- 2026-10-04 - A public, view-only link to one task.
--
-- Access-model toggle 10, "Public links" (off by default, never more than
-- view): a person who may share a task can turn on "Anyone with the link can
-- view" for it, copy the link, and turn it off again. The page behind it
-- (/share/task/<id>.<secret>) shows that task alone, read only.
--
-- ITS OWN TABLE, never "Item"."metadata": a task's metadata goes to every
-- reader in every List and row payload, so a secret kept there would reach
-- anyone who can read the task, and from them any copy of a page. Here it is
-- read by the share dialog's route (people who may share the task) and by
-- the public page (comparing, timing-safe), and nothing else.
--
-- One row per task (the primary key on "itemId"): turning the link off
-- deletes the row, turning it on again mints a new secret, so an old link
-- never comes back. "createdById" has no foreign key on purpose, like
-- "addedById" on "ItemListLink": removing a person must not remove what
-- they shared, and must not quietly keep it alive either, which the
-- organization switch (off by default) and the task's own state decide.
--
-- ADDITIVE ONLY. One new table. No existing table gains, loses, renames or
-- retypes a column, and no existing row is read or written. The Prisma
-- fields on "Item" and "Organization" are relation fields with no column.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- every foreign key guarded by a catalogue lookup. Running it twice is a
-- no-op.

CREATE TABLE IF NOT EXISTS "ItemPublicLink" (
  "itemId"         TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "secret"         TEXT NOT NULL,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemPublicLink_pkey" PRIMARY KEY ("itemId")
);

-- The workspace's links, for the access page's count and the off switch.
CREATE INDEX IF NOT EXISTS "ItemPublicLink_organizationId_idx"
  ON "ItemPublicLink" ("organizationId");

-- Deleting the task or the workspace deletes its link, and only its link.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItemPublicLink_itemId_fkey'
  ) THEN
    ALTER TABLE "ItemPublicLink"
      ADD CONSTRAINT "ItemPublicLink_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "Item" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItemPublicLink_organizationId_fkey'
  ) THEN
    ALTER TABLE "ItemPublicLink"
      ADD CONSTRAINT "ItemPublicLink_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
