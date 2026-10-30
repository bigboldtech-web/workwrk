# Recurring goals: one-time and repeating goals, periods, and numbers from Lists and Tables

Status: PLAN, revised after the spec review of 2026-10-27 (section 6). Written 2026-10-27 against `main` plus one Settings commit, with no goals changes. Owner: product.

Trigger (founder, 2026-10-27): "If I set a goal and if it is a monthly goal, then it should reset automatically every month and we can keep updating it every month. If it's a one time goal, then it ends. That is good but right now if we set it as a monthly goal, why does it ask for a due date? Rather, it should be repeated monthly and we should be able to add data to it right or collect data from any list or table so you have to think over it really well."

One line for the founder: **a goal is either One time (it has a due date and ends) or Repeating (weekly, monthly, quarterly or yearly, no due date); a repeating goal starts fresh every period, keeps every past period as history with its result, and each target can be checked in by hand or counted automatically from a List, a table or a KPI.**

Builds on, and keeps the decisions of: `docs/plans/goals-rebuild.md` (one shared goal, one scoreboard, owner singular, audience resolved at read time), `docs/plans/goals-redesign.md` (simple My / Team / Company, manager-owned assignment, automated effort, no OKR theatre), `docs/plans/goals-ux-redesign.md` (ClickUp-shaped goal page, Owner separate from Contributors, Set / Add / Subtract check-ins) and `docs/plans/ui-refresh/spec-goals.md` (the one verdict, the records-list `/okrs`, the 720 goal page). Where this spec changes one of them it says so.

The whole feature ships behind one switch, `RECURRING_GOALS` (section 2.0), and the founder approves the four visible designs (step 3a) before it can ever be turned on.


## 1. What exists today

Paths are relative to the repo root.

### 1.1 The real reason "Monthly" asks for a due date

There is no repeating goal anywhere in WorkwrK. The "Monthly" the founder chose is the **Check-ins** control, which is only the reminder rhythm:

- `src/components/okrs/create-goal-modal.tsx:41-49` offers `CADENCE_OPTIONS` Weekly · Every two weeks · Monthly · None under the label "Check-ins" (`:342-345`). It is stored in `OKR.checkInCadence` (`prisma/schema.prisma:2927-2930`, a free String, default WEEKLY).
- Its only readers: the reminder cron (`src/app/api/cron/okr-reminders/route.ts:38-42`, `:101-112`), the "check-in overdue" rule (`src/lib/goal-verdict.ts:37`, `:84-99`), the goal page's "Check-ins" row (`src/app/(dashboard)/okrs/[id]/page.tsx:50`, `:218`) and the assess prompt (`src/app/api/okrs/[id]/assess/route.ts:94`). Nothing resets, repeats or copies a goal.
- The due date is **required by the modal**, not by the API: `create-goal-modal.tsx:217` (`if (!endDate) errs.endDate = "Pick a due date."`) and the Due date field has `allowClear={false}` (`:335-339`). This came from spec-goals ("Start date and Due date (date pickers; Due required)", `docs/plans/ui-refresh/spec-goals.md:212`), shipped in commit `415c182a` (Phase 6). `POST /api/okrs` accepts a goal with no dates (`src/app/api/okrs/route.ts:521-522`).
- Why it was made required: the whole goal model hangs off `endDate`. The pace verdict needs an end (`goal-verdict.ts:68-81` returns no pace without one, so a dateless goal can never read Off track); the quarter label is derived from it (`src/lib/fiscal-quarter.ts:44`, `page.tsx:102`); the list's default sort is Due (`src/app/(dashboard)/okrs/okrs-client.tsx:98-104`); "Show completed goals" hides by it (`src/lib/goals/goal-list.ts:107-110`); the profile's "this quarter" goals filter by it (`src/lib/person-alignment.ts:112-123`).

So the founder saw a reminder setting labeled like a goal type, next to a mandatory due date that only makes sense for a one-time goal.

### 1.2 The goal model

