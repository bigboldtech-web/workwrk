-- Review perf indexes: speed up cycle+status admin queries and reviewer dashboards
CREATE INDEX IF NOT EXISTS "Review_cycleId_status_idx" ON "Review"("cycleId", "status");
CREATE INDEX IF NOT EXISTS "Review_reviewerId_idx" ON "Review"("reviewerId");
