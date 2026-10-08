-- 2026-10-08 AI teammates, Phase 3 (docs/plans/ai-teammates-phase3.md).
--
-- Connectors: one person's own Google account (Gmail, Google Calendar)
-- connected to their AI teammates in one workspace. Additive and idempotent:
-- it runs on every deploy (scripts/deploy-migrations.mjs SQL_MANIFEST) under
-- its lock timeout.
--
-- EXISTING ROWS ARE UNCHANGED. Four new tables, and two defaulted columns on
-- "AgentPersonSetting" whose default allows nothing. No CHECK is widened.
--
-- FOREIGN KEYS. A connection and a connect in flight go with the person's
-- account and with the workspace (ON DELETE CASCADE). Leaving a workspace
-- through a second membership has no row to cascade from, so the code ends
-- the connection (src/lib/connectors/connections.ts removeConnections) and
-- the cron sweeps any it missed. The revocation queue has no foreign key on
-- purpose: it outlives the person and the workspace until Google is told,
-- and it names neither.
--
-- TOKENS ARE SEALED (src/lib/connectors/seal.ts over src/lib/secrets-crypto.ts),
-- stored as the JSON blob OrgSecret uses, so scripts/rotate-secrets-key.ts
-- moves them too.
--
-- NO BACKFILL.

-- ── TeammateConnectorPolicy: what a workspace lets people connect ──
CREATE TABLE IF NOT EXISTS "TeammateConnectorPolicy" (
  "organizationId" TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "products"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeammateConnectorPolicy_pkey" PRIMARY KEY ("organizationId", "provider")
);

-- ── TeammateConnection: one person's Google, in one workspace ──────
CREATE TABLE IF NOT EXISTS "TeammateConnection" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "provider"             TEXT NOT NULL,
  "status"               TEXT NOT NULL DEFAULT 'active',
  "statusReason"         TEXT,
  "products"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "scopes"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "accountSub"           TEXT NOT NULL,
  "accountEmail"         TEXT NOT NULL,
  "refreshTokenSealed"   JSONB NOT NULL,
  "accessTokenSealed"    JSONB,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "tokenVersion"         INTEGER NOT NULL DEFAULT 1,
  "connectedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"           TIMESTAMP(3),
  "lastUsedAgentId"      TEXT,
  "needsReconnectAt"     TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeammateConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeammateConnection_organizationId_userId_provider_key"
  ON "TeammateConnection" ("organizationId", "userId", "provider");
CREATE INDEX IF NOT EXISTS "TeammateConnection_organizationId_status_idx" ON "TeammateConnection" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "TeammateConnection_userId_idx" ON "TeammateConnection" ("userId");
CREATE INDEX IF NOT EXISTS "TeammateConnection_provider_accountSub_idx" ON "TeammateConnection" ("provider", "accountSub");

-- ── TeammateOAuthState: a connect in flight, used once ─────────────
CREATE TABLE IF NOT EXISTS "TeammateOAuthState" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "products"       TEXT[] NOT NULL,
  "verifierSealed" JSONB NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeammateOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TeammateOAuthState_expiresAt_idx" ON "TeammateOAuthState" ("expiresAt");
CREATE INDEX IF NOT EXISTS "TeammateOAuthState_userId_idx" ON "TeammateOAuthState" ("userId");

-- ── TeammateTokenRevocation: tokens Google must still be told about ─
CREATE TABLE IF NOT EXISTS "TeammateTokenRevocation" (
  "id"            TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "tokenSealed"   JSONB NOT NULL,
  "reason"        TEXT NOT NULL,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeammateTokenRevocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TeammateTokenRevocation_nextAttemptAt_idx" ON "TeammateTokenRevocation" ("nextAttemptAt");

-- ── AgentPersonSetting: what this person lets this teammate use ────
ALTER TABLE "AgentPersonSetting" ADD COLUMN IF NOT EXISTS "connectorProducts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentPersonSetting" ADD COLUMN IF NOT EXISTS "connectorPrints" JSONB;

-- ── Foreign keys and value checks (catalogue-guarded) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateConnectorPolicy_organizationId_fkey') THEN
    ALTER TABLE "TeammateConnectorPolicy" ADD CONSTRAINT "TeammateConnectorPolicy_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateConnection_organizationId_fkey') THEN
    ALTER TABLE "TeammateConnection" ADD CONSTRAINT "TeammateConnection_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateConnection_userId_fkey') THEN
    ALTER TABLE "TeammateConnection" ADD CONSTRAINT "TeammateConnection_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateOAuthState_organizationId_fkey') THEN
    ALTER TABLE "TeammateOAuthState" ADD CONSTRAINT "TeammateOAuthState_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateOAuthState_userId_fkey') THEN
    ALTER TABLE "TeammateOAuthState" ADD CONSTRAINT "TeammateOAuthState_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateConnectorPolicy_values_check') THEN
    ALTER TABLE "TeammateConnectorPolicy" ADD CONSTRAINT "TeammateConnectorPolicy_values_check" CHECK (
      "provider" IN ('google') AND "products" <@ ARRAY['gmail', 'calendar']::TEXT[]
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateConnection_values_check') THEN
    ALTER TABLE "TeammateConnection" ADD CONSTRAINT "TeammateConnection_values_check" CHECK (
      "provider" IN ('google')
      AND "status" IN ('active', 'needs_reconnect')
      AND ("statusReason" IS NULL OR "statusReason" IN ('revoked', 'scopes_missing'))
      AND "products" <@ ARRAY['gmail', 'calendar']::TEXT[]
      AND cardinality("products") >= 1
      AND "tokenVersion" >= 1
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateOAuthState_values_check') THEN
    ALTER TABLE "TeammateOAuthState" ADD CONSTRAINT "TeammateOAuthState_values_check" CHECK (
      "provider" IN ('google') AND "products" <@ ARRAY['gmail', 'calendar']::TEXT[] AND cardinality("products") >= 1
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeammateTokenRevocation_values_check') THEN
    ALTER TABLE "TeammateTokenRevocation" ADD CONSTRAINT "TeammateTokenRevocation_values_check" CHECK (
      "provider" IN ('google')
      AND "reason" IN ('disconnected', 'replaced', 'left', 'deactivated', 'admin_all', 'workspace_deleted', 'no_access', 'sweep')
      AND "attempts" >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentPersonSetting_connector_check') THEN
    ALTER TABLE "AgentPersonSetting" ADD CONSTRAINT "AgentPersonSetting_connector_check"
      CHECK ("connectorProducts" <@ ARRAY['gmail', 'calendar']::TEXT[]) NOT VALID;
  END IF;
END
$$;
