-- Room sidebar Starred section (Slack parity). Per-member flag. Idempotent.
ALTER TABLE "ConversationMember" ADD COLUMN IF NOT EXISTS "starred" BOOLEAN NOT NULL DEFAULT false;