| Model | Where | What matters here |
|---|---|---|
| `OKR` | `prisma/schema.prisma:2913-2961` | `level` (GoalLevel enum, `:2907-2911`), `status` String re-derived from progress, `progress` Int, `startDate`/`endDate` DateTime? (`:2920-2921`), `quarter` free text kept but no longer written (`:2922`), `completedAt` (Mark complete, `:2926`), `checkInCadence` (`:2930`), `ownerId` (the one accountable person), `parentId`, `departmentId`. No period, recurrence or repeat field. |
| `GoalAssignee` | `:2969-2988` | Contributors (user, department, role or tag), resolved to people at read time (`src/lib/goal-audience.ts`). |
| `KeyResult` (shown as "Targets") | `:2990-3016` | `startValue`, `targetValue`, `currentValue` (one running number for the goal's whole life), `progress`, `lastReminderAt`, `kpiId` (hard link to a KPI, `:3006`). |
| `KRCheckIn` | `:3018-3027` | `value`, `note`, `userId`, `createdAt`. No period. |

Dates: a goal's start and due are calendar days stored as UTC midnight, and three readers cut the stored instant to its first 10 characters (`okrs-client.tsx:304-307`, `GoalDates` in `src/app/(dashboard)/okrs/[id]/goal-page-bits.tsx:49-52`, `toDateInput` in `create-goal-modal.tsx:92`). Deleting a goal hard-deletes its targets and check-ins (`src/app/api/okrs/[id]/route.ts:93-100`).

### 1.3 Progress, status and the verdict

- Target progress: `keyResultProgress` (`src/lib/alignment.ts:101-128`), direction aware (HIGHER, LOWER inferred when target is below start, MAINTAIN for KPIs), clamped to 0 to 100 (`clampPct`, `:92-95`), so a target at 112 of 100 reads 100%.
- KPI-linked targets are derived on read: `deriveKeyResultProgress` (`:168-187`) with the **latest** KPIRecord of the goal owner, the highest month key regardless of the goal's dates (`latestKpiValues` `:236-288`, `enrichKeyResultGroups` `:476-531`).
- Goal progress: mean of targets (`rollUpOkrProgress` `:189-194`); parents add measured children; one pass over the whole org (`computeGoalRollups` `:558-633`), which every `persistGoalRollupChain` call runs again (`:656-693`). Every surface quotes this one number.
- Status: `okrStatusFor` 100 / 70 / 40 to COMPLETED / ON_TRACK / AT_RISK / BEHIND (`:196-201`).
- The verdict (the "On track?" word everywhere): `src/lib/goal-verdict.ts:54-65`. Pace = progress against share of time between start and due (`:68-81`); check-in staleness by cadence, measured from creation when there is no check-in, never stale for None or all-KPI goals (`:84-99`); the narrative says "On track for the due date." (`:175`).
- "Measured by a KPI" is decided in four places, each by `kpiId != null` only: `src/app/api/okrs/route.ts:210`, `assess/route.ts:73`, `okrs/[id]/page.tsx:97`, `src/lib/person-alignment.ts:281`.

### 1.4 The create and edit UI, the goal page, targets and check-ins

- `CreateGoalModal` (`create-goal-modal.tsx`, one modal for create and edit): Goal name; Owner and Level (only for the manager tier, `:265-288`); Part of (`:290-328`); Start date and Due date (`:330-340`); Check-ins (`:342-345`); Description. Quarter and Contributors were removed on purpose (`:9-15`).
- The goal page (`src/app/(dashboard)/okrs/[id]/page.tsx`): Summary card (ring, title, description, the On track? block `GoalSummaryAssessment`), Details rows Owner, Contributors, Level, Part of, Dates, Check-ins (`:197-219`), then Targets, Effort, Linked work, Supports this goal, Activity.
- Targets card (`goal-targets.tsx`): one row per target "6 of 20 people", a bar, last check-in, Check in, a row menu with Check in, View history, Delete target (`:152-163`). **There is no Edit target**; adding is an inline composer (name, start, target, unit; `:171-222`). The KR PATCH route exists (`src/app/api/okrs/[id]/key-results/[krId]/route.ts:1-33`) but no UI edits a target or links a KPI to it.
- Check in modal (`okr-checkin-modal.tsx`): Set value · Add · Subtract, a live preview, a note. It sends the **absolute** new value built from the target's current value (`:48`, `:60`), so a target's number is a running total. `POST /api/okrs/[id]/check-in` (`src/app/api/okrs/[id]/check-in/route.ts`): visibility then Can edit or contributor (`:39-43`), KPI-linked targets refused with 409 (`:54-59`), then two writes with no transaction: the check-in, and an overwrite of `KeyResult.currentValue` (`:62-81`); it persists the rollup (`:86`) and triggers the performance score (`:101`).
- Every writer of a target's number today: the check-in route above; KR PATCH `currentValue` (`key-results/[krId]/route.ts:31`, `:92`); KR POST (`key-results/route.ts:68-88`); goal create with targets (`src/app/api/okrs/route.ts:539`); Ask AI `create_okr` (`src/lib/agents/tools.ts:1182`); the Tuesday template, which makes a one-time Company goal with quarter dates (`src/lib/templates/apply-tuesday.ts:309`).
- Activity: `GET /api/okrs/[id]/check-ins?page=` (12 a page, newest first).
- List `/okrs`: columns Goal, Verdict, Progress, Owner, Due, Level, plus Effort and Last moved on Team goals (`okrs-client.tsx:287-322`). `GET /api/okrs` reads every visible goal uncapped (`route.ts:165-176`) and filters, sorts and builds the Team goals headers over all of them (`:241-284`).

### 1.5 Reminders

`src/app/api/cron/okr-reminders/route.ts`, **weekdays only** at 9 AM (`scripts/CRON-SETUP.md:102`): selects every target of an owned, not completed goal, KPI-linked ones included (`:70-92`), and nudges the owner when the last check-in is older than the cadence (7 / 14 / 30 days, `:38-42`), at most once per cadence per target (`lastReminderAt`, `:110-112`), one email per goal per run (`:135-166`). Its notification text contains an em dash and links to `/okrs`, not the goal (`:118-121`). Inbox rows `okr_assigned` and `okr_check_in_due` (`src/lib/inbox-kinds.ts:131-132`).

### 1.6 Effort and the "On track?" assess route

- `src/lib/goal-effort.ts`: work linked through EntityLink (KRA, List, Space; `:4-14`), counted under the VIEWER's access (`:23-27`, `readableBoardIds` `:258-262`), done by `isDoneStatusName` (`:214`), `hoursThisMonth` from the **UTC** month start (`:48`, `:94`), legacy Task rows read tolerantly (`:161-173`).
- `GET /api/okrs/[id]/assess`: the same verdict function as the list (`:70-75`); the AI writes only the words, never the verdict (`:24-29`).

### 1.7 Where goals feed the performance score and reviews

- `src/services/performanceScoreService.ts`: `calcOkrScore` averages the live rollup of **every goal the person has ever owned** (`:159-172`), weight 10 (`:275`); the breakdown stores only the averaged `okrScore` (`:314`), so one goal's share cannot be picked out later; the score row's month is the server's local month (`getCurrentPeriod` `:33-36`, used at `:324`); "past months are history" (`:327-331`).
- Review cycles average owned goals' live progress (`src/lib/performance/review-cycle.server.ts:188-206`); the self assessment filters check-ins by the cycle's dates (`src/app/api/reviews/[id]/self-assessment/route.ts:79-99`).

### 1.8 KPIs, the existing repeating measure

- `KPI` (`schema.prisma:1274-1320`) has `frequency` DAILY · WEEKLY · MONTHLY · QUARTERLY · ANNUALLY (`:1280`, enum `:1327-1333`), a target, a direction and a baseline.
- `KPIRecord` (`:1335-1358`) is one number per KPI, per person, per period, unique on `(kpiId, userId, period)` (`:1355`). The period is always a `"YYYY-MM"` month key (`alignment.ts:216-234`), the **UTC** month (`src/lib/kpi-period.ts:14-26`), whatever the KPI's frequency; `adjustedTarget` scales a weekly target to a month (`src/lib/kpi-utils.ts:37-76`).
- The review loop: the employee self-reports (SUBMITTED), the manager records or approves (APPROVED) or sends back (REJECTED) on `/team/kpi-reviews`. A month takes numbers while it is the current or the previous month, plus 14 hours either side for zones (`kpi-period.ts:60-90`); so October's numbers can still arrive until 1 December, 14:00 UTC. Approving a submitted number is allowed in any month but does not change it, and readers skip only REJECTED rows (`alignment.ts:236-288`). `kpi-reminders` nudges PENDING and REJECTED.
- A target hard-links a KPI with `KeyResult.kpiId`; it then cannot be checked in by hand (the 409 above).

How they relate: a KPI is already a monthly, per-person, permanent gauge with its own entry and approval loop. It is a good **source** for a target on a monthly goal, but it is not a goal: it has no owner-chosen target for one period, no audience, no parent, no verdict. Recurring goals do **not** rebuild on KPIs; they read a KPI as one source (C5), and keep the KPI loop as it is.

### 1.9 Data sources the founder asked for

**Lists (Boards with Items).**
- `Item` (`schema.prisma:4943-5011`): `status`, `ownerId` plus `assigneeIds`, `startAt`, `dueAt`, `priority`, `metadata` (custom field values by field key), `createdAt`, `updatedAt`, `archivedAt`, `parentItemId`. **No completion time**: "Items keep no `completedAt`" (`src/lib/my-work-sprint.ts:19`); analytics uses `updatedAt` as the proxy (`src/lib/analytics.ts:153-155`), but reorder rewrites `updatedAt` (`src/app/api/boards/[id]/order/route.ts:101`, `:118`).
- A status change is logged as `ItemActivity` STATUS_CHANGED inside `updateItem` (`src/lib/board-items.ts:1022-1029`). Paths that put a task into a done status without that event: create with a status (`board-items.ts:767`), a move that remaps the status (`:1325`), a change of a List's status set (`src/lib/board.ts:545`), duplicate (`board.ts:700-711`) and restore from Trash (`src/lib/trash.ts:274-276`). An "After completion" recurring task is marked done and reset to open within one save (`src/lib/recurring-tasks.ts:13-15`, `:175-195`, `:228-235`).
- Done: per-List statuses (`Board.statuses`, `schema.prisma:4797`) through `isDoneStatus` (`src/lib/board-items-shared.ts:118`, any group other than ACTIVE), cross-board fallback `isDoneStatusName` (`:107-110`).
- Custom fields: `Board.schema.fields` (`src/lib/board-fields.ts`, `src/lib/field-catalog.ts:35-53`, `:261-283`), values in `Item.metadata[key]`; number-like types NUMBER, MONEY, PERCENT, RATING. Tags: `TagAssignment` with entityType BOARD_ITEM (`schema.prisma:3533`).
- Dates: DATE field values are read with `new Date(v)` (`src/lib/dashboards/widget-math.ts:107-112`), while the Gantt writes a date as UTC midnight (`src/components/board-view/board-gantt-view.tsx:395`) and the pickers write midnight in the viewer's zone (`src/lib/item-date.ts:1-15`). So west of UTC the same day can read as the day before.
- **The aggregator already exists: the dashboard stat card.** `src/lib/dashboards/widgets.ts:1-30`, `:57-76` (source All my Lists / A Space / Choose Lists; filter rules on status, assignee, priority, due, tags, title, type and custom fields; metric Count or Sum of a number field; scope Total / Open / Completed / Overdue); computed in `src/lib/dashboards/widget-data.ts:233-310` from the Lists' own tasks plus tasks linked into them (`resolveListScope`), **under the viewer's access** (`:1-17`). Only an unfiltered total count runs in SQL (`:246-253`); every rule runs in memory through `applyWidgetFilter` (`:308`) over at most 5,000 rows with a `truncated` flag (`:56`). The All my Lists resolver loads every List and its role map (`:135-150`); a Space source is whatever the Space holds now (`:158-163`). Its editor: `WidgetSourcePicker` (`src/components/dashboards/widget-source-picker.tsx:76-90`, surfaces `dashboard` and `space-overview`, `widget-kinds.ts:17`), `WidgetFilterEditor` (`widget-filter-editor.tsx:58-68`), `SettingsRow` and `PickerButton` (`widget-registry.tsx:34`, `:60`), the Metric picker in `StatSettings` (`:145-193`), inside the widget editor dialog with a live preview (`widget-editor.tsx:1-40`), whose Title, widget kind and Scope rows mean nothing for a goal target.

**Tables (DataTable).**
- `DataTable.columns` JSON, `DataTableRow.values` `{ columnId: value }` with a soft delete `deletedAt` (`schema.prisma:357-411`). Seventeen column types (`src/lib/sheet-columns.ts:23-55`).
- **A new table is born with 1,000 blank rows**, all created the moment the table is (`src/app/api/tables/route.ts:106-114`, `NEW_SHEET_ROWS = 1000` in `src/lib/sheet-new.ts:17`). The Tables list counts only filled rows, with one SQL rule (`ROW_HAS_DATA`, `src/lib/table-counts.ts:22`, `filledRowCounts` `:49`).
- Formulas are stored as `{ "=": "A1+B2" }`; the grid evaluates them in the browser after the whole table streams in (`src/app/api/tables/[id]/rows/route.ts:35-40`), and **the same engine already runs on the server** for the public embed (`src/lib/sheet-embed.ts:1-20`, `buildEmbedSnapshot` `:150`) behind a memo of 8 entries for 60 seconds (`src/lib/sheet-embed-cache.ts:37-38`). `TODAY()` reads the server's local date (`src/lib/sheet-engine/index.ts:84`).
- Column filters: value / range / contains by column type (`src/lib/sheet-filters.ts:1-60`).
- Access: `tableReadableBy`, `tableRoleFor` (`src/lib/table-gate.ts:68-98`). Tables is a premium module (`src/lib/modules.ts:33-38`); its routes gate on `getSessionAndModule("workwrk-tables")` (`src/app/api/tables/route.ts:33`).

**Tasks (the old Task model).** `Task.kraId`, `hoursSpent`, `completedAt` (`schema.prisma:1371+`); migrated into Items (`metadata.legacyTaskId`, `metadata.kraId`), read only tolerantly because the table may go (`goal-effort.ts:5-9`, `:161-173`).

**Whose view a number is computed as today, and how access is decided.** Effort and dashboards: the viewer (each person can see a different number). KPI-linked targets: the goal **owner's** records, shown to everyone who can see the goal (`alignment.ts:441-446`, `:571-574`). `viewerForUser` (`src/lib/access/viewer.ts:64-72`) builds a Viewer for anyone not deleted, deactivated or not; `nodeCtxFromLevel` always sets `denied: false` (`src/lib/access/node-rules.ts:115-125`) and is what `board.ts:750` and `table-gate.ts:68-98` use, while `nodeCtxFromViewer` sets `denied` for a deleted or deactivated person (`src/lib/access/node-access.ts:129-138`); `canEditGoal` reads a session (`src/lib/alignment-scope.ts:160-163`). The leaver handover (`src/lib/people/handover.server.ts`) moves reporting lines and tasks, nothing on goals.

### 1.10 Time zones

- The workspace zone is `Organization.settings.timezone` (default Asia/Kolkata), with week start MON or SUN and the fiscal year start month (`localeSettingsOf`, `src/lib/settings/org-policy.ts:321-334`; the fiscal default is April, `fiscal-quarter.ts:16`). Settings > Locale says "Readers: settings.timezone (the crons, digests, due-date bucketing)" (`src/app/(dashboard)/settings/locale/page.tsx:16`).
- The person's zone is `home.locale.timezone`; the org zone is deliberately not layered into it (`src/lib/preferences.ts:286-292`).
- Helpers: `zonedWallClockToUtc`, `endOfZonedDay`, `zonedDateKey` (`src/lib/zoned-time.ts:77`, `:108`, `:115`; for a time that does not exist on a daylight-saving day it lands on the hour after east of UTC but on the hour BEFORE west of UTC, so Santiago's missing midnight on 6 September 2026 reads as 23:00 on the 5th, `:66-80`), `dayKeyInZone` (`src/lib/item-date.ts:70`), fiscal quarters (`src/lib/fiscal-quarter.ts:16-60`).
- UTC or server-local months in code this spec touches: `kpi-period.ts:24`, `review-cadence.ts:160-219`, `goal-effort.ts:94`, `performanceScoreService.ts:33`.

### 1.11 Other readers of goals

MCP `list_my_goals` (`src/lib/mcp/tools/read.ts:815-880`) and Ask AI `search_okrs` both read `searchOkrRows` (`src/lib/agents/tools.ts:973-997`): stored `progress`, `status`, `quarter` and each target's `currentValue`. Ask AI `create_okr` (`tools.ts:1113-1215`) writes the goal itself, not through `POST /api/okrs`. Home's goals card (`src/app/api/me/home/route.ts:237-255`) hides any goal whose stored status is COMPLETED (`:244`) and orders by `endDate`. The old dashboard OKR component (`src/components/dashboard/dashboard-okrs.tsx`) has no importer, and dashboards have no goal card (`widgets.ts:96-106`). Also: the profile (`person-alignment.ts`), `my-okrs`, search, the workspace export (`src/lib/export/workspace-export.server.ts:231`).

### 1.12 Deploys and switches

Every deploy applies the `prisma/sql` manifest (`SQL_MANIFEST` in `scripts/deploy-migrations.mjs`) before the build, each file under a 5 second lock timeout, and runs no data script (`.github/workflows/deploy.yml:418-425`). A feature is held back by an environment switch read at call time, as `MCP_OFFERED` is (`src/lib/mcp/config.ts:1-7`, `mcpOffered` `:40-50`). Precedents reused below: the task Repeat rule (`src/lib/recurrence.ts:16-50`) and its hourly cron (`CRON-SETUP.md:108`); `MonthControl` ‹ month › (`src/components/ui/month-control.tsx`, KPI reviews); the Inbox kinds table with its completeness test (`src/lib/inbox-kinds.ts:1-30`).


## 2. Design

Every question below is decided by the worst case of each option for real people. Every control is an existing component (`CreateGoalModal`, `SegmentedControl`, `Picker`, `DateField`, the goal page cards and `.os-row` rows, `MonthControl`, the dashboard pickers, the check-in modal); section 2.E3 lists exactly what the one new dialog reuses and what is new in it.

### 2.0 The switch: RECURRING_GOALS

- `recurringGoalsOn()` in a new `src/lib/goals/recurring-flag.ts`, read at call time from `RECURRING_GOALS`, the same shape as `mcpOffered`. Off by default. The founder sets it only after step 6, the final three reviewers and his approval of step 3a.
- **Off closes every door that makes a goal repeating or connects a source**: the modal renders no Goal type; `POST`/`PATCH /api/okrs` and Ask AI `create_okr` refuse `repeat` (400 "Repeating goals are not turned on."); the key-results routes refuse `source` (400); the target editor and Edit target are not rendered; the goal page's migration offer (A5) is hidden.
- **Off is not "exactly as before" in every pixel** (fixes review L6): the final review's general fixes reach one-time goals too, whatever the switch says, and are kept. In the goal modal: a blocked Save says why in the footer and its refusals are alerts (final review L19), the reminder rhythm is a picker below 640 and a segment never wraps (M11), Cancel is outlined (L12), and the empty Part of reads in ink-2 (L22). Nothing that makes a goal repeating or connects a source renders while it is off.
- **Off does not stop the reading half**: settling periods, the cron, period reads and check-in routing run whatever the switch says, and do nothing while no goal repeats. Worst case of gating everything: turning the switch off after repeating goals exist strands them mid-period with no close and no score. Gating only the doors means "off" is "nothing new becomes repeating", and goals already repeating keep working.
- ItemCompletion rows (C3) are written from step 4 whatever the switch says, so the first period counted after it turns on already has its completions.
- The client learns the switch from the server: `GET /api/okrs` returns `recurringGoals: boolean`, and the goal page reads it server side.
- The two new Inbox kinds (F) land in step 2, so no step writes a kind the Inbox cannot route.

### A. One-time and repeating goals

**A1. Two kinds of goal.**
- **One time** (every goal today): Start date (optional), **Due date (required)**, ends at its due date or when marked complete. Unchanged.
- **Repeating**: repeats **every week, month, quarter or year**. Yearly is included because it costs nothing extra (the same engine with a 12-month step). A repeating goal has **no due date**. It has a **Starts** period and an optional **Ends** (the last period it runs), else it runs until someone stops it.
- Stored as two new nullable columns: `OKR.repeat` (null for one time; WEEKLY, MONTHLY, QUARTERLY, YEARLY) and `OKR.repeatUntil` (the last day it runs, a `yyyy-mm-dd` key in the workspace zone, or null: the **nominal last day** of its last period, `nominalLastDayKey`, B2). `OKR.startDate` holds **UTC midnight of the first period's key** (`2026-10-01T00:00:00Z`), so the three readers that cut it to 10 characters show 1 October, not 30 September; the real instant lives on the period row. `OKR.endDate` stays **null** for a repeating goal, and every create path refuses one (400 "A repeating goal has no due date. Choose when it ends instead.").
- Why not reuse `endDate` as "until": every reader of `endDate` (the Due column, overdue, pace, the quarter label, the Due filter, Home's order, the profile's quarter filter) would treat it as a due date: a monthly goal running until December would show "Due 31 Dec", be paced over the whole year and read "overdue" after.
- One create helper, `createGoal` in `src/lib/goals/goal-periods.server.ts`, holds the repeat validation and opens the first period; `POST /api/okrs`, Ask AI `create_okr` and the Tuesday template (`apply-tuesday.ts:309`, which stays one time) all call it, so no door can make a repeating goal with a due date or without a first period.

**A2. The create and edit modal** (`CreateGoalModal`, same 560 dialog, same order, new fields marked):
1. Goal name.
2. Owner, Level (manager tier only, unchanged).
3. Part of (unchanged).
4. **Goal type** (new): `SegmentedControl` **One time · Repeating**, default One time. Two segments, inside the design system's 2 to 4 rule; one control with five options would break it.
5. When **One time**: Start date and Due date exactly as today (Due required).
   When **Repeating**: **Repeats every** `SegmentedControl` **Week · Month · Quarter · Year**, default Month; then two `Picker` fields side by side in the grid the dates use today:
   - **Starts**: the current period and the next 12; never a past one. The default is the current period **only while at least half of it remains**, otherwise the next one; the current period is always offered, labeled with what is left ("This month (October, 4 days left)"). Each option shows its dates, so a yearly goal reads "FY27 (1 Apr 2026 to 31 Mar 2027)" and nobody is surprised by the April fiscal default.
   - **Ends**: "Never" (default), then the periods after Starts, each labeled "Last period: March 2027". The choice is stored as that period's nominal last day (`nominalLastDayKey`, B2), and a period is opened only while its own nominal last day is on or before it.
   The Due date field is not rendered at all for a repeating goal.
6. **Remind the owner to check in** (the old "Check-ins", relabeled so it can never again read as a goal type): Weekly · Every two weeks · Monthly · **Off** (stored value NONE as today). Default Weekly. A weekly goal offers Weekly · Off (the other two would never fire inside one period). In edit mode the field is hidden when every target is measured automatically (C2), since there is nothing to check in. Below 640 the same choices are a `PickerSelect` ("Every two weeks" does not fit one segmented track at 390), and no segment ever wraps its label.
7. Description.

Under Repeats every, one 13px line in `text-ink-2` says what will happen: "Targets start fresh on the 1st of every month. Past months keep their results." (worded per cadence: "every Monday", "every quarter", "every year").

**A3. Editing.**
- **Repeats every** can change. It takes effect at the first boundary of the new cadence on or after the current period's end, and the line under the control says when:
  - To a coarser cadence, the old cadence keeps running whole periods until the new one starts: "Repeats quarterly from 1 January. November and December stay monthly."
  - To a finer cadence, the current period is stretched to the new cadence's first boundary after its end (by less than one new period): "Repeats weekly from Monday 2 November. October runs to 1 November." (2026: 1 November is a Sunday.) A stretched period keeps its name and its nominal last day (October, 31 October, B2); its `graceEndsAt` and `closesAt` are recomputed from the new end.
  - A change **to Week**, from any cadence, is refused while any target links a KPI (400 "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.", C6).
  The current period is never cut short. Worst case of cutting it at the new cadence's next boundary: a month cut on the 20th, or a 2-day "November" stub carrying a whole month's target, which is a guaranteed Missed in the owner's score. Stretching by under a week is the smaller harm, and the line says so before saving.
- **Starts** is editable until the first period closes, then it reads as text ("Started October 2026"). Moving it later while the first period is open discards that open period; its check-ins stay in Activity with no period, and the modal says "October's 3 check-ins stay in Activity and won't count." A target that starts each period at its start value reads it again; one that starts at last period's number (B4, "open bugs") keeps its level, which the new first period opens at.
- **Ends** can change any time; moving it before the current period's nominal last day (`nominalLastDayKey`) is refused (the current period always finishes).
- **One time to Repeating**: allowed. The due date is removed, and the modal says so under Starts ("The due date 31 Oct is removed."; Activity records "Due date 31 Dec removed when this goal became monthly"). The first period defaults to the current one **whatever is left of it**, not by A2's half rule: the goal is already running this month, and starting it next month would leave this month's work counted nowhere (final review M2); a later Starts can still be chosen. **Every target starts it at its start value** (or by its carry rule, B4); check-ins made before the change keep no period and stay in Activity. A check-in is a running total (1.4), so counting old check-ins into the new period would double count. For a target that counts up and moved during the current period, the modal offers one more `SegmentedControl` under Starts and Ends (final review M8): "October starts at: **0** · **What was added since 1 Oct**", the second option naming the numbers ("What was added since 1 Oct: 8 (38 now, 30 on 30 Sep)", the value at the period start read from the last check-in before it; with several targets, "Demos: 8 added since 1 Oct (38 now, 30 on 30 Sep)"). With a later Starts the line says what is left behind: "November starts at 0. October's 6 so far stay in Activity and won't count toward November." Pace and the score count from the change, not from the period start (B6, E4).
- **Repeating to One time**: allowed only while no period has ended (a goal made repeating by mistake): not once one has closed, nor while one that has ended still takes late or KPI numbers, since discarding it would delete a finished period's result. Its open period is discarded and the targets keep their current values. Once any period has closed it is refused ("This goal has history. Stop it repeating and create a one-time goal instead."): converting would leave closed periods that a one-time goal cannot show, and a score that already counted them.

**A4. Stop repeating, and deleting a goal with history.**
- On a repeating goal the row menu and the goal's "..." show **Stop repeating** in the Mark complete slot (same gating). It sets Ends to the current period: the period finishes and closes normally, then the goal ends (`completedAt` is stamped at that final close). Before that close, **Keep repeating** in the same slot (or Edit > Ends > Never) undoes it. After the goal ended, **Repeat again** in the same slot, while the switch is on (or Edit > Ends > Never), restarts it from the current period (final review M6; both send `repeatUntil: null`) (`restartPeriod`: from the current period's start, or from the last period's end when the zone moved since and that is later, so the two never overlap); the skipped periods are not invented, and the history shows the gap.
- **Delete goal** on a goal with closed periods keeps today's hard delete (an explicit, confirmed act) but its confirm names what goes: "Delete {goal}? Its targets, check-ins and 12 months of results go with it. To keep its history, choose Stop repeating instead. This can't be undone." In the "..." menu Stop repeating sits directly above Delete goal.

**A5. Existing goals: no automatic conversion, one offer.**
- Every existing goal stays One time with its dates, targets, check-ins and reminder rhythm untouched; `repeat` is null for all of them. Worst case of converting "Check-ins: Monthly" goals automatically: "Launch v2 by 31 Dec" with monthly reminders would start resetting every month, wiping its meaning and dragging its owner's score, and nothing tells it apart from a goal meant to repeat.
- The offer: on a one-time goal whose reminder rhythm is Monthly and whose due date is the last day of a month, with its start date empty or that month's 1st (final review M3: a goal made with no start date is the commonest monthly goal), and only while today (the workspace's day) falls inside that month, editors see a "Make this a monthly goal" text link in the Dates row (the existing `GoalEditLink` pattern), opening Edit with Repeating and Month selected. It follows A3's conversion rules and is reversible until the first close. Hidden while the switch is off.

### B. Periods

**B1. Each period is its own record.** New models (section 3):
- `GoalPeriod`: one per goal per period: `key`, the `cadence` it was cut with, `startsAt` and `endsAt` (UTC instants, end exclusive), `trackedFrom` (the later of `startsAt` and the moment the goal was created or became repeating), `graceEndsAt` (when hand check-ins and windowed sources stop), `closesAt` (when it freezes), `status` OPEN or CLOSED, and once closed the frozen `progress` (clamped, 0 to 100), `attainment` (the same mean without the clamp, for display), `result`, `scored`, `closedAt` and `scorePatchedAt`. Unique on `(okrId, key)`.
- `KeyResultPeriod`: one per target per period: `keyResultId` (set to null if the target is later deleted, so a closed period keeps its rows), `title` and `unit` copied at opening, `startValue` and `targetValue` copied from the target, `currentValue`, `progress`, `carried`, `frozenAt`, `refreshedAt`, `sourceSig`, `sourceListCount`, `pausedSince`, `pausedReason`. Unique on `(keyResultId, periodId)`.
- `KRCheckIn.periodId`: which period a check-in counted toward (null for one-time goals and every existing row).
- The `KeyResult` row stays the **template** (name, unit, start, target, source, carry rule). The goal stays **one shared record with one scoreboard** (goals-rebuild decision 1); a period is a slice of that scoreboard, never a per-person copy.

**B2. Boundaries, in the workspace zone.** A period begins and ends at 00:00 in `Organization.settings.timezone`, so everyone, in any zone, sees the same October. One new pure module, `src/lib/goals/goal-period.ts`, on top of `zonedWallClockToUtc` and `zonedDateKey`. On a day whose midnight does not exist the period starts at the jump, 01:00; the shared helper does not give that west of UTC (it lands on the hour BEFORE, 23:00 the day before in Santiago, 1.10), so the module's `startOfZonedDay` checks the helper's answer and corrects it. **Every later step uses `startOfZonedDay` as the only "first instant of a day" helper** (windows, Done dates, date keys, the KPI and score months), never `zonedWallClockToUtc(key, "00:00")` directly.

| Repeats every | A period is | Label | Hand check-ins until |
|---|---|---|---|
| Week | 7 days from the workspace's week start day (Settings > Locale, Monday or Sunday) | "Week of 26 Oct" (plus the year when not this year) | 2 calendar days after its end |
| Month | the calendar month | "October 2026" | 5 calendar days after its end |
| Quarter | the **fiscal** quarter (fiscal year start, Settings > Locale) | "Q3 FY27", the rules of `goalQuarterLabel` | 5 calendar days after its end |
| Year | the fiscal year | "FY27", or "2026" when the year starts in January | 5 calendar days after its end |

Fiscal, not calendar, quarters because the goal page already labels quarters by the fiscal year and an April-start company's Q1 is April to June; two meanings of "Q1" in one product is the worse case.

**Identity after a change** (zone, week start, fiscal start or cadence):
- The current period is **the stored row whose range contains now**, never a key recomputed from today's settings.
- A new period of a running goal starts exactly at the previous period's `endsAt` (no gap, no overlap). Its end is the first boundary under the settings in force at opening that leaves it at least half a nominal period long (so a settings change never makes a stub). Its `key` is `zonedDateKey(startsAt)` in the zone at opening. Its **name, KPI months and nominal last day come from its own range**, never from today's settings, so a running or closed period keeps them when the zone, week start or fiscal start changes: a month, quarter or year is the workspace-zone months it holds at least half of (`heldMonths`), named by the last of them, and its nominal last day (`nominalLastDayKey`) is that month's last day; a week is named by its first day (its key) and its nominal last day is six days later, or its own last day when it is shorter. This is the period's middle, not its last instant: a stretched October (A3, to 1 November) is October with a nominal last day of 31 October. A quarter is named under today's fiscal start when its months are a quarter of it, else under the start a month either side that makes them one, so its name always means its own three months.
- A period that would overlap a stored one is never opened. A key is never reused.
- A cadence change follows A3; settings changes follow the same "the open period keeps its end" rule.

**B3. Opening and closing periods.** One server module, `src/lib/goals/goal-periods.server.ts`.

*Opening* (`settleGoalPeriods(orgId, okrIds, now)`):
- Opens every missing period of each goal, from the last stored `endsAt` (or Starts) up to now, oldest first, at most 24 per goal per run (downtime longer than that catches up over the next runs). The no-gap rule applies to a running goal; a stopped and restarted goal starts at the current period (A4).
- Each goal is opened in one transaction holding `pg_advisory_xact_lock(hashtext(okrId))` (ids taken in sorted order in a batch, so two batches cannot deadlock): insert the `GoalPeriod` with `ON CONFLICT DO NOTHING`, then `createMany` its `KeyResultPeriod` rows with `skipDuplicates`. Every settle also inserts the missing rows of every OPEN period (a target added in between, a crash between the two inserts).
- Runs on every read and write that touches a repeating goal: `GET /api/okrs` settles **every repeating goal in its visible set** before the rollup, with one query to find what is missing and writes only when something is (the list filters, sorts and builds headers over the whole set, 1.4, so settling only the page would leave the headers stale); the goal page; a check-in; a target edit; `my-okrs`; Home; the profile; every create path (A1); and the cron.
- One batch computes the org rollup once and persists every touched chain in one transaction, instead of one whole-org `computeGoalRollups` per goal (1.3).
- Read and write paths **only open**. They never close.

*Closing* (the cron only):
- A new cron, `POST /api/cron/goal-periods`, at `5,35 * * * *` (IST midnight is 18:30 UTC, so a run at 35 past opens an Indian month within five minutes; other zones are covered by the lazy opening). **The crontab row is required**: it is the only closer. So a missing row is never silent: every run of `okr-reminders` (installed) counts the OPEN periods more than two hours past their `closesAt` and, when there are any, logs it and emails `OPS_ALERT_EMAIL` at most once a day.
- Each run settles, then closes, deepest goals first (children before their parents, D2), every period whose `closesAt` has passed:
  1. refresh its windowed sources one last time (outside any lock);
  2. one transaction: lock the `GoalPeriod` row `FOR UPDATE`; if it is still OPEN, freeze every `KeyResultPeriod`, compute `progress`, `attainment`, `result` and `scored`, set CLOSED and `closedAt`;
  3. after commit: the Inbox rows (F) and the score patch (G), then `scorePatchedAt`. A month the server is still in is recalculated by the score service first, and `scorePatchedAt` is stamped only once that has succeeded. A closed period whose `scorePatchedAt` is still null is retried by the next run.
- A period past `closesAt` that no cron has closed yet reads **"Closing. Its final numbers are being saved."** with its stored numbers.
- A period opened after its whole window had passed (the cron was down, nobody opened the goal): windowed sources count their own window; hand-checked targets close **Not measured**, and the period is not scored. Nobody could check in during a window the period did not exist for.

**B4. What "reset" means.** Each target has **"Each period starts at: Start value · Last period's number"** (`SegmentedControl` in the target editor, stored as `KeyResult.periodStart`):
- **Start value**: the target starts again at its baseline (0 by default), so "40 demos a month" is 0 of 40 on the 1st.
- **Last period's number**: the new period opens at the previous period's final value, shown as "Carried from October" until someone checks in. For levels typed by hand: "Reduce open bugs to 5", "NPS 60".
- The default is Last period's number for a target that counts down, and Start value otherwise. Worst case of always resetting: "open bugs" jumps back to its baseline of 30 every 1st and the goal reads Off track for work already done.
- The target itself carries over unless edited (B5).

**B5. Editing targets never rewrites the past.**
- Changing a target's start, target or unit updates the template and the **current open period** (so a typo on day 1 is fixable today), never a closed one. The change is written to Activity with the old and new numbers ("Target changed from 60 to 40 for October"), so a manager sees a mid-month cut. Worst case of "from next period only": a wrong target on a new goal guarantees a frozen Missed in its first month and in the owner's score. Worst case of "from current": an owner lowers their own target late in the month; that is possible on one-time goals today, and the Activity line plus Team goals keeps it visible.
- A target added during a previous period's grace window gets a row only in the current period.
- Deleting a target removes it from the current and later periods and deletes its check-ins, as the confirm already says: in one transaction it **first deletes its `KeyResultPeriod` rows in the periods that have not ended** (the current one and any later), then deletes the target, whose `ON DELETE SET NULL` keeps its rows in the closed periods (their `keyResultId` becomes null, the copied title and unit keep them readable). So past results never change. The confirm reads "Delete {target}? Its check-ins go with it. Its past results stay in Past periods. This can't be undone."
- **A target a period still taking numbers holds can't be deleted yet** (fixes review M1). While a period that has ended but not closed (in its grace, held for a KPI month, or closing) holds a row of it, the delete is refused, 409: "October still takes numbers until 5 Nov, so this target can't be deleted yet. Delete it after that.", naming the last day that period takes numbers (for a KPI hold, the hold's last day: "until 30 Nov"), and "October is closing, so this target can't be deleted yet. Try again in an hour." past its close (`targetDeleteRefusals`, read again under the goal's lock, so a close and a delete run one after the other). Worst case of keeping the row with no target behind it (final review M3's fix): the close and the graph read it as a hand row, so a KPI row's quarter falls back to its latest month, a List row reads as checked in by hand, and a long pause no longer leaves it out, and October's result changes after the delete. The goal page sends each target's refusal with its row, so Delete target says it before any confirm, in a dialog with one OK; a 409 that comes anyway (a period ended since the page loaded) is said in the same dialog.

**B6. Closing results.**

| Result | Rule |
|---|---|
| Hit | progress 100% |
| Partly hit | 70% to 99% (the line that reads "On track" everywhere, `okrStatusFor`) |
| Missed | under 70% |
| Not measured | nothing measured counted: no targets and no measured children, or every target left out (below) |

- The result is decided on the clamped progress; the history shows the unclamped `attainment` beside Hit only ("Hit, 112%"), and beside any other result the clamped progress it was decided on ("Missed, 33%", never "Missed, 150%": the attainment is a mean of unclamped targets, so one target at 300% and two at 0% average 100%), and each target's "112 of 100" from its own values.
- A hand-checked target with no check-in all period closes at its starting number, which is honest (no number was given); reminders and the grace window exist to prevent it.
- **Left out** of a period's progress (and so of the score): a hand-checked target in a period opened after its window (B3), and a sourced target paused for more than half the period (C10).
- `scored` is false for a Not measured period, for a first period whose `trackedFrom` covers less than half of it (a goal created on 27 October shows October's result but does not drag the owner's October score), and for a period opened after its window.

**B7. Grace and late check-ins.**
- Hand check-ins for the previous period are allowed **until its `graceEndsAt`** (2 calendar days after a week, 5 after a month, quarter or year), from the goal page's period control (E2), never after: `POST check-in` answers 409 naming the last day the period took numbers, the same day the goal page names (final review M4): "October took its last numbers on 5 Nov. Its numbers are final." Past its grace but held for its KPI month (below), it says so: "October took its last check-ins on 5 Nov. Its KPI numbers are taken until 30 Nov." Worst case of allowing them forever: the history, the trend, a manager's review and a closed month's score change silently months later. Worst case of no grace: a person on leave on the last day cannot enter the month's final number and it freezes as Missed. Five calendar days covers a normal month-end close.
- **A goal with a KPI-linked target closes when the KPI month stops taking numbers**: its `closesAt` is the later of `graceEndsAt` and the end of the KPI write gate for the period's last month (1.8: the month after it, plus the 14 hours of zone spread; for October, 1 December 14:00 UTC). For a quarterly or yearly goal, the period's last month sets it. Until then the Targets card reads "Open for KPI numbers until 30 Nov". Its hand-checked targets still refuse check-ins after `graceEndsAt`. A parent's period waits the same way for every child period D2 reads for it on its cadence or a finer one (a quarter waits for its monthly children's December); a coarser child's period holds nothing, since D2 reads it as it stands when the parent closes. Worst case otherwise: a manager approves or records October's KPI on 20 November, as the KPI loop invites, and October's goal is already frozen without it.

