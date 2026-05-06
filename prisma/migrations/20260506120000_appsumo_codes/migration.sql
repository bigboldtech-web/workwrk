-- AppSumo lifetime-deal redemption codes
--
-- New table only. No existing rows touched.
-- AppSumo customers redeem on a /redeem page, which sets their
-- Organization.Subscription plan from the code's tier.

CREATE TABLE IF NOT EXISTS "AppsumoCode" (
  "id"            TEXT PRIMARY KEY,
  "code"          TEXT NOT NULL,
  "tier"          INTEGER NOT NULL,
  "plan"          "Plan" NOT NULL,
  "seats"         INTEGER NOT NULL,
  "redeemedById"  TEXT,
  "redeemedByOrg" TEXT,
  "redeemedAt"    TIMESTAMP(3),
  "refundedAt"    TIMESTAMP(3),
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppsumoCode_code_key" ON "AppsumoCode"("code");
CREATE INDEX IF NOT EXISTS "AppsumoCode_redeemedByOrg_idx" ON "AppsumoCode"("redeemedByOrg");
CREATE INDEX IF NOT EXISTS "AppsumoCode_redeemedAt_idx" ON "AppsumoCode"("redeemedAt");
