/* 2026-10-27 Recurring goals (docs/plans/recurring-goals.md section 3, File 1).
   A goal is One time (repeat NULL, as every goal today) or Repeating (repeat
   WEEKLY, MONTHLY, QUARTERLY or YEARLY, no due date). Two new tables:
   "GoalPeriod" (one row per goal per period, frozen with its result at the
   close) and "KeyResultPeriod" (one row per target per period). New nullable
   columns: "OKR"."repeat" and "repeatUntil"; "KeyResult"."source",
   "sourceById", "sourceRefreshedAt", "sourcePausedReason" and "periodStart";
   "KRCheckIn"."periodId". Additive and idempotent.
   EXISTING ROWS ARE UNCHANGED: every existing goal stays one time (repeat
   NULL), no period is created for it, every check-in keeps periodId NULL.
   NO BACKFILL.
   APPLY THIS FILE BEFORE THE CODE: the new client selects every scalar on a
   findMany with no select, and "OKR", "KeyResult" and "KRCheckIn" are read
   that way.
   CATALOGUE-GUARDED. Each column is added only when pg_attribute says it is
   missing, and each index, key and check only when pg_indexes or
   pg_constraint says so, so a deploy after the first takes no lock (an
   unguarded ADD COLUMN IF NOT EXISTS takes the table's ACCESS EXCLUSIVE
   lock before it looks). The first apply takes ACCESS EXCLUSIVE on "OKR",
   "KeyResult" and "KRCheckIn" for the new columns and the "OKR" check, and
   SHARE ROW EXCLUSIVE on them for the keys, held to the end of this file;
   the three tables are small and every new column is NULL, so no rewrite.
   No key to "User" (sourceById is a bare id), so no lock on it.
   Rollback: drop the two new tables, the "OKR_repeat_check" constraint and
   the eight new columns. */

