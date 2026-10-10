-- AI teammates, Phase 3, review round 1 of the whole phase
-- (docs/plans/ai-teammates-phase3.md, "After Phase 3").
--
-- A card proposed in a turn that read the person's Google is marked so on
-- its own row, the moment it is proposed: "AgentAction"."readGoogle". The
-- turn's answer and its run were marked only when the turn finished, so a
-- turn that stopped part way (a reload during a deploy, out of memory) left a
-- card made from a planted email that a later turn was told of as if nothing
-- had been read. With the mark on the card, that card stands alone on its own
-- card in the chat (never ticked by a batch's Approve), and any turn told of
-- it starts as one that read Google (src/lib/agents/engine.ts startsTainted).
--
-- The revoke queue gains an index on "accountKey": a reconnect of a Google
-- account deletes, under the per-account lock, the revokes queued for that
-- account before it (src/lib/connectors/connections.ts saveOnce), so one
-- queued earlier is never sent after the new grant exists.
--
-- Additive and idempotent. ADD COLUMN IF NOT EXISTS with a constant default
-- is a catalogue change on Postgres 11 and later: no row is rewritten, and
-- every existing card reads false, which is what it was before (the turns
-- that made them are read from their runs and answers, as before). The index
-- is IF NOT EXISTS on a small table (rows live only until Google is told).
-- Rollback: DROP INDEX IF EXISTS "TeammateTokenRevocation_accountKey_idx";
--   ALTER TABLE "AgentAction" DROP COLUMN IF EXISTS "readGoogle";

ALTER TABLE "AgentAction" ADD COLUMN IF NOT EXISTS "readGoogle" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "TeammateTokenRevocation_accountKey_idx" ON "TeammateTokenRevocation" ("accountKey");
