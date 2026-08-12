# Goals rebuild + KRA weightage

Decided 2026-08-12. Supersedes the ad-hoc OKR shape.

## Why

Two things are broken, both structural rather than cosmetic.

**Goals cannot express their audience.** `OKR` has a single optional
`ownerId`, so "assign this to five people, or to the Dispatch team" is not
representable. `departmentId` is a bare `String` with no foreign key to
`Department`, so department goals are not actually linked to departments.
`level` is a loose string instead of an enum. There is no `Team` model at
all (teams are `Department` plus the manager report tree). And a second,
parallel goal model, `DepartmentGoal`, exists without ever talking to OKRs.

**KRA weightage cannot be set on a role.** Weight lives only on
`KRAAssignment.weightage`, i.e. per person. `KRA` has no weight field, so a
job title cannot carry "Exception resolution is worth 30%" for every holder.
Worse, `seedKraToRoleHolders` creates assignments without a weightage, so
every seeded KRA lands on the `0` default. That is why Rohit Mane shows five
KRAs at 0% and a header total of 0%. `PUT /api/kra-assignments/[id]` already
accepts and validates a weightage (1..100, total capped at 100), but the
Manage-alignment dialog renders the percentage as static text, so there is no
way to correct those zeros from the UI.

## Decisions

1. **Shared goal, one scoreboard.** A goal is ONE record with many
   assignees and a single progress bar. No per-person fan-out copies.
   Progress continues to come from Key Results, which already link to KPIs
   via `KeyResult.kpiId` (the one part of the current design that works).
2. **Owner stays singular.** `ownerId` remains the accountable person (the
   DRI). Assignees are contributors. One neck, many hands.
3. **Weight belongs to the role, with a per-person override.** The role's
   KRA carries the default; a person's assignment may deviate.
4. **Audience resolves at read time.** Assigning to a department or role
   stores the department/role, not a frozen list of people, so a new hire
   inherits their team's goals and a leaver stops counting.

---

## Phase 1 — goal audience

### Schema

```prisma
enum GoalLevel { COMPANY DEPARTMENT INDIVIDUAL }

model GoalAssignee {
  id           String      @id @default(cuid())
  okrId        String
  okr          OKR         @relation(fields: [okrId], references: [id], onDelete: Cascade)
  userId       String?
  user         User?       @relation(fields: [userId], references: [id], onDelete: Cascade)
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  roleId       String?
  role         Role?       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  createdAt    DateTime    @default(now())

  @@index([okrId])
  @@index([userId])
  @@index([departmentId])
  @@index([roleId])
}
```

On `OKR`: make `departmentId` a real relation to `Department`, and change
`level` from `String` to `GoalLevel`.

"Team" is not a separate model. A team is a `Department` (which already has
`parentId` for sub-departments), so assigning to a team is a department
assignment. A manager's report tree stays a *query*, via `getTeamUserIds`,
not a stored audience.

### Constraints Prisma cannot express

Postgres treats NULLs as distinct, so `@@unique([okrId, userId])` will NOT
stop duplicate `(okrId, NULL)` rows. Add these in raw SQL in the migration:

```sql
CREATE UNIQUE INDEX "GoalAssignee_okr_user_key"
  ON "GoalAssignee"("okrId","userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "GoalAssignee_okr_dept_key"
  ON "GoalAssignee"("okrId","departmentId") WHERE "departmentId" IS NOT NULL;
CREATE UNIQUE INDEX "GoalAssignee_okr_role_key"
  ON "GoalAssignee"("okrId","roleId") WHERE "roleId" IS NOT NULL;

ALTER TABLE "GoalAssignee" ADD CONSTRAINT "GoalAssignee_one_subject"
  CHECK (num_nonnulls("userId","departmentId","roleId") = 1);
```

The CHECK is what guarantees a row means exactly one thing.

### New lib

`src/lib/goal-audience.ts`

- `resolveGoalMembers(okrId): Promise<string[]>` — owner + direct users +
  members of assigned departments + holders of assigned roles, de-duped,
  ACTIVE and not soft-deleted only.
- `canSeeGoal(session, okr): boolean` — see Phase 4.

Leaver safety: filter on `status === "ACTIVE"` and `deletedAt: null`, the
same rule `seedKraToRoleHolders` uses, so removed people drop out of
audiences automatically.

### API

- `POST /api/okrs` and `PATCH /api/okrs/[id]` accept
  `assignees: [{ type: "USER"|"DEPARTMENT"|"ROLE", id: string }]`.
  Validate every id belongs to the caller's organization.
- `GET /api/okrs` returns resolved assignee summaries (avatars + counts),
  not raw join rows.
- `GET/POST/DELETE /api/okrs/[id]/assignees` for incremental edits.

### UI

- Goal create/edit modal: one multi-select picker mixing people,
  departments and roles (grouped sections, same pattern as the existing
  assignee picker).
- Goals list and goal detail: avatar stack with an overflow count.
- `/people/me`: show goals where I am a resolved member, not just goals I own.

---

## Phase 2 — KRA weightage

- Add `KRA.weight Float @default(0)` — the role-level default.
- `seedKraToRoleHolders` copies `KRA.weight` into
  `KRAAssignment.weightage` instead of leaving the `0` default. This is the
  actual fix for Rohit's five 0% rows.
