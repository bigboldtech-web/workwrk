-- 2026-10-20 The WorkwrK browser host (docs/plans/browser-host.md Decision 16
-- and section 2): the session CHECK gains the provider 'workwrk'.
--
-- WHY. src/lib/browser/sessions.ts writes provider: cfg.provider into every
-- new "TeammateBrowserSession" row, and 2026-10-11-ai-teammates-phase4.sql
-- holds "provider" IN ('browserbase', 'stand-in'). Once BROWSER_PROVIDER=workwrk,
-- every start's insert would fail that CHECK (23514), and no browser would
-- ever start.
--
-- REPLACED UNDER ITS OWN NAME, guarded on its definition naming 'workwrk', as
-- 2026-10-11-ai-teammates-phase4-erasure.sql did for "AccountErasure" (After
-- Phase 4, step 2, "The CHECK keeps its name"): the Phase 4 file adds
-- "TeammateBrowserSession_values_check" whenever none of that name exists, so
-- a new name would bring the old list back beside the new one. Every other
-- test of the CHECK is the Phase 4 file's, word for word
-- (src/lib/browser/types.test.ts holds the lists equal).
--
-- NOT VALID here, VALIDATE in the next file, its own transaction
-- (2026-10-20-browser-host-provider-validate.sql): this file holds ACCESS
-- EXCLUSIVE on "TeammateBrowserSession" for the drop and the add only, with
-- no scan, under the deploy's 5 s lock_timeout and its retries; the scan
-- takes SHARE UPDATE EXCLUSIVE, so reads and writes go on. Every row the old
-- list allowed the new one does. A deploy after the first reads only the
-- catalogue.
--
-- Before the reload: the new build writes 'workwrk' once it is configured.
-- Rollback: nothing to undo; the old build never writes 'workwrk', and the new
-- CHECK allows all it writes.
--
-- Additive and idempotent. Declared in prisma/schema.prisma by comment only
-- (TeammateBrowserSession.provider); no column changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'TeammateBrowserSession_values_check'
       AND conrelid = '"TeammateBrowserSession"'::regclass
       AND pg_get_constraintdef(oid) LIKE '%''workwrk''%'
  ) THEN
    ALTER TABLE "TeammateBrowserSession" DROP CONSTRAINT IF EXISTS "TeammateBrowserSession_values_check";
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_values_check" CHECK (
      "provider" IN ('browserbase', 'stand-in', 'workwrk')
      AND "status" IN ('starting', 'live', 'waiting', 'handed_over', 'ending', 'ended')
      AND ("endReason" IS NULL OR "endReason" IN ('idle', 'time_cap', 'waited_too_long', 'take_over_too_long', 'stopped',
           'closed_by_teammate', 'turned_off', 'plan', 'left', 'deactivated', 'no_access', 'workspace_closed', 'teammate_off',
           'restarted', 'start_failed', 'provider_ended', 'admin_stopped'))
      AND "reservedMinutes" BETWEEN 1 AND 120
      AND ("billedMinutes" IS NULL OR "billedMinutes" >= 0)
      AND "stopAttempts" >= 0
      AND "endsBy" > "startedAt"
    ) NOT VALID;
  END IF;
END $$;
