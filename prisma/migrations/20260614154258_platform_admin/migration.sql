-- Platform-staff allowlist for the cross-tenant back-office (admin.workwrk.com).
-- Separate from tenant roles so a customer's SUPER_ADMIN can't reach it.
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- Seed the founding WorkwrK account. Idempotent so re-running is safe.
INSERT INTO "PlatformAdmin" ("id", "email", "name")
VALUES ('platformadmin_founder', 'bigboldtech@gmail.com', 'Founder')
ON CONFLICT ("email") DO NOTHING;
