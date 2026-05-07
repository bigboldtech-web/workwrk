-- Phase 2: Compensation cycles. Manager-proposed merit + bonus per
-- direct report, HR-finalized. SalaryBands and PDF letters are v2.
-- Authorization triangle on every read: subject / proposer / decider.

CREATE TYPE "CompCycleStatus" AS ENUM (
  'DRAFT',
  'OPEN',
  'CLOSED'
);

CREATE TYPE "CompDecisionStatus" AS ENUM (
  'DRAFT',
  'PROPOSED',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "CompensationCycle" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "status"            "CompCycleStatus" NOT NULL DEFAULT 'DRAFT',
  "startDate"         TIMESTAMP(3) NOT NULL,
  "endDate"           TIMESTAMP(3) NOT NULL,
  "budgetPct"         DECIMAL(5,2),
  "reportingCurrency" TEXT NOT NULL DEFAULT 'USD',
  "closedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompensationCycle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompensationCycle_organizationId_status_idx"
  ON "CompensationCycle"("organizationId", "status");
CREATE INDEX "CompensationCycle_organizationId_startDate_idx"
  ON "CompensationCycle"("organizationId", "startDate");

ALTER TABLE "CompensationCycle"
  ADD CONSTRAINT "CompensationCycle_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CompensationDecision" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "cycleId"        TEXT NOT NULL,
  "subjectId"      TEXT NOT NULL,
  "proposedById"   TEXT,
  "currentSalary"  DECIMAL(12,2),
  "proposedSalary" DECIMAL(12,2),
  "currency"       TEXT NOT NULL DEFAULT 'USD',
  "changePct"      DECIMAL(6,2),
  "bonusAmount"    DECIMAL(12,2),
  "reasoning"      TEXT,
  "status"         "CompDecisionStatus" NOT NULL DEFAULT 'DRAFT',
  "decisionNote"   TEXT,
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompensationDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompensationDecision_cycleId_subjectId_key"
  ON "CompensationDecision"("cycleId", "subjectId");
CREATE INDEX "CompensationDecision_organizationId_status_idx"
  ON "CompensationDecision"("organizationId", "status");
CREATE INDEX "CompensationDecision_cycleId_status_idx"
  ON "CompensationDecision"("cycleId", "status");
CREATE INDEX "CompensationDecision_subjectId_idx"
  ON "CompensationDecision"("subjectId");
CREATE INDEX "CompensationDecision_proposedById_idx"
  ON "CompensationDecision"("proposedById");

ALTER TABLE "CompensationDecision"
  ADD CONSTRAINT "CompensationDecision_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompensationDecision"
  ADD CONSTRAINT "CompensationDecision_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "CompensationCycle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompensationDecision"
  ADD CONSTRAINT "CompensationDecision_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompensationDecision"
  ADD CONSTRAINT "CompensationDecision_proposedById_fkey"
  FOREIGN KEY ("proposedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
