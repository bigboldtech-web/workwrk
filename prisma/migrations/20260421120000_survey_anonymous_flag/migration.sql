-- PulseSurvey.anonymous — flips attribution on/off for a specific survey.
-- Defaults to true so all existing surveys stay anonymous (no visible
-- change for historical responses).

ALTER TABLE "PulseSurvey"
  ADD COLUMN IF NOT EXISTS "anonymous" BOOLEAN NOT NULL DEFAULT TRUE;
