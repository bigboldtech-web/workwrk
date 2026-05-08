-- Phase 5 v3 + Phase 4 v3
-- Adaptive Planning (BudgetPlan / PlanScenario / PlanLine / PlanDriver)
-- Studio (Workflow / WorkflowRun / CustomFieldDefinition / CustomFieldValue)
-- Overtime engine (OvertimePolicy)

CREATE TYPE "PlanType" AS ENUM ('BUDGET', 'FORECAST', 'STRATEGIC', 'WHAT_IF');
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "WorkflowRunStatus" AS ENUM ('IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'MULTI_SELECT', 'URL', 'EMAIL');

CREATE TABLE "BudgetPlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PlanType" NOT NULL DEFAULT 'BUDGET',
  "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "baselineId" TEXT,
  "description" TEXT,
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BudgetPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetPlan_organizationId_fiscalYearId_name_version_key" ON "BudgetPlan"("organizationId", "fiscalYearId", "name", "version");
CREATE INDEX "BudgetPlan_organizationId_status_idx" ON "BudgetPlan"("organizationId", "status");
CREATE INDEX "BudgetPlan_fiscalYearId_idx" ON "BudgetPlan"("fiscalYearId");

CREATE TABLE "PlanScenario" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "multiplier" DECIMAL(8,4),
  "notes" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanScenario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanScenario_planId_name_key" ON "PlanScenario"("planId", "name");
CREATE INDEX "PlanScenario_planId_idx" ON "PlanScenario"("planId");

CREATE TABLE "PlanLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "scenarioId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "costCenterId" TEXT,
  "periodId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "driverId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanLine_planId_scenarioId_accountId_costCenterId_periodId_key" ON "PlanLine"("planId", "scenarioId", "accountId", "costCenterId", "periodId");
CREATE INDEX "PlanLine_planId_accountId_idx" ON "PlanLine"("planId", "accountId");
CREATE INDEX "PlanLine_periodId_idx" ON "PlanLine"("periodId");
CREATE INDEX "PlanLine_costCenterId_idx" ON "PlanLine"("costCenterId");

CREATE TABLE "PlanDriver" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "formula" TEXT,
  "assumptions" JSONB NOT NULL DEFAULT '{}',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanDriver_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanDriver_organizationId_name_key" ON "PlanDriver"("organizationId", "name");
CREATE INDEX "PlanDriver_organizationId_idx" ON "PlanDriver"("organizationId");

CREATE TABLE "Workflow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Workflow_organizationId_name_key" ON "Workflow"("organizationId", "name");
CREATE INDEX "Workflow_organizationId_targetType_active_idx" ON "Workflow"("organizationId", "targetType", "active");

CREATE TABLE "WorkflowRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "status" "WorkflowRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "currentStep" INTEGER NOT NULL DEFAULT 0,
  "decisions" JSONB NOT NULL DEFAULT '[]',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkflowRun_organizationId_status_idx" ON "WorkflowRun"("organizationId", "status");
CREATE INDEX "WorkflowRun_entityType_entityId_idx" ON "WorkflowRun"("entityType", "entityId");

CREATE TABLE "CustomFieldDefinition" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "fieldType" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "options" JSONB NOT NULL DEFAULT '{}',
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_targetType_key_key" ON "CustomFieldDefinition"("organizationId", "targetType", "key");
CREATE INDEX "CustomFieldDefinition_organizationId_targetType_idx" ON "CustomFieldDefinition"("organizationId", "targetType");

CREATE TABLE "CustomFieldValue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "valueText" TEXT,
  "valueNumber" DECIMAL(20,6),
  "valueDate" TIMESTAMP(3),
  "valueJson" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomFieldValue_definitionId_entityType_entityId_key" ON "CustomFieldValue"("definitionId", "entityType", "entityId");
CREATE INDEX "CustomFieldValue_entityType_entityId_idx" ON "CustomFieldValue"("entityType", "entityId");

CREATE TABLE "OvertimePolicy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "dailyOtAfter" DECIMAL(4,2),
  "dailyDtAfter" DECIMAL(4,2),
  "weeklyOtAfter" DECIMAL(5,2),
  "seventhDayOt" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OvertimePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OvertimePolicy_organizationId_name_key" ON "OvertimePolicy"("organizationId", "name");
CREATE INDEX "OvertimePolicy_organizationId_active_idx" ON "OvertimePolicy"("organizationId", "active");

ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanScenario" ADD CONSTRAINT "PlanScenario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanScenario" ADD CONSTRAINT "PlanScenario_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BudgetPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BudgetPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "PlanScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanLine" ADD CONSTRAINT "PlanLine_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "PlanDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanDriver" ADD CONSTRAINT "PlanDriver_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimePolicy" ADD CONSTRAINT "OvertimePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