DO $$
BEGIN
  /* One time (NULL) or how often the goal starts fresh. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OKR"'::regclass AND attname = 'repeat' AND NOT attisdropped) THEN
    ALTER TABLE "OKR" ADD COLUMN IF NOT EXISTS "repeat" TEXT;
  END IF;
  /* The last day a repeating goal runs, a yyyy-mm-dd key in the workspace zone, or NULL. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OKR"'::regclass AND attname = 'repeatUntil' AND NOT attisdropped) THEN
    ALTER TABLE "OKR" ADD COLUMN IF NOT EXISTS "repeatUntil" TEXT;
  END IF;
  /* What counts the target: a List, Space or table (C2); NULL is check-ins or the KPI link. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResult"'::regclass AND attname = 'source' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "source" JSONB;
  END IF;
  /* The person whose access counts the source (C8). */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResult"'::regclass AND attname = 'sourceById' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourceById" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResult"'::regclass AND attname = 'sourceRefreshedAt' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourceRefreshedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResult"'::regclass AND attname = 'sourcePausedReason' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourcePausedReason" TEXT;
  END IF;
  /* Each period starts at the start value or at last period's number (B4). */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KeyResult"'::regclass AND attname = 'periodStart' AND NOT attisdropped) THEN
    ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "periodStart" TEXT;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "GoalPeriod" (
  "id"             TEXT NOT NULL,
  "okrId"          TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "cadence"        TEXT NOT NULL,
  "startsAt"       TIMESTAMP(3) NOT NULL,
  "endsAt"         TIMESTAMP(3) NOT NULL,
  "trackedFrom"    TIMESTAMP(3) NOT NULL,
  "graceEndsAt"    TIMESTAMP(3) NOT NULL,
  "closesAt"       TIMESTAMP(3) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "progress"       INTEGER,
  "attainment"     INTEGER,
  "result"         TEXT,
  "scored"         BOOLEAN,
  "closedAt"       TIMESTAMP(3),
  "scorePatchedAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "GoalPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KeyResultPeriod" (
  "id"              TEXT NOT NULL,
  "keyResultId"     TEXT,
  "periodId"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "unit"            TEXT,
  "startValue"      DOUBLE PRECISION NOT NULL,
  "targetValue"     DOUBLE PRECISION NOT NULL,
  "currentValue"    DOUBLE PRECISION,
  "progress"        INTEGER,
  "carried"         BOOLEAN NOT NULL DEFAULT false,
  "frozenAt"        TIMESTAMP(3),
  "refreshedAt"     TIMESTAMP(3),
  "sourceSig"       TEXT,
  "sourceListCount" INTEGER,
  "pausedSince"     TIMESTAMP(3),
  "pausedReason"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "KeyResultPeriod_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  /* Which period a check-in counted toward; NULL for one-time goals and every existing row. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"KRCheckIn"'::regclass AND attname = 'periodId' AND NOT attisdropped) THEN
    ALTER TABLE "KRCheckIn" ADD COLUMN IF NOT EXISTS "periodId" TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'GoalPeriod_okrId_key_key') THEN
    CREATE UNIQUE INDEX "GoalPeriod_okrId_key_key" ON "GoalPeriod" ("okrId", "key");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'GoalPeriod_okrId_startsAt_idx') THEN
    CREATE INDEX "GoalPeriod_okrId_startsAt_idx" ON "GoalPeriod" ("okrId", "startsAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'GoalPeriod_status_closesAt_idx') THEN
    CREATE INDEX "GoalPeriod_status_closesAt_idx" ON "GoalPeriod" ("status", "closesAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'GoalPeriod_organizationId_idx') THEN
    CREATE INDEX "GoalPeriod_organizationId_idx" ON "GoalPeriod" ("organizationId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'KeyResultPeriod_keyResultId_periodId_key') THEN
    CREATE UNIQUE INDEX "KeyResultPeriod_keyResultId_periodId_key" ON "KeyResultPeriod" ("keyResultId", "periodId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'KeyResultPeriod_periodId_idx') THEN
    CREATE INDEX "KeyResultPeriod_periodId_idx" ON "KeyResultPeriod" ("periodId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'KRCheckIn_periodId_idx') THEN
    CREATE INDEX "KRCheckIn_periodId_idx" ON "KRCheckIn" ("periodId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'OKR_repeat_idx') THEN
    CREATE INDEX "OKR_repeat_idx" ON "OKR" ("repeat");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalPeriod_okrId_fkey') THEN
    ALTER TABLE "GoalPeriod" ADD CONSTRAINT "GoalPeriod_okrId_fkey" FOREIGN KEY ("okrId") REFERENCES "OKR"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  /* SET NULL, so a closed period keeps a deleted target's row (its copied title and unit keep it readable). */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyResultPeriod_keyResultId_fkey') THEN
    ALTER TABLE "KeyResultPeriod" ADD CONSTRAINT "KeyResultPeriod_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyResultPeriod_periodId_fkey') THEN
    ALTER TABLE "KeyResultPeriod" ADD CONSTRAINT "KeyResultPeriod_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "GoalPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KRCheckIn_periodId_fkey') THEN
    ALTER TABLE "KRCheckIn" ADD CONSTRAINT "KRCheckIn_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "GoalPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  /* The values src/lib/goals/goal-period.ts writes. Every existing row holds NULL, so none can fail it. */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OKR_repeat_check') THEN
    ALTER TABLE "OKR" ADD CONSTRAINT "OKR_repeat_check" CHECK (
      ("repeat" IS NULL OR "repeat" IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'))
      AND ("repeatUntil" IS NULL OR "repeatUntil" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalPeriod_values_check') THEN
    ALTER TABLE "GoalPeriod" ADD CONSTRAINT "GoalPeriod_values_check" CHECK (
      "key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND "cadence" IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')
      AND "status" IN ('OPEN', 'CLOSED')
      AND ("status" = 'CLOSED') = ("closedAt" IS NOT NULL)
      AND ("result" IS NULL OR "result" IN ('HIT', 'PARTLY_HIT', 'MISSED', 'NOT_MEASURED'))
      AND ("progress" IS NULL OR "progress" BETWEEN 0 AND 100)
      AND "endsAt" > "startsAt" AND "trackedFrom" >= "startsAt"
      AND "graceEndsAt" >= "endsAt" AND "closesAt" >= "graceEndsAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeyResultPeriod_values_check') THEN
    ALTER TABLE "KeyResultPeriod" ADD CONSTRAINT "KeyResultPeriod_values_check" CHECK ("progress" IS NULL OR "progress" BETWEEN 0 AND 100);
  END IF;
END
$$;
