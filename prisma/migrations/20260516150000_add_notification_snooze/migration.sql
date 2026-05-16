-- Notification snooze — defer a notification until a future timestamp.
-- The Inbox + topbar bell apply `(snoozedUntil IS NULL OR snoozedUntil <= now())`
-- as a filter, so snoozed rows disappear and reappear when their time comes.

ALTER TABLE "Notification"
  ADD COLUMN "snoozedUntil" TIMESTAMP(3);

CREATE INDEX "Notification_userId_snoozedUntil_idx"
  ON "Notification"("userId", "snoozedUntil");
