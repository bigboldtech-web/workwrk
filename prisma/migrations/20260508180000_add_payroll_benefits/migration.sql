-- Phase 4: Payroll + Benefits
--
-- Adds the native models for pay groups, pay runs, paystubs, and the
-- benefits stack (plans, tiers, open enrollment windows, enrollments,
-- dependents, life events). Vendor-adapter integrations (CheckHQ,
-- Sequoia, etc.) write back into these tables so the org keeps a
-- portable history if they ever switch providers.

-- ────────────────────── Enums ──────────────────────

CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY');
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'CALCULATING', 'CALCULATED', 'POSTED', 'CANCELLED');
CREATE TYPE "PayMethod" AS ENUM ('DIRECT_DEPOSIT', 'CHECK', 'WIRE', 'MANUAL');
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION', 'TAX');
CREATE TYPE "BenefitType" AS ENUM ('MEDICAL', 'DENTAL', 'VISION', 'LIFE', 'DISABILITY_SHORT', 'DISABILITY_LONG', 'RETIREMENT_401K', 'RETIREMENT_ROTH', 'HSA', 'FSA', 'COMMUTER', 'OTHER');
CREATE TYPE "OpenEnrollmentStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');
CREATE TYPE "EnrollmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "DependentRelationship" AS ENUM ('SPOUSE', 'DOMESTIC_PARTNER', 'CHILD', 'STEPCHILD', 'OTHER');
CREATE TYPE "LifeEventType" AS ENUM ('MARRIAGE', 'DIVORCE', 'BIRTH', 'ADOPTION', 'DEATH', 'GAIN_COVERAGE', 'LOSS_COVERAGE', 'DEPENDENT_LOSS', 'ADDRESS_CHANGE', 'OTHER');
CREATE TYPE "LifeEventStatus" AS ENUM ('REPORTED', 'APPROVED', 'REJECTED', 'ENROLLED');

-- ────────────────────── Tables ──────────────────────

CREATE TABLE "PayGroup" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'US',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "frequency" "PayFrequency" NOT NULL DEFAULT 'BIWEEKLY',
  "anchorDate" TIMESTAMP(3) NOT NULL,
  "payOffsetDays" INTEGER NOT NULL DEFAULT 3,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayGroup_organizationId_name_key" ON "PayGroup"("organizationId", "name");
CREATE INDEX "PayGroup_organizationId_idx" ON "PayGroup"("organizationId");

CREATE TABLE "PayRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "payGroupId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "payDate" TIMESTAMP(3) NOT NULL,
  "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
  "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "providerRef" TEXT,
  "notes" TEXT,
  "calculatedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayRun_payGroupId_periodStart_key" ON "PayRun"("payGroupId", "periodStart");
CREATE INDEX "PayRun_organizationId_status_idx" ON "PayRun"("organizationId", "status");
CREATE INDEX "PayRun_payDate_idx" ON "PayRun"("payDate");

CREATE TABLE "EarningCode" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "taxable" BOOLEAN NOT NULL DEFAULT true,
  "glAccount" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EarningCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EarningCode_organizationId_code_key" ON "EarningCode"("organizationId", "code");
CREATE INDEX "EarningCode_organizationId_idx" ON "EarningCode"("organizationId");

CREATE TABLE "DeductionCode" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "preTax" BOOLEAN NOT NULL DEFAULT false,
  "perPeriodCap" DECIMAL(12,2),
  "annualCap" DECIMAL(12,2),
  "glAccount" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeductionCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeductionCode_organizationId_code_key" ON "DeductionCode"("organizationId", "code");
CREATE INDEX "DeductionCode_organizationId_idx" ON "DeductionCode"("organizationId");

CREATE TABLE "Payslip" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "payRunId" TEXT NOT NULL,
  "payGroupId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "net" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "hoursWorked" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "providerRef" TEXT,
  "payMethod" "PayMethod" NOT NULL DEFAULT 'DIRECT_DEPOSIT',
  "bankLast4" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payslip_payRunId_subjectId_key" ON "Payslip"("payRunId", "subjectId");
CREATE INDEX "Payslip_organizationId_subjectId_idx" ON "Payslip"("organizationId", "subjectId");
CREATE INDEX "Payslip_payGroupId_idx" ON "Payslip"("payGroupId");

