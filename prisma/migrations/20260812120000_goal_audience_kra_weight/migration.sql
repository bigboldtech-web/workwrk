-- Goals rebuild, Phases 1 + 2 (docs/plans/goals-rebuild.md).
-- ADDITIVE ONLY: no DROP TABLE, no data loss. Every statement is
-- idempotent-safe so a partial/re-run cannot fail.
--
--  (1) GoalLevel enum; OKR.level String -> GoalLevel
--      (TEAM -> DEPARTMENT, anything unrecognised -> INDIVIDUAL)
--  (2) OKR.departmentId gains a real FK to Department
--      (orphaned ids are nulled first so the FK cannot fail)
--  (3) GoalAssignee: one row = one audience member (person, department
--      OR role). Partial unique indexes + CHECK because Postgres treats
--      NULLs as distinct, so plain UNIQUE cannot stop duplicates.
--  (4) KRA.weight: role-level default weightage.

-- ---------------------------------------------------------------
-- (1) GoalLevel enum
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GoalLevel') THEN
    CREATE TYPE "GoalLevel" AS ENUM ('COMPANY', 'DEPARTMENT', 'INDIVIDUAL');
  END IF;
END $$;

-- Map legacy loose strings BEFORE converting the column. ::text keeps
-- these re-runnable after the column is already the enum type.
UPDATE "OKR" SET "level" = 'DEPARTMENT' WHERE "level"::text = 'TEAM';
UPDATE "OKR" SET "level" = 'INDIVIDUAL'
  WHERE "level"::text NOT IN ('COMPANY', 'DEPARTMENT', 'INDIVIDUAL');

-- Convert the column. USING ::text::"GoalLevel" is a no-op when the
-- column is already "GoalLevel", so a re-run succeeds.
ALTER TABLE "OKR" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "OKR" ALTER COLUMN "level" TYPE "GoalLevel" USING ("level"::text::"GoalLevel");
ALTER TABLE "OKR" ALTER COLUMN "level" SET DEFAULT 'INDIVIDUAL'::"GoalLevel";

-- ---------------------------------------------------------------
-- (2) OKR.departmentId -> real FK to Department
-- ---------------------------------------------------------------
-- departmentId was a bare String; rows may hold ids that no longer
-- resolve. Null those out so adding the FK cannot fail. (Nulling a
-- dangling pointer loses nothing — it already pointed at nothing.)
UPDATE "OKR" o SET "departmentId" = NULL
  WHERE o."departmentId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Department" d WHERE d."id" = o."departmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OKR_departmentId_fkey') THEN
    ALTER TABLE "OKR" ADD CONSTRAINT "OKR_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "OKR_departmentId_idx" ON "OKR"("departmentId");

-- ---------------------------------------------------------------
-- (3) GoalAssignee
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "GoalAssignee" (
  "id"           TEXT NOT NULL,
  "okrId"        TEXT NOT NULL,
  "userId"       TEXT,
  "departmentId" TEXT,
  "roleId"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GoalAssignee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoalAssignee_okrId_idx" ON "GoalAssignee"("okrId");
CREATE INDEX IF NOT EXISTS "GoalAssignee_userId_idx" ON "GoalAssignee"("userId");
CREATE INDEX IF NOT EXISTS "GoalAssignee_departmentId_idx" ON "GoalAssignee"("departmentId");
CREATE INDEX IF NOT EXISTS "GoalAssignee_roleId_idx" ON "GoalAssignee"("roleId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAssignee_okrId_fkey') THEN
    ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_okrId_fkey"
      FOREIGN KEY ("okrId") REFERENCES "OKR"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAssignee_userId_fkey') THEN
    ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAssignee_departmentId_fkey') THEN
    ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAssignee_roleId_fkey') THEN
    ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Postgres treats NULLs as distinct, so a plain UNIQUE(okrId, userId)
-- would happily accept duplicate (okrId, NULL) rows. Partial unique
-- indexes per subject are the real dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS "GoalAssignee_okr_user_key"
  ON "GoalAssignee"("okrId", "userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "GoalAssignee_okr_dept_key"
  ON "GoalAssignee"("okrId", "departmentId") WHERE "departmentId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "GoalAssignee_okr_role_key"
  ON "GoalAssignee"("okrId", "roleId") WHERE "roleId" IS NOT NULL;

-- Exactly ONE subject per row — this CHECK is what guarantees a row
-- means exactly one thing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAssignee_one_subject') THEN
    ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_one_subject"
      CHECK (num_nonnulls("userId", "departmentId", "roleId") = 1);
  END IF;
END $$;

-- ---------------------------------------------------------------
-- (4) KRA.weight — role-level default weightage
-- ---------------------------------------------------------------
ALTER TABLE "KRA" ADD COLUMN IF NOT EXISTS "weight" DOUBLE PRECISION NOT NULL DEFAULT 0;
