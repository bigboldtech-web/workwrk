-- Phase 2: ATS / Recruiting. Three-table triangle (Job, Candidate,
-- Application) with stage transitions logged via ActivityLog. Public
-- career page, structured scorecards, interview scheduling, offer
-- letter generation are all v2 surfaces on top of this base.

CREATE TYPE "JobStatus" AS ENUM (
  'DRAFT',
  'OPEN',
  'ON_HOLD',
  'CLOSED',
  'FILLED'
);

CREATE TYPE "EmploymentType" AS ENUM (
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
  'TEMPORARY'
);

CREATE TYPE "ApplicationStage" AS ENUM (
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN'
);

CREATE TABLE "Job" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "status"          "JobStatus" NOT NULL DEFAULT 'DRAFT',
  "employmentType"  "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
  "location"        TEXT,
  "departmentId"    TEXT,
  "hiringManagerId" TEXT,
  "salaryMin"       DECIMAL(12,2),
  "salaryMax"       DECIMAL(12,2),
  "salaryCurrency"  TEXT NOT NULL DEFAULT 'USD',
  "openings"        INTEGER NOT NULL DEFAULT 1,
  "publishedAt"     TIMESTAMP(3),
  "closedAt"        TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Job_organizationId_status_idx" ON "Job"("organizationId", "status");
CREATE INDEX "Job_organizationId_departmentId_idx" ON "Job"("organizationId", "departmentId");
CREATE INDEX "Job_hiringManagerId_idx" ON "Job"("hiringManagerId");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job"
  ADD CONSTRAINT "Job_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job"
  ADD CONSTRAINT "Job_hiringManagerId_fkey"
  FOREIGN KEY ("hiringManagerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Candidate" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "firstName"      TEXT NOT NULL,
  "lastName"       TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "phone"          TEXT,
  "resumeUrl"      TEXT,
  "source"         TEXT,
  "notes"          TEXT,
  "hiredUserId"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Candidate_organizationId_email_key" ON "Candidate"("organizationId", "email");
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");
CREATE INDEX "Candidate_hiredUserId_idx" ON "Candidate"("hiredUserId");

ALTER TABLE "Candidate"
  ADD CONSTRAINT "Candidate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate"
  ADD CONSTRAINT "Candidate_hiredUserId_fkey"
  FOREIGN KEY ("hiredUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Application" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "jobId"           TEXT NOT NULL,
  "candidateId"     TEXT NOT NULL,
  "stage"           "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
  "rejectionReason" TEXT,
  "source"          TEXT,
  "recruiterId"     TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Application_jobId_candidateId_key" ON "Application"("jobId", "candidateId");
CREATE INDEX "Application_organizationId_stage_idx" ON "Application"("organizationId", "stage");
CREATE INDEX "Application_jobId_stage_idx" ON "Application"("jobId", "stage");
CREATE INDEX "Application_recruiterId_stage_idx" ON "Application"("recruiterId", "stage");
CREATE INDEX "Application_candidateId_idx" ON "Application"("candidateId");

ALTER TABLE "Application"
  ADD CONSTRAINT "Application_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_recruiterId_fkey"
  FOREIGN KEY ("recruiterId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
