/* 2026-10-21 The WorkwrK MCP server (docs/plans/mcp-server.md section 5).
   Seven new tables: the workspace switch, OAuth clients, pending
   authorization requests, grants (one live per person, app and workspace),
   codes, tokens, and daily usage. Every token, code and secret is stored only
   as its SHA-256 hex. Additive and idempotent; every statement after the
   CREATE TABLEs is catalogue-guarded. EXISTING ROWS ARE UNCHANGED. NO BACKFILL.
   Before the reload: the new build reads "McpPolicy" for Settings.
   Rollback: DROP TABLE IF EXISTS "McpUsageDay", "OAuthToken",
   "OAuthAuthorizationCode", "OAuthGrant", "OAuthAuthorizationRequest",
   "OAuthClient", "McpPolicy"; */

CREATE TABLE IF NOT EXISTS "McpPolicy" (
  "organizationId" TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "allowedApps"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "McpPolicy_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE IF NOT EXISTS "OAuthClient" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL DEFAULT '',
  "redirectUris"   TEXT[] NOT NULL,
  "grantTypes"     TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token']::TEXT[],
  "authMethod"     TEXT NOT NULL,
  "secretHash"     TEXT,
  "disabledAt"     TIMESTAMP(3),
  "disabledReason" TEXT,
  "lastUsedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OAuthAuthorizationRequest" (
  "id"            TEXT NOT NULL,
  "clientId"      TEXT NOT NULL,
  "redirectUri"   TEXT NOT NULL,
  "scopes"        TEXT[] NOT NULL,
  "state"         TEXT,
  "codeChallenge" TEXT NOT NULL,
  "resource"      TEXT NOT NULL,
  "viewerId"      TEXT,
  "csrfHash"      TEXT,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "OAuthAuthorizationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OAuthGrant" (
  "id"             TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "scopes"         TEXT[] NOT NULL,
  "appName"        TEXT NOT NULL,
  "redirectHost"   TEXT NOT NULL,
  "familyId"       TEXT NOT NULL,
  "tokenVersion"   INTEGER NOT NULL,
  "authorizedAt"   TIMESTAMP(3) NOT NULL,
  "endsBy"         TIMESTAMP(3) NOT NULL,
  "lastUsedAt"     TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "revokedReason"  TEXT,
  "revokedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "OAuthGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OAuthAuthorizationCode" (
  "id"            TEXT NOT NULL,
  "grantId"       TEXT NOT NULL,
  "clientId"      TEXT NOT NULL,
  "redirectUri"   TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "resource"      TEXT NOT NULL,
  "familyId"      TEXT NOT NULL,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "usedAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OAuthToken" (
  "id"        TEXT NOT NULL,
  "grantId"   TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "familyId"  TEXT NOT NULL,
  "parentId"  TEXT,
  "scopes"    TEXT[] NOT NULL,
  "resource"  TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "McpUsageDay" (
  "grantId"        TEXT NOT NULL,
  "day"            TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "calls"          INTEGER NOT NULL DEFAULT 0,
  "writes"         INTEGER NOT NULL DEFAULT 0,
  "refused"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "McpUsageDay_pkey" PRIMARY KEY ("grantId", "day")
);

DO $$
BEGIN
  /* One unrevoked grant per person, app and workspace. SQL only: Prisma cannot express a partial index. */
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthGrant_one_live') THEN
    CREATE UNIQUE INDEX "OAuthGrant_one_live" ON "OAuthGrant" ("clientId", "userId", "organizationId") WHERE "revokedAt" IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthGrant_userId_idx') THEN
    CREATE INDEX "OAuthGrant_userId_idx" ON "OAuthGrant" ("userId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthGrant_organizationId_revokedAt_idx') THEN
    CREATE INDEX "OAuthGrant_organizationId_revokedAt_idx" ON "OAuthGrant" ("organizationId", "revokedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthGrant_clientId_idx') THEN
    CREATE INDEX "OAuthGrant_clientId_idx" ON "OAuthGrant" ("clientId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthGrant_endsBy_idx') THEN
    CREATE INDEX "OAuthGrant_endsBy_idx" ON "OAuthGrant" ("endsBy");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthToken_grantId_kind_idx') THEN
    CREATE INDEX "OAuthToken_grantId_kind_idx" ON "OAuthToken" ("grantId", "kind");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthToken_familyId_idx') THEN
    CREATE INDEX "OAuthToken_familyId_idx" ON "OAuthToken" ("familyId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthToken_expiresAt_idx') THEN
    CREATE INDEX "OAuthToken_expiresAt_idx" ON "OAuthToken" ("expiresAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthAuthorizationCode_grantId_idx') THEN
    CREATE INDEX "OAuthAuthorizationCode_grantId_idx" ON "OAuthAuthorizationCode" ("grantId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthAuthorizationCode_expiresAt_idx') THEN
    CREATE INDEX "OAuthAuthorizationCode_expiresAt_idx" ON "OAuthAuthorizationCode" ("expiresAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthAuthorizationRequest_expiresAt_idx') THEN
    CREATE INDEX "OAuthAuthorizationRequest_expiresAt_idx" ON "OAuthAuthorizationRequest" ("expiresAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthAuthorizationRequest_clientId_idx') THEN
    CREATE INDEX "OAuthAuthorizationRequest_clientId_idx" ON "OAuthAuthorizationRequest" ("clientId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthAuthorizationRequest_viewerId_idx') THEN
    CREATE INDEX "OAuthAuthorizationRequest_viewerId_idx" ON "OAuthAuthorizationRequest" ("viewerId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OAuthClient_createdAt_idx') THEN
    CREATE INDEX "OAuthClient_createdAt_idx" ON "OAuthClient" ("createdAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'McpUsageDay_organizationId_day_idx') THEN
    CREATE INDEX "McpUsageDay_organizationId_day_idx" ON "McpUsageDay" ("organizationId", "day");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'McpUsageDay_userId_idx') THEN
    CREATE INDEX "McpUsageDay_userId_idx" ON "McpUsageDay" ("userId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'McpUsageDay_day_idx') THEN
    CREATE INDEX "McpUsageDay_day_idx" ON "McpUsageDay" ("day");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpPolicy_organizationId_fkey') THEN
    ALTER TABLE "McpPolicy" ADD CONSTRAINT "McpPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthAuthorizationRequest_clientId_fkey') THEN
    ALTER TABLE "OAuthAuthorizationRequest" ADD CONSTRAINT "OAuthAuthorizationRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthGrant_clientId_fkey') THEN
    ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthGrant_organizationId_fkey') THEN
    ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthGrant_userId_fkey') THEN
    ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthAuthorizationCode_grantId_fkey') THEN
    ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthToken_grantId_fkey') THEN
    ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpUsageDay_grantId_fkey') THEN
    ALTER TABLE "McpUsageDay" ADD CONSTRAINT "McpUsageDay_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpPolicy_values_check') THEN
    ALTER TABLE "McpPolicy" ADD CONSTRAINT "McpPolicy_values_check" CHECK (cardinality("allowedApps") <= 50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthClient_values_check') THEN
    ALTER TABLE "OAuthClient" ADD CONSTRAINT "OAuthClient_values_check" CHECK (
      "authMethod" IN ('none', 'client_secret_post', 'client_secret_basic')
      AND (("authMethod" = 'none') = ("secretHash" IS NULL))
      AND cardinality("redirectUris") BETWEEN 1 AND 5
      AND char_length("name") <= 60
      AND "grantTypes" <@ ARRAY['authorization_code', 'refresh_token']::TEXT[]
      AND 'authorization_code' = ANY("grantTypes")
      AND ("disabledReason" IS NULL OR "disabledReason" IN ('staff', 'abuse')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthAuthorizationRequest_values_check') THEN
    ALTER TABLE "OAuthAuthorizationRequest" ADD CONSTRAINT "OAuthAuthorizationRequest_values_check" CHECK (
      char_length("codeChallenge") = 43 AND ("state" IS NULL OR char_length("state") <= 4096)
      AND char_length("redirectUri") <= 2000 AND cardinality("scopes") BETWEEN 1 AND 2
      AND "scopes" <@ ARRAY['mcp:read', 'mcp:write']::TEXT[] AND "expiresAt" > "createdAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthGrant_values_check') THEN
    ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_values_check" CHECK (
      "scopes" <@ ARRAY['mcp:read', 'mcp:write']::TEXT[] AND 'mcp:read' = ANY("scopes")
      AND char_length("appName") BETWEEN 1 AND 60 AND char_length("redirectHost") BETWEEN 1 AND 255
      AND "tokenVersion" >= 0 AND "endsBy" > "authorizedAt"
      AND ("revokedAt" IS NULL) = ("revokedReason" IS NULL)
      AND ("revokedReason" IS NULL OR "revokedReason" IN ('person', 'client_revoked', 'admin_off', 'app_not_allowed',
           'left', 'deactivated', 'no_access', 'workspace_closed', 'sessions_ended', 'password_changed',
           'signed_out_everyone', 'expired', 'reuse_detected', 'code_reuse', 'client_disabled')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthAuthorizationCode_values_check') THEN
    ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_values_check" CHECK (char_length("codeChallenge") = 43 AND "expiresAt" > "createdAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OAuthToken_values_check') THEN
    ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_values_check" CHECK (
      "kind" IN ('access', 'refresh') AND "expiresAt" > "createdAt"
      AND "scopes" <@ ARRAY['mcp:read', 'mcp:write']::TEXT[] AND ("kind" = 'refresh' OR "usedAt" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpUsageDay_values_check') THEN
    ALTER TABLE "McpUsageDay" ADD CONSTRAINT "McpUsageDay_values_check" CHECK ("day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "calls" >= 0 AND "writes" >= 0 AND "refused" >= 0);
  END IF;
END
$$;
