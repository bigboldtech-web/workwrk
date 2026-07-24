-- Workwrk operating-core (Phase 1) — additive-only migration.
-- Generated via: prisma migrate diff (old schema -> new schema).
-- Apply on any env with:  npx prisma db execute --file prisma/sql/2026-07-21-operating-core.sql
-- Purely additive: 3 enums, 2 ADD COLUMN (KPI, Item), 6 new tables, indexes, FKs. No drops.

-- CreateEnum
CREATE TYPE "BoundaryRelation" AS ENUM ('OWNS', 'CAN_REQUEST', 'CANNOT_TOUCH');

-- CreateEnum
CREATE TYPE "KpiOwnership" AS ENUM ('OWNED', 'SHARED');

-- CreateEnum
CREATE TYPE "WorkType" AS ENUM ('ENGINE', 'ROUTINE', 'JUDGMENT');

-- AlterTable
ALTER TABLE "KPI" ADD COLUMN     "baselineLabel" TEXT,
ADD COLUMN     "baselineValue" DOUBLE PRECISION,
ADD COLUMN     "formula" TEXT,
ADD COLUMN     "ownership" "KpiOwnership" NOT NULL DEFAULT 'OWNED';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "workType" "WorkType";

-- CreateTable
CREATE TABLE "Scope" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleInstance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scopeId" TEXT,
    "userId" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipArea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleBoundary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "relation" "BoundaryRelation" NOT NULL DEFAULT 'CAN_REQUEST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Threshold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT,
    "label" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Threshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleInstanceOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleInstanceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "source" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleInstanceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scope_organizationId_idx" ON "Scope"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Scope_organizationId_name_dimension_key" ON "Scope"("organizationId", "name", "dimension");

-- CreateIndex
CREATE INDEX "RoleInstance_organizationId_idx" ON "RoleInstance"("organizationId");

-- CreateIndex
CREATE INDEX "RoleInstance_userId_idx" ON "RoleInstance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleInstance_roleId_scopeId_key" ON "RoleInstance"("roleId", "scopeId");

-- CreateIndex
CREATE INDEX "OwnershipArea_organizationId_idx" ON "OwnershipArea"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipArea_organizationId_name_key" ON "OwnershipArea"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RoleBoundary_organizationId_idx" ON "RoleBoundary"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleBoundary_roleId_areaId_key" ON "RoleBoundary"("roleId", "areaId");

-- CreateIndex
CREATE INDEX "Threshold_organizationId_idx" ON "Threshold"("organizationId");

-- CreateIndex
CREATE INDEX "Threshold_roleId_idx" ON "Threshold"("roleId");

-- CreateIndex
CREATE INDEX "RoleInstanceOverride_organizationId_idx" ON "RoleInstanceOverride"("organizationId");

-- CreateIndex
CREATE INDEX "RoleInstanceOverride_roleInstanceId_idx" ON "RoleInstanceOverride"("roleInstanceId");

-- AddForeignKey
ALTER TABLE "Scope" ADD CONSTRAINT "Scope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scope" ADD CONSTRAINT "Scope_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Scope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInstance" ADD CONSTRAINT "RoleInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInstance" ADD CONSTRAINT "RoleInstance_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInstance" ADD CONSTRAINT "RoleInstance_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInstance" ADD CONSTRAINT "RoleInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipArea" ADD CONSTRAINT "OwnershipArea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipArea" ADD CONSTRAINT "OwnershipArea_ownerRoleId_fkey" FOREIGN KEY ("ownerRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBoundary" ADD CONSTRAINT "RoleBoundary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBoundary" ADD CONSTRAINT "RoleBoundary_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBoundary" ADD CONSTRAINT "RoleBoundary_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "OwnershipArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Threshold" ADD CONSTRAINT "Threshold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Threshold" ADD CONSTRAINT "Threshold_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInstanceOverride" ADD CONSTRAINT "RoleInstanceOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleInstanceOverride" ADD CONSTRAINT "RoleInstanceOverride_roleInstanceId_fkey" FOREIGN KEY ("roleInstanceId") REFERENCES "RoleInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

