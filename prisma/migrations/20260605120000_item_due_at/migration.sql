-- Phase 58 — Item gets first-class startAt + dueAt columns + boardId+dueAt index.
-- Pre-Phase 58 dates lived in metadata under user-defined per-board DATE keys.
-- The Calendar + Gantt views continue to project metadata as a fallback while
-- new items can set their schedule directly via these columns. Index supports
-- the cross-board "items due in window" queries from the Calendar + Gantt fetches.
ALTER TABLE "Item" ADD COLUMN "startAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN "dueAt" TIMESTAMP(3);
CREATE INDEX "Item_boardId_dueAt_idx" ON "Item"("boardId", "dueAt");
