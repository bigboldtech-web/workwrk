-- Goals rebuild Phase 3: collapse the second goal model.
--
-- DepartmentGoal was a parallel goal system that never talked to OKRs.
-- This migration folds every DepartmentGoal row into the OKR table
-- (level = DEPARTMENT, one GoalAssignee row targeting the department,
-- and a KeyResult carrying targetValue/currentValue/unit so the number
-- is not lost), then RENAMES the table to "_archived_DepartmentGoal".
--
-- WHY RENAME, NOT DROP: production data cannot be inspected from dev.
-- The rename completes the collapse (nothing reads the table any more,
-- the Prisma model is gone) while staying reversible. FOLLOW-UP: once
-- production is confirmed migrated (row count of _archived_DepartmentGoal
-- equals the count of OKRs whose id starts with 'deptgoal_'), a later
-- migration drops "_archived_DepartmentGoal" and the then-unused
-- "GoalStatus" enum type. Tracked in docs/plans/goals-rebuild.md (Phase 3).
--
-- IDEMPOTENCY / PROVENANCE: every generated row carries a deterministic
-- id derived from the source row —
--     OKR          id = 'deptgoal_'   || DepartmentGoal.id
--     KeyResult    id = 'deptgoalkr_' || DepartmentGoal.id
--     GoalAssignee id = 'deptgoalga_' || DepartmentGoal.id
-- so provenance is queryable forever and a re-run cannot double-insert:
-- every INSERT is ON CONFLICT DO NOTHING (targetless, so it absorbs PK
-- collisions AND the partial-unique (okrId, departmentId) index on
-- GoalAssignee). The whole body sits inside one plpgsql block guarded
-- by to_regclass('"DepartmentGoal"'): plpgsql resolves table references
-- only when a statement actually executes, so once the table has been
-- renamed the entire migration is a clean no-op instead of an error.
-- Running this file any number of times converges on the same state.
--
-- STATUS MAPPING (GoalStatus enum -> OKR.status text vocabulary):
--     ON_TRACK -> ON_TRACK, AT_RISK -> AT_RISK,
--     OFF_TRACK -> BEHIND, COMPLETED -> COMPLETED.
--
-- KEY-RESULT RULE: a KR is created only when there is a number to keep
-- (targetValue set, or a non-zero currentValue). When targetValue is
-- NULL but currentValue isn't zero, currentValue doubles as the target
-- so the reading survives even though it renders as met.

DO $$
BEGIN
  IF to_regclass('"DepartmentGoal"') IS NOT NULL THEN

    -- 1) DepartmentGoal -> OKR. organizationId comes from the row's
    --    Department (the FK guarantees the join hits). No owner existed
    --    on DepartmentGoal, so ownerId stays NULL; departmentId carries
    --    over onto the real FK from the goal_audience_kra_weight
    --    migration.
    INSERT INTO "OKR"
      ("id", "title", "description", "level", "status", "progress",
       "startDate", "endDate", "quarter", "checkInCadence", "ownerId",
       "departmentId", "parentId", "position", "organizationId",
       "createdAt", "updatedAt")
    SELECT
      'deptgoal_' || dg."id",
      dg."title",
      dg."description",
      'DEPARTMENT'::"GoalLevel",
      CASE dg."status"::text WHEN 'OFF_TRACK' THEN 'BEHIND' ELSE dg."status"::text END,
      CASE
        WHEN dg."status"::text = 'COMPLETED' THEN 100
        WHEN dg."targetValue" IS NOT NULL AND dg."targetValue" > 0
             AND dg."currentValue" IS NOT NULL
          THEN LEAST(100, GREATEST(0, ROUND(dg."currentValue" / dg."targetValue" * 100)))::int
        ELSE 0
      END,
      NULL,          -- DepartmentGoal never had a start date; don't invent one
      dg."deadline", -- deadline -> endDate
      NULL,
      'WEEKLY',
      NULL,
      dg."departmentId",
      NULL,
      0,
      d."organizationId",
      dg."createdAt",
      dg."updatedAt"
    FROM "DepartmentGoal" dg
    JOIN "Department" d ON d."id" = dg."departmentId"
    ON CONFLICT DO NOTHING;

    -- 2) Carry the metric onto a KeyResult so targetValue/currentValue/
    --    unit are not lost. Joined on the migrated OKR id so a KR can
    --    never be orphaned even on partial re-runs.
    INSERT INTO "KeyResult"
      ("id", "title", "unit", "startValue", "targetValue", "currentValue",
       "progress", "kpiId", "okrId", "createdAt", "updatedAt")
    SELECT
      'deptgoalkr_' || dg."id",
      dg."title",
      dg."unit",
      0,
      COALESCE(dg."targetValue", dg."currentValue"),
      COALESCE(dg."currentValue", 0),
      CASE
        WHEN COALESCE(dg."targetValue", dg."currentValue") > 0
          THEN LEAST(100, GREATEST(0,
                 ROUND(COALESCE(dg."currentValue", 0)
                       / COALESCE(dg."targetValue", dg."currentValue") * 100)))::int
        ELSE 0
      END,
      NULL,
      o."id",
      dg."createdAt",
      dg."updatedAt"
    FROM "DepartmentGoal" dg
    JOIN "OKR" o ON o."id" = 'deptgoal_' || dg."id"
    WHERE dg."targetValue" IS NOT NULL
       OR COALESCE(dg."currentValue", 0) <> 0
    ON CONFLICT DO NOTHING;

    -- 3) Audience: one GoalAssignee row pointing at the department. The
    --    targetless ON CONFLICT also absorbs the partial unique index
    --    "GoalAssignee_okr_dept_key" in case the department was already
    --    assigned by hand between runs.
    INSERT INTO "GoalAssignee"
      ("id", "okrId", "userId", "departmentId", "roleId", "createdAt")
    SELECT
      'deptgoalga_' || dg."id",
      o."id",
      NULL,
      dg."departmentId",
      NULL,
      dg."createdAt"
    FROM "DepartmentGoal" dg
    JOIN "OKR" o ON o."id" = 'deptgoal_' || dg."id"
    ON CONFLICT DO NOTHING;

    -- 4) Archive the table (NOT a drop — see header). Keeps the FK to
    --    Department (cascade on department delete is fine: the data now
    --    lives on OKR). The pkey index is renamed too because index
    --    names are schema-wide in Postgres.
    IF to_regclass('"_archived_DepartmentGoal"') IS NULL THEN
      ALTER TABLE "DepartmentGoal" RENAME TO "_archived_DepartmentGoal";
      ALTER INDEX "DepartmentGoal_pkey" RENAME TO "_archived_DepartmentGoal_pkey";
      COMMENT ON TABLE "_archived_DepartmentGoal" IS
        'Collapsed into OKR by 20260812150000_collapse_department_goal. Rows were migrated to OKR ids ''deptgoal_''||id (+ deptgoalkr_/deptgoalga_ children). Safe to drop in a follow-up migration once production counts are confirmed.';
    END IF;

  END IF;
END $$;
