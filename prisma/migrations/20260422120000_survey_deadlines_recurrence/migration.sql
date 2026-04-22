-- PulseSurvey deadlines + recurrence
--
-- Adds the columns the rotate cron uses to auto-close expired surveys,
-- send pre-close reminders to non-respondents, and spawn the next
-- cycle of recurring surveys. All ADDs are IF NOT EXISTS so the
-- migration is safe to re-run.

ALTER TABLE "PulseSurvey"
  ADD COLUMN IF NOT EXISTS "closesAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "parentSurveyId" TEXT;

CREATE INDEX IF NOT EXISTS "PulseSurvey_status_closesAt_idx"
  ON "PulseSurvey"("status", "closesAt");
CREATE INDEX IF NOT EXISTS "PulseSurvey_parentSurveyId_idx"
  ON "PulseSurvey"("parentSurveyId");

-- Recurrence parent pointer. SetNull on parent delete so children stay
-- as standalone historical records. Guarded by catalog check since
-- ADD CONSTRAINT isn't idempotent in Postgres DDL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PulseSurvey_parentSurveyId_fkey'
  ) THEN
    ALTER TABLE "PulseSurvey"
      ADD CONSTRAINT "PulseSurvey_parentSurveyId_fkey"
      FOREIGN KEY ("parentSurveyId") REFERENCES "PulseSurvey"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
