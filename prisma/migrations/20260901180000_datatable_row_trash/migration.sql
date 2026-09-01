-- Row trash: soft-delete for DataTableRow (recoverable, purged after 60 days).
ALTER TABLE "DataTableRow" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "DataTableRow_tableId_deletedAt_idx" ON "DataTableRow"("tableId", "deletedAt");
