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
