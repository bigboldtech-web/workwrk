-- Native calls Phase 2 — live huddle presence (docs/plans/native-calls.md).
-- Idempotent.

CREATE TABLE IF NOT EXISTS "CallSession" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roomName"       TEXT NOT NULL,
  "conversationId" TEXT,
  "meetingId"      TEXT,
  "participants"   JSONB NOT NULL DEFAULT '[]',
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"        TIMESTAMP(3),
  CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallSession_organizationId_endedAt_idx" ON "CallSession"("organizationId", "endedAt");
CREATE INDEX IF NOT EXISTS "CallSession_conversationId_endedAt_idx" ON "CallSession"("conversationId", "endedAt");
CREATE INDEX IF NOT EXISTS "CallSession_meetingId_endedAt_idx" ON "CallSession"("meetingId", "endedAt");
CREATE INDEX IF NOT EXISTS "CallSession_roomName_endedAt_idx" ON "CallSession"("roomName", "endedAt");
