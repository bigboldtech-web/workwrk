-- 2026-09-26 - Phase 6, PEOPLE: the Directory, goals, KRAs and KPIs, reviews,
-- talent, candor, surveys and kudos (spec-teams-people, spec-goals,
-- spec-teams-performance). ONE file for every schema addition of the three
-- units, so the founder applies one thing.
--
-- PURELY ADDITIVE AND IDEMPOTENT. Every statement is ADD COLUMN IF NOT
-- EXISTS or CREATE ... IF NOT EXISTS. Nothing is renamed, retyped, dropped
-- or made required, no existing row is read or rewritten, and a second run
-- does nothing. Every new column is nullable or carries a default, so every
-- existing INSERT keeps working unchanged.
--
-- What each addition is for:
--   "User"."weeklyCapacityHours"      the person's own weekly hours on the
--                                     Workload grid (null = the org schedule)
--   "User"."presenceStatus",
--   "User"."presenceUntil"            the avatar presence dot and Do not
--                                     disturb (null draws no dot at all)
--   "User"."workSchedule"             a per-person override of the org
--                                     WorkSchedule (decided addition a)
--   "User"."customFields"             values of the org's custom profile
--                                     fields (decided addition c)
--   "Threshold"."escalatedToId"       who an escalation goes to (T9; nothing
--                                     enforces thresholds yet, report only)
--   "KPIRecord"."reviewedById"        the manager who recorded or approved a
--                                     KPI number
--   "ReviewCycle"."createdById",
--   "audienceType", "departmentIds",
--   "userIds"                         who started a cycle and who it covers,
--                                     so a manager can run one for their chain
--   "Review"."potential",
--   "calibratedById", "calibratedAt"  the 9-box potential set in calibration
--                                     and who calibrated
--   "TalentAssessment"."source",
--   "cycleId"                         MANUAL / SCORES / CALIBRATION, and the
--                                     cycle a calibrated placement came from
--   "PulseSurvey"."createdById"       the survey's creator
--   "CandorRespondent" (new table)    WHO answered a candor session, never
--                                     what; replaces a browser-only flag.
--                                     "CandorResponse" never gets a user
--                                     column, now or later.
--
-- DEPLOY ORDER. The new scalar columns are on the Prisma models, so a
-- findMany with no select asks for them. The file is therefore in the deploy
-- manifest (scripts/deploy-migrations.mjs), which applies it inside the
-- build before the new release starts. The data backfills that go with this
-- file are separate, dry-run-by-default scripts (scripts/MIGRATIONS.md,
-- Phase 6), never part of the deploy.

-- 1. User: capacity, presence, per-person schedule, custom profile fields.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weeklyCapacityHours" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "presenceStatus" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "presenceUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "workSchedule" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customFields" JSONB;

-- 2. Threshold: the escalation target.
ALTER TABLE "Threshold" ADD COLUMN IF NOT EXISTS "escalatedToId" TEXT;

-- 3. KPIRecord: the manager who recorded or approved the number.
ALTER TABLE "KPIRecord" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;

-- 4. ReviewCycle: creator and audience.
ALTER TABLE "ReviewCycle" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "ReviewCycle" ADD COLUMN IF NOT EXISTS "audienceType" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "ReviewCycle" ADD COLUMN IF NOT EXISTS "departmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ReviewCycle" ADD COLUMN IF NOT EXISTS "userIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 5. Review: potential and calibration stamp.
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "potential" INTEGER;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "calibratedById" TEXT;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "calibratedAt" TIMESTAMP(3);

-- 6. TalentAssessment: where a placement came from.
ALTER TABLE "TalentAssessment" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "TalentAssessment" ADD COLUMN IF NOT EXISTS "cycleId" TEXT;

-- 7. PulseSurvey: the creator.
ALTER TABLE "PulseSurvey" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- 8. CandorRespondent: who answered, never what.
CREATE TABLE IF NOT EXISTS "CandorRespondent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandorRespondent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CandorRespondent_sessionId_userId_key" ON "CandorRespondent"("sessionId", "userId");
CREATE INDEX IF NOT EXISTS "CandorRespondent_userId_idx" ON "CandorRespondent"("userId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CandorRespondent_sessionId_fkey'
  ) THEN
    ALTER TABLE "CandorRespondent"
      ADD CONSTRAINT "CandorRespondent_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "CandorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
