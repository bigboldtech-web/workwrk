-- OKR cadence + reminder bookkeeping (Phase O2 of the OKR enhancement)
--
-- Strictly additive. Existing OKRs default to WEEKLY which matches the
-- conventional rhythm; no behavioural change for anyone unless they
-- pick a different cadence.

ALTER TABLE "OKR"
  ADD COLUMN IF NOT EXISTS "checkInCadence" TEXT NOT NULL DEFAULT 'WEEKLY';

ALTER TABLE "KeyResult"
  ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMP(3);
