-- Phase 7: TimerSession (additive-only)

CREATE TABLE "TimerSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimerSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimerSession_organizationId_entityType_entityId_idx" ON "TimerSession"("organizationId", "entityType", "entityId");
CREATE INDEX "TimerSession_userId_stoppedAt_idx" ON "TimerSession"("userId", "stoppedAt");
CREATE INDEX "TimerSession_organizationId_userId_idx" ON "TimerSession"("organizationId", "userId");

ALTER TABLE "TimerSession" ADD CONSTRAINT "TimerSession_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
