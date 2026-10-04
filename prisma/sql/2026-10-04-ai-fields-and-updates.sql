-- 2026-10-04 - Batch 8: AI fields in Lists, and scheduled AI updates in Talk.
--
-- "AiUsageDay": one workspace's AI use in one UTC day, by kind ("field_fill"
-- for Fill with AI on a List field). It is the daily guard rail on cost
-- (src/lib/ai-usage.ts claimAiUse): each use is claimed by ONE atomic
-- INSERT ... ON CONFLICT DO UPDATE that never takes the count past the day's
-- cap, so two people filling at once can never both slip past it. Nothing
-- else reads or writes it. Deleting a workspace deletes its rows.
--
-- ADDITIVE ONLY. New tables. No existing table gains, loses, renames or
-- retypes a column, and no existing row is read or written. The Prisma field
-- on "Organization" is a relation field with no column.
--
-- Apply it BEFORE the code: the new release claims a row on every fill and
-- answers "not ready" (nothing sent to the AI provider, nothing written)
-- until this table exists. Both opt-ins are off by default, so a workspace
-- that never turns them on never touches it.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS and every foreign key guarded by a
-- catalogue lookup. Running it twice is a no-op.

CREATE TABLE IF NOT EXISTS "AiUsageDay" (
  "organizationId" TEXT NOT NULL,
  "day"            DATE NOT NULL,
  "kind"           TEXT NOT NULL,
  "count"          INTEGER NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("organizationId", "day", "kind")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiUsageDay_organizationId_fkey'
  ) THEN
    ALTER TABLE "AiUsageDay"
      ADD CONSTRAINT "AiUsageDay_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
