-- Phase 5: Core Financials
--
-- Native double-entry GL: chart of accounts + cost centers + fiscal
-- calendar + journal entries + lines. Reports (P&L, balance sheet,
-- trial balance) read JournalLine aggregates; we never cache
-- balances on Account.

-- ────────────────────── Enums ──────────────────────

CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'PAYROLL', 'AP_INVOICE', 'AR_INVOICE', 'EXPENSE', 'PURCHASE_ORDER', 'ADJUSTMENT', 'OPENING_BALANCE', 'REVERSAL');
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'POSTED', 'REVERSED', 'VOIDED');

-- ────────────────────── Tables ──────────────────────

CREATE TABLE "GlAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "GlAccountType" NOT NULL,
  "parentId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GlAccount_organizationId_code_key" ON "GlAccount"("organizationId", "code");
CREATE INDEX "GlAccount_organizationId_type_idx" ON "GlAccount"("organizationId", "type");
CREATE INDEX "GlAccount_parentId_idx" ON "GlAccount"("parentId");

CREATE TABLE "CostCenter" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostCenter_organizationId_code_key" ON "CostCenter"("organizationId", "code");
CREATE INDEX "CostCenter_organizationId_idx" ON "CostCenter"("organizationId");

CREATE TABLE "FiscalYear" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiscalYear_organizationId_label_key" ON "FiscalYear"("organizationId", "label");
CREATE INDEX "FiscalYear_organizationId_status_idx" ON "FiscalYear"("organizationId", "status");

CREATE TABLE "AccountingPeriod" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingPeriod_fiscalYearId_label_key" ON "AccountingPeriod"("fiscalYearId", "label");
CREATE INDEX "AccountingPeriod_organizationId_status_idx" ON "AccountingPeriod"("organizationId", "status");

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
  "sourceType" TEXT,
  "sourceId" TEXT,
  "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "postedById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JournalEntry_organizationId_reference_key" ON "JournalEntry"("organizationId", "reference");
CREATE INDEX "JournalEntry_organizationId_postedAt_idx" ON "JournalEntry"("organizationId", "postedAt");
CREATE INDEX "JournalEntry_periodId_status_idx" ON "JournalEntry"("periodId", "status");
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "debitAccountId" TEXT,
  "creditAccountId" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "costCenterId" TEXT,
  "description" TEXT,
  "txnCurrency" TEXT,
  "txnAmount" DECIMAL(14,2),
  "txnFxRate" DECIMAL(14,8),
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_debitAccountId_idx" ON "JournalLine"("debitAccountId");
CREATE INDEX "JournalLine_creditAccountId_idx" ON "JournalLine"("creditAccountId");
CREATE INDEX "JournalLine_costCenterId_idx" ON "JournalLine"("costCenterId");

-- ────────────────────── Foreign keys ──────────────────────

ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
