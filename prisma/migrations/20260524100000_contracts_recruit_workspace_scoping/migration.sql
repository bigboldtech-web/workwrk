-- 2026-05-24 — Workspace data-scoping for Legal (Contract) and
-- Recruiting (Job, Candidate). Phase 5 of the multi-app rollout,
-- following CRM (140000) and Dev/Mktg/ITSM (150000). Same pattern:
-- nullable workspaceId + composite index. Legacy rows stay NULL and
-- are visible across every workspace's view.

-- Legal
ALTER TABLE "Contract" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Contract_organizationId_workspaceId_idx" ON "Contract"("organizationId", "workspaceId");

-- Recruiting
ALTER TABLE "Job" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Job_organizationId_workspaceId_idx" ON "Job"("organizationId", "workspaceId");

ALTER TABLE "Candidate" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Candidate_organizationId_workspaceId_idx" ON "Candidate"("organizationId", "workspaceId");
