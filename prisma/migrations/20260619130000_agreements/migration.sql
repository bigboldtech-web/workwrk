-- Agreements e-signature: Agreement (envelope) + AgreementParty (recipients).
-- Purely additive: two new tables.

CREATE TABLE "Agreement" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "content"        TEXT NOT NULL DEFAULT '',
  "sourceType"     TEXT NOT NULL DEFAULT 'blocknote',
  "pdfUrl"         TEXT,
  "fields"         JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status"         TEXT NOT NULL DEFAULT 'DRAFT',
  "templateId"     TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Agreement_organizationId_idx" ON "Agreement"("organizationId");
CREATE INDEX "Agreement_status_idx" ON "Agreement"("status");

CREATE TABLE "AgreementParty" (
  "id"          TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "role"        TEXT NOT NULL DEFAULT 'SIGNER',
  "name"        TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "userId"      TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "token"       TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "values"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "signedAt"    TIMESTAMP(3),
  "ipAddress"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgreementParty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgreementParty_token_key" ON "AgreementParty"("token");
CREATE INDEX "AgreementParty_agreementId_idx" ON "AgreementParty"("agreementId");
CREATE INDEX "AgreementParty_token_idx" ON "AgreementParty"("token");
ALTER TABLE "AgreementParty" ADD CONSTRAINT "AgreementParty_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
