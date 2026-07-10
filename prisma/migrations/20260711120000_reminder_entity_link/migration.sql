-- Reminder → entity link (task-scheduled reminders). Both nullable = existing
-- personal reminders unaffected.
ALTER TABLE "Reminder" ADD COLUMN "entityType" TEXT;
ALTER TABLE "Reminder" ADD COLUMN "entityId" TEXT;
CREATE INDEX "Reminder_entityType_entityId_idx" ON "Reminder"("entityType", "entityId");
