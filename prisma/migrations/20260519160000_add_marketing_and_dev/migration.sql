-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PLANNING', 'APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('BLOG_POST', 'EMAIL', 'SOCIAL_POST', 'VIDEO', 'PODCAST', 'WHITEPAPER', 'EBOOK', 'CASE_STUDY', 'WEBINAR', 'ONE_PAGER', 'PRESS_RELEASE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'BRIEFED', 'IN_DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PLANNING', 'PROMOTING', 'REGISTERING', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('PLANNED', 'IN_DEVELOPMENT', 'READY', 'ROLLING_OUT', 'SHIPPED', 'ROLLED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoadmapPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "RoadmapStatus" AS ENUM ('EXPLORING', 'COMMITTED', 'IN_PROGRESS', 'BETA', 'SHIPPED', 'PAUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PLANNING',
    "channel" TEXT,
    "budget" DECIMAL(12,2),
    "spent" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "goalMetric" TEXT,
    "goalTarget" INTEGER,
    "goalActual" INTEGER,
    "utmCampaign" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ContentType" NOT NULL DEFAULT 'BLOG_POST',
    "status" "ContentStatus" NOT NULL DEFAULT 'IDEA',
    "channel" TEXT,
    "ownerId" TEXT,
    "authorId" TEXT,
    "briefUrl" TEXT,
    "draftUrl" TEXT,
    "publishedUrl" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventBrief" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT,
    "format" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "location" TEXT,
    "capacity" INTEGER,
    "registeredCount" INTEGER DEFAULT 0,
    "attendedCount" INTEGER DEFAULT 0,
    "budget" DECIMAL(12,2),
    "spent" DECIMAL(12,2),
    "status" "EventStatus" NOT NULL DEFAULT 'PLANNING',
    "ownerId" TEXT,
    "campaignId" TEXT,
    "url" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "teamId" TEXT,
    "capacityPoints" INTEGER,
    "committedPoints" INTEGER,
    "completedPoints" INTEGER,
    "velocityRolling7" DECIMAL(8,2),
    "retroNotes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "changelog" TEXT,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'PLANNED',
    "releaseType" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "shipNotesUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "theme" TEXT,
    "priority" "RoadmapPriority" NOT NULL DEFAULT 'P2',
    "status" "RoadmapStatus" NOT NULL DEFAULT 'EXPLORING',
    "quarter" TEXT,
    "ownerId" TEXT,
    "effortPoints" INTEGER,
    "impactScore" INTEGER,
    "parentId" TEXT,
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoadmapItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_ownerId_idx" ON "Campaign"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Campaign_startDate_idx" ON "Campaign"("startDate");

-- CreateIndex
CREATE INDEX "ContentItem_organizationId_status_idx" ON "ContentItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_organizationId_type_idx" ON "ContentItem"("organizationId", "type");

-- CreateIndex
CREATE INDEX "ContentItem_scheduledFor_idx" ON "ContentItem"("scheduledFor");

-- CreateIndex
CREATE INDEX "EventBrief_organizationId_status_idx" ON "EventBrief"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EventBrief_startDate_idx" ON "EventBrief"("startDate");

-- CreateIndex
CREATE INDEX "Sprint_organizationId_status_idx" ON "Sprint"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Sprint_organizationId_startDate_idx" ON "Sprint"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "Release_organizationId_status_idx" ON "Release"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Release_scheduledFor_idx" ON "Release"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Release_organizationId_version_key" ON "Release"("organizationId", "version");

-- CreateIndex
CREATE INDEX "RoadmapItem_organizationId_status_idx" ON "RoadmapItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RoadmapItem_organizationId_quarter_idx" ON "RoadmapItem"("organizationId", "quarter");

-- CreateIndex
CREATE INDEX "RoadmapItem_parentId_idx" ON "RoadmapItem"("parentId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventBrief" ADD CONSTRAINT "EventBrief_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapItem" ADD CONSTRAINT "RoadmapItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapItem" ADD CONSTRAINT "RoadmapItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RoadmapItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
