-- Phase 72 — Item subtask self-relation. Top-level items have
-- parentItemId = null; subtasks point to their parent. CASCADE so
-- removing a parent drops the whole subtree. Index supports the
-- "children of X within board Y" lookup the renderer uses.
ALTER TABLE "Item" ADD COLUMN "parentItemId" TEXT;
ALTER TABLE "Item" ADD CONSTRAINT "Item_parentItemId_fkey"
  FOREIGN KEY ("parentItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Item_boardId_parentItemId_idx" ON "Item"("boardId", "parentItemId");
