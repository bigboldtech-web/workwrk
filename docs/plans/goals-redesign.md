# Goals redesign — simpler, manager-owned, effort-aware

Status: PLAN. Created 2026-09-07. Owner: product.
Trigger (user, 2026-09-07): "All Goals vs My Goals is confusing… goal assignment
should be a manager thing (managers assign to their team, team sees it in My
Goals / My KRAs-KPIs)… star goals — what's the use case?… make the Goals section
awesome and AUTOMATED: collect data on how much effort/time an employee puts
into a goal… but keep it SIMPLE — WorkwrK is about real work, not confusing OKR
theater. You decide and plan well."

Supersedes the on-hold [[project_workwrk_goals_redesign]] (owner-vs-contributor
was the P0). Builds on [[project_workwrk_alignment_system]] + the AI Performance
Manager idea ([[project_workwrk_ai_performance_manager]]).

---

## What already exists (from the codebase map, 2026-09-07)

The backend is in better shape than the UI suggests:
- **Permissions already gate by manager tier** (`src/lib/alignment-scope.ts`,
  `api/okrs/route.ts`): a non-manager can only create an INDIVIDUAL goal owned by
  themselves; managers create Company/Department goals and assign an `ownerId` to
  anyone in their report tree; org-wide levels own everything. Edit/delete gates
  mirror this.
- **Owner vs contributors is modelled**: `OKR.ownerId` (the one DRI) + `GoalAssignee[]`
  (audience via user/dept/role/tag, resolved to real people at read time by
  `lib/goal-audience.ts`). One shared scoreboard, no per-person copies.
- **Progress rollup is automated** at read time (`lib/alignment.ts`), KRs can hard-link
  to a KPI (`KeyResult.kpiId` → live value), cadence reminders run on cron, and OKR
  progress already feeds the performance score (weight 10).

What's stubbed / missing:
- **"Favorites"/star**: a dead placeholder in `GoalsSidebar` — no field, no API, no
  action. No real use case. → **remove it.**
- **"All Goals" label**: it's NOT the whole org (it's a visibility-filtered list), but
  the label reads like a firehose and confuses employees. → **reframe.**
- **Effort/time on a goal**: none. Time lives on Tasks/TimerSession/TimeEntry and only
  reaches a goal indirectly through the KPI chain. → **new: attribute effort to goals
  via their linked work.**

## The redesign

Two clean surfaces, plain language, no OKR jargon:

### Phase 1 — Simplify the structure (low risk, immediate clarity)
- Sidebar becomes: **My Goals** (goals I own or am assigned) · **Team Goals**
  (manager-only: my report tree's goals) · **My KRAs & KPIs**. Remove "All Goals"
  and the dead "Favorites/star" section.
- `/okrs` defaults to **My Goals** for everyone; a manager gets a **Team Goals**
  toggle (the report-tree view already exists in the API via `mine`/manager filter).
- Gate the Team Goals entry on `isManager`. Company-level goals still visible to all
  (they're org context), grouped under a clearly-labelled "Company" band, not mixed
  into a generic "all".

### Phase 2 — Make assignment obviously a manager act (surface existing gates)
- On **My Goals**, the "New Goal" button creates a **self-owned individual goal**
  (what an employee can do today).
- On **Team Goals** (managers), "New Goal" / "Assign" lets a manager set the owner to a
  report and pick contributors — the API already allows this; we just expose it here
  and hide the owner picker for non-managers. Assigned goals already land in the
  assignee's My Goals (via `ownerId`/`GoalAssignee`), and a notification+email already
  fires.

### Phase 3 — Automated effort & evaluation (the new capability, kept simple)
The honest signal: **how much real work is moving this goal**, derived, never
self-reported.
- **Attribute effort via linked work.** A goal already links to Boards/Spaces/KRAs via
  `EntityLink` (`okr-linked-work.tsx`) and KRs link to KPIs. Aggregate time + activity
  from the Tasks under those links: sum `Task.hoursSpent` / `TimeEntry.hours` /
  `TimerSession.durationMs`, count completed vs open tasks, last-activity recency.
- **Per-goal "Effort" card**: hours invested (this period + trend), tasks moving it
  (done / in-progress / stuck), and a per-contributor split (who's actually putting in
  the work). Sits beside the existing progress rollup on the goal detail.
- **Manager Team-Goals view** rolls this up: for each report, "goal, progress, effort,
  on-track?, is it stalling?" — so evaluation is at-a-glance and data-driven, feeding
  the performance score that already consumes OKR progress.
- No new manual entry anywhere. If work isn't linked, effort reads "no linked work yet"
  with a one-click "link a board" — nudging the healthy habit instead of a form.

## Open decisions
1. Effort attribution join: linked Boards/Spaces' Tasks (broad) vs only Tasks tagged to
   the goal's KRA (precise). Recommend: **linked Boards/Spaces + KRA tasks, deduped** —
   broad enough to be useful, honest about its source.
2. Do we keep three GoalLevels (Company/Department/Individual) or collapse to
   Company + Personal for simplicity? Recommend keep the three (data already there) but
   present them as plain bands, not "levels".
3. Team Goals for a manager: their DIRECT reports only, or the whole sub-tree?
   `getTeamUserIds` already does the sub-tree; recommend the full sub-tree with a
   "direct reports" filter.

## Rollout
A (Phase 1) is safe and shippable on its own — pure UI/label/gate cleanup, no schema
change. B surfaces existing permissions. C is the real build (effort attribution +
the two evaluation views) and is where the schema/aggregation work lives.
