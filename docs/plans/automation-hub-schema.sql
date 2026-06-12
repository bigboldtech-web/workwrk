-- Automation Hub — event-driven workflow engine.
-- Additive only: new enums + tables. Does not touch existing objects.

-- CreateEnum
CREATE TYPE "AutomationWorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AutomationStepStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AutomationStepType" AS ENUM ('TRIGGER', 'CONDITION', 'ACTION');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('WHATSAPP', 'GMAIL', 'GOOGLE_CALENDAR', 'SLACK', 'WEBHOOK', 'ZAPIER', 'CRM');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'ERROR');

-- CreateTable
CREATE TABLE "AutomationWorkflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AutomationWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "severity" "AutomationSeverity" NOT NULL DEFAULT 'MINOR',
    "triggerEvent" TEXT,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "publishedVersionId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationWorkflowVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL DEFAULT '{}',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationWorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersionId" TEXT,
    "triggerEventKey" TEXT NOT NULL,
    "triggerPayload" JSONB NOT NULL DEFAULT '{}',
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "severity" "AutomationSeverity" NOT NULL DEFAULT 'MINOR',
    "idempotencyKey" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "userId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRunStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "stepType" "AutomationStepType" NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" "AutomationStepStatus" NOT NULL DEFAULT 'RUNNING',
    "inputJson" JSONB NOT NULL DEFAULT '{}',
    "outputJson" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT,
    "runId" TEXT,
    "userId" TEXT,
    "boardId" TEXT,
    "moduleName" TEXT,
    "actionKey" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "usageDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "connectedByUserId" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "scopesJson" JSONB NOT NULL DEFAULT '[]',
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "severity" "AutomationSeverity" NOT NULL DEFAULT 'MINOR',
    "templateJson" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationWorkflow_organizationId_status_idx" ON "AutomationWorkflow"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AutomationWorkflow_organizationId_triggerEvent_status_idx" ON "AutomationWorkflow"("organizationId", "triggerEvent", "status");

-- CreateIndex
CREATE INDEX "AutomationWorkflowVersion_organizationId_idx" ON "AutomationWorkflowVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationWorkflowVersion_workflowId_versionNumber_key" ON "AutomationWorkflowVersion"("workflowId", "versionNumber");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_status_idx" ON "AutomationRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_workflowId_idx" ON "AutomationRun"("organizationId", "workflowId");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_severity_status_idx" ON "AutomationRun"("organizationId", "severity", "status");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_createdAt_idx" ON "AutomationRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_recordType_recordId_idx" ON "AutomationRun"("recordType", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_workflowId_idempotencyKey_key" ON "AutomationRun"("workflowId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationRunStep_runId_order_idx" ON "AutomationRunStep"("runId", "order");

-- CreateIndex
CREATE INDEX "AutomationRunStep_organizationId_idx" ON "AutomationRunStep"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationUsage_organizationId_usageDate_idx" ON "AutomationUsage"("organizationId", "usageDate");

-- CreateIndex
CREATE INDEX "AutomationUsage_organizationId_workflowId_idx" ON "AutomationUsage"("organizationId", "workflowId");

-- CreateIndex
CREATE INDEX "AutomationUsage_organizationId_actionKey_idx" ON "AutomationUsage"("organizationId", "actionKey");

-- CreateIndex
CREATE INDEX "AutomationUsage_organizationId_userId_idx" ON "AutomationUsage"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_organizationId_status_idx" ON "IntegrationConnection"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_organizationId_provider_key" ON "IntegrationConnection"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "AutomationTemplate_isActive_category_idx" ON "AutomationTemplate"("isActive", "category");

-- AddForeignKey
ALTER TABLE "AutomationWorkflow" ADD CONSTRAINT "AutomationWorkflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationWorkflowVersion" ADD CONSTRAINT "AutomationWorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "AutomationWorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRunStep" ADD CONSTRAINT "AutomationRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationUsage" ADD CONSTRAINT "AutomationUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
