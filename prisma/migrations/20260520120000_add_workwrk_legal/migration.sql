-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'IN_NEGOTIATION', 'AWAITING_SIGNATURE', 'SIGNED', 'ACTIVE', 'EXPIRED', 'RENEWED', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'DELETION', 'PORTABILITY', 'OBJECTION', 'CONSENT_WITHDRAWAL', 'RESTRICTION', 'AUTOMATED_DECISION');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'VERIFYING', 'IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IpAssetType" AS ENUM ('WORD_MARK', 'DESIGN_MARK', 'COMBINED_MARK', 'SOUND_MARK', 'COLOR_MARK', 'PATENT', 'COPYRIGHT', 'TRADE_SECRET', 'DOMAIN_NAME');

-- CreateEnum
CREATE TYPE "TrademarkStatus" AS ENUM ('PROPOSED', 'CLEARANCE_SEARCH', 'APPLIED', 'PENDING', 'PUBLISHED', 'REGISTERED', 'RENEWAL_DUE', 'EXPIRED', 'ABANDONED', 'CANCELLED', 'OPPOSED');

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "counterpartyType" TEXT,
    "type" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "signedAt" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "renewalNoticeDays" INTEGER DEFAULT 60,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "documentUrl" TEXT,
    "description" TEXT,
    "terms" JSONB NOT NULL DEFAULT '{}',
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "subjectEmail" TEXT NOT NULL,
    "subjectName" TEXT,
    "subjectId" TEXT,
    "jurisdiction" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "notes" TEXT,
    "resolutionNotes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trademark" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "type" "IpAssetType" NOT NULL DEFAULT 'WORD_MARK',
    "status" "TrademarkStatus" NOT NULL DEFAULT 'PROPOSED',
    "jurisdictions" JSONB NOT NULL DEFAULT '[]',
    "classes" JSONB NOT NULL DEFAULT '[]',
    "registrationNumber" TEXT,
    "applicationNumber" TEXT,
    "filedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "renewalDueAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "externalCounselFirm" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trademark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_organizationId_status_idx" ON "Contract"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Contract_organizationId_counterparty_idx" ON "Contract"("organizationId", "counterparty");

-- CreateIndex
CREATE INDEX "Contract_expiresAt_idx" ON "Contract"("expiresAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_organizationId_status_idx" ON "PrivacyRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PrivacyRequest_organizationId_type_idx" ON "PrivacyRequest"("organizationId", "type");

-- CreateIndex
CREATE INDEX "PrivacyRequest_dueAt_idx" ON "PrivacyRequest"("dueAt");

-- CreateIndex
CREATE INDEX "Trademark_organizationId_status_idx" ON "Trademark"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Trademark_renewalDueAt_idx" ON "Trademark"("renewalDueAt");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trademark" ADD CONSTRAINT "Trademark_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
