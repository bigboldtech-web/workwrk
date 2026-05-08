-- Enterprise identity. SAML + SCIM scaffolding. SAML signing
-- verification needs `samlify` package (or equivalent) wired up
-- before /api/auth/saml/* is real — schema and config UI ship now
-- so the IT-side onboarding form is ready when the package lands.

CREATE TYPE "IdpType" AS ENUM ('SAML', 'OIDC');

CREATE TABLE "IdentityProvider" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type"           "IdpType" NOT NULL DEFAULT 'SAML',
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "issuer"         TEXT,
  "ssoUrl"         TEXT,
  "sloUrl"         TEXT,
  "certificate"    TEXT,
  "attributeMap"   JSONB NOT NULL DEFAULT '{"email":"NameID","firstName":"firstName","lastName":"lastName"}',
  "jitProvision"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityProvider_organizationId_type_key"
  ON "IdentityProvider"("organizationId", "type");
CREATE INDEX "IdentityProvider_organizationId_idx"
  ON "IdentityProvider"("organizationId");

ALTER TABLE "IdentityProvider"
  ADD CONSTRAINT "IdentityProvider_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScimToken" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "tokenHash"      TEXT NOT NULL,
  "tokenPrefix"    TEXT NOT NULL,
  "createdById"    TEXT,
  "lastUsedAt"     TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScimToken_tokenHash_key" ON "ScimToken"("tokenHash");
CREATE INDEX "ScimToken_organizationId_revokedAt_idx"
  ON "ScimToken"("organizationId", "revokedAt");

ALTER TABLE "ScimToken"
  ADD CONSTRAINT "ScimToken_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
