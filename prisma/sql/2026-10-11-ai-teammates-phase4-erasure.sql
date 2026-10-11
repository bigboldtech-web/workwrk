-- 2026-10-11 AI teammates, Phase 4 step 2 (docs/plans/ai-teammates-phase4.md,
-- the reconciliation note: "a new part in the sweep needs the CHECK on
-- "AccountErasure"."part" replaced in a catalogue-guarded way").
--
-- An account erasure's pass (src/lib/agents/erasure-sweep.ts ERASURE_PARTS)
-- gains the part "browser": the person's teammates' browser steps (kinds and
-- hosts) and pictures of pages are deleted, and the host a session of theirs
-- was on is blanked, after the erasure's short transaction, never inside it.
-- Its row keeps the part it stopped in, which the CHECK holds to the list.
--
-- THE CHECK IS REPLACED UNDER ITS OWN NAME, ONCE. "AccountErasure_values_check"
-- (prisma/sql/2026-10-11-ai-teammates-phase3-round6.sql) is dropped and added
-- again with the new list, in one DO block that first reads pg_constraint for
-- a definition that already names 'browser': a deploy after the first takes
-- no lock. The name is kept on purpose: round 6's file runs before this one on
-- every deploy and adds its CHECK whenever no constraint of that name exists,
-- so a new name would bring the old list back beside the new one, and the old
-- list refuses every erasure saved in "browser". Every row the old CHECK
-- allowed the new one allows (the old parts are all in it), so its one scan
-- cannot fail.
--
-- LOCKS. Dropping and adding a CHECK take ACCESS EXCLUSIVE on "AccountErasure"
-- for the scan of its rows: one row a person who ever erased their account,
-- read only by the erasure itself and the teammates cron. Under the deploy's
-- lock timeout (scripts/deploy-migrations.mjs LOCK_TIMEOUT), tried again on a
-- lock timeout or a deadlock.
--
-- Additive and idempotent. Before the reload: the new build's erasure pass
-- saves the part "browser", which the old CHECK refuses.
-- Rollback: the build before this one never writes "browser" and the new
-- CHECK allows all it writes, so nothing needs undoing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'AccountErasure_values_check'
       AND conrelid = '"AccountErasure"'::regclass
       AND pg_get_constraintdef(oid) LIKE '%''browser''%'
  ) THEN
    ALTER TABLE "AccountErasure" DROP CONSTRAINT IF EXISTS "AccountErasure_values_check";
    -- The parts of one pass, in order (src/lib/agents/erasure-sweep.ts ERASURE_PARTS).
    ALTER TABLE "AccountErasure" ADD CONSTRAINT "AccountErasure_values_check" CHECK (
      "part" IN ('chats', 'requests', 'browser', 'runs', 'questions', 'activity', 'memories', 'routines')
      AND "tries" >= 0
    );
  END IF;
END
$$;
