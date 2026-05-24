-- 2026-05-22 — Workspace data-scoping for Dev, Marketing, ITSM
-- (Phases 2-4 of multi-app rollout, following CRM in 20260522140000).
-- Adds a nullable workspaceId column + (organizationId, workspaceId)
-- index to each board-backed model. Legacy rows stay workspaceId NULL
-- and remain visible across every workspace's view (GET handlers OR
-- on workspaceId = active OR workspaceId IS NULL). New rows get a
-- workspaceId on create.

-- Dev
ALTER TABLE "Sprint" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Sprint_organizationId_workspaceId_idx" ON "Sprint"("organizationId", "workspaceId");

ALTER TABLE "Release" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Release_organizationId_workspaceId_idx" ON "Release"("organizationId", "workspaceId");

ALTER TABLE "RoadmapItem" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "RoadmapItem_organizationId_workspaceId_idx" ON "RoadmapItem"("organizationId", "workspaceId");

-- Marketing
ALTER TABLE "Campaign" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Campaign_organizationId_workspaceId_idx" ON "Campaign"("organizationId", "workspaceId");

ALTER TABLE "ContentItem" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "ContentItem_organizationId_workspaceId_idx" ON "ContentItem"("organizationId", "workspaceId");

ALTER TABLE "EventBrief" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "EventBrief_organizationId_workspaceId_idx" ON "EventBrief"("organizationId", "workspaceId");

-- ITSM
ALTER TABLE "Ticket" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Ticket_organizationId_workspaceId_idx" ON "Ticket"("organizationId", "workspaceId");

ALTER TABLE "Incident" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Incident_organizationId_workspaceId_idx" ON "Incident"("organizationId", "workspaceId");

ALTER TABLE "KbArticle" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "KbArticle_organizationId_workspaceId_idx" ON "KbArticle"("organizationId", "workspaceId");
