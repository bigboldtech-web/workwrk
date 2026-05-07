-- Phase 2: Expenses module. Single-currency per row for v1; multi-
-- currency joins arrive when reporting/FX schemas are added. Tagging
-- (cost center / project / region) rides the polymorphic
-- TagAssignment table — no direct FKs from Expense.

CREATE TYPE "ExpenseCategory" AS ENUM (
  'TRAVEL',
  'MEALS',
  'LODGING',
  'TRANSPORT',
  'SUPPLIES',
  'SUBSCRIPTION',
  'EQUIPMENT',
  'CLIENT_ENTERTAINMENT',
  'TRAINING',
  'OTHER'
);

CREATE TYPE "ExpenseStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'REIMBURSED'
);

CREATE TABLE "Expense" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reporterId"     TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "notes"          TEXT,
  "category"       "ExpenseCategory" NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'USD',
  "expenseDate"    TIMESTAMP(3) NOT NULL,
  "receiptUrl"     TEXT,
  "status"         "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt"    TIMESTAMP(3),
  "approverId"     TEXT,
  "decisionAt"     TIMESTAMP(3),
  "decisionNote"   TEXT,
  "reimbursedAt"   TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Expense_organizationId_status_idx"
  ON "Expense"("organizationId", "status");
CREATE INDEX "Expense_organizationId_expenseDate_idx"
  ON "Expense"("organizationId", "expenseDate");
CREATE INDEX "Expense_reporterId_status_idx"
  ON "Expense"("reporterId", "status");
CREATE INDEX "Expense_approverId_status_idx"
  ON "Expense"("approverId", "status");

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
