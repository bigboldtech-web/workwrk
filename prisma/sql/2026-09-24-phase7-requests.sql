-- 2026-09-24 - Phase 7 (AI, automation and add-ons), stage A: demand, counted.
--
-- Two new tables, nothing else. No existing table gains, loses, renames or
-- retypes a column, and no existing row is read or written by this file.
--
--   "IntegrationRequest"  one person asking for one connector on
--                         /integrations ("Request this"). Unique on
--                         (organizationId, key, userId), so the count on the
--                         card is a count of people, not of clicks.
--   "AppSuggestion"       "Suggest an app" on Marketplace (/store): a sentence
--                         about what somebody wants WorkwrK to do.
--
-- userId carries no foreign key on either table, like addedById elsewhere:
-- offboarding a person must never erase the demand they registered.
--
-- DEPLOY ORDER IS FREE. The only readers and writers are the new routes
-- (POST/GET /api/integrations/requests, POST/GET /api/marketplace/requests,
-- and GET /api/integrations joining the counts). Each one catches the
-- missing-relation error (42P01): the catalogue reads with zero counts and a
-- request answers a named 503, so no page breaks while the file is unapplied.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and each
-- foreign key guarded by a catalogue lookup. Running it twice is a no-op.

CREATE TABLE IF NOT EXISTS "IntegrationRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "note"           TEXT,
  "notify"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationRequest_organizationId_key_userId_key"
  ON "IntegrationRequest" ("organizationId", "key", "userId");
CREATE INDEX IF NOT EXISTS "IntegrationRequest_organizationId_key_idx"
  ON "IntegrationRequest" ("organizationId", "key");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IntegrationRequest_organizationId_fkey') THEN
    ALTER TABLE "IntegrationRequest"
      ADD CONSTRAINT "IntegrationRequest_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AppSuggestion" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "text"           TEXT NOT NULL,
  "notify"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AppSuggestion_organizationId_createdAt_idx"
  ON "AppSuggestion" ("organizationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AppSuggestion_organizationId_fkey') THEN
    ALTER TABLE "AppSuggestion"
      ADD CONSTRAINT "AppSuggestion_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
