-- Phase 2 v2 polish:
--   - TimeOffPolicy gets accrual + waiting-period + max-balance fields
--   - SalaryBand model for compensation guardrails

CREATE TYPE "AccrualMode" AS ENUM ('UPFRONT', 'ACCRUE');
CREATE TYPE "AccrualFrequency" AS ENUM ('PER_PAY_PERIOD', 'MONTHLY', 'QUARTERLY');

ALTER TABLE "TimeOffPolicy"
  ADD COLUMN "accrualMode" "AccrualMode" NOT NULL DEFAULT 'UPFRONT',
  ADD COLUMN "accrualFrequency" "AccrualFrequency" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "accrualRate" DECIMAL(8,4),
  ADD COLUMN "waitingPeriodDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxBalanceHours" DECIMAL(8,2);

CREATE TABLE "SalaryBand" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "level" TEXT,
  "location" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "minAmount" DECIMAL(12,2) NOT NULL,
  "midAmount" DECIMAL(12,2) NOT NULL,
  "maxAmount" DECIMAL(12,2) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalaryBand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalaryBand_organizationId_role_level_location_key"
  ON "SalaryBand"("organizationId", "role", "level", "location");
CREATE INDEX "SalaryBand_organizationId_active_idx" ON "SalaryBand"("organizationId", "active");

ALTER TABLE "SalaryBand"
  ADD CONSTRAINT "SalaryBand_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
