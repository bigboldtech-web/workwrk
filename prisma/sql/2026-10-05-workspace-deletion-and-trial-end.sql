-- Batch 9: two staff console facts that must outlive what they describe.
--
-- 1. "WorkspaceDeletion", a record of an Owner deleting their workspace.
--
-- WHY. The staff console's Cancellations (GET /api/admin/analytics) read an
-- Owner's deletion from its audit row, ActivityLog
-- 'organization_scheduled_deletion'. That row's actor is the Owner, and
-- ActivityLog.actor is ON DELETE CASCADE. Thirty days later the hard-delete
-- cron deletes the Organization, which deletes the Owner's User row, which
-- deletes the audit row. So "Last 90 days" and "Last 12 months" lost every
-- Owner deletion older than about a month: the commonest cancellation
-- disappeared from the churn record exactly when it became final.
--
-- The same cascade took the company out of every other long-range number:
-- new companies per month, the setup funnel and the retention cohorts all
-- read only companies that still exist, so a month's signups shrank, and its
-- retention rose, the day its deleted companies were purged.
--
-- WHAT IT KEEPS, AND WHAT IT DOES NOT. The privacy policy (section 6) keeps
-- workspace data for 30 days after termination and then deletes it. So this
-- table keeps NO name and NO person: an opaque company id, the plan it was
-- on, the dates (signed up, deletion asked for, deleted for good) and two
-- yes/no facts the hard-delete cron reads at the end (had it finished setup,
-- had it created anything). A deleted company reads "A deleted company" in
-- the console. It has NO foreign keys, on purpose: nothing may cascade it.
--
-- 2. "Organization"."trialEndsAt", the date a self-serve trial ends, for
-- WorkwrK staff only.
--
-- WHY. A self-serve signup is status TRIAL with no Subscription row, so the
-- only trial date the console could read (Subscription.trialEndsAt, which
-- Stripe writes) was always empty for them: Overview's "Trials end in the
-- next 7 days" could never count one, and the company page never showed when
-- one ends. The customer is not shown this date and nothing in the product
-- changes on it; it is when WorkwrK staff follow a trial up. Signup sets it to
-- 14 days after signup (src/lib/admin/trial-end.ts), and staff can change it.
--
-- ADDITIVE ONLY. One new table, one new nullable column, three indexes.
-- Nothing existing is renamed, retyped, dropped or made required, so this can
-- be applied to a live database while the current release serves traffic.
--
-- IDEMPOTENT, INCLUDING BOTH BACKFILLS. The deploy runs every file in its
-- manifest on every deploy (scripts/deploy-migrations.mjs keeps no ledger), so
-- each one-time backfill is guarded by a MARKER comment on the table or column
-- it fills, the house pattern (2026-09-18-notification-cleared-at.sql). A
-- second run finds the marker and does nothing, so a trial date a staff
-- member cleared is never filled in again, and no deletion is recorded twice.
-- One fill does run on every deploy (section 3), guarded on its own effect:
-- trials that signed up while the release was being built.
--
-- NOTHING HERE CAN FAIL THE DEPLOY ON BAD DATA. settings.cancelledAt is cast
-- to a timestamp one row at a time, only when it has the shape the delete
-- route writes (Date.toISOString()), and inside its own exception block, so
-- a hand-edited value (even one shaped right but impossible, like
-- 2026-09-31) is skipped, never an error that aborts the release. A skipped
-- row loses nothing: the console still reads the live schedule, and the
-- hard-delete cron writes the record when it deletes the company.
--
-- Local (applied by the authoring session against .env.local only).

-- 1. The deletion record.
CREATE TABLE IF NOT EXISTS "WorkspaceDeletion" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "plan"             TEXT,
  "signedUpAt"       TIMESTAMP(3),
  "requestedAt"      TIMESTAMP(3) NOT NULL,
  "hardDeletedAt"    TIMESTAMP(3),
  "finishedSetup"    BOOLEAN,
  "createdSomething" BOOLEAN,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceDeletion_organizationId_requestedAt_key"
  ON "WorkspaceDeletion" ("organizationId", "requestedAt");
CREATE INDEX IF NOT EXISTS "WorkspaceDeletion_requestedAt_idx"
  ON "WorkspaceDeletion" ("requestedAt");
CREATE INDEX IF NOT EXISTS "WorkspaceDeletion_signedUpAt_idx"
  ON "WorkspaceDeletion" ("signedUpAt");

-- One-time backfill: every Owner deletion whose audit row still exists, then
-- every live deletion schedule whose audit row never wrote (logAuditEvent
-- never throws, so a failed write was silent). The plan and the signup date
-- come from the company as it is now; a company already gone has neither.
DO $$
DECLARE
  marker CONSTANT text := 'workspace-deletion-backfill-2026-10-05';
  r record;
  asked timestamp;
