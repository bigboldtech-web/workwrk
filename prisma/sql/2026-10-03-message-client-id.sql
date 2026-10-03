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
--     "clientId" IS NOT NULL: the old rows (all null) are not indexed, and a
--     race of two sends with one key loses on the second insert (P2002),
--     which the route answers with the first message.
--
-- LOCKS. Each statement runs only when its object is missing, checked in the
-- catalog first, so a deploy after the first takes NO lock on this table
-- (ALTER TABLE ... IF NOT EXISTS and CREATE INDEX ... IF NOT EXISTS both take
-- their table lock before they look, and this is Talk's busiest table). The
-- first run: ADD COLUMN of a nullable column with no default is a catalog
-- change (an instant ACCESS EXCLUSIVE); the index build reads the whole table
-- once under a SHARE lock, so sends wait for that scan (seconds on a large
-- table, during the deploy's build step) and nothing else.
--
-- No existing row is read for its content or written. APPLY THIS BEFORE THE
-- CODE: the new release writes "clientId" on every send, so until this file
-- lands every send fails with a 500 (nothing half written: the send is one
-- transaction). The running release never names the column, so applying it
-- early is safe.
--
-- Idempotent: every statement is guarded, so running this file twice is a
-- no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ConversationMessage' AND column_name = 'clientId'
  ) THEN
    ALTER TABLE "ConversationMessage" ADD COLUMN "clientId" TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'ConversationMessage_conversationId_authorId_clientId_key'
  ) THEN
    CREATE UNIQUE INDEX "ConversationMessage_conversationId_authorId_clientId_key"
      ON "ConversationMessage" ("conversationId", "authorId", "clientId")
      WHERE "clientId" IS NOT NULL;
  END IF;
END $$;
