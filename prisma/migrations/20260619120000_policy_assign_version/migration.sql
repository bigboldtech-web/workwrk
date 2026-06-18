-- Policy assignment (mirror SOPAssignment) + policy version control (mirror SOPVersion).
-- Purely additive: two new tables, no changes to existing rows.

CREATE TABLE "PolicyAssignment" (
  "id"          TEXT NOT NULL,
  "policyId"    TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'ASSIGNED',
  "mandatory"   BOOLEAN NOT NULL DEFAULT true,
  "dueDate"     TIMESTAMP(3),
  "assignedBy"  TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicyAssignment_policyId_userId_key" ON "PolicyAssignment"("policyId", "userId");
CREATE INDEX "PolicyAssignment_userId_idx" ON "PolicyAssignment"("userId");
CREATE INDEX "PolicyAssignment_policyId_idx" ON "PolicyAssignment"("policyId");
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PolicyVersion" (
  "id"          TEXT NOT NULL,
  "policyId"    TEXT NOT NULL,
  "version"     INTEGER NOT NULL,
  "title"       TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "status"      TEXT,
  "publishedBy" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PolicyVersion_policyId_idx" ON "PolicyVersion"("policyId");
CREATE INDEX "PolicyVersion_version_idx" ON "PolicyVersion"("version");
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
