-- Multi-assignee for tasks. `assigneeIds` holds the full set of assignees;
-- `ownerId` stays as the primary (synced to assigneeIds[0] in app code) so every
-- existing ownerId read keeps working. Backfill existing single owners into the
-- array so current tasks show their assignee under the new model.
ALTER TABLE "Item" ADD COLUMN "assigneeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Item" SET "assigneeIds" = ARRAY["ownerId"] WHERE "ownerId" IS NOT NULL;

CREATE INDEX "Item_assigneeIds_idx" ON "Item" USING GIN ("assigneeIds");
