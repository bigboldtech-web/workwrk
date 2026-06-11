-- Task-system phase 2 — first-class priority on Item + board items join the
-- polymorphic tag system.
--
-- 1) Item.priority: hoisted column (URGENT | HIGH | NORMAL | LOW, null = none)
--    so cross-board queries can filter/order without JSON-path gymnastics —
--    same rationale as the Phase 58 startAt/dueAt hoist. Index supports
--    per-board group-by and future "my urgent tasks" surfaces.
ALTER TABLE "Item" ADD COLUMN "priority" TEXT;
CREATE INDEX "Item_boardId_priority_idx" ON "Item"("boardId", "priority");

-- 2) TagEntityType gains BOARD_ITEM so workspace-level colored Tags
--    (Tag/TagAssignment, Worktags substrate) can be applied to board items.
ALTER TYPE "TagEntityType" ADD VALUE 'BOARD_ITEM';
