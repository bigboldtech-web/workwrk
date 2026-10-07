-- AI teammates, Phase 2 step 7 (docs/plans/ai-teammates-phase2.md): an
-- automation's answer in its creator's chat with the teammate is saved with
-- its own kind, 'AUTOMATION', so the history query (engine.ts buildHistory)
-- reads only the chat's own turns. The CHECK on "ChatMessage"."kind" is
-- widened to a superset: replaced only while it lacks the new value, so a
-- second run changes nothing. NOT VALID, as before: no existing row is read.
-- Additive. Rollback: none needed (older builds never write the value; the
-- wider CHECK accepts everything the narrower one did).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChatMessage_kind_check'
      AND conrelid = '"ChatMessage"'::regclass
      AND strpos(pg_get_constraintdef(oid), 'AUTOMATION') = 0
  ) THEN
    ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_kind_check";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_kind_check' AND conrelid = '"ChatMessage"'::regclass
  ) THEN
    ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_kind_check"
      CHECK ("kind" IS NULL OR "kind" IN ('EVENT', 'APPROVAL', 'REPORT', 'AUTOMATION')) NOT VALID;
  END IF;
END
$$;
