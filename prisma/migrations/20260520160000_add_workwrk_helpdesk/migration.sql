-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED', 'SPAM');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportChannel" AS ENUM ('EMAIL', 'CHAT', 'PHONE', 'PORTAL', 'SOCIAL', 'IN_APP');

-- CreateTable
CREATE TABLE "SupportCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "linkedAccountId" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "customerId" TEXT NOT NULL,
    "channel" "SupportChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "category" TEXT,
    "assigneeId" TEXT,
    "slaTier" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "csatScore" INTEGER,
    "csatComment" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMacro" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "resolves" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportMacro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportCustomer_organizationId_companyName_idx" ON "SupportCustomer"("organizationId", "companyName");

-- CreateIndex
CREATE INDEX "SupportCustomer_linkedAccountId_idx" ON "SupportCustomer"("linkedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCustomer_organizationId_email_key" ON "SupportCustomer"("organizationId", "email");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_status_idx" ON "SupportTicket"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_assigneeId_idx" ON "SupportTicket"("organizationId", "assigneeId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_customerId_idx" ON "SupportTicket"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_priority_idx" ON "SupportTicket"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "SupportTicket_firstResponseDueAt_idx" ON "SupportTicket"("firstResponseDueAt");

-- CreateIndex
CREATE INDEX "SupportMacro_organizationId_category_idx" ON "SupportMacro"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMacro_organizationId_slug_key" ON "SupportMacro"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "SupportCustomer" ADD CONSTRAINT "SupportCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SupportCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMacro" ADD CONSTRAINT "SupportMacro_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