**B8. One number everywhere, and one writer.**
- `writePeriodValue(krId, periodId, value)` is the **only** writer of a repeating goal's target numbers. It runs inside a transaction that locks the `GoalPeriod` row, refuses (409) unless the period is OPEN and, for hand check-ins, before `graceEndsAt`, writes the `KeyResultPeriod`, and, when that period is the current one, mirrors `currentValue` and `progress` onto the `KeyResult` row. Check-ins, refreshes and period openings all go through it.
- On a repeating goal, KR `PATCH` and `POST` answer 409 to a `currentValue` ("Check in to change this period's number.").
- A contract test lists every writer of `KeyResult.currentValue` and `progress` in `src` and fails on a new one, the way the Inbox completeness test does for notification types.
- The mirror is for **readers**: Home, the profile, search, `my-okrs`, MCP and Ask AI show the current period with no change of their own. Rollups of repeating goals and of their parents read periods, not the mirror (D).
- The stored `OKR.status` of a running repeating goal is **never COMPLETED** (at 100% it stores ON_TRACK; "Target hit" is a display label, E1). COMPLETED is stored only when the goal has ended. Otherwise Home (`me/home/route.ts:244`), the reminders and every status filter would drop a live monthly goal for the rest of the month once it hit its number.

### C. Updating data

**C1. By hand.** The existing check-in modal, unchanged (Set value · Add · Subtract, note). For a repeating goal the check-in lands in the period the goal page is showing: the current one, unless the person stepped back into the previous period inside its grace window. `POST /api/okrs/[id]/check-in` takes an optional `periodKey` (default: the current period). It writes the check-in and the value in one transaction through `writePeriodValue` (B8), so a check-in racing the close either lands before the freeze or gets the 409, never half of each.

