-- Comms Hub Phase 5 — message updatedAt (docs/plans/comms-hub.md)
-- Powers propagation of reactions/edits/deletes through the existing
-- poll: the after-cursor filters on updatedAt instead of createdAt.
-- Idempotent.

ALTER TABLE "ConversationMessage"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ConversationMessage_conversationId_updatedAt_idx"
  ON "ConversationMessage"("conversationId", "updatedAt");
