-- Slack-style "close conversation" (Room). Per-member hide flag — the
-- conversation and its full history survive; a new message un-hides it
-- for everyone. Idempotent.
ALTER TABLE "ConversationMember" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