**C2. Each target is "Measured by" one of four things.** A new `KeyResult.source` (JSON) plus the existing `kpiId`:

| Measured by | What it counts |
|---|---|
| Check-ins (default) | what people type |
| A List | tasks in one Space or chosen Lists |
| A table | filled rows of one table |
| A KPI | the owner's KPI records (the existing link) |

One helper, `isMeasuredAutomatically(kr)`, true for a `kpiId` or a `source`, replaces the four `kpiId != null` checks (1.3), drives the check-in 409, and makes the reminders skip those targets (F). Sources work on one-time goals too: their window is the goal's start date to its due date, read in the workspace zone (with no start date, from the day the goal was made, never all history); once it has ended the target is counted once more (a Right now count by the cron's first run after the due date) and its number then stands. A windowed count that paused there (Tables off, access lost) is tried again on the usual age until one succeeds: its window is over, so a later count reads the same days. A Right now count that paused there keeps its stored number as the final one, as a repeating period's paused freeze does: a later count would read what stands later (fixes review L2).

**C3. From a List** (on the dashboard stat card's engine, not a new one):
- **Where**: "A Space" or "Choose Lists" (`WidgetSourcePicker` with a new `goal` surface that has no "All my Lists"). Not All my Lists: that set is "every List the counting person can open", so the number would jump whenever their access changed. A Space source counts the Lists the Space holds now (1.9); each count stores how many Lists it read (`sourceListCount`), and a change is written to Activity ("Now counting 6 Lists in Marketing, was 5").
- **What**: Count of tasks, **Sum of** or **Average of** a number field (NUMBER, MONEY, PERCENT, RATING). Average is for goals only; dashboards keep Count and Sum.
- **Which tasks**: the dashboard filter rules unchanged (status, assignee, priority, due, tags, title, type, custom fields; AND or OR; Hide completed), the same `WidgetFilter` shape and `WidgetFilterEditor`, applied by `applyWidgetFilter` in the **workspace** zone (one number for everyone), not the viewer's.
- **Counted by** (the window): **Done date**, **Created date**, **Due date**, **a Date field** of the chosen Lists, or **Right now** (no window).
- **What runs in SQL**: only the window, top-level tasks, not archived and not system items. Everything else runs through `applyWidgetFilter` in memory, exactly as dashboards do (1.9), so a goal and a card on the same rules can never disagree. The cap is **20,000 rows after the window** (and, by Done date, after the top-level and archive rules, so subtask completions never pause a List), decided on counts before any row is loaded; over it the source pauses with "Too many tasks to count. Narrow the filter." A goal feeds the score, so it never shows a silently cut number. A Done-date count pages through at most four times the cap of completions before its filters; a window holding more pauses with the same words without reading one. A Date field window too wide for month prefixes still reads only the tasks whose field is set.
- Tasks home in the Lists or linked into them, each counted once (`resolveListScope`, as dashboards do).
- **Dates are compared as `yyyy-mm-dd` keys in the workspace zone**: a bare date string is its own key; an instant at exactly 00:00:00.000Z (the Gantt's date-only write) is its UTC day; any other instant is its day in the workspace zone (`dayKeyInZone`). So a task due 1 November counts in November in Kolkata and in New York.
- **Right now** (for "keep open bugs under 10"): while the period is open it shows the live count; its final number is stored at the **first cron run after `endsAt`** (and `frozenAt` set). Grace and the final refresh apply only to windowed sources and hand check-ins. Worst case otherwise: a bug closed on 2 November lowers October's frozen number.

**C4. Done date: an append-only ItemCompletion.**
- Decided over an `Item.doneAt` column by worst case. A column holds one time per task, so an "After completion" recurring task (done and reset to open in one save, 1.9) would stamp and clear it in the same save and a weekly report done four times in October would count zero; a task done, reopened and done again keeps only the last time; and an `updatedAt` fallback is wrong because reorder rewrites it. A row per completion has none of these.
- `ItemCompletion` (itemId, boardId, organizationId, `status` the done status it entered, `doneAt`, actorId). A row is written **in the same transaction as the status write** whenever a task's status crosses from not done into its List's done group (`isDoneStatus`): in `updateItem`; in the roll-forward, before it resets the status, so each completion of an "After completion" task counts; on create into a done status; on a move whose remapped status is done (judged on the statuses the move reads under its row locks, its subtasks' too); and on a change of a List's status set that puts tasks into the done group, archived tasks included. **Duplicate** writes no completion, the task Duplicate and the List duplicate alike: a copy is not new work, and a goal counting the List and its copy would count the same work twice. **Trash** keeps a task's completions in its snapshot and restore brings them back, each on the task's home.
- A create into done is dated when the work was finished (`completionAt`): now for a person creating it; the row's end or published date for the legacy marketing import (none without one, never later than the import); no row at all for a Template Center sample task.
- An unarchive into a done status with no completion follows the backfill's rule: one row at its last not-done-to-done STATUS_CHANGED activity, none without one. The Trash page's unarchive goes through the same path.
- When a task crosses back out of done (reopened by a person, or its status leaving the done group in a status set change), its latest completion row is removed. The roll-forward's own reset does not remove it.
- **A status set round trip keeps the real dates.** A status set change that takes a status out of the done group sets the removed completions aside in ONE activity row on the List (entityType `BOARD_STATUS_SET`, read by no feed; `GET /api/item-activity` refuses that entity type, fixes review L1), in the same transaction, and with them each task it took out of done that had no completion (`meta.none`, its id and status, fixes review M2). A change that puts tasks into the done group dates each one by: the set-aside date, while the task still has that status and nobody changed its status since; a task set aside with none, under the same two conditions, gets none (a copy, a dateless import, a template's sample, work done before completions existed: a round trip must not stamp it now); else the backfill's rule (its last not-done-to-done STATUS_CHANGED activity, judged by the new set); else now. Decided over voiding the rows in place: a void flag needs a column every completion reader must filter, and a reader that missed it would count a task that is not done; the set-aside row is read by the status set change alone.
- **No `updatedAt` fallback.** A nightly repair (the cron's run at 20:35 UTC, which is 02:05 in Kolkata) adds a row for any task in a done status with no completion since its last not-done-to-done STATUS_CHANGED activity, at that activity's time (else at the repair's own time), logs how many it added so a missed writer shows up, and deletes rows whose task is gone. Only `updateBoardItem` writes STATUS_CHANGED, so the repair catches only a miss of the paths through it (every PATCH, the bulk route, automations, Ask AI, MCP); create, move, a status set change, duplicate, restore and import write no such activity, and each is covered in its own write.
- The one-time backfill script (`scripts/backfill-item-completions.ts`, dry run by default, JSON report first) gives each task now done one row at its last not-done-to-done STATUS_CHANGED activity. A task with no such activity gets no row (it was done before any goal could count it) and the script reports the count. Not a Done to Closed change: both are done. Each page is written in one transaction that locks its tasks FOR UPDATE, parents before subtasks and each by id (as a move locks its task before its subtasks), reads their Lists' status sets FOR SHARE, and checks each task again under the sets as they are then, never as the run read them at its start; a deadlock Postgres breaks anyway (40P01, a move of a subtask whose own subtask has a lower id) retries the page, three tries in all (fixes review L3).
- Counting by Done date: completions inside the window of tasks currently in scope. A status rule matches the status the completion entered; every other rule matches the task now. Moving a done task out of the chosen Lists removes it from the open period's count (closed periods are frozen), the same as a dashboard card.
- No foreign key to `Item` (as `EndedSession` has none to `User`), so creating the table takes no lock on the busiest table in the product; the repair deletes orphans.

**C5. From a table** (Tables module on):
- **Which rows**: **filled rows only**, by the Tables list's own rule (`ROW_HAS_DATA`, 1.9), so the 1,000 blank rows a new table is born with never count; an unticked checkbox (`false`) is not data, as the public embed's `rowUsed` reads it (ticking and unticking a box leaves `false` behind), and the Tables list's count, a form's append position and an import's reuse follow the same rule; trashed rows never count; then the Tables column filters (value / range / contains, `SheetColumnFilter`), all of which must hold, as in the grid. A filter reads what a cell shows, so a filter on a formula column reads its computed value (the grid's own filter reads nothing there for a formula column's fill). The rows are read in the grid's storage order (`liveTableRows` in `src/lib/table-counts.ts`, the same `ROW_HAS_DATA`). A count over plain columns loads only the columns it names (`filled` is still decided on the whole row, in SQL).
- **What**: Count of rows, or Sum of / Average of a number, currency, percent, rating **or formula** column. Formulas run on the server through the embed's engine path, with `TODAY()` given the **workspace zone's** date (1.9 says the engine otherwise reads the server's). Link, lookup and rollup columns are not offered: they read another table, whose access the goal cannot check for every viewer. A row whose computed cell in a column the count reads (the one it adds up, its Date column, a filter's) shows an error is left out, as the grid's Sum leaves it out, and the preview says how many ("3 rows show an error and are left out."). When every row the count would read errors, or no row has a number while some error, or a formula column it reads holds `#REF!` (a column it named was deleted), the source pauses with the formulas words (C10) instead of storing a 0 the close would freeze into the score. A period's final number (a Right now freeze, the close's final count, a one-time goal's count after its due date) reads `TODAY()` and `NOW()` at `min(now, end - 1ms)` in the workspace zone, the period's last day, so a freeze on 1 November reads 31 October. `NOW()` is **day-granular** for a goal: the signature and the shared reads name the day, not the hour, so a formula that turns on the hour moves the stored number only at a count that runs for another reason, at the latest the next day.
- **Counted by**: a **Date column**, or **Right now** (C3's rule for its final number). There is no "Row added": every seeded row carries the table's creation day, so a seeded row someone fills in November would count in the month the table was made. A `DataTableRow.filledAt` column was weighed and rejected: every cell write path in Tables would have to stamp it, and a person who wants a monthly count of rows already has a date in the row. Date columns compare as keys by C3's rule; a time with no zone ("2026-11-01T09:00") is the day it names, and a formula's date serial (`=DATE(2026,11,1)`) the day it stands for. A newly chosen table counts by its first Date column, else Right now.
- **Caps**: plain columns, 50,000 filled rows; a sum or filter over a formula column, 20,000 live rows (the engine reads every live row, the blank ones too, because A1 refs anchor to storage order), one table at a time per run (every target on a table counted together, whoever connected it, oldest first by its oldest count; the run holds that table's plain read and its engine only, and lets them go after its last count), yielding between tables, and one read of a table per run however many of its targets count it. A request's count (the preview, the count when a source is saved, the goal page's Refresh) shares a per-process cache instead, three reads for a minute, keyed as the public embed's memo is (the table, then the zone and the day for an engine, or the columns for a plain read) with the data signature as its check; the read depends on the table alone, and every check of the connector runs before it. A plain column holding a cell formula of its own (`{ "=": ... }`) is a formula read. Over the cap the source pauses with "This table is too large to count from a goal." A one-time goal's source, a table's included, is recounted without the signature skip: the signature is stored on a period row, a one-time target has none, and storing one would need a `KeyResult` column (accepted: a one-time goal's sources are few, and counted at most every 50 minutes).

**C6. From a KPI.** The existing `kpiId` link, made period aware for repeating goals:
- A monthly goal's target reads the owner's KPIRecord for the period's month (not REJECTED, with a value); nothing yet reads as the starting number.
- A quarterly or yearly goal offers **Latest month · Sum of months · Average of months** (a `PickerButton` in the target editor, stored in `source`; default Latest month), over the months inside the period. Sum fits a monthly count ("deals closed"), Latest a level ("NPS").
- A weekly goal cannot link a KPI (400 "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal."): a monthly number repeated in four weeks would be wrong three times. For the same reason a change of Repeats every **to Week**, from any cadence, is refused while any target links a KPI (A3), and a goal changed from weekly to a coarser cadence takes no KPI link while a weekly period still runs or is still to come (400 "A KPI is recorded monthly, and this goal still has weekly periods to finish. Link the KPI once its first month starts.").
- Linking a KPI reads the goal **owner's** KPI records, so anyone but the owner links one only when they may read those (`canTouchUserAlignment`, as the KPI routes ask it; 403 otherwise).
- The months a period reads are its KPI months (`kpiMonths`: the workspace-zone months it holds at least half of, from its own range, B2), so a stretched October reads October only and a quarter that a fiscal start change joined to January reads January to April.
- The close waits for the KPI month (B7). One-time goals keep today's "latest record" behavior. The link becomes choosable in the target editor (today only the API can set it).

**C7. When an automatic number refreshes.** The number is **stored** on the period, so the list never counts anything and every surface agrees:
- by the cron, for every open period with a source last counted more than 50 minutes ago: a List's sources grouped by connector (one Viewer each) and a table's by table (one read each, C5), oldest `refreshedAt` first, the workspace counted longest ago first, a time budget per run, the rest next run (a Right now freeze never waits on the budget, and one paused at its freeze keeps its stored number as the final one); a source signature (`sourceSig`: for a List, the count and newest `updatedAt` of its scope, the ids of the tasks linked into it, plus its newest completion; for a table, as the embed memo keys it: the table's `updatedAt`, its newest row's `updatedAt` and its row count) skips a recount when nothing changed;
- when the goal page opens and a source was counted more than 10 minutes ago, **only for people who may check in** (the page renders the stored number, then the Targets card asks `POST /api/okrs/[id]/refresh` and repaints if it changed);
- from **Refresh** in the target's row menu (anyone who may check in);
- a final number: a windowed source's at the first cron run after its grace ends (`graceEndsAt`), stored with `frozenAt`, so a period held open for its KPI month never counts its List or table again (the close counts once more only a row not frozen yet); a Right now count's at the first run after the end. Neither waits on the budget. After its grace no request (the goal page, Refresh) counts a period's windowed source.

Not on every task or row write: hooking every Item and DataTableRow write to find the goals that count them puts a goal query on the hottest write paths in the product, and a failure there would break task saves. Worst case of the chosen rule: a goal number up to an hour behind on the list, and up to 10 minutes on the goal page.

**C8. Whose access counts the number: the person who connected the source.** Stored as `KeyResult.sourceById`.

| Option | Worst case |
|---|---|
| The viewer (as Effort and dashboards) | Ten people see ten numbers for one target; a frozen October cannot be per viewer; the score needs one number. |
| The goal owner | A manager connects a manager-only "Hiring pipeline" List to a report's goal; the owner cannot open it, so the target reads 0 and the manager cannot tell why. Company goals often have no owner. |
| **The person who connected it** | They publish an aggregate of a List they can open to everyone who sees the goal. That is what they could already do by typing the number in a check-in, and only goal editors who can open the source can connect it. |

Every count first reads the connector's `User` row: deleted or INACTIVE pauses the source with "Priya no longer works here. Reconnect it." It then builds their Viewer (`viewerForUser`) and decides List and table access with `nodeCtxFromViewer`, which honors a denied person, never `nodeCtxFromLevel`, which cannot (1.9); and checks Can edit on the goal with `canEditGoal` on a session built from that row. If any check fails, the source pauses (C10).

**C9. Someone who can see the goal but not the source** sees the **number** (everyone who sees a goal sees every target's value today; KPI-linked targets already work this way) and "From a private List" or "From a private table" (the existing `PRIVATE_DESTINATION_NAME` words, `table-gate.ts:120`), with no name, no link, no filter details and no task or row. Hiding the number too would make one goal read differently per viewer and break the one scoreboard. An editor who cannot open the source sees it as private too, with who connected it, and may replace it but not read its settings (the dashboard's partial-card redaction, `widgets.ts:24-27`). Before saving a source that is not open to the whole workspace, the target editor says "Everyone who can see this goal will see this number."

**C10. Paused sources.**
- A source pauses when its List or table is archived, trashed or deleted, the summed field or column is removed (for a table, also the Date column it counts by or a column it filters on, removed or retyped), a value filter none of whose options its column still offers (renamed or removed), the Tables module is turned off, the count is over its cap, a table's formulas cannot be worked out at all (no engine, a `#REF!` in a formula column it reads, or an error in every row it would read), or the connector left or lost access. The last counted number stands, and a line under the target row says so at every width, for everyone: "Paused. The last number counted stands.", followed for editors by the reason, which says what fixes it ("A List it counts was deleted or moved to Trash. Restore it, or choose another List in Edit target."; "Tables is turned off for this workspace. An Admin can turn it on in Settings > Modules."). No tooltip carries the reason (final review H3, L5). While Tables is off, a table source keeps its name for a viewer who can open the table, with no Open source and no Reconnect.
- The first pause sends **one Inbox row** to the owner and to the connector (`goal_source_paused`: "{goal}: {target} stopped counting. {reason}"), linking to the goal, each only while they still work in the workspace and may still see the goal. No repeat while it stays paused.
- Editors get **Reconnect** (they become the connector, after the same checks) or can switch the target to check-ins. A source that comes back (a List restored from Trash) resumes on its own.
- A target paused for **more than half a period** is left out of that period's progress and score (B6); its history row says "Paused from 14 Oct". Worst case otherwise: a stale number from the 14th drags a month's result and the owner's score for work nobody could count.
- The leaver handover offers to move the leaver's connected sources to the transferee, after the same checks for the transferee; any that fail stay paused and the Inbox row tells the owner.

### D. Targets on repeating goals, and parent goals

**D1.** Each target repeats with its goal: one `KeyResultPeriod` per period, opened by B4's rule.

**D2. A parent's period is computed from its children's periods, never from the mirror.** For a period P of a repeating goal, its progress is the mean of its own targets' rows for P plus each measured child's contribution:
- a repeating child **on the same cadence**: its period with P's key (live while open or in grace);
- a repeating child on a **finer** cadence: the mean of its periods whose nominal last day (`nominalLastDayKey`, B2) falls in P;
- a repeating child on a **coarser** cadence: its period that holds P's nominal last day (`nominalLastDayKey`), as it stands when P closes. Worst case of "only periods ending in P": a monthly Company goal would ignore its quarterly Department goals two months in three;
- a **one-time** child: its progress as of P's `endsAt`: each hand-checked target at its last check-in at or before `endsAt` (its start value if none), KPI targets at the record for P's month or earlier, sourced targets at their stored number; its own children by these same rules.

A **one-time parent** takes a repeating child as the mean of the child's closed periods inside the parent's dates, or its current period while none has closed. Worst case otherwise: a one-time parent drops to near 0 every 1st, when its monthly children restart.

Settle closes the deepest goals first (B3), so a parent freezes on its children's frozen numbers. `computeGoalRollups` gains a period-aware branch for repeating goals and for parents of repeating children; it does change. Worked case, proved in step 2: a Company goal with three monthly Department children closes October on 5 November with the children's October numbers, not their November ones.

### E. The views

**E1. The goal list (`/okrs`).** Rows of repeating goals show the current period: Progress and Verdict are the current period's; the **Due** column reads "Resets 1 Nov" in `text-ink-2` (tooltip "Repeats monthly. This period: October 2026."); Sort by Due uses the current period's end; the Due filter matches it. A repeating goal that hits 100% mid-period shows the chip label **"Target hit"** (the Completed tone) and is **not** hidden by "Show completed goals": hiding it would remove a live monthly goal from My goals for the rest of the month. Only an ended repeating goal counts as completed. One line per row, nothing added to the row budget.

**E2. The goal page (`/okrs/[id]`).**
- Details: the **Dates** row becomes **Repeats** for a repeating goal ("Every month, since October 2026" or "Every month, October 2026 to March 2027"; once ended, "Every week, ended after the week of 19 Oct"); the **Check-ins** row becomes **Reminders** ("Weekly, to the owner", "Off"), hidden when every target is measured automatically (the longer label wrapped in the Details column, final review L11).
- **Period control**: `MonthControl`, generalized to take an ordered list of period keys and labels (its month behavior stays the default, so KPI reviews do not change), on the Summary card's top line: "‹ October 2026 ›  9 days left", with the dates for a quarter or a year, whose name alone gives none ("‹ Q3 FY27 ›  1 Oct 2026 to 31 Dec 2026, 9 days left"). In periods mode the name between the arrows is plain text, not the bordered chip, which looked like a button that did nothing (final review L14). It writes `?period=<key>`; Next is disabled past the current period. The ring and the On track? block, Targets, Effort and Activity all follow it.
- **A goal that has not started** (Starts is a later period, so no period exists yet; final review H2): the top line reads "Starts 1 Nov. Check-ins open then."; the ring reads "Not started"; the verdict is **Not started** (`not_started`, a neutral chip, in the list, the filters, the profile and assess too), with no pace and no staleness, and assess says "Starts November 2026." with no AI; Check in is hidden, while its targets can be set up.
- A **closed** period shows its result where the verdict is ("September: Hit, 112%"), every target read only, no Check in, and the Targets card names the last day it took numbers, the day a late check-in's 409 names too: "Took numbers until 5 Oct. Its numbers are final." (never the day the cron closed it, final review M4). A period in its grace window shows "Open for late numbers until 5 Nov" in the Targets card and keeps Check in, and its Summary shows its result so far, with no pace and no next step: "October 2026 ended: Partly hit so far, 84%. Late numbers until 5 Nov." (final review M1); a KPI-held period shows "Open for KPI numbers until 30 Nov" (B7); a period past its close shows "Closing. Its final numbers are being saved." A carried target shows "Carried from October".
- **While the period before still takes numbers** (final review H1), the Targets card of the period running now says so with a link to it: "October still takes late numbers until 5 Nov." · "Check in for October" (`?period=2026-10-01`; "Open October" for someone who cannot check in, or when no row of October takes a hand check-in, its targets all counted by a KPI or a source, fixes review L5; and "October still takes KPI numbers until 30 Nov." past its grace). The check-in's title always names the period the number lands in: "Check in on Demos booked for November 2026". The period view carries the facts (`previous`: its key, label, whether it takes late numbers, whether a row of it takes a hand check-in (`takesHandCheckIns`) or it waits for a KPI month, and their last days).
- **A target's row** names what measures it (its source, its KPI, "Carried from October") in a column from 1280 up and in a line under the row below it; a pause is a line under the row at every width (C10); the numbers carry no tooltip of their own (final review H3). Closing the check-in or the target editor opened from the row's "..." puts focus back on that "..." (final review M9).
- **Past periods** card (the existing card pattern, after Targets, only once a period has closed): 36px rows, newest first: the label, the result as one pale `StatusChip`, "112 of 100" (single-target goals) or the attainment % (kept below 640, final review L13), and the 72px bar the Targets rows use (from 640 up); clicking a row moves the period control there; 12 rows then "Show more". Above the rows, a small bar trend of the last 12 periods (progress per period with a 100% reference line), drawn with the same recharts bar the dashboard chart card uses (`src/components/dashboards/widgets/chart-widget.tsx`). A target deleted later still shows in its closed periods (B5).
- **Activity** gets a `SegmentedControl` in its header, **This period · All periods** (default This period on a repeating goal; one-time goals show all, as today). Beside the check-ins, newest first, it shows the goal's own `okr_updated` lines, each naming its target: "Demos booked: target changed from 60 to 40 for October 2026", "Due date 31 Oct removed when this goal became monthly" (final review M5; `GET /api/okrs/[id]/check-ins` merges them as `kind: "update"` rows; This period shows the lines written inside the period's dates).

**E3. The target editor: the one new dialog.** Opened by a new "Edit target" in the target row menu, and by "Count from a List or table" on the inline composer (which stays for quick hand-typed targets; "More options" hid what it opened, final review M7). The dashboard widget editor cannot be reused as it stands (its Title, widget kind and Scope rows mean nothing for a target), so:
- **Reused as is**: `Dialog` and `DialogContent` (`ui/dialog`); `SettingsRow` and `PickerButton` (`widget-registry.tsx:34`, `:60`); `WidgetFilterEditor`; `numberFields`; `SegmentedControl`; `Picker`; the Tables filter kinds (`sheet-filters.ts`).
- **Reused with one change**: `WidgetSourcePicker`, given a `goal` surface without All my Lists; `MonthControl` (E2).
- **Copied as a pattern, not a component**: the widget editor's layout, a live preview on the left and a settings column on the right.
- **New**: the `TargetEditor` component (`src/app/(dashboard)/okrs/[id]/target-editor.tsx`); its rows Name, Start, Target, Unit, Measured by, Counted by, Each period starts at, the table and column pickers (built on `Picker`) and the KPI Latest / Sum / Average picker; the preview line ("This month so far: 42 of 60", or "Right now: 10 of 200 rows" for a count of what stands now, whose hint reads "Its number on the period's last day becomes the result.", final review L1), from a new `POST /api/okrs/[id]/key-results/preview` computed as the person editing ("Couldn't count the preview. Try again in a moment." when it cannot); and the audience line (C9). A List's source row is "Where", as a table's is, and "Which tasks" carries no second "Filter" heading (final review L2, L3); "Only rows that hold data count" is said once, by the Which rows hint (L4). Every picker's name starts with what it shows ("Choose a KPI, KPI", "Count of tasks, What"), each hint describes its control (`aria-describedby`), a filter's remove button names its filter ("Remove the Stage filter"), and placeholders are ink-2 (final review M10, L15, L20, L22).

**E4. Other views.**
- **My, Team and Company goals** keep their filters and grouping. **By person** (Team goals headers, "3 goals · 46% avg · 18h this month"): repeating goals contribute their current period's progress; the hours use the workspace zone's month (fixing the UTC month start at `goal-effort.ts:94`).
- **Effort per period**: `computeGoalEffortBatch` gains a window; for a repeating goal the Effort card counts hours (TimeEntry.day) and tasks done (each ItemCompletion on a day of the period, so a weekly report done twice counts 2, as Done date counts it) inside the selected period, labeled "This period". The Team goals Effort column shows the current period's hours.
- **Assess per period**: `GET /api/okrs/[id]/assess` takes `?period=`. The open period is paced from its `trackedFrom` (the later of its start and the goal's creation or conversion) to its end, so a goal made on 27 October is not Off track at birth; staleness counts from the later of `trackedFrom` and the last check-in in the period; the words name the period ("On track for October.", "On track for the week of 19 Oct."). A repeating goal has no due date, so no word of the assessment names one: the AI is told it repeats and has none, and an AI sentence naming a due date or a deadline gives way to the worked-out one (final review H2). A target counted from a List or a Space is linked work: the summary never says "No linked work" while a List moves the goal (final review M12). A closed period returns its frozen result and skips the AI.
- **Home** (`me/home/route.ts:237-255`): its `status: { not: "COMPLETED" }` filter keeps a running repeating goal (B8), and the card's due line reads "Resets 1 Nov". The **profile**'s this-quarter filter (`person-alignment.ts:112-123`) treats a running repeating goal as current.

### F. Reminders, Inbox and notifications

- All reminders skip targets measured automatically (`isMeasuredAutomatically`); today they nag KPI-linked ones (1.5).
- **A check-in is due**: the existing `okr-reminders` cron, made period aware: for a repeating goal, staleness counts from the later of `trackedFrom` and the last check-in in the period. Once per period, on the **first reminders run inside the last 3 days** of a monthly, quarterly or yearly period (the cron runs on weekdays only, so a fixed "two days before" would skip weekend ends), the owner of a goal with a hand-checked target that has no check-in this period gets "October ends in 2 days. Add this month's numbers." No end nudge for weekly goals: two days before is most of the week. Both use the existing `okr_check_in_due` kind and link to `/okrs/{id}`; today's em dash is removed. Email stays as today (prefs-gated `due_reminders`).
- **A period started**: one Inbox row per owner per day, only for goals with a hand-checked target: "3 goals reset for October 2026" (the founder's word, and the list's "Resets 1 Nov", final review L8), linking to `/okrs`. New kind `goal_period_started`, labeled "Goals reset". No email.
- **A period closed**: one Inbox row per owner per cron run: "October results: 3 hit, 1 missed", linking to `/okrs` (with one goal, to `/okrs/{id}?period=2026-10-01`). New kind `goal_period_closed`. No email. Managers read results on Team goals; contributors are not notified.
- **A source paused**: `goal_source_paused` (C10); when reconnecting is the fix, its message says where: "Priya can no longer open a List it counts. Open the goal and choose Reconnect in the target's menu." (final review L16).
- All three new kinds get rows in `src/lib/inbox-kinds.ts` in step 2 (the completeness test requires it): primary tab, people group, the Trophy icon.
- **Only people who still work in the goal's workspace.** A goal keeps its `ownerId` when its owner leaves, is deactivated or is removed, and the Inbox shows a person's rows from every workspace, so every row and email above (the started and results rows, the end nudge and the stale check-in rows with their emails, `goal_source_paused`) goes only to someone not deleted, not deactivated and holding a level in that workspace. The started row's and the end nudge's ids name the workspace (a digest of the workspace and the person), so an owner with goals in two workspaces gets each workspace's row.

### G. The performance score and review cycles

**G1. Which period counts.**
- The score's month M keeps its existing key (`getCurrentPeriod`). The breakdown gains `okrParts`, a list of `{ okrId, periodKey or null, progress }`, and `okrScore` becomes their mean.
- A one-time goal's part is its live progress, as today (`periodKey` null).
- A repeating goal's part counts **its scored periods that belong to M**, where a period belongs to the month (workspace zone) of its nominal last day (`nominalLastDayKey`, B2, so a stretched October counts in October): a monthly goal, its month M; a weekly goal, the mean of its scored weeks ending in M; a **quarterly or yearly goal only in the month it ends**. Worst case of counting a quarter in each of its months: the same quarter scored three times at three partial values. Periods with `scored` false (B6) are left out; a goal with no part in M is left out of M.
- Mapping by period key, not "the current period", keeps the October row on October even when the server's clock and the workspace's disagree for a few hours at the month change.

**G2. The close patch.** At the final close (in the next month, after the grace), the closer patches M's row:
- if the row has `okrParts`: replace that goal's part, re-average, and re-compose the total from the row's **stored** breakdown, so no other component is recomputed;
- if the row predates `okrParts`: leave it alone;
- if there is no row for M: create one with the goal part alone.
Worst case of not patching: a number entered on 3 November inside the grace never reaches October's score. Worst case of a full recompute: October's row picks up November's KPI and review inputs.

**G3. Review cycles.** `review-cycle.server.ts:188-206` and the self assessment (`self-assessment/route.ts:79-99`) read a repeating goal as the mean of its scored periods whose nominal last day (`nominalLastDayKey`) falls inside the cycle, the open period included only when the cycle ends inside it; the self assessment lists each period with its result. Proved in step 6: a Q3 review opened on 2 November reads July, August and September, not November.

### H. Permissions

Unchanged where possible (`src/lib/goals/goal-rights.ts`, `src/lib/alignment-scope.ts`):
- Create a repeating goal: whoever can create that goal today (a Member, their own Individual goals; the manager tier, for their chain; Company goals, Owner/Admin, the People team or the owner). Manager assignment, `okr_assigned` and its notification are unchanged.
- Edit Goal type, Repeats every, Starts, Ends, Stop repeating, targets: Can edit on the goal (`canEditGoal`), as today's edit.
- Connect, change or reconnect a source: Can edit on the goal **and** Can view on that List or table at that moment. Contributors cannot connect sources.
- Link a KPI to a target: Can edit on the goal **and**, for anyone but the owner, the right to read the owner's KPI numbers (C6). The 403 says who can fix it: "You can link a KPI only when you can see Priya's KPI numbers. Ask Priya or their manager to link it."
- Check in (the current period, or the previous one inside its grace) and Refresh: Can edit or contributor, as today's check-in.
- See periods, history and results: whoever can see the goal (`canSeeGoal`).

### I. API and MCP

- `POST /api/okrs`, `PATCH /api/okrs`: accept `repeat` (null or one of the four), `repeatStart` (a period key, current or later), `repeatUntil` (a day key or null), and for a conversion `firstPeriodStart` ("start" or "carry the change"); refuse `endDate` together with `repeat` (400); apply A3; the response carries the current period. Both go through `createGoal` / the shared update helper.
- Ask AI `create_okr` gains an optional `repeat`, through `createGoal`, and refuses an end date together with it. Without it the assistant would keep creating monthly goals with due dates, the founder's exact complaint.
- `GET /api/okrs` rows gain `repeat` and `period: { key, label, startsAt, endsAt, graceEndsAt, closesAt, daysLeft, state } | null` (state: open, grace, closing); `progress`, `verdict` and `endDate` behave per E1; the response carries `recurringGoals`.
- `GET /api/okrs/[id]` and the page read `?period=`.
- New `GET /api/okrs/[id]/periods?page=`: 12 periods a page, newest first, each with its targets' start, target, value, progress and pause, its result, attainment and state.
- `POST /api/okrs/[id]/check-in`: optional `periodKey`; 409 outside the period's hand check-in window; 409 on any target measured automatically.
- `POST` and `PATCH /api/okrs/[id]/key-results[/krId]`: accept `source` (validated: the List, Space or table exists in the org and the caller can open it; field and column ids exist; the kind fits the goal, C6) or `kpiId`, and `periodStart`; record `sourceById`; 409 on `currentValue` for a repeating goal (B8).
- New `POST /api/okrs/[id]/key-results/preview` (E3) and `POST /api/okrs/[id]/refresh` (C7; anyone who may check in; rate limited per person and goal, 6 a minute). Every count a request triggers (the preview, the first count of a source connected or reconnected by the key-results POST and PATCH, Refresh) comes from one budget per person, `goal-count:<userId>`, 30 a minute. Once it is spent, the preview and Refresh are refused before they count (429 "You're counting too often. Try again in a minute.", and the editor's preview shows those words), but a Save never is (fixes review L4): the target is saved uncounted, the answer says `countsLater: true`, the toast reads "Target saved. Its number is counted within the hour.", and the cron or the next page open counts it.
- New cron `POST /api/cron/goal-periods`.
- MCP `list_my_goals`: each goal gains `repeat` (string or null) and `period` (label, startsAt, endsAt, or null); its `progress`, `status` and targets' `currentValue` already show the current period (B8). Output schema updated in step with the payload. No new MCP write tool.


## 3. Data

All additive and idempotent, catalog guarded, declared in `prisma/schema.prisma`, listed last in `SQL_MANIFEST` (`scripts/deploy-migrations.mjs`) as a text edit, with a row in `prisma/sql/README.md`. The deploy applies them before the build (1.12), so no one applies SQL by hand. **No existing row is rewritten.** Both headers say "apply this file before the code": the new client selects every scalar on a `findMany` without a `select` (the README's warning), and `OKR`, `KeyResult` and `KRCheckIn` are read that way.

**File 1: `prisma/sql/2026-10-27-recurring-goals.sql`** (step 1)

```sql
/* 2026-10-27 Recurring goals (docs/plans/recurring-goals.md). Additive and
   idempotent. EXISTING ROWS ARE UNCHANGED: every existing goal stays one time
   (repeat NULL), no period is created for it, every check-in keeps periodId
   NULL. APPLY THIS FILE BEFORE THE CODE. No key to "User" (sourceById is a
   bare id), so no lock on it. Rollback: drop the two new tables and the new
   columns. */

ALTER TABLE "OKR" ADD COLUMN IF NOT EXISTS "repeat" TEXT;
ALTER TABLE "OKR" ADD COLUMN IF NOT EXISTS "repeatUntil" TEXT;

ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "source" JSONB;
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourceById" TEXT;
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourceRefreshedAt" TIMESTAMP(3);
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourcePausedReason" TEXT;
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "periodStart" TEXT;

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
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
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
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyResultPeriod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KRCheckIn" ADD COLUMN IF NOT EXISTS "periodId" TEXT;

/* Then, each inside a DO block that first checks pg_constraint or pg_indexes:
   GoalPeriod_okrId_fkey             REFERENCES "OKR"("id") ON DELETE CASCADE
   KeyResultPeriod_keyResultId_fkey  REFERENCES "KeyResult"("id") ON DELETE SET NULL
   KeyResultPeriod_periodId_fkey     REFERENCES "GoalPeriod"("id") ON DELETE CASCADE
   KRCheckIn_periodId_fkey           REFERENCES "GoalPeriod"("id") ON DELETE SET NULL
   UNIQUE GoalPeriod_okrId_key_key ("okrId", "key")
   INDEX  GoalPeriod_okrId_startsAt_idx ("okrId", "startsAt")
   INDEX  GoalPeriod_status_closesAt_idx ("status", "closesAt")
   INDEX  GoalPeriod_organizationId_idx ("organizationId")
   UNIQUE KeyResultPeriod_keyResultId_periodId_key ("keyResultId", "periodId")
   INDEX  KeyResultPeriod_periodId_idx ("periodId")
   INDEX  KRCheckIn_periodId_idx ("periodId")
   INDEX  OKR_repeat_idx ("repeat")
   The OKR, KeyResult and KRCheckIn tables are small; each statement runs only
   when its object is missing, so a later deploy takes no lock. */
```

**File 2: `prisma/sql/2026-10-27-item-completions.sql`** (step 4): one new table and its indexes, nothing on `Item`.

```sql
/* 2026-10-27 Item completions (docs/plans/recurring-goals.md C4). One new
   append-only table: a row each time a task enters its List's done group.
   No foreign key to "Item", so no lock on it; the nightly repair deletes rows
   whose task is gone. Existing rows elsewhere are unchanged. The one-time
   backfill is scripts/backfill-item-completions.ts, NOT part of the deploy.
   APPLY THIS FILE BEFORE THE CODE: the status write paths insert into it.
   Rollback: DROP TABLE IF EXISTS "ItemCompletion"; */

CREATE TABLE IF NOT EXISTS "ItemCompletion" (
  "id"             TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "boardId"        TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "doneAt"         TIMESTAMP(3) NOT NULL,
  "actorId"        TEXT,
  CONSTRAINT "ItemCompletion_pkey" PRIMARY KEY ("id")
);

/* Catalogue-guarded indexes, built on the new, empty table:
   ItemCompletion_organizationId_doneAt_idx ("organizationId", "doneAt")
   ItemCompletion_itemId_doneAt_idx         ("itemId", "doneAt")
   ItemCompletion_boardId_doneAt_idx        ("boardId", "doneAt") */
```

**Not a schema change:** `PerformanceScore.breakdown` (JSON) gains `okrParts` (G1).

**Migration of existing goals:** none (A5). The only data script is the ItemCompletion backfill, run once by the founder after step 4.

**Export:** the workspace export gains `repeat` on goals and a `goal-periods` file (period, result, attainment, per-target values), so history leaves with the customer's data.


## 4. Steps

Each step: one builder, one read-only reviewer, high and medium findings fixed, one push. Everything is behind `RECURRING_GOALS` (2.0), so a push changes nothing anyone sees until the founder sets it. After step 6, the final round of three reviewers tests everything before the founder's list. Every behavior change carries a test that fails on the base commit (the builder restores the changed sources from the base in a scratch copy and reports the counts). Screenshots are taken by the lead with the local smoke harness, at 1280 and 390 wide.

**Step 1. The period engine, the switch and the data.**
- `src/lib/goals/goal-period.ts` (pure): `periodFor`, `nextPeriod` (the identity and change rules of B2 and A3), `graceEndsAt`, `kpiCloseAt`, labels, `trackedFrom`, `resultFor`; `src/lib/goals/recurring-flag.ts`.
- File 1, the schema models, the manifest and README rows.
- Must prove (unit): October in Asia/Kolkata starts at 30 Sep 18:30 UTC; a New York month across the November daylight-saving change; Pacific/Auckland; a zone whose daylight-saving change falls at midnight (America/Santiago, where the period starts at 01:00 through `startOfZonedDay`, B2); Sunday weeks; April fiscal quarters and years; grace in calendar days; October's KPI close at 1 Dec 14:00 UTC; no gap and no overlap across a zone, week start and fiscal start change; monthly to quarterly and monthly to weekly changes; no stub under half a period; the new files never use `hour12: false` (existing guarded uses, such as `zoned-input.ts:27`, are out of scope); `npx prisma validate`.

**Step 2. Repeating goals on the server.**
- `createGoal` and the update rules (A1, A3, A4) for `POST`/`PATCH /api/okrs`, `create_okr` and the Tuesday template; `settleGoalPeriods` with its locks (B3), the `goal-periods` cron at `5,35 * * * *` and its CRON-SETUP row; `writePeriodValue` and the writers contract test (B8); `isMeasuredAutomatically` in the four places (C2); check-in period routing, grace and the 409s (B7, C1); carry (B4); parent periods from children's periods, deepest first (D2); KPI period matching, combining and the KPI close (C6, B7); pace and staleness from `trackedFrom` (E4); `scored` (B6); stored status never COMPLETED while running (B8); target edits and deletes keep the past (B5); `GET /api/okrs/[id]/periods`; the three Inbox kinds (F).
- Must prove (route and lib tests failing on the old code): a monthly goal posted with no `endDate` gets its first period; `repeat` with `endDate` is a 400 from POST and from `create_okr`; a check-in lands in the current period and the goal shows that period's progress; a check-in after `graceEndsAt` is a 409 and one before it is accepted; a check-in racing the close either lands before the freeze or gets the 409; two concurrent settles make one period, one close and one score patch; the Company goal with three monthly Department children closes October on its children's October numbers; a one-time parent does not drop on 1 November; a goal created on 27 October is not Off track that day and its October is not scored; converting a goal with "38 now, 30 on 30 Sep" opens October at 0, or at 8 when chosen; a carried "open bugs" target opens November at October's final value; a weekly goal untouched for 40 days with the cron off opens its missing weeks on the first read (reading Closing) and the next cron run closes them Not measured and unscored; a KPI-linked October stays open until 1 Dec 14:00 UTC while its hand-checked targets refuse check-ins after 5 Nov; deleting a target keeps its closed rows and leaves none in open or later periods; every stretch of an open period (A3) recomputes its `graceEndsAt` and `closesAt`, so an October stretched by one day takes numbers until the end of 6 November; a change to weekly is a 400 while a target links a KPI; a restarted goal's first period does not overlap its last one after a zone change; a hit monthly goal still shows on Home; KR PATCH with `currentValue` on a repeating goal is a 409.

**Step 3. The modal, the goal page and the list (behind the switch).**
- `CreateGoalModal` per A2 and A3 (Goal type, Repeats every, Starts with the half rule and dates, Ends, Remind the owner to check in, the change lines, the conversion choice); the goal page per E2 (Repeats row, the generalised period control, the grace, KPI, Closing and carried lines, Past periods with the trend, Activity This period · All periods); the list per E1; Stop repeating and the delete confirm (A4); the migration offer (A5); Home and the profile per E4.
- Must prove: a contract test that Repeating renders no Due date field and saves without one (the old modal refuses with "Pick a due date."); `MonthControl`'s month default unchanged for KPI reviews; nothing new renders with the switch off.

**Step 3a. Designs for the founder.** Built behind the switch and screenshotted locally by the lead, at 1280 and 390 wide: the **Goal type block** in the modal (One time and Repeating, with Starts showing "4 days left"), the **period control** on the goal page (open, grace and closed periods), the **Past periods card** with its trend, and the **target editor** (E3: this step builds its layout and fields, Check-ins and A KPI working; steps 4 and 5 wire the List and table rows). The founder approves, or asks for changes that are made before step 4. **The switch can never be set before this approval**, and because the switch hides everything, pushing behind it meanwhile is safe.

**Step 4. Numbers from a List.**
- File 2; ItemCompletion writes in every path of C4, the nightly repair and the backfill script; the dashboard row loader extracted from `computeWidget` into a shared function (dashboard results byte identical, its tests unchanged); `src/lib/goals/goal-source.server.ts` (count, sum, average, the windows and date keys, SQL only for the window, `applyWidgetFilter` in the workspace zone, the 20,000 cap, the connector checks, the pause rules, the signature); `POST /api/okrs/[id]/refresh`, the preview route and the cron refresh grouped by connector; the List rows of the target editor; Refresh and Open source in the row menu; the private wording and the audience line (C9); `goal_source_paused`; the handover offer (C10).
- Must prove: an "After completion" weekly task done four times in October counts 4; a task done in September and reordered in October counts in September only; reopening a task removes its completion; a task created straight into Done, duplicated, and restored from Trash each count once; a task due 1 November counts in November in Kolkata and New York, whichever way it was written; a deactivated connector pauses the source with its message, and so does one who lost the List; a viewer without the List sees the number and "From a private List", never the name; a count over the cap pauses rather than truncating; a Right now count freezes at the first run after the end and a bug closed on 2 November leaves October alone; a source paused for 20 days of October is left out of October; a query-count test: 2,000 period openings in one batch run a fixed number of queries and one org rollup. Screenshots of the editor with a List and of a paused row.

**Step 5. Numbers from a table.**
- The table, column and filter pickers in the target editor; the table branch of `goal-source` with filled rows only, server formula evaluation through the embed's engine path with the workspace zone's `TODAY()`, the caps and yielding; module off, table deleted and column removed pause.
- Must prove: a new table with 3 typed rows counts 3, not 1,003; a seeded row filled in and dated 2 November counts in November; a sum over a formula column equals what the grid computes for the same rows; `TODAY()` in a formula reads the workspace day; trashed rows never count; a Date column row dated 1 November counts in November in Kolkata and New York; Tables off pauses. Screenshots.

**Step 6. Reminders, score, reviews, effort and the outside readers.**
- F (both crons, the end nudge on weekdays, digests, the em dash and link fix, reminders skipping automatic targets); G (`okrParts`, the period mapping, the close patch, review cycles and the self assessment); E4 effort windows and the workspace-zone month; I (MCP `list_my_goals`, Ask AI `search_okrs`); the export (section 3).
- Must prove: ten monthly goals send one "started" row and one "results" row; the end nudge fires on the Friday when the month ends on a Sunday; reminders skip a KPI-linked target; October's score row reads October's period at 01:00 IST on 1 November; a quarterly goal counts only in its last month; a number entered on 3 November inside the grace changes October's goal part and nothing else; a row from before `okrParts` is left alone; a Q3 review opened on 2 November reads July, August and September; MCP output validates against its schema with `period`.

**Then**: the final three reviewers on everything, the founder's list, and only then the founder sets `RECURRING_GOALS`.


## 5. Risks, and what needs the founder's eye

**Founder steps** (there is no SQL to apply by hand: the deploy applies the manifest, 1.12):
1. **Approve the four designs in step 3a** (the Goal type block, the period control, the Past periods card, the target editor). The switch cannot be set before this.
2. **Add the crontab row** for `goal-periods` at `5,35 * * * *` (required: it is the only thing that closes periods, B3).
3. **Run the ItemCompletion backfill** once after step 4 (dry run first).
4. **Set `RECURRING_GOALS`** after step 6 and the final reviewers.

**Risks:**
- **The status write paths are the busiest in the product.** Every path that puts a task into done must write an ItemCompletion (C4); for the paths through `updateBoardItem` the nightly repair catches a missed one within a day at its activity time, and logs it so the path gets fixed, and every other path (create, move, status set, duplicate, restore, import) is covered in its own write and proved by its own test. The step 4 reviewer checks every status writer against the list in 1.9.
- **Server load.** Counting many sources, and table formulas above all, costs CPU; the stored numbers, the signature skip, grouping by connector (a table's counts by table, one read each), the time budget per run and the caps bound it, and step 4 proves the batch query count.
- **Existing "monthly" goals stay one time** (A5); the founder's own team switches the ones they meant, helped by the "Make this a monthly goal" offer.
- **One hard delete stays**: deleting a whole goal still removes its history, now with a confirm that names it and Stop repeating offered beside it (A4).

Out of scope, on purpose: per-person copies of a goal (goals-rebuild decision 1 stands; a manager who wants each report's own monthly target creates each report's goal), counting tasks tagged with a KRA, the legacy Task table as a source (it is being retired), link, lookup and rollup columns, Average on dashboards, planning a different target for one future period, creating past periods, and automations on period events.


## 6. After: spec review 2026-10-27

Spec review 2026-10-27 (one reviewer, against commit `34ff61b4`): 5 high, 18 medium, 20 low, all addressed.

High:
- **H1** parent periods read children's next period: D2 (parent periods from children's periods by cadence, one-time child as of `endsAt`, one-time parent over closed periods), B3 (deepest first), step 2 proof. Refined: a coarser child contributes its period holding P's last day.
- **H2** KPI targets frozen before the KPI loop: B7 (`closesAt` waits for the KPI write gate; "Open for KPI numbers until 30 Nov"; hand targets still stop at grace), 1.8 (the correct precedent), step 1 and 2 proofs.
- **H3** late start Off track and Missed: A2 (Starts half rule with "4 days left"), B1 `trackedFrom`, E4 pace, B6 and G1 `scored`, step 2 proof.
- **H4** conversion double counts: A3 (opens at the start value, old check-ins keep no period, the "What was added since 1 Oct" choice), step 2 proof.
- **H5** seeded blank table rows: C5 (filled rows only by `ROW_HAS_DATA`, no "Row added"; `filledAt` weighed and rejected), step 5 proofs.

Medium:
- **M1** deactivated connector: C8 (User row check, `nodeCtxFromViewer`, `canEditGoal` from that row), 1.9, step 4 proof.
- **M2** races: B3 (advisory lock, ON CONFLICT, skipDuplicates, close FOR UPDATE, `scorePatchedAt`, lazy paths only open, "Closing"), B8 and C1 (one transaction), step 2 proof.
- **M3** period identity: B2 (stored range is the current period, keys and labels, no overlap, no stub), A3 (cadence change at the next boundary after the current end). Resolved differently for finer cadences: the current period stretches rather than being cut, because a cut leaves a stub carrying a whole period's target.
- **M4** missed periods: B3 (open every missing period, 24 per run, Not measured and unscored for hand targets, no-gap only for running goals, crontab required), step 2 proof.
- **M5** Right now measured into grace: C3 (frozen at the first run after `endsAt`), step 4 proof.
- **M6** reset wrong for levels: B4 ("Each period starts at", default by direction, "Carried from October"), step 2 proof.
- **M7** sourced targets read as hand-checked: C2 `isMeasuredAutomatically` in the four places and the reminders, F, step 6 proof.
- **M8** score part not isolatable: G1 `okrParts`, quarterly and yearly in their end month, G2 patch rules, step 6 proofs.
- **M9** review cycles read the current period: G3, step 6 proof.
- **M10** unrouted mirror writers: B8 (`writePeriodValue` only, 409 on `currentValue`, contract test), A1 (`createGoal` for every create path), 1.4 lists the writers.
- **M11** `doneAt` misses completions: C4 (append-only ItemCompletion, every path, roll-forward, duplicate, Trash, no `updatedAt` fallback, nightly repair, backfill from not-done-to-done), 1.9, step 4 proofs.
- **M12** "filters in SQL": C3 (only the window and fixed rules in SQL, `applyWidgetFilter` in the workspace zone, cap after the window).
- **M13** performance: B3 (one rollup per org per batch), C7 (grouped by connector, `refreshedAt` order, signature), C5 (formula cap 20,000, one table at a time, yielding), step 4 query-count proof.
- **M14** silent pauses: C10 (`goal_source_paused`, more than half a period left out, handover offer), B6, F, step 4 proof.
- **M15** delete erases history: B5 (closed rows survive a target delete through ON DELETE SET NULL and copied title and unit), A4 (goal delete confirm names "12 months of results", Stop repeating beside it). Resolved differently from `KeyResult.archivedAt` and Stop tracking: an archived flag must be learnt by every target reader, and one that misses it shows a stopped target as live in a rollup; keeping the closed rows changes no reader.
- **M16** stale list and boundary: B3 (GET settles the whole visible set, writing only when needed; cron at `5,35 * * * *`).
- **M17** half-built steps go live: 2.0 (`RECURRING_GOALS` on the `MCP_OFFERED` pattern; gates the doors, while the reading half always runs so turning it off never strands a live goal), Inbox kinds in step 2, section 4.
- **M18** designs before turning on: step 3a, section 5 founder step 1, E3 (exactly what the target editor reuses and what is new).

Low:
- **L1** index lock on Item: no column on Item at all (ItemCompletion, a new table with no foreign key to Item, indexes built on the empty table), section 3 File 2.
- **L2** founder applies SQL: removed; the deploy applies the manifest (1.12, section 3); founder steps in section 5.
- **L3** `create_okr` bypasses POST: A1 `createGoal` for POST, `create_okr` and the Tuesday template; I (`create_okr` refuses an end date with `repeat`).
- **L4** "112%" impossible: B1 and B6 (unclamped `attainment` for display, result on clamped progress), 1.3.
- **L5** startDate cut to 10 characters: A1 (UTC midnight of the first period's key), 1.2.
- **L6** west-of-UTC dates: C3 date-key rule (also C5), steps 4 and 5 proofs.
- **L7** "five calendar days" and weekday cron: B2 table, B7, F (first run inside the last 3 days), step 6 proof.
- **L8** one row per owner, no weekly nudge: F.
- **L9** quarterly goal on a monthly KPI: C6 (Latest month · Sum of months · Average of months).
- **L10** Space source widens: C3 (`sourceListCount`, Activity line).
- **L11** audience warning: C9.
- **L12** All periods on repeating goals: E2 Activity toggle.
- **L13** Home hides a hit goal: B8 (stored status never COMPLETED while running), E4 (Home's filter named), 1.11 (no dashboard goal card).
- **L14** yearly April default: A2 (Starts options show their dates).
- **L15** small edits: A3 (moving Starts later), B5 (a target added in grace), A2 ("Last period: March 2027"), C7 (automatic refresh only for people who may check in).
- **L16** daylight saving at midnight and the `hour12` check: step 1 proofs.
- **L17** no Average on dashboards: C3, out of scope list.
- **L18** a migration offer: A5 ("Make this a monthly goal").
- **L19** reminders label: A2 and E2 ("Remind the owner to check in", hidden when no target is hand-checked).
- **L20** `TODAY()` zone: C5, 1.9, step 5 proof.

### Step 2 review, 2026-10-27 (0 high, 6 medium, 11 low; lead decisions)

- **M5, undoing a conversion (Repeating to One time).**
  - If the discarded period has no check-ins: every hand-checked target goes back to its value before the conversion (its newest check-in with periodId null, otherwise its start value), and startDate is restored if it was rewritten.
  - If it has check-ins: the period's numbers are kept, and Activity says "Stopped repeating. Targets keep October's numbers."
  - This supersedes A3's "targets keep their current values" for this case.
- **M6, KPI identity.** Each KeyResultPeriod stores the reading identity (kpiId and kpiUserId) at opening, in a new additive SQL file. Close and read use the stored identity, so an owner change or an unlink during the hold window never rewrites an ended period. This supersedes reading goal.ownerId and kr.kpiId live (C6 and B7).
- **Fixed in step 2:**
  - M1: conversion or restart opens inside the PATCH transaction.
  - M2: one verdict everywhere; staleness from the later of trackedFrom and the period's own last check-in.
  - M3: chunked settles; read paths survive a settle failure; closes run even when that org's settle failed.
  - M4: linear in-memory work; only the latest period plus the closed periods D2 needs.
  - L1 to L11: a parent's close waits for KPI-held children; the as-of reader; closesAt kept in step; per-period close isolation; sorted rollup writes; a 64-bit lock key; E1 list visibility; Ends checks; refusing completed with a conversion; the safe "added since"; create_okr hides repeat while the switch is off.

### Step 4 review, 2026-10-29 (1 high, 3 medium, 16 low; all fixed)

- **H1, the raw source reached every goal viewer.** `enrichKeyResults` and `enrichKeyResultGroups` drop `source`, `sourceById`, `sourcePausedReason` and `sourceRefreshedAt`, and send `measuredAutomatically` and `kpiCombine` in their place, so no goal route (the list, the goal, POST and PATCH, the key-results POST and PATCH, my goals) and no profile carries a List, a Space, a filter, a field key or a connector. The goal page reads the stored rows through `describeTargetSources`, the one place a source's settings leave the server, which gives who connected it and why it paused to editors only ("Paused" for everyone else, in GET /api/okrs/[id] and the periods route too). A contract test walks every answer. MCP `list_my_goals`, Ask AI `search_okrs` and the export already select their columns.
- **M1, the close.** One final count per level before its closes, scoped to the level's goals and periods, with no rollup of its own (the close stores one).
- **M2, status set changes.** A status leaving the done group removes its tasks' latest completions; archived tasks are judged both ways; an unarchive into done with no completion follows the backfill's rule (a row at its last entry into done, none without one).
- **M3, old work.** `createBoardItem` takes `completionAt` (null: no row): the legacy import passes the row's end or published date (or none, never later than the import), Template Center seeds pass none, Duplicate keeps `completionFrom`.
- **Fixed in the same round:**
  - L1 to L4: a move re-reads its task's and subtasks' statuses under their row locks; Right now freezes run first and outside the budget, and a paused one freezes its stored number; a one-time goal's ended window is counted once more, then stands; the cron visits the workspace counted longest ago first and never stops before the last one.
  - L5 to L8: the cap is decided on counts, after the filters, and the preview is limited to 30 a minute per person; the audience line checks every List a Space source counts; the Activity line names a Space only when the workspace may open it; goal_source_paused reaches only people who hold a level in the workspace, and never a leaver about themselves.
  - L9 to L12: "Paused from 14 Oct" is the workspace's day, formatted on the server; the check-in modal names the List, or "a private List"; ItemCompletion is a workspace orphan table for the hard delete; a restore moves every row of the task to its home.
  - L13 to L16: Reconnect is refused while the switch is off; Hide completed does not apply to Done date (hidden in the editor, read as off by the server); the signature hashes the linked task ids; a wide Date field window reads only tasks whose field is set.
  - The goal page on a phone: below 640 a target row is two lines (the name, wrapping, with its "..." menu; then the numbers, the bar, the percent and Check in), and the Contributors picker takes the value column's width.

### Step 5 review, 2026-10-29 (0 high, 3 medium, 7 low; all fixed, L6 accepted)

- **M1, a broken formula summed to 0.** Deleting a column a formula reads rewrites the formula to `#REF!`, every cell read the error, and a Sum stored 0 (an Average its start) with no pause, which the close froze into the score. `countTableRows` now tallies the rows whose computed cell in a column the count reads (the metric, the Date column, a filter) shows an error. When every row it would read errors, or no row has a number while some error, or a formula column it reads holds `#REF!`, the source pauses with the formulas words. A few error rows are still left out, as the grid's Sum leaves them, and the preview says "N rows show an error and are left out."
- **M2, the request path rebuilt the engine on every call.** The preview, the count when a source is saved (key-results POST and PATCH) and the goal page's Refresh now share one per-process `EmbedSnapshotCache` (three entries, 60 seconds), keyed `tableId|zone|day|engine` or `tableId|plain|columns`, with the data signature as its sig, as the public embed's memo is. Safe to share: the read depends on the table alone, and the module, table and column checks of the connector run before it on every count.
- **M3, one read of a table per run.** Inside each mode (freeze, then refresh) a run counts every job on one table together, whoever connected it, tables ordered by their oldest count, then by id. Its memo holds that table only (its plain read and its engine, no TTL) and is cleared after the table's last job; a List's jobs stay grouped by connector. Proved by targets on tables A B C D E A plus a second connector on B: each table is read once.
- **Fixed in the same round:**
  - L1 to L4: with Tables off a table source shows no Open source and no Reconnect (`describeTargetSources` asks the module once per call); a plain read projects the columns its targets read (the union over the run), with `filled` still decided on the whole row in SQL; a period's final number (a Right now freeze, the close's final count, a one-time goal's last count) reads `TODAY()` at `min(now, end - 1ms)` in the workspace zone, and `NOW()` is day-granular (C5); a value filter none of whose options its column still offers pauses with the filter words.
  - L5: an unticked checkbox (`false`) is not data, in `ROW_HAS_DATA` (the goal count, the Tables list's Rows, the entity links' row count, a form's append position) and in `isBlankValues` (an import's and a form's reuse of blank rows), matching the embed's `rowUsed`; `table-source.dbtest.ts` proves it on Postgres.
  - L6, accepted: a one-time goal's table source gets no signature skip (C5), since it would need a column.
  - L7: the redaction contract seeds a table target paused with "Priya can no longer open the table it counts. Reconnect it.", and walks the periods route, the key-results DELETE and the check-in answers too.

## Final review

Three reviewers on everything at `b7ef7be6`, 2026-10-29. The first fix run covers the data integrity review (0 high, 7 medium, 10 low, and the workspace in the digest ids) and the security, privacy and permissions review (0 high, 2 medium, 4 low); the second, the product, UI, accessibility and copy review (3 high, 12 medium, 22 low). All fixed.

### Data integrity (0 high, 7 medium, 10 low; all fixed)

- **M1, a parent waits for every child period it reads.** A parent's close holds for each child period D2 reads for it on its cadence or a finer one (`childPeriodsHoldingClose`, in the close holds and again under the close's lock), so a quarterly goal waits for its monthly KPI child's December (B7). Kept from D2: a coarser child's period holds nothing, since the parent reads it as it stands; waiting for it would count work after the parent's end and keep a month open for a quarter.
- **M2, a window stops at its grace.** A windowed List or table source's final number is its count at the first cron run after `graceEndsAt`, frozen (`frozenAt`); a KPI hold never recounts it, the close's final count skips a frozen row, and no request counts it after its grace (C7).
- **M3, a target deleted in a grace keeps its row.** Only rows in periods that have not ended are deleted; an ended period keeps the row (`keyResultId` null), and the close freezes it at its number (B5).
- **M4, a status set round trip.** Lead decision, the simpler fix with one addition: an entry into done from a status set change takes the backfill rule's date when there is one, and only then now; and a removal sets the completions aside in one activity row on the List, so a round trip restores their real dates while nobody has moved the task since. A void column was weighed: every completion reader would have to filter it, and one that missed it would count a task that is not done; the set-aside row has one reader, needs no SQL, and is one write per change however many tasks (C4).
- **M5, a duplicate gets no completion.** Lead decision: the task Duplicate and the List duplicate write none (`completionAt: null`; `copyLatestCompletions` and `completionFrom` are gone). C4 and the step 4 test say so.
- **M6, a missing crontab row is not silent.** Lead decision: `okr-reminders` (installed, weekdays) counts the OPEN periods more than two hours past their close (`staleCloseCount`, on the `status, closesAt` index), logs them, and emails `OPS_ALERT_EMAIL` at most once a day through `alertOpsOnce`, the path a failed job's alert takes (B3). The goal page reads such a period as "Closing".
- **M7, no "Missed, 150%".** A closed period shows its unclamped attainment beside Hit only, and its clamped progress beside any other result (`shownPercent`, in the summary, the Past periods rows, the trend's tooltip and the assess headline; B6).
- **L1:** the Trash page's unarchive of a task goes through `restoreBoardItem`, so it writes the completion an unarchive owes, clears the archiver and logs RESTORED.
- **L2:** "Make this a monthly goal" is offered only while today falls inside the goal's month (A5).
- **L3:** a one-time source with no Start date counts from the day the goal was made (C2).
- **L4:** no KPI link while a goal changed from weekly still runs, or has still to open, a weekly period (`kpiLinkRefusal`, C6).
- **L5:** the backfill writes page by page, each page in a transaction that locks its tasks FOR UPDATE and checks each again; a task reopened, moved or given a completion since the plan is skipped and counted (`changedSince`).
- **L6:** Repeating to One time is refused once any period has ended, not only once one has closed (A3).
- **L7:** Effort's tasks done, with a window, are the completions on the window's days (E4).
- **L8:** a one-time source paused at its count after the due date is tried again until a count succeeds (C2).
- **L9:** moving Starts later reads a target back to its start value only when it starts each period there; a "Last period's number" target keeps its level (A3).
- **L10:** a running month's recalculation runs before `scorePatchedAt` is stamped; a failed one throws, is counted by the run, and is tried again by the next (B3).
- **The workspace in the ids:** the started row's and the end nudge's ids are the day and a digest of the workspace and the person, so an owner with goals in two workspaces gets each workspace's row (F).

### Security, privacy and permissions (0 high, 2 medium, 4 low; all fixed)

- **M1, only people who still work here.** The started and results rows, the end nudge and its email, and the stale check-in rows and their emails go only to an owner who is not deleted, not deactivated and holds a level in the goal's workspace (`liveRecipients`, one read narrowed by id through `inWorkspaceWhere`), as `goal_source_paused` already did (F).
- **M2, one count budget per person.** Lead decision: `goal-count:<userId>`, 30 a minute, shared by the preview, the first count of a source the key-results POST or PATCH connects, and Refresh, checked before anything is written; Refresh also keeps its limit of 6 a minute, now per person and goal. A refusal is 429 "You're counting too often. Try again in a minute." (I). The optional per-process queue for engine builds is not built: the budget, the table caps and the shared read cache (C5) already bound one person's load.
- **L1:** GET /api/okrs/[id] checks `canSeeGoal` before it settles, so a caller who cannot see a goal never makes it write.
- **L2:** linking a KPI, by anyone but the owner, needs `canTouchUserAlignment` on the owner (403, worded in the product part: "You can link a KPI only when you can see Priya's KPI numbers. Ask Priya or their manager to link it."; C6, H).
- **L3:** `goal_source_paused` reaches each person only while `canSeeGoal` holds for them as they are now (C10).
- **L4:** a Done-date count pages through at most four times the cap of completions before its filters, and pauses with the cap's words past it (C3).

Proved by `src/lib/goals/goal-final-review.test.ts` (and, for M5 and M4, `goal-source.step4.test.ts`), every test failing on `b7ef7be6` but the one that holds D2's coarser-child rule; on Postgres by `scripts/recurring-goals/final-review.dbtest.ts` (the set-aside round trip, the workspace membership read, the backfill's lock waiting for a status write, and the dead-man count). No SQL.

### Product, UI, accessibility and copy (3 high, 12 medium, 22 low; all fixed)

Lead decisions for H1, H2, H3, M2 and M7 came with the review; every item is fixed as the review worded it unless noted.

- **H1, late numbers for last month.** While the period before the one running now still takes numbers, November's Targets card says "October still takes late numbers until 5 Nov." with "Check in for October" (`?period=2026-10-01`), or "Open October" for a viewer who cannot check in, and past its grace "October still takes KPI numbers until 30 Nov." The period view carries `previous` (its key, label, cadence, `takesLateNumbers`, `kpiHeld`, `graceLastDay`, `kpiLastDay`), null once it takes nothing more. The check-in's title always names its period ("Check in on Demos booked for November 2026"). E2.
- **H2, a goal that has not started.** A new verdict, `not_started` ("Not started", neutral): no pace, no staleness, in the list and its filter (offered while the switch is on), the profile and assess. The Summary's top line is "Starts 1 Nov. Check-ins open then." (`goalPeriodsSummary.startsOn`), the ring reads "Not started", Check in is hidden while targets can be set up, and assess answers "Starts November 2026." with no AI. No sentence of a repeating goal names a due date: the worked-out one says "On track for this period." with no period name, the AI is told the goal repeats and has none (`repeats`, `period` in its numbers, and a rule), and an AI sentence naming a due date or a deadline gives way to the worked-out one. E2, E4.
- **H3, the source and the pause at every width.** Below 1280 what measures a target (its source, its KPI, "Carried from October") is a line under the row; a pause is a line under the row at every width, "Paused. The last number counted stands.", with the reason after it for editors (the server sends it to editors only). No tooltip carries information the row does not show. C10, E2.
- **M1:** a period in its grace shows its result so far in the Summary, with no pace and no next step: "Week of 19 Oct ended: Partly hit so far, 84%. Late numbers until 27 Oct." (`endedSoFar`; the assess route keeps its own `?period=` reading for API callers).
- **M2:** a conversion's Starts defaults to the period running now (`startChoices(..., { conversion: true })`). A3.
- **M3:** "Make this a monthly goal" is offered with an empty start date too. A5.
- **M4:** one day for a closed period, the last day it took numbers (`lastNumbersDayKey`: its KPI day when its close waited for one, else its grace's last day): "Took numbers until 5 Oct. Its numbers are final." on the card, "September took its last numbers on 5 Oct. Its numbers are final." in the 409, and for a KPI-held period past its grace "September took its last check-ins on 5 Oct. Its KPI numbers are taken until 31 Oct." B7, E2.
- **M5:** the goal's Activity shows its own `okr_updated` lines beside the check-ins, and a target change names its target ("Demos booked: target changed from 60 to 40 for October 2026"). E2.
- **M6:** the row menu offers Keep repeating (Ends back to Never) on a goal set to end with the period running now, and Repeat again on an ended goal while the switch is on (`repeatMenuAction`). A4.
- **M7:** the composer's door reads "Count from a List or table". E3.
- **M8:** the conversion block sits under Starts and Ends, and the Starts column says "The due date 31 Oct is removed." A3.
- **M9:** closing the check-in or the target editor opened from a row's "..." returns focus to that "..." (`onCloseAutoFocus`; a check-in opened from its own button returns there).
- **M10:** every picker of the target editor and the table filters is named value first ("Choose a KPI, KPI", "Count of tasks, What", "Done date, Counted by", "Won, Stage").
- **M11:** a segment never wraps (`whitespace-nowrap` in `SegmentedControl`), and below 640 the reminder rhythm is a `PickerSelect`. A2.
- **M12:** a target counted from a List or a Space is linked work, in `goalVerdicts` (so the list, the page, the profile and assess agree) and in assess's words ("A target counts from a List, so that List's work moves this goal."). A table is not. E4.
- **Low:**
  - L1 to L4: "Right now: 10 of 200 rows" and "Its number on the period's last day becomes the result." ("on the due date" for a one-time goal); "Where" for a List as for a table; no second "Filter" heading under "Which tasks" (`WidgetFilterEditor heading={false}`; a dashboard card keeps it); the filled-rows rule said once, by the Which rows hint.
  - L5: every pause says its fix, and the preview's failure reads "Couldn't count the preview. Try again in a moment." Beyond the review's six, the Space, the date field and the table's column pauses say their fix the same way. Reasons already stored keep the words they were written with.
  - L6 to L9: "Closing. Its final numbers are being saved."; "the week of 19 Oct" inside a sentence; "3 goals reset for October 2026" and the kind "Goals reset"; the delete confirm's "can't".
  - L10 to L14: "Every week, ended after the week of 19 Oct" (`goalPeriodsSummary.lastLabel`); "Reminders" with "Weekly, to the owner"; every goal dialog's Cancel outlined, as the confirm dialog and the dashboard editor draw it; Past periods keeps its value at 390; the period name between the arrows is plain text, and a quarter or a year shows its dates beside what is left.
  - L15 to L18: "Remove the Stage filter" (no title-only tooltip), and the Remove List button is 24px; the paused Inbox row says "Open the goal and choose Reconnect in the target's menu." when reconnecting is the fix (`pausedInboxMessage`); Home's goal titles wrap below 640; the conversion's words ("What was added since 1 Oct: 2 (5 now, 3 on 30 Sep)", "October's 6 so far stay in Activity and won't count toward November.").
  - L19 to L22: a blocked Save says why in the footer until the rule stops holding, and the inline refusals are `role="alert"`; SettingsRow hints describe their control (`aria-describedby` through `PickerButton`), as the Starts dates line describes Starts; Refresh reads "Count again", the word its toast answers with; placeholders and the empty Part of are ink-2.
- **Run 1's strings, reviewed:** the weeks refusal now says when the weeks end and the month starts, "This goal runs weekly until 30 Nov. A KPI is recorded monthly, so link it from 1 Dec." (`kpiAfterWeeksWords`); the KPI owner refusal names whose numbers and who can link it, "You can link a KPI only when you can see Priya's KPI numbers. Ask Priya or their manager to link it." (`kpiOwnerDenied`). "Missed, 33%" is kept: a result with its number, in the style of "Hit, 112%" (B6), short enough for the chip rows and the trend's tooltip.

Proved by `src/lib/goals/goal-final-product.test.ts` (the routes, the period view and the words) and `src/app/(dashboard)/okrs/[id]/goal-final-product.test.ts` (the screens, rendered; the composer's door, the conversion block's place, Home's card and the modal's blocked Save read from their source, which a static render cannot reach), with the existing suites' pinned words moved to the new ones. No SQL.

### Fixes review (0 high, 2 medium, 7 low; all fixed)

A read-only review of the two fix runs above (`1da1eb07`, `d97587f4`), 2026-10-29. Lead decisions for M1, M2, L4 and L6 came with the review.

- **M1, a target deleted in a grace or a KPI hold could still change the ended period.** Data M3's kept row had no target behind it, so the close and the graph read it as a hand row: a KPI row's quarter fell back to its latest month, a List row read as checked in by hand, and a long pause no longer left it out. Lead decision: the delete waits. While a period that has ended but not closed holds a row of the target, DELETE answers 409 "October still takes numbers until 5 Nov, so this target can't be deleted yet. Delete it after that.", naming the hold's last day for a KPI hold ("until 30 Nov"), the period that closes last when two hold it, and "October is closing, so this target can't be deleted yet. Try again in an hour." past its close (`targetDeleteRefusals`, `deleteWaitWords`, read again under the goal's lock). The goal page sends each target's refusal with its row (`deleteRefusal`), so Delete target says it before any confirm, in a dialog with one OK (`deleteTargetDialog`); a 409 that comes anyway is said in the same dialog. A row with no target is now only one left before this fix; the close still freezes it in place. B5.
- **M2, a round trip stamped now on a done task that had no completion.** Lead decision: the set-aside row records those tasks in `meta.none` (id and status); putting the status back gives such a task none while it still has that status and nobody changed its status since. C4.
- **L1:** `GET /api/item-activity` refuses `BOARD_STATUS_SET` in its generic branch (404, as a List the caller cannot read), so the set-aside row is read by the status set writer alone. C4.
- **L2:** only a windowed one-time source paused at its count after the due date is tried again; a Right now source paused there keeps its stored number as final (and its first run after the end is tried whatever the age of an earlier pause). C2.
- **L3:** the backfill's page reads its Lists' status sets inside its transaction FOR SHARE and judges "still done" by them, locks its tasks parents before subtasks and each by id (`ORDER BY ("parentItemId" IS NOT NULL), id`), and retries a page that loses a deadlock (40P01), three tries in all. `writePage` no longer takes the run's status map. C4.
- **L4:** lead decision: the count budget never refuses a Save. Once it is spent, the key-results POST and PATCH save the source uncounted (`countsLater: true`, the toast "Target saved. Its number is counted within the hour."), and the cron or the next page open counts it; the preview shows the 429's own words ("You're counting too often. Try again in a minute.", `previewFromResponse`). Privacy M2's budget stands for the preview and Refresh. I, E3.
- **L5:** the late-numbers note links "Open October", never "Check in for October", when no row of October takes a hand check-in (`previous.takesHandCheckIns`: a row whose target is still there and is counted by neither its KPI nor a source). E2.
- **L6:** lead decision: the general fixes that reach one-time goals stay; the modal's comment and the switch's section (2.0) now say so.
- **L7:** US spelling through this spec (labeled, behavior, honors, catalog).

Proved by `src/lib/goals/goal-fixes-review.test.ts` (the routes, the close, the status set, the feed, the counts, the backfill's page and the period view) and `src/app/(dashboard)/okrs/[id]/goal-fixes-review.test.ts` (the delete dialog, the preview's words and the toast), every test failing on `c802c67a` but the one that holds the backfill rule for a task moved since; the final review's M3, L5 and privacy M2 tests and the product H1 test now say the new behavior. On Postgres by `scripts/recurring-goals/fixes-review.dbtest.ts` (the round trip's `none`, the backfill's page waiting for a status set change in flight, and a page retried after losing a deadlock to a move of a subtask). No SQL.