- Inline weight editor in
  `src/app/(dashboard)/people/[id]/manage-alignment-dialog.tsx`, wired to the
  existing `PUT /api/kra-assignments/[id]`. Surface the over-100 validation
  the API already performs rather than letting the save fail silently.
- Role page: weight column plus a running total, so a job title's KRAs
  visibly sum to 100%.
- Backfill script (dry-run by default, JSON backup first, same shape as
  `scripts/reset-alignment.mjs`): existing `0` assignments adopt their KRA's
  role weight. Never overwrite a non-zero value someone set by hand.

---

## Phase 3 — collapse the second goal model  ✅ SHIPPED

`DepartmentGoal` folds into `OKR` with `level = DEPARTMENT` and a
`GoalAssignee` row pointing at the department. One goal concept, one place.

Shipped as migration `20260812150000_collapse_department_goal`. The data
move happens **inside the migration SQL** (same transaction as the
structural change — production applies it via `migrate deploy` with no
separate script to remember):

- Each `DepartmentGoal` row becomes an `OKR` with `level = DEPARTMENT`,
  `organizationId` from its `Department`, `deadline → endDate`, and status
  mapped `OFF_TRACK → BEHIND` (the rest map 1:1).
- `targetValue`/`currentValue`/`unit` are carried onto a `KeyResult`
  whenever there is a number to keep, so no metric is lost.
- A `GoalAssignee` row targets the department.
- Idempotent by construction: deterministic provenance ids
  (`deptgoal_`/`deptgoalkr_`/`deptgoalga_` + source id), targetless
  `ON CONFLICT DO NOTHING`, and the whole body guarded by
  `to_regclass` so any re-run is a no-op.
- The table is **renamed** to `_archived_DepartmentGoal`, NOT dropped —
  production data cannot be inspected from dev, and a rename is
  reversible. The Prisma model, the `GoalStatus` enum, the
  `Department.goals` relation and all code references are gone.

**FOLLOW-UP (do not forget):** once production is confirmed migrated
(`SELECT count(*) FROM "_archived_DepartmentGoal"` equals
`SELECT count(*) FROM "OKR" WHERE id LIKE 'deptgoal\_%'`), ship a
separate migration that drops `"_archived_DepartmentGoal"` and the
then-unused `"GoalStatus"` enum type.

---

## Phase 4 — visibility and rollup  ✅ SHIPPED

Reuse `src/lib/alignment-scope.ts` and `getTeamUserIds`. A goal is visible
when you own it, are a resolved member, or manage someone who is. COMPANY
goals are visible to everyone. Enforce in `src/lib/page-gates.ts` so the
three-door model (employee / manager / admin) holds for goals too.

Rollup: a parent goal's progress derives from its children; a leaf goal's
progress derives from its Key Results, which already derive from KPIs where
`KeyResult.kpiId` is set.

Shipped:

- **Pages gated server-side.** `requireGoalPage(okrId)` in
  `src/lib/page-gates.ts` guards `/okrs/[id]` through the ONE visibility
  implementation, `canSeeGoal` (`src/lib/goal-audience.ts`) — out-of-scope
  reads as `notFound()`, never a peek. `requireGoalsPage` gates `/okrs`
  (rows arrive three-door-filtered from `GET /api/okrs`, same as before).
- **One rollup implementation.** `computeGoalRollups(orgId)` in
  `src/lib/alignment.ts` derives every goal's effective progress in one
  pass: leaf = mean of live KR progress (KPI-linked KRs read the gauge),
  parent = mean of own KRs + measured children, recursively, cycle-safe.
  Every read surface — `GET /api/okrs`, `GET /api/okrs/[id]`, `my-okrs`,
  `buildPersonAlignment` (people profile/hero), and the server-rendered
  `/okrs/[id]` page — quotes this same number, so one goal can never show
  two different figures on two screens.
- **Persisted on change.** `persistGoalRollupChain(okrId)` recomputes and
  stores progress/status for the goal AND its ancestor chain on check-in,
  KR create/update/delete, goal create/PATCH (including re-parenting: the
  old parent's chain is recomputed too) and delete.
- **Honest empty state.** `progressSource: "ROLLUP" | "MANUAL" | "NONE"`
  ships with every read. `NONE` (no KRs, no measured children, nothing
  hand-set) renders as "—" with a "no key results yet" hint — never a
  fake 0% that reads as "behind". Unmeasured goals are also excluded from
  the /okrs average-progress stat, and unmeasured children contribute
  nothing to a parent's mean.

---

## Guardrails

- **Never touch SOPs.**
- Migrations: local is Neon, production is aaPanel Postgres, and
  `migrate dev` is broken by drift. Use `prisma db execute` and the
  `scripts/deploy-migrations.mjs` path.
- Additive only until Phase 3. Nothing is dropped before its data is
  confirmed migrated.
- Every phase ships behind its own commit and is verified against real data
  before the next one starts.

## Open follow-ups inherited from the board work

- `stash@{0}` holds unverified bulk-op failure handling (an archive/delete
  whose request fails still hides the row) plus the `AddSubtaskRow`
  set-state-in-effect lint debt. Verify and land it before it rots.
