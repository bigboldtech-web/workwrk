-- Phase 0 follow-ups (May 2026)
-- 1. Announcement.mustAcknowledge + notificationsSentAt + AnnouncementAcknowledgment table
--    (Mirrors the existing Policy / PolicyAcknowledgment pattern so the
--    ack semantics are consistent across the product.)
-- 2. Idea.position, OKR.position (NOT NULL default 0 — safe for existing rows)
-- 3. Task.dayPosition (NULLABLE — avoids touching millions of historic rows)

-- ── Announcement scheduled-publish + must-ack ──
ALTER TABLE "Announcement"
  ADD COLUMN "mustAcknowledge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notificationsSentAt" TIMESTAMP(3);

CREATE INDEX "Announcement_publishedAt_notificationsSentAt_idx"
  ON "Announcement"("publishedAt", "notificationsSentAt");

CREATE TABLE "AnnouncementAcknowledgment" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  CONSTRAINT "AnnouncementAcknowledgment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementAcknowledgment_announcementId_userId_key"
  ON "AnnouncementAcknowledgment"("announcementId", "userId");
CREATE INDEX "AnnouncementAcknowledgment_userId_idx"
  ON "AnnouncementAcknowledgment"("userId");
CREATE INDEX "AnnouncementAcknowledgment_announcementId_idx"
  ON "AnnouncementAcknowledgment"("announcementId");

ALTER TABLE "AnnouncementAcknowledgment"
  ADD CONSTRAINT "AnnouncementAcknowledgment_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementAcknowledgment"
  ADD CONSTRAINT "AnnouncementAcknowledgment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── Idea priority-list ordering ──
ALTER TABLE "Idea"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Idea_organizationId_status_position_idx"
  ON "Idea"("organizationId", "status", "position");

-- ── OKR priority-list ordering ──
ALTER TABLE "OKR"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "OKR_organizationId_ownerId_position_idx"
  ON "OKR"("organizationId", "ownerId", "position");

-- ── Task within-day reorder ──
ALTER TABLE "Task"
  ADD COLUMN "dayPosition" INTEGER;

CREATE INDEX "Task_assigneeId_date_dayPosition_idx"
  ON "Task"("assigneeId", "date", "dayPosition");
