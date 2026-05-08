-- Phase 2: Time off. Org-defined leave policies + per-employee
-- requests. Balances computed lazily from policy minus approved /
-- pending hours — no separate Balance table to drift.

CREATE TYPE "TimeOffType" AS ENUM (
  'PTO',
  'SICK',
  'PERSONAL',
  'BEREAVEMENT',
  'PARENTAL',
  'UNPAID',
  'OTHER'
);

CREATE TYPE "TimeOffStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "TimeOffPolicy" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "type"             "TimeOffType" NOT NULL DEFAULT 'PTO',
  "color"            TEXT,
  "description"      TEXT,
  "annualHours"      DECIMAL(8,2) NOT NULL,
  "carryoverHours"   DECIMAL(8,2) NOT NULL DEFAULT 0,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "archived"         BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeOffPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimeOffPolicy_organizationId_name_key"
  ON "TimeOffPolicy"("organizationId", "name");
CREATE INDEX "TimeOffPolicy_organizationId_idx"
  ON "TimeOffPolicy"("organizationId");
CREATE INDEX "TimeOffPolicy_organizationId_archived_idx"
  ON "TimeOffPolicy"("organizationId", "archived");

ALTER TABLE "TimeOffPolicy"
  ADD CONSTRAINT "TimeOffPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TimeOffRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "policyId"       TEXT NOT NULL,
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3) NOT NULL,
  "hours"          DECIMAL(6,2) NOT NULL,
  "reason"         TEXT,
  "status"         "TimeOffStatus" NOT NULL DEFAULT 'PENDING',
  "approverId"     TEXT,
  "decisionAt"     TIMESTAMP(3),
  "decisionNote"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeOffRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeOffRequest_organizationId_status_idx"
  ON "TimeOffRequest"("organizationId", "status");
CREATE INDEX "TimeOffRequest_userId_status_idx"
  ON "TimeOffRequest"("userId", "status");
CREATE INDEX "TimeOffRequest_approverId_status_idx"
  ON "TimeOffRequest"("approverId", "status");
CREATE INDEX "TimeOffRequest_userId_startDate_idx"
  ON "TimeOffRequest"("userId", "startDate");

ALTER TABLE "TimeOffRequest"
  ADD CONSTRAINT "TimeOffRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeOffRequest"
  ADD CONSTRAINT "TimeOffRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeOffRequest"
  ADD CONSTRAINT "TimeOffRequest_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "TimeOffPolicy"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeOffRequest"
  ADD CONSTRAINT "TimeOffRequest_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
