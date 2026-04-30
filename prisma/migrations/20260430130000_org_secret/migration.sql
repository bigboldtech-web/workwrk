-- BYOK — per-org encrypted credentials (Phase B1)
--
-- Strictly additive. New table only. No existing rows touched.

CREATE TABLE IF NOT EXISTS "OrgSecret" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "encryptedKey"   JSONB NOT NULL,
  "keyHint"        TEXT,
  "lastUsedAt"     TIMESTAMP(3),
  "preferredModel" TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrgSecret_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgSecret_org_provider_key"
  ON "OrgSecret"("organizationId", "provider");
CREATE INDEX IF NOT EXISTS "OrgSecret_organizationId_idx"
  ON "OrgSecret"("organizationId");
