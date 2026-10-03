-- 2026-10-03 - Batch 3 (Talk): a message's client key, so a retried send never
-- posts twice.
--
-- ONE NEW NULLABLE COLUMN AND ONE PARTIAL UNIQUE INDEX on
-- "ConversationMessage", nothing else:
--
--   * "ConversationMessage"."clientId": the key the composer gives one
--     composed message (its optimistic row's id). Retry, or a keepalive send
--     that landed while the tab thought it had failed, sends the same key,
--     and POST /api/conversations/[id]/messages answers the message the
--     first send made instead of writing a second one and ringing everyone
--     twice. Null for every message sent before this release, never
--     back-filled.
--   * A UNIQUE index on (conversationId, authorId, clientId), PARTIAL on
--     "clientId" IS NOT NULL: the old rows (all null) are not indexed, so the
--     build reads the table once and writes nothing, and a race of two sends
--     with one key loses on the second insert (P2002), which the route
--     answers with the first message.
--
-- No existing row is read or written. APPLY THIS BEFORE THE CODE: the new
-- release writes "clientId" on every send, so until this file lands every
-- send fails with a 500 (nothing half written: the send is one transaction).
-- The running release never names the column, so applying it early is safe.
--
-- Idempotent: every statement is guarded, so running this file twice is a
-- no-op.

ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationMessage_conversationId_authorId_clientId_key"
  ON "ConversationMessage" ("conversationId", "authorId", "clientId")
  WHERE "clientId" IS NOT NULL;
