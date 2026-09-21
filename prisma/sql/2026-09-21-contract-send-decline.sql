-- Phase 3 (process unit), spec-process section 2 `/agreements/[id]` and `/sign/[token]`:
--   Agreement.signingOrder / sendMessage / sentAt / voidedAt
--     the Send for signature options (parties sign one after another, the
--     note in the email), when it was sent, when it was voided
--   AgreementParty.declinedAt / declineReason / viewedAt
--     the Decline evidence and the first-open stamp
-- Additive and idempotent. Nothing is renamed, retyped, dropped or required.

ALTER TABLE "Agreement" ADD COLUMN IF NOT EXISTS "signingOrder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agreement" ADD COLUMN IF NOT EXISTS "sendMessage" TEXT;
ALTER TABLE "Agreement" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "Agreement" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);

ALTER TABLE "AgreementParty" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);
ALTER TABLE "AgreementParty" ADD COLUMN IF NOT EXISTS "declineReason" TEXT;
ALTER TABLE "AgreementParty" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);

-- AgreementParty.userAgent: the signer's browser beside the IP, so a signature
-- carries the same evidence pair a policy acknowledgement does.
ALTER TABLE "AgreementParty" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