BEGIN
  IF obj_description('"WorkspaceDeletion"'::regclass, 'pg_class') IS DISTINCT FROM marker THEN
    INSERT INTO "WorkspaceDeletion" ("id", "organizationId", "plan", "signedUpAt", "requestedAt")
    SELECT 'wd_' || l."id", COALESCE(l."targetId", l."organizationId"), o."plan"::text, o."createdAt", l."createdAt"
      FROM "ActivityLog" l
      LEFT JOIN "Organization" o ON o."id" = COALESCE(l."targetId", l."organizationId")
     WHERE l."type" = 'organization_scheduled_deletion'
    ON CONFLICT DO NOTHING;

    FOR r IN
      SELECT o."id", o."plan"::text AS plan, o."createdAt", o."settings"->>'cancelledAt' AS cancelled
        FROM "Organization" o
       WHERE o."status" = 'CANCELLED'
         AND o."settings"->>'scheduledHardDeleteAt' IS NOT NULL
         AND o."settings"->>'cancelledAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
    LOOP
      -- One row's cast, on its own: an impossible date skips that row only.
      BEGIN
        asked := (r.cancelled)::timestamptz AT TIME ZONE 'UTC';
      EXCEPTION WHEN others THEN
        asked := NULL;
      END;
      IF asked IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM "WorkspaceDeletion" d
            WHERE d."organizationId" = r."id" AND d."requestedAt" >= asked - interval '5 minutes'
         ) THEN
        INSERT INTO "WorkspaceDeletion" ("id", "organizationId", "plan", "signedUpAt", "requestedAt")
        VALUES ('wd_live_' || r."id", r."id", r.plan, r."createdAt", asked)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    EXECUTE format('COMMENT ON TABLE "WorkspaceDeletion" IS %L', marker);
  END IF;
END $$;

-- 2. The staff-only trial end date. Added inside the block so the backfill
-- runs in the same step as the column's arrival, and only once.
DO $$
DECLARE
  marker CONSTANT text := 'trialEndsAt-backfill-2026-10-05';
  current_marker text;
BEGIN
  ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);

  SELECT col_description(a.attrelid, a.attnum) INTO current_marker
    FROM pg_attribute a
   WHERE a.attrelid = '"Organization"'::regclass
     AND a.attname = 'trialEndsAt';

  IF current_marker IS DISTINCT FROM marker THEN
    -- Every self-serve trial today: on TRIAL, with neither a Stripe
    -- subscription nor a lifetime deal (neither of which moves a company off
    -- TRIAL, so a paying company can still read TRIAL). Fourteen days from
    -- signup, the same rule signup now applies, stored as noon UTC on that
    -- calendar day like every trial end (src/lib/admin/trial-end.ts). Older
    -- trials get a date in the past and read "ended" to staff, which is what
    -- the rule says.
    UPDATE "Organization" o
       SET "trialEndsAt" = date_trunc('day', o."createdAt" + interval '14 days') + interval '12 hours'
     WHERE o."status" = 'TRIAL'
       AND o."trialEndsAt" IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM "Subscription" s
              WHERE s."organizationId" = o."id"
                AND (s."stripeSubscriptionId" IS NOT NULL OR s."billingMode" = 'FLAT_TIER')
           );

    EXECUTE format('COMMENT ON COLUMN "Organization"."trialEndsAt" IS %L', marker);
  END IF;
END $$;

-- The same column again, outside the block, for scripts/check-schema-sql.mjs
-- (and a no-op here, since the block above has added it).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);

-- 3. EVERY deploy, guarded on its own effect: a self-serve trial that signed
-- up while this release was being built (the old code still served signups
-- and wrote no date, and the one-time block above had already run) gets its
-- date. Only companies created since this file shipped, so an older company
-- staff later move to Trial is left alone; and never one whose date a staff
-- member cleared, since a clear always writes an admin.org.trial_end_changed
-- row (it changes the value).
UPDATE "Organization" o
   SET "trialEndsAt" = date_trunc('day', o."createdAt" + interval '14 days') + interval '12 hours'
 WHERE o."status" = 'TRIAL'
   AND o."trialEndsAt" IS NULL
   AND o."createdAt" >= TIMESTAMP '2026-10-05 00:00:00'
   AND NOT EXISTS (
         SELECT 1 FROM "Subscription" s
          WHERE s."organizationId" = o."id"
            AND (s."stripeSubscriptionId" IS NOT NULL OR s."billingMode" = 'FLAT_TIER')
       )
   AND NOT EXISTS (
         SELECT 1 FROM "StaffAction" sa
          WHERE sa."targetCompanyId" = o."id" AND sa."action" = 'admin.org.trial_end_changed'
       );

-- The console's trial reads ("Trials end in the next 7 days").
CREATE INDEX IF NOT EXISTS "Organization_trialEndsAt_idx" ON "Organization" ("trialEndsAt");
