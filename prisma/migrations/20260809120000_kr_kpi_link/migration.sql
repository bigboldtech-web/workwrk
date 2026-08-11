-- KR ↔ KPI link + richer KPI direction. Additive only: new enum, new
-- nullable columns, one FK. Touches no existing data.

-- CreateEnum
CREATE TYPE "KpiDirection" AS ENUM ('HIGHER', 'LOWER', 'MAINTAIN');

-- AlterTable
ALTER TABLE "KPI" ADD COLUMN "direction" "KpiDirection";
ALTER TABLE "KPI" ADD COLUMN "isNorthStar" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KeyResult" ADD COLUMN "kpiId" TEXT;

-- CreateIndex
CREATE INDEX "KeyResult_kpiId_idx" ON "KeyResult"("kpiId");

-- AddForeignKey
ALTER TABLE "KeyResult" ADD CONSTRAINT "KeyResult_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KPI"("id") ON DELETE SET NULL ON UPDATE CASCADE;
