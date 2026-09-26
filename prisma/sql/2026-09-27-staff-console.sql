-- 2026-09-27 - Phase 9, the Staff console: the staff activity log and the
-- per-staff-member console preferences (spec-admin-backoffice section 3
-- items 3 and 5, section 4 "Data migrations").
--
-- ONE NEW TABLE AND ONE NEW NULLABLE COLUMN, NOTHING ELSE.
--
--   * "StaffAction": one row per write a WorkwrK staff member makes from the
--     Staff console (plan, status, seats, module, add-on, Owner, staff list,
--     AppSumo import and refund) plus the sampled "admin.access.denied" probe.
--     Who (staff user id and email), what (the action key), which company,
--     a plain summary, before and after, the reason, the IP, a hit count.
--     Kept for ever. Nothing cascades: removing a staff member never removes
--     their history, and deleting a company sets "targetCompanyId" to NULL
--     rather than deleting the rows (ON DELETE SET NULL).
--   * "PlatformAdmin"."consolePrefs": console-local layout state per staff
--     member (sidebar collapsed, company drawer width, table columns,
--     recents). Null reads as an empty object. Product preferences (theme,
--     density) are never copied here.
--
-- No existing row is read or written. No backfill: no staff history exists
-- to recover. Deploy order is free: the currently running release never
-- names either object, and the new release's readers of "consolePrefs" read
-- null as the defaults.
--
-- Idempotent: every statement is guarded, so running this file twice is a
-- no-op.

-- 1. StaffAction --------------------------------------------------------

CREATE TABLE IF NOT EXISTS "StaffAction" (
  "id"              TEXT NOT NULL,
  "action"          TEXT NOT NULL,
  "actorUserId"     TEXT,
  "actorEmail"      TEXT NOT NULL,
  "targetCompanyId" TEXT,
  "targetLabel"     TEXT,
  "summary"         TEXT NOT NULL,
  "before"          JSONB,
  "after"           JSONB,
  "reason"          TEXT,
  "ip"              TEXT,
  "hits"            INTEGER NOT NULL DEFAULT 1,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StaffAction_createdAt_idx"
  ON "StaffAction" ("createdAt");
CREATE INDEX IF NOT EXISTS "StaffAction_targetCompanyId_createdAt_idx"
  ON "StaffAction" ("targetCompanyId", "createdAt");
CREATE INDEX IF NOT EXISTS "StaffAction_actorEmail_createdAt_idx"
  ON "StaffAction" ("actorEmail", "createdAt");
CREATE INDEX IF NOT EXISTS "StaffAction_action_createdAt_idx"
  ON "StaffAction" ("action", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StaffAction_targetCompanyId_fkey'
  ) THEN
    ALTER TABLE "StaffAction"
      ADD CONSTRAINT "StaffAction_targetCompanyId_fkey"
      FOREIGN KEY ("targetCompanyId") REFERENCES "Organization"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. PlatformAdmin.consolePrefs -------------------------------------------

ALTER TABLE "PlatformAdmin" ADD COLUMN IF NOT EXISTS "consolePrefs" JSONB;
