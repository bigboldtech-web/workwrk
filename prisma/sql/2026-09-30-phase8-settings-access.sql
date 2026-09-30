-- 2026-09-30 - Phase 8, settings, sign-in and the access surfaces. The ONE
-- schema file for the phase: later stages append their statements below
-- this block, each guarded the same way.
--
-- Stage B (sign-in and the wizard): TWO NEW NULLABLE COLUMNS ON "User",
-- NOTHING ELSE.
--
--   * "User"."termsAcceptedAt": when the person agreed to the Terms and the
--     Privacy Policy at /signup (spec-account-auth `/signup` field 5). The
--     policy version is recorded on the `terms.accepted` ActivityLog row the
--     same request writes. Null for every account made before this release
--     ("not recorded"), never back-filled with a guess.
--   * "User"."passwordChangedAt": the last time the person chose a password
--     (signup, join, reset, change password). Null reads as "unknown" and
--     no policy acts on a null.
--
-- No existing row is read or written, no backfill. APPLY THIS BEFORE THE
-- CODE: the new release writes both columns on signup, join and reset, so
-- until this file lands those three writes fail with a 500 (nothing is
-- half written: each is one statement or one transaction). The running
-- release never names either column, so applying it early is safe.
--
-- Idempotent: every statement is guarded, so running this file twice is a
-- no-op.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Stage D (workspace settings): WHO DID IT, ON EVERY AUDIT ROW.
--
--   * "ActivityLog"."actorType": what kind of actor wrote the row: 'user'
--     (a person, every row before this release), 'api_key', 'agent',
--     'system', 'scim' or 'platform_staff' (a WorkwrK staff change from the
--     Staff console). NOT NULL with a constant default, so every existing
--     row reads 'user' without a rewrite (Postgres 11+ stores the default in
--     the catalogue; no table rewrite, no lock beyond the brief ALTER).
--   * "ActivityLog"."actorLabel": the name shown when the actor is not a
--     person ("WorkwrK Support", "API key wk_ab12"). Null for people.
--   * "ActivityLog"."actingForId": the person a key or an agent acted as.
--   * "ActivityLog"."actorId" becomes NULLABLE: a WorkwrK staff row names no
--     user of the customer's organisation (src/lib/staff-audit.ts held those
--     rows until this column set existed). Relaxing NOT NULL rewrites
--     nothing and loses nothing; every existing row keeps its actor.
--
-- Rollback (only if the release is rolled back AND no staff row was
-- written): DELETE the rows WHERE "actorId" IS NULL, then
-- ALTER COLUMN "actorId" SET NOT NULL. The three new columns can stay.

ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actorType" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actorLabel" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actingForId" TEXT;
ALTER TABLE "ActivityLog" ALTER COLUMN "actorId" DROP NOT NULL;
