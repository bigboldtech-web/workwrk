-- 2026-06-03 — Phase 5: WeeklyReview heartbeat cadence.
--   1. Enums: WeeklyReviewStatus + ManagerReviewStatus
--   2. WeeklyReview table (unique per (userId, periodStart))
-- Additive-only. No data loss possible.

-- ──────────────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE "WeeklyReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED');

CREATE TYPE "ManagerReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED');

-- ──────────────────────────────────────────────────────────────────
-- 2. WeeklyReview
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE "WeeklyReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "kpiSnapshots" JSONB NOT NULL DEFAULT '[]',
    "kraProgress" JSONB NOT NULL DEFAULT '[]',
    "highlights" TEXT,
    "blockers" TEXT,
    "plan" TEXT,
    "status" "WeeklyReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "managerId" TEXT,
    "managerStatus" "ManagerReviewStatus",
    "managerNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeeklyReview_userId_periodStart_key" ON "WeeklyReview"("userId", "periodStart");
CREATE INDEX "WeeklyReview_organizationId_periodStart_idx" ON "WeeklyReview"("organizationId", "periodStart");
CREATE INDEX "WeeklyReview_managerId_status_idx" ON "WeeklyReview"("managerId", "status");
CREATE INDEX "WeeklyReview_userId_status_idx" ON "WeeklyReview"("userId", "status");

ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
