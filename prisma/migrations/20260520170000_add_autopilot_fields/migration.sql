-- CreateEnum
CREATE TYPE "WorkflowKind" AS ENUM ('APPROVAL', 'AUTOMATION');

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "conditions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "kind" "WorkflowKind" NOT NULL DEFAULT 'APPROVAL',
ADD COLUMN     "triggerEvent" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_organizationId_kind_triggerEvent_active_idx" ON "Workflow"("organizationId", "kind", "triggerEvent", "active");
