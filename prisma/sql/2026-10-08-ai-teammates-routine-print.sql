-- AI teammates, Phase 2 review round 10 (docs/plans/ai-teammates-phase2.md,
-- "After Phase 2"): a routine keeps the fingerprint of its teammate as its
-- person last chose it (src/lib/agents/teammate-print.ts), set when the
-- routine is made, moved from Workspace agents or resumed by its person. A
-- routine whose workspace teammate someone else changed since pauses with
-- its reason instead of running unattended on their words.
-- One nullable column: ADD COLUMN IF NOT EXISTS, so a second run changes
-- nothing, and no existing row is rewritten. Additive.
-- Rollback: ALTER TABLE "AgentRoutine" DROP COLUMN IF EXISTS "teammatePrint";

ALTER TABLE "AgentRoutine" ADD COLUMN IF NOT EXISTS "teammatePrint" TEXT;
