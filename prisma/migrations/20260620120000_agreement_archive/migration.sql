-- Soft-archive contracts/templates into a 60-day trash before purge.
ALTER TABLE "Agreement" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Agreement_archivedAt_idx" ON "Agreement" ("archivedAt");