CREATE TABLE "PayslipLine" (
  "id" TEXT NOT NULL,
  "payslipId" TEXT NOT NULL,
  "kind" "PayslipLineKind" NOT NULL,
  "earningCodeId" TEXT,
  "hours" DECIMAL(8,2),
  "rate" DECIMAL(10,4),
  "deductionCodeId" TEXT,
  "taxLabel" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "ytdAmount" DECIMAL(12,2),
  CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");
CREATE INDEX "PayslipLine_earningCodeId_idx" ON "PayslipLine"("earningCodeId");
CREATE INDEX "PayslipLine_deductionCodeId_idx" ON "PayslipLine"("deductionCodeId");

CREATE TABLE "BenefitPlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" "BenefitType" NOT NULL,
  "name" TEXT NOT NULL,
  "carrier" TEXT,
  "description" TEXT,
  "employeeCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "employerCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BenefitPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BenefitPlan_organizationId_name_key" ON "BenefitPlan"("organizationId", "name");
CREATE INDEX "BenefitPlan_organizationId_type_idx" ON "BenefitPlan"("organizationId", "type");

CREATE TABLE "BenefitTier" (
  "id" TEXT NOT NULL,
  "benefitPlanId" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "employeeCost" DECIMAL(10,2) NOT NULL,
  "employerCost" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "BenefitTier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BenefitTier_benefitPlanId_tier_key" ON "BenefitTier"("benefitPlanId", "tier");

CREATE TABLE "OpenEnrollment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "status" "OpenEnrollmentStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpenEnrollment_organizationId_status_idx" ON "OpenEnrollment"("organizationId", "status");

CREATE TABLE "OpenEnrollmentPlan" (
  "id" TEXT NOT NULL,
  "openEnrollmentId" TEXT NOT NULL,
  "benefitPlanId" TEXT NOT NULL,
  CONSTRAINT "OpenEnrollmentPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpenEnrollmentPlan_openEnrollmentId_benefitPlanId_key" ON "OpenEnrollmentPlan"("openEnrollmentId", "benefitPlanId");

CREATE TABLE "BenefitEnrollment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "benefitPlanId" TEXT NOT NULL,
  "benefitTierId" TEXT,
  "openEnrollmentId" TEXT,
  "lifeEventId" TEXT,
  "employeeCost" DECIMAL(10,2) NOT NULL,
  "employerCost" DECIMAL(10,2) NOT NULL,
  "effectiveStart" TIMESTAMP(3) NOT NULL,
  "effectiveEnd" TIMESTAMP(3),
  "status" "EnrollmentStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "providerRef" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BenefitEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BenefitEnrollment_organizationId_subjectId_idx" ON "BenefitEnrollment"("organizationId", "subjectId");
CREATE INDEX "BenefitEnrollment_benefitPlanId_status_idx" ON "BenefitEnrollment"("benefitPlanId", "status");
CREATE INDEX "BenefitEnrollment_openEnrollmentId_idx" ON "BenefitEnrollment"("openEnrollmentId");
CREATE INDEX "BenefitEnrollment_lifeEventId_idx" ON "BenefitEnrollment"("lifeEventId");

CREATE TABLE "Dependent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "relationship" "DependentRelationship" NOT NULL,
  "dateOfBirth" TIMESTAMP(3),
  "ssnLast4" TEXT,
  "coveredOnPlan" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dependent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Dependent_organizationId_ownerId_idx" ON "Dependent"("organizationId", "ownerId");

CREATE TABLE "LifeEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "type" "LifeEventType" NOT NULL,
  "eventDate" TIMESTAMP(3) NOT NULL,
  "status" "LifeEventStatus" NOT NULL DEFAULT 'REPORTED',
  "electionWindowEnd" TIMESTAMP(3),
  "notes" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LifeEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LifeEvent_organizationId_subjectId_idx" ON "LifeEvent"("organizationId", "subjectId");
CREATE INDEX "LifeEvent_status_idx" ON "LifeEvent"("status");

-- ────────────────────── Foreign keys ──────────────────────

ALTER TABLE "PayGroup" ADD CONSTRAINT "PayGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_payGroupId_fkey" FOREIGN KEY ("payGroupId") REFERENCES "PayGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EarningCode" ADD CONSTRAINT "EarningCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeductionCode" ADD CONSTRAINT "DeductionCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payGroupId_fkey" FOREIGN KEY ("payGroupId") REFERENCES "PayGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_earningCodeId_fkey" FOREIGN KEY ("earningCodeId") REFERENCES "EarningCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_deductionCodeId_fkey" FOREIGN KEY ("deductionCodeId") REFERENCES "DeductionCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BenefitPlan" ADD CONSTRAINT "BenefitPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitTier" ADD CONSTRAINT "BenefitTier_benefitPlanId_fkey" FOREIGN KEY ("benefitPlanId") REFERENCES "BenefitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenEnrollment" ADD CONSTRAINT "OpenEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenEnrollmentPlan" ADD CONSTRAINT "OpenEnrollmentPlan_openEnrollmentId_fkey" FOREIGN KEY ("openEnrollmentId") REFERENCES "OpenEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenEnrollmentPlan" ADD CONSTRAINT "OpenEnrollmentPlan_benefitPlanId_fkey" FOREIGN KEY ("benefitPlanId") REFERENCES "BenefitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_benefitPlanId_fkey" FOREIGN KEY ("benefitPlanId") REFERENCES "BenefitPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_benefitTierId_fkey" FOREIGN KEY ("benefitTierId") REFERENCES "BenefitTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_openEnrollmentId_fkey" FOREIGN KEY ("openEnrollmentId") REFERENCES "OpenEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_lifeEventId_fkey" FOREIGN KEY ("lifeEventId") REFERENCES "LifeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifeEvent" ADD CONSTRAINT "LifeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifeEvent" ADD CONSTRAINT "LifeEvent_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
