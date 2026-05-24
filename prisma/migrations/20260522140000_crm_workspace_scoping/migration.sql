-- 2026-05-22 — Workspace data-scoping for CRM (Phase 1 of multi-app rollout).
-- Adds a nullable workspaceId column + index to Lead, Account, Opportunity.
-- Legacy rows stay workspaceId = NULL and remain visible across every
-- workspace's view (the GET handlers OR on workspaceId = the active id
-- OR workspaceId IS NULL). New rows always get a workspaceId on create.

ALTER TABLE "Lead" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Lead_organizationId_workspaceId_idx" ON "Lead"("organizationId", "workspaceId");

ALTER TABLE "Account" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Account_organizationId_workspaceId_idx" ON "Account"("organizationId", "workspaceId");

ALTER TABLE "Opportunity" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Opportunity_organizationId_workspaceId_idx" ON "Opportunity"("organizationId", "workspaceId");
