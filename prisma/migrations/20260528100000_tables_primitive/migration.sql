-- CreateTable
CREATE TABLE "DataTable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTableRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataTable_organizationId_idx" ON "DataTable"("organizationId");

-- CreateIndex
CREATE INDEX "DataTable_createdById_idx" ON "DataTable"("createdById");

-- CreateIndex
CREATE INDEX "DataTableRow_tableId_position_idx" ON "DataTableRow"("tableId", "position");

-- CreateIndex
CREATE INDEX "DataTableRow_organizationId_idx" ON "DataTableRow"("organizationId");

-- AddForeignKey
ALTER TABLE "DataTable" ADD CONSTRAINT "DataTable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTableRow" ADD CONSTRAINT "DataTableRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTableRow" ADD CONSTRAINT "DataTableRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DataTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
