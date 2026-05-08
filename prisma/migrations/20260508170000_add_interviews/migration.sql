-- Phase 2 v2: Interview scheduling for ATS. One row per scheduled
-- session against an Application; multi-interviewer rounds are v3.

CREATE TYPE "InterviewType" AS ENUM (
  'SCREEN', 'TECHNICAL', 'BEHAVIORAL', 'ONSITE', 'FINAL', 'OTHER'
);

CREATE TYPE "InterviewStatus" AS ENUM (
  'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
);

CREATE TABLE "Interview" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "applicationId"   TEXT NOT NULL,
  "interviewerId"   TEXT NOT NULL,
  "scheduledAt"     TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 30,
  "type"            "InterviewType" NOT NULL DEFAULT 'SCREEN',
  "location"        TEXT,
  "status"          "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
  "score"           INTEGER,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Interview_organizationId_status_idx"
  ON "Interview"("organizationId", "status");
CREATE INDEX "Interview_applicationId_status_idx"
  ON "Interview"("applicationId", "status");
CREATE INDEX "Interview_interviewerId_scheduledAt_idx"
  ON "Interview"("interviewerId", "scheduledAt");

ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interview"
  ADD CONSTRAINT "Interview_interviewerId_fkey"
  FOREIGN KEY ("interviewerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
