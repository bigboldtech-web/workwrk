-- Phase 3: Workforce Planning. Headcount + budget per department per
-- period. Variance is computed at view time against live User counts.

CREATE TABLE "HeadcountPlan" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "departmentId"     TEXT,
  "period"           TEXT NOT NULL,
  "plannedHeadcount" INTEGER NOT NULL,
  "plannedBudget"    DECIMAL(14,2),
  "budgetCurrency"   TEXT NOT NULL DEFAULT 'USD',
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HeadcountPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HeadcountPlan_organizationId_departmentId_period_key"
  ON "HeadcountPlan"("organizationId", "departmentId", "period");
CREATE INDEX "HeadcountPlan_organizationId_period_idx"
  ON "HeadcountPlan"("organizationId", "period");

ALTER TABLE "HeadcountPlan"
  ADD CONSTRAINT "HeadcountPlan_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HeadcountPlan"
  ADD CONSTRAINT "HeadcountPlan_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
