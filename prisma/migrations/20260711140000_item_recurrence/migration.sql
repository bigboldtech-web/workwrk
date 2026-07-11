-- Recurring tasks (spawn model). Columns set only on the series anchor;
-- all nullable so existing tasks are unaffected. recurNextAt indexed for
-- the cron's due-anchor scan.
ALTER TABLE "Item" ADD COLUMN "recurRule" JSONB;
ALTER TABLE "Item" ADD COLUMN "recurNextAt" TIMESTAMP(3);
CREATE INDEX "Item_recurNextAt_idx" ON "Item"("recurNextAt");
