# Recurring goals: one-time and repeating goals, periods, and numbers from Lists and Tables

Status: PLAN. Written 2026-10-27 against branch `agents-p1` (main plus one Settings commit, no goals changes). Owner: product.

Trigger (founder, 2026-10-27): "If I set a goal and if it is a monthly goal, then it should reset automatically every month and we can keep updating it every month. If it's a one time goal, then it ends. That is good but right now if we set it as a monthly goal, why does it ask for a due date? Rather, it should be repeated monthly and we should be able to add data to it right or collect data from any list or table so you have to think over it really well."

One line for the founder: **a goal is either One time (it has a due date and ends) or Repeating (weekly, monthly, quarterly or yearly, no due date); a repeating goal starts fresh every period, keeps every past period as history with its result, and each target can be checked in by hand or counted automatically from a List, a table or a KPI.**

Builds on, and keeps the decisions of: `docs/plans/goals-rebuild.md` (one shared goal, one scoreboard, owner singular, audience resolved at read time), `docs/plans/goals-redesign.md` (simple My / Team / Company, manager-owned assignment, automated effort, no OKR theatre), `docs/plans/goals-ux-redesign.md` (ClickUp-shaped goal page, Owner separate from Contributors, Set / Add / Subtract check-ins) and `docs/plans/ui-refresh/spec-goals.md` (the one verdict, the records-list `/okrs`, the 720 goal page). Where this spec changes one of them it says so.


## 1. What exists today

Paths are relative to the repo root.

### 1.1 The real reason "Monthly" asks for a due date

There is no repeating goal anywhere in WorkwrK. The "Monthly" the founder chose is the **Check-ins** control, which is only the reminder rhythm:

- `src/components/okrs/create-goal-modal.tsx:41-49` offers `CADENCE_OPTIONS` Weekly · Every two weeks · Monthly · None under the label "Check-ins" (`:342-345`). It is stored in `OKR.checkInCadence` (`prisma/schema.prisma:2927-2930`, a free String, default WEEKLY).
- Its only readers: the reminder cron (`src/app/api/cron/okr-reminders/route.ts:38-42`, `:101-112`), the "check-in overdue" rule (`src/lib/goal-verdict.ts:37`, `:84-99`), the goal page's "Check-ins" row (`src/app/(dashboard)/okrs/[id]/page.tsx:50`, `:218`) and the assess prompt (`src/app/api/okrs/[id]/assess/route.ts:94`). Nothing resets, repeats or copies a goal.
- The due date is **required by the modal**, not by the API: `create-goal-modal.tsx:217` (`if (!endDate) errs.endDate = "Pick a due date."`) and the Due date field has `allowClear={false}` (`:335-339`). This came from spec-goals ("Start date and Due date (date pickers; Due required)", `docs/plans/ui-refresh/spec-goals.md:212`), shipped in commit `415c182a` (Phase 6). `POST /api/okrs` accepts a goal with no dates (`src/app/api/okrs/route.ts:521-522`).
- Why it was made required: the whole goal model hangs off `endDate`. The pace verdict needs an end (`goal-verdict.ts:68-81` returns no pace without one, so a dateless goal can never read Off track); the quarter label is derived from it (`src/lib/fiscal-quarter.ts:44`, `page.tsx:102`); the list's default sort is Due (`src/app/(dashboard)/okrs/okrs-client.tsx:98-104`); "Show completed goals" hides by it (`src/lib/goals/goal-list.ts:107-110`); the profile's "this quarter" goals filter by it (`src/lib/person-alignment.ts:112-123`).

So the founder saw a reminder setting labelled like a goal type, next to a mandatory due date that only makes sense for a one-time goal.

### 1.2 The goal model

| Model | Where | What matters here |
|---|---|---|
| `OKR` | `prisma/schema.prisma:2913-2961` | `level` (GoalLevel enum, `:2907-2911`), `status` String re-derived from progress, `progress` Int, `startDate`/`endDate` DateTime? (`:2920-2921`), `quarter` free text kept but no longer written (`:2922`), `completedAt` (Mark complete, `:2926`), `checkInCadence` (`:2930`), `ownerId` (the one accountable person), `parentId`, `departmentId`. No period, recurrence or repeat field. |
| `GoalAssignee` | `:2969-2988` | Contributors (user, department, role or tag), resolved to people at read time (`src/lib/goal-audience.ts`). |
| `KeyResult` (shown as "Targets") | `:2990-3016` | `startValue`, `targetValue`, `currentValue` (one running number for the goal's whole life), `progress`, `lastReminderAt`, `kpiId` (hard link to a KPI, `:3006`). |
| `KRCheckIn` | `:3018-3027` | `value`, `note`, `userId`, `createdAt`. No period. |

Dates: a goal's start and due are calendar days stored as UTC midnight (`okrs-client.tsx:302-310` says so and reads them as wall dates; `GoalDates`, `src/app/(dashboard)/okrs/[id]/goal-page-bits.tsx:49-61`).

### 1.3 Progress, status and the verdict

- Target progress: `keyResultProgress` (`src/lib/alignment.ts:101-128`), direction aware (HIGHER, LOWER inferred when target is below start, MAINTAIN for KPIs).
- KPI-linked targets are derived on read: `deriveKeyResultProgress` (`:168-187`) with the **latest** KPIRecord of the goal owner, the highest month key regardless of the goal's dates (`latestKpiValues` `:236-288`, `enrichKeyResultGroups` `:476-531`).
- Goal progress: mean of targets (`rollUpOkrProgress` `:189-194`); parents add measured children; one pass for the whole org (`computeGoalRollups` `:558-633`); persisted up the parent chain on every write (`persistGoalRollupChain` `:656-693`). Every surface quotes this one number.
- Status: `okrStatusFor` 100 / 70 / 40 to COMPLETED / ON_TRACK / AT_RISK / BEHIND (`:196-201`).
- The verdict (the "On track?" word everywhere): `src/lib/goal-verdict.ts:54-65`. Pace = progress against share of time between start and due (`:68-81`); check-in staleness by cadence, measured from creation when there is no check-in, never stale for None or all-KPI goals (`:84-99`); the narrative says "On track for the due date." (`:175`).

### 1.4 The create and edit UI, the goal page, targets and check-ins

- `CreateGoalModal` (`create-goal-modal.tsx`, one modal for create and edit): Goal name; Owner and Level (only for the manager tier, `:265-288`); Part of (`:290-328`); Start date and Due date (`:330-340`); Check-ins (`:342-345`); Description. Quarter and Contributors were removed on purpose (`:9-15`).
- The goal page (`src/app/(dashboard)/okrs/[id]/page.tsx`): Summary card (ring, title, description, the On track? block `GoalSummaryAssessment`), Details rows Owner, Contributors, Level, Part of, Dates, Check-ins (`:197-219`), then Targets, Effort, Linked work, Supports this goal, Activity.
- Targets card (`goal-targets.tsx`): one row per target "6 of 20 people", a bar, last check-in, Check in, a row menu with Check in, View history, Delete target (`:152-163`). **There is no Edit target**; adding is an inline composer (name, start, target, unit; `:171-222`). The KR PATCH route exists (`src/app/api/okrs/[id]/key-results/[krId]/route.ts:1-33`) but no UI edits a target or links a KPI to it.
- Check in modal (`okr-checkin-modal.tsx`): Set value · Add · Subtract, a live preview, a note. `POST /api/okrs/[id]/check-in` (`src/app/api/okrs/[id]/check-in/route.ts`): visibility then Can edit or contributor (`:39-43`), KPI-linked targets refused with 409 (`:54-59`), writes the check-in and **overwrites** `KeyResult.currentValue` (`:62-81`), persists the rollup (`:86`), triggers the performance score (`:101`).
- Activity: `GET /api/okrs/[id]/check-ins?page=` (12 a page, newest first).
- List `/okrs`: columns Goal, Verdict, Progress, Owner, Due, Level, plus Effort and Last moved on Team goals (`okrs-client.tsx:287-322`).

### 1.5 Reminders

`src/app/api/cron/okr-reminders/route.ts`, weekdays 9 AM (`scripts/CRON-SETUP.md:102`): for every target of an owned, not completed goal, nudges the owner when the last check-in is older than the cadence (7 / 14 / 30 days, `:38-42`), at most once per cadence per target (`lastReminderAt`, `:110-112`), one email per goal per run (`:135-166`). Its notification text contains an em dash and links to `/okrs`, not the goal (`:118-121`). Inbox rows `okr_assigned` and `okr_check_in_due` (`src/lib/inbox-kinds.ts:131-132`).

### 1.6 Effort and the "On track?" assess route

- `src/lib/goal-effort.ts`: work linked through EntityLink (KRA, List, Space; `:4-14`), counted under the VIEWER's access (`:23-27`, `readableBoardIds` `:258-262`), done by `isDoneStatusName` (`:214`), `hoursThisMonth` from the **UTC** month start (`:48`, `:94`), legacy Task rows read tolerantly (`:161-173`).
- `GET /api/okrs/[id]/assess`: the same verdict function as the list (`:70-75`); the AI writes only the words, never the verdict (`:24-29`).

### 1.7 Where goals feed the performance score

`src/services/performanceScoreService.ts`: `calcOkrScore` averages the live rollup of **every goal the person has ever owned** (`:159-172`), weight 10 (`:275`); the score row's month is the server's local month (`getCurrentPeriod` `:33-36`, used at `:324`); "past months are history" (`:327-331`). Review cycles also average owned goals (`src/lib/performance/review-cycle.server.ts:189-206`); the self assessment filters check-ins by the cycle's dates (`src/app/api/reviews/[id]/self-assessment/route.ts:79-99`).

### 1.8 KPIs, the existing repeating measure

- `KPI` (`schema.prisma:1274-1320`) has `frequency` DAILY · WEEKLY · MONTHLY · QUARTERLY · ANNUALLY (`:1280`, enum `:1327-1333`), a target, a direction and a baseline.
- `KPIRecord` (`:1335-1358`) is one number per KPI, per person, per period, unique on `(kpiId, userId, period)` (`:1355`). The period is always a `"YYYY-MM"` month key (`alignment.ts:216-234`), the **UTC** month (`src/lib/kpi-period.ts:14-26`), whatever the KPI's frequency; `adjustedTarget` scales a weekly target to a month (`src/lib/kpi-utils.ts:37-76`).
- The review loop: the employee self-reports (SUBMITTED), the manager records or approves (APPROVED) or sends back (REJECTED) on `/team/kpi-reviews`; the current and the previous month are writable, older months read only (`kpi-period.ts:60-71`); `kpi-reminders` cron nudges PENDING and REJECTED.
- A target hard-links a KPI with `KeyResult.kpiId`; it then cannot be checked in by hand (the 409 above).

How they relate: a KPI is already a monthly, per-person, permanent gauge with its own entry and approval loop. It is a perfect **source** for a target on a monthly goal, but it is not a goal: it has no owner-chosen target for one period, no audience, no parent, no verdict. Recurring goals do **not** rebuild on KPIs; they read a KPI as one of the sources (section 2.C.4), and keep the KPI loop as it is.

### 1.9 Data sources the founder asked for

**Lists (Boards with Items).**
- `Item` (`schema.prisma:4943-5011`): `status`, `ownerId` plus `assigneeIds`, `startAt`, `dueAt`, `priority`, `metadata` (custom field values by field key), `createdAt`, `updatedAt`, `archivedAt`, `parentItemId`. **No completion time**: "Items keep no `completedAt`" (`src/lib/my-work-sprint.ts:19`); analytics uses `updatedAt` as the proxy (`src/lib/analytics.ts:153-155`). A status change is logged as `ItemActivity` STATUS_CHANGED inside `updateItem` (`src/lib/board-items.ts:1022-1029`); the move path rewrites status without that log (`:1325`).
- Done: per-List statuses (`Board.statuses`, `schema.prisma:4797`) through `isDoneStatus` (`src/lib/board-items-shared.ts:118`), cross-board fallback `isDoneStatusName` (`:107-110`).
- Custom fields: `Board.schema.fields` (`src/lib/board-fields.ts`, `src/lib/field-catalog.ts:35-53`, `:261-283`), values in `Item.metadata[key]`; number-like types NUMBER, MONEY, PERCENT, RATING. Tags: `TagAssignment` with entityType BOARD_ITEM (`schema.prisma:3533`).
- **The aggregator already exists: the dashboard stat card.** `src/lib/dashboards/widgets.ts:1-30`, `:57-76` (source All my Lists / A Space / Choose Lists; filter rules on status, assignee, priority, due, tags, title, type and custom fields; metric Count or Sum of a number field; scope Total / Open / Completed / Overdue); computed in `src/lib/dashboards/widget-data.ts:233-310` from the Lists' own tasks plus tasks linked into them (`resolveListScope`), **under the viewer's access** (`:1-17`), capped at 5,000 rows with a `truncated` flag (`:56`); due-date rules read the viewer's day in their zone (`src/lib/dashboards/widget-math.ts:1-11`, `statValue` `:139-149`). Its editor: `WidgetSourcePicker` (`src/components/dashboards/widget-source-picker.tsx`), `WidgetFilterEditor` (`widget-filter-editor.tsx`), the Metric picker in `StatSettings` (`widget-registry.tsx:145-193`), inside the widget editor dialog with a live preview (`widget-editor.tsx:1-40`).

**Tables (DataTable).**
- `DataTable.columns` JSON, `DataTableRow.values` `{ columnId: value }` with a soft delete `deletedAt` (`schema.prisma:357-411`). Seventeen column types (`src/lib/sheet-columns.ts:23-55`): number, currency, percent, rating, date, checkbox, select and the rest, plus formula, link, lookup and rollup.
- Formulas are stored as `{ "=": "A1+B2" }`; the grid evaluates them in the browser after the whole table streams in (`src/app/api/tables/[id]/rows/route.ts:35-40`), but **the same engine already runs on the server** for the public embed (`src/lib/sheet-embed.ts:1-20`, `buildEmbedSnapshot` `:150`) with a memo (`src/lib/sheet-embed-cache.ts`).
- Column filters: value / range / contains by column type (`src/lib/sheet-filters.ts:1-60`).
- Access: `tableReadableBy`, `tableRoleFor` (`src/lib/table-gate.ts:68-98`). Tables is a premium module (`src/lib/modules.ts:33-38`); its routes gate on `getSessionAndModule("workwrk-tables")` (`src/app/api/tables/route.ts:33`).

**Tasks (the old Task model).** `Task.kraId`, `hoursSpent`, `completedAt` (`schema.prisma:1371+`); migrated into Items (`metadata.legacyTaskId`, `metadata.kraId`), read only tolerantly because the table may go (`goal-effort.ts:5-9`, `:161-173`).

**Whose view a number is computed as today.** Effort and dashboards: the viewer (each person can see a different number). KPI-linked targets: the goal **owner's** records, shown to everyone who can see the goal (`alignment.ts:441-446`, `:571-574`). A Viewer for any person can be built on the server with `viewerForUser` (`src/lib/access/viewer.ts:64`).

### 1.10 Time zones

- The workspace zone is `Organization.settings.timezone` (default Asia/Kolkata), with week start MON or SUN and the fiscal year start month (`localeSettingsOf`, `src/lib/settings/org-policy.ts:321-334`); Settings > Locale says "Readers: settings.timezone (the crons, digests, due-date bucketing)" (`src/app/(dashboard)/settings/locale/page.tsx:16`).
- The person's zone is `home.locale.timezone`; the org zone is deliberately not layered into it (`src/lib/preferences.ts:286-292`). The "WorkwrK clock" the Phase 3 review used is the person's zone.
- Helpers: `zonedWallClockToUtc`, `endOfZonedDay`, `zonedDateKey` (`src/lib/zoned-time.ts:77`, `:108`, `:115`; uses `hourCycle: "h23"`, never `hour12: false`, the Node 20 trap), `src/lib/zoned-input.ts` for pickers, fiscal quarters in `src/lib/fiscal-quarter.ts:16-60`.
- UTC or server-local months in the code this spec touches: `kpi-period.ts:24`, `review-cadence.ts:160-219`, `goal-effort.ts:94`, `performanceScoreService.ts:33`.

### 1.11 Other readers of goals

MCP `list_my_goals` (`src/lib/mcp/tools/read.ts:815-880`) and Ask AI `search_okrs` both read `searchOkrRows` (`src/lib/agents/tools.ts:973-997`): stored `progress`, `status`, `quarter` and each target's `currentValue`. Ask AI `create_okr` (`tools.ts:1113-1215`) takes start and end dates and no repeat. Also: Home (`src/app/api/me/home/route.ts:246-255`, sorted by endDate), the profile (`person-alignment.ts`), `my-okrs`, the dashboard OKR card, search, the workspace export (`src/lib/export/workspace-export.server.ts:231`), the handover page.

Precedents this spec reuses: the task Repeat rule (`src/lib/recurrence.ts:16-50`) and its hourly spawn cron (`CRON-SETUP.md:108`); `MonthControl` ‹ month › (`src/components/ui/month-control.tsx`, KPI reviews); the Inbox kinds table with its completeness test (`src/lib/inbox-kinds.ts:1-30`).


## 2. Design

Every question below is decided by the worst case of each option for real people. Nothing here invents a surface: every control is an existing component (`CreateGoalModal`, `SegmentedControl`, `Picker`, `DateField`, the goal page cards and `.os-row` rows, `MonthControl`, the dashboard widget editor and its pickers, the check-in modal). Section 4 names the one composition that needs the founder's eye.

### A. One-time and repeating goals

**A1. Two kinds of goal.**
- **One time** (every goal today): Start date (optional), **Due date (required)**, ends at its due date or when marked complete. Unchanged.
- **Repeating**: repeats **every week, month, quarter or year**. Yearly is included because it costs nothing extra (the same engine with a 12-month step). A repeating goal has **no due date**. It has a **Starts** period (default: the current one) and an optional **Ends** (the last period it runs), else it runs until someone stops it.
- Stored as two new nullable columns: `OKR.repeat` (null for one time; WEEKLY, MONTHLY, QUARTERLY, YEARLY) and `OKR.repeatUntil` (the last day it runs, a `yyyy-mm-dd` key in the workspace zone, or null for no end). `OKR.startDate` holds the first period's start; `OKR.endDate` stays **null** for a repeating goal, and the API refuses one (400 "A repeating goal has no due date. Choose when it ends instead.").
- Why not reuse `endDate` as "until": every reader of `endDate` (the Due column, overdue, pace, the quarter label, the Due filter, Home's order, the profile's quarter filter) would treat it as a due date: a monthly goal running until December would show "Due 31 Dec", be paced over the whole year and read "overdue" after. A separate column leaves those readers correct by default.

**A2. The create and edit modal** (`CreateGoalModal`, same 560 dialog, same order, new fields marked):
1. Goal name.
2. Owner, Level (manager tier only, unchanged).
3. Part of (unchanged).
4. **Goal type** (new): `SegmentedControl` **One time · Repeating**, default One time. Two segments, inside the design system's 2 to 4 rule; one control with five options would break it.
5. When **One time**: Start date and Due date exactly as today (Due required).
   When **Repeating**: **Repeats every** `SegmentedControl` **Week · Month · Quarter · Year**, default Month; then two `Picker` fields side by side in the same grid the dates use today: **Starts** (this period, labelled "This month (October 2026)", plus the next 12 periods; never a past one) and **Ends** ("Never" default, plus the periods after Starts, each labelled by the period: "After March 2027"). The Due date field is not rendered at all for a repeating goal.
6. **Check-in reminders** (the old "Check-ins", relabelled so it can never again read as a goal type): Weekly · Every two weeks · Monthly · **Off** (stored value NONE as today). Default Weekly; for a weekly goal the "Every two weeks" and "Monthly" options would never fire inside one period, so a weekly goal offers Weekly · Off.
7. Description.

Under Repeats every, one 13px line in `text-ink-2` says what will happen: "Targets start fresh on the 1st of every month. Past months keep their results." (worded per cadence: "every Monday", "every quarter", "every year").

**A3. Editing.**
- Repeats every can change; the change applies **from the next period**. The current period runs to its own end, so a half-done month is never cut into weeks. Shown under the control: "Changes from November. October keeps its targets."
- Starts is editable until the first period closes, then it reads as text ("Started October 2026").
- Ends can change any time; moving it before the current period is refused (the current period always finishes).
- **One time to Repeating**: allowed. The due date is removed (Activity records "Due date 31 Dec removed when this goal became monthly"), the first period is the current one, check-ins already made inside the current period's window count toward it (their `periodId` is set by timestamp) and the latest of them becomes the period's value; older check-ins stay in Activity with no period. The confirm line in the modal: "Targets will start fresh each month. Check-ins from before October stay in Activity."
- **Repeating to One time**: allowed only while no period has closed (a goal made repeating by mistake). Its open period is discarded and the targets keep their current values. Once any period has closed it is refused ("This goal has history. Stop it repeating and create a one-time goal instead."): converting would leave closed periods that a one-time goal cannot show, and a perf score that already counted them.

**A4. Mark complete becomes Stop repeating.** On a repeating goal the row menu and the goal's "..." show **Stop repeating** in the Mark complete slot (same gating). It sets Ends to the current period: the period finishes and closes normally, then the goal ends (`completedAt` is stamped at that final close). Before that close, Edit > Ends > Never undoes it. After the goal ended, Edit > Ends > Never restarts it from the current period; the skipped periods are not invented (the history shows the gap).

**A5. Existing goals: no automatic conversion.** Every existing goal stays One time with its dates, targets, check-ins and reminder rhythm untouched; `repeat` is null for all of them. Worst case of converting "Check-ins: Monthly" goals automatically: a goal like "Launch v2 by 31 Dec" with monthly reminders would start resetting every month, wiping its meaning and dragging its owner's score, with no way for us to tell it apart from a goal meant to repeat. Worst case of not converting: the founder's team edits the goals they meant as monthly (Edit > Goal type > Repeating, ten seconds each). The second worst case is cheap and reversible; the first is neither.

### B. Periods

**B1. Each period is its own record.** New models (section 3):
- `GoalPeriod`: one per goal per period: `key` (the first day, `yyyy-mm-dd`), `cadence` it was cut with, `startsAt` and `endsAt` (UTC instants, end exclusive), `closesAt` (end plus the grace window), `status` OPEN or CLOSED, and once closed the frozen `progress`, `result` and `closedAt`. Unique on `(okrId, key)`.
- `KeyResultPeriod`: one per target per period: `startValue` and `targetValue` copied from the target when the period opens, `currentValue`, `progress`, source bookkeeping. Unique on `(keyResultId, periodId)`.
- `KRCheckIn.periodId`: which period a check-in counted toward (null for one-time goals and every existing row).
- The `KeyResult` row stays the **template** (name, unit, start, target, source). The goal stays **one shared record with one scoreboard** (goals-rebuild decision 1); a period is a slice of that scoreboard, never a per-person copy.

**B2. Boundaries, in the workspace zone.** A period begins and ends at 00:00 in `Organization.settings.timezone`, so everyone in the workspace, in any zone, sees the same October. Computed by one new pure module, `src/lib/goals/goal-period.ts`, on top of `zonedWallClockToUtc` and `zonedDateKey`:

| Repeats every | A period is | Label | Grace |
|---|---|---|---|
| Week | 7 days from the workspace's week start day (Settings > Locale, Monday or Sunday) | "Week of 26 Oct" (plus the year when not this year) | 2 days |
| Month | the calendar month | "October 2026" | 5 days |
| Quarter | the **fiscal** quarter (fiscal year start, Settings > Locale) | "Q3 FY27", the rules of `goalQuarterLabel` | 5 days |
| Year | the fiscal year | "FY27", or "2026" when the year starts in January | 5 days |

Fiscal, not calendar, quarters because the goal page already labels quarters by the fiscal year (`fiscal-quarter.ts`) and an April-start company's Q1 is April to June; two meanings of "Q1" in one product is the worse case.

If the workspace changes its zone, week start or fiscal start, closed and open periods keep their stored instants. The next period starts exactly at the previous one's `endsAt` (no gap, no overlap) and ends at the next boundary under the new settings, so one period may be a little short or long; a key is never reused.

**B3. When a period is created: both lazily and by a cron, through one function.** `settleGoalPeriods(okrIds, now)` (new, `src/lib/goals/goal-periods.server.ts`) opens the current period when it is missing (with a `KeyResultPeriod` per target) and closes every period whose `closesAt` has passed. It is idempotent: creation is guarded by the unique key, closing is a conditional update (OPEN to CLOSED only where still OPEN), and only the request that wins the close sends its notification and patches the score. It runs:
- on every read and write that touches a repeating goal: the `/okrs` list (batched for the page's goals), the goal page, a check-in, a target edit, `my-okrs`, Home and the profile;
- from a new hourly cron, `POST /api/cron/goal-periods` (`5 * * * *`, guarded like the others, row added to `scripts/CRON-SETUP.md`), which also refreshes automatic sources and sends the period notifications.

Why both: cron only, a missed run means no October on 1 October and check-ins cannot land; lazy only, a goal nobody opens never closes, never reminds and never reaches the score. Either alone fails real people; the one shared function makes the two paths agree.

**B4. What "reset" means.** At the start of each period every target starts again at its **start value** (its baseline, 0 by default) and keeps its **target**, so "40 demos a month" is 0 of 40 on the 1st. A target whose number should carry from month to month (a running balance) is not a repeating target; it reads its number from a source with the window "Right now" (C2), which needs no reset.

**B5. Editing a target never rewrites the past.** Changing a target's start, target or unit updates the template and the **current open period** (so a typo on day 1 is fixable today), never a closed one. The change is written to Activity with the old and new numbers ("Target changed from 60 to 40 for October"), so a manager sees a mid-month cut. Worst case of "from next period only": a wrong target on a new goal guarantees a frozen Missed in the first month and in the owner's score. Worst case of "from current": an owner lowers their own target late in the month; that is possible on one-time goals today, and the Activity line plus the manager's Team goals view keeps it visible. A target added mid-period gets a row for the open period at once; a deleted target's period rows go with it (the existing delete confirm already says its check-ins go too), while the closed periods' frozen goal results stay.

**B6. Closing a period.** At `closesAt` (end plus grace): automatic sources refresh one last time (C5), every `KeyResultPeriod` freezes, and the period stores its rolled-up `progress` (the same mean as `rollUpOkrProgress`, including measured children) and a `result`:

| Result | Rule |
|---|---|
| Hit | progress 100% or more |
| Partly hit | 70% to 99% (the line that reads "On track" everywhere, `okrStatusFor`) |
| Missed | under 70% |
| Not measured | the goal had no targets and no measured children that period |

A manual target with no check-in all period closes at its start value, so it counts as 0%. That is honest (no number was given) and the reminders plus the grace window exist to prevent it.

**B7. Late check-ins.** Allowed for the previous period **until it closes** (end plus 2 days for weekly, 5 days otherwise), from the goal page's period control (E2), never after. Worst case of allowing them forever: the history, the trend, the manager's review and the score of a closed month change silently months later. Worst case of no grace: a person on leave on the last day of the month cannot enter the month's final number and it freezes as Missed. The grace window covers the real month-end close (five working days) and then freezes. After it, `POST check-in` answers 409 "October closed on 5 Nov. Its result is final."; the KPI precedent (`kpi-period.ts:60-71`, older months read only) is the same rule.

**B8. One number everywhere, without touching every reader.** Every write to the current period (open, check-in, refresh) also writes that period's `currentValue` and `progress` onto the `KeyResult` row, and `persistGoalRollupChain` stores the goal's progress and status as today. So `computeGoalRollups`, the list, Home, the profile, the dashboard card, search, `my-okrs`, MCP and Ask AI all show the **current period** with no change of their own. Closed periods are read only from `GoalPeriod` and `KeyResultPeriod`.

### C. Updating data

**C1. By hand.** The existing check-in modal, unchanged (Set value · Add · Subtract, note). For a repeating goal the check-in lands in the period the goal page is showing, which is the current one unless the person stepped back into the previous period inside its grace window. `POST /api/okrs/[id]/check-in` takes an optional `periodKey` (default: the current period) and refuses a closed one (B7).

**C2. Each target is "Measured by" one of four things.** A new `KeyResult.source` (JSON) plus the existing `kpiId`:

| Measured by | What it counts |
|---|---|
| Check-ins (default) | what people type |
| A List | tasks in one Space or chosen Lists |
| A table | rows of one table |
| A KPI | the owner's KPI record (the existing link) |

A target measured by a List, a table or a KPI cannot be checked in by hand (the existing 409, extended). Sources work on one-time goals too: their window is the goal's start date to its due date, read in the workspace zone.

**C3. From a List** (built on the dashboard stat card's engine, not a new one):
- **Where**: "A Space" or "Choose Lists" (the `WidgetSource` kinds `space` and `lists`). **Not** "All my Lists": that set is "every List the counting person can open", so the number would jump whenever their access changed.
- **What**: Count of tasks, **Sum of** or **Average of** a number field (NUMBER, MONEY, PERCENT, RATING). Average is new for goals and also free for dashboards.
- **Which tasks**: the dashboard filter rules unchanged (status, assignee, priority, due, tags, title, type, custom fields; AND or OR; Hide completed), the same `WidgetFilter` shape and editor.
- **Counted by** (the period window): **Done date** (tasks that became done inside the period), **Created date**, **Due date**, **a Date field** of the chosen Lists, or **Right now** (no window, the count at this moment, frozen at close; for "keep open bugs under 10").
- Top-level tasks, home in the Lists or linked into them, each counted once (`resolveListScope`, as dashboards do); archived and system items excluded (`NOT_SYSTEM_ITEMS`).
- **Done date needs a real completion time.** Today there is none (1.9) and `updatedAt` is wrong for this: a task done in September and commented on in October would count in October. New `Item.doneAt`, set when a task's status crosses into its List's done group and cleared when it leaves, in `updateItem` (`board-items.ts:988-993`), the move path (`:1305-1340`) and the recurring roll-forward (`recurring-tasks.ts:188`, `:297`). A backfill script (dry run by default, JSON backup first, like the others) fills it for done tasks from their last STATUS_CHANGED activity, else `updatedAt`. A done task with no `doneAt` still counts by `updatedAt`, so a write path missed later degrades to today's proxy rather than dropping the task.
- Filters on columns (status, assignee, priority, due, created, done date) run in the database, so a plain count over any size of List is exact. Filters or sums over custom fields read rows into memory, capped at **20,000 rows**; over the cap the source **pauses** with "Too many tasks to count. Narrow the filter." A goal feeds the score, so it never shows a silently cut number (dashboards may show "truncated"; a goal may not).

**C4. From a table** (Tables module on):
- **What**: Count of rows, or Sum of / Average of a number, currency, percent, rating **or formula** column. Formulas are evaluated on the server by the same engine and table loader the public embed uses (`sheet-embed.ts`), so the goal reads the number the grid shows. Link, lookup and rollup columns are not offered: they read another table, whose access the goal cannot check for every viewer.
- **Which rows**: the Tables column filters (value / range / contains, `SheetColumnFilter`), all of which must hold, as in the grid. Trashed rows never count.
- **Counted by**: a Date column, **Row added** (the row's `createdAt`), or **Right now**.
- Cap: tables over **50,000 rows** pause with "This table is too large to count from a goal."

**C5. When an automatic number refreshes.** The number is **stored** on the period (so the list never computes anything, and every surface agrees):
- by the hourly `goal-periods` cron, for every open period with a source last counted more than 50 minutes ago (batched per workspace, a time budget per run, the rest next hour);
- when the goal page opens and a source was counted more than 10 minutes ago (the page renders the stored number, the Targets card asks `POST /api/okrs/[id]/refresh`, then repaints if it changed);
- from **Refresh** in the target's row menu (anyone who may check in);
- one last time at the period's close.
Not on every task or row write: hooking every Item and DataTableRow write to find the goals that count them puts a goal query on the hottest write paths in the product, and a failure there would break task saves. Worst case of the chosen rule: a goal number up to an hour behind on the list, and up to 10 minutes on the goal page.

**C6. Whose access counts the number: the person who connected the source.** Stored as `KeyResult.sourceById`. Each refresh rebuilds their Viewer (`viewerForUser`) and checks they still have Can view on the source **and** Can edit on the goal; if either fails, the source pauses (C8).

| Option | Worst case |
|---|---|
| The viewer (as Effort and dashboards) | Ten people see ten numbers for one target; a frozen October cannot be per viewer; the score needs one number. |
| The goal owner | A manager connects a manager-only "Hiring pipeline" List to a report's goal; the owner cannot open it, so the target reads 0 and the manager cannot tell why. Company goals often have no owner. |
| **The person who connected it** | They publish an aggregate of a List they can open to everyone who sees the goal. That is exactly what they could already do by typing the number in a check-in, and only goal editors who can open the source can connect it. |

**C7. Someone who can see the goal but not the source** sees the **number** (everyone who sees a goal sees every target's value today; KPI-linked targets already work this way) and "From a private List" or "From a private table" (the existing `PRIVATE_DESTINATION_NAME` words, `table-gate.ts:120`), with no name, no link, no filter details and no task or row. Hiding the number too would make the same goal read differently per viewer and break the one scoreboard. An editor who cannot open the source sees it as private too, connected by whom, and may replace it but not read its settings (the dashboard's partial-card redaction, `widgets.ts:24-27`).

**C8. Paused sources.** When the List or table is archived, trashed or deleted, the summed field or column is removed, the Tables module is turned off, or the person who connected it left or lost access, the source **pauses**: the last counted number stands, the period keeps counting nothing new, and the target row's last column reads "Paused" with the reason in its tooltip for editors ("Priya can no longer open this List. Reconnect it."). Editors get **Reconnect** (they become the connector, after the same access check) or can switch the target to check-ins. A source that comes back (a List restored from Trash) resumes on its own. A period that closes while paused freezes its last good number and the history row says "Last counted 14 Oct".

**C9. From a KPI.** The existing `kpiId` link, made period aware for repeating goals: a monthly goal's target reads the owner's KPIRecord whose month key is the period's month (status not REJECTED, a value present); a quarterly or yearly goal reads the latest such month inside the period; nothing yet reads as the start value. A weekly goal cannot link a KPI (400 "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal."): a monthly number repeated in four weeks would be wrong three times. One-time goals keep today's "latest record" behaviour. The link becomes choosable in the target editor (today only the API can set it).

### D. Targets on repeating goals

Each target repeats with its goal: one `KeyResultPeriod` per period, opened with the template's start and target. The goal's progress is the mean of its targets in the **current** period, plus measured children; a repeating child contributes its current period to any parent, and a repeating parent's closed period freezes what its children showed at that moment. `computeGoalRollups` needs no change for hand-checked and List or table targets (B8); its KPI branch reads the period's month for repeating goals (C9).

### E. The views

**E1. The goal list (`/okrs`).** Rows of repeating goals show the current period: Progress and Verdict are the current period's; the **Due** column reads "Resets 1 Nov" in `text-ink-2` (tooltip "Repeats monthly. This period: October 2026."); Sort by Due uses the current period's end; the Due filter matches it. A repeating goal that hits 100% mid-month shows the chip label **"Target hit"** (same tone as Completed) and is **not** hidden by "Show completed goals": hiding it would remove a live monthly goal from My goals for the rest of the month. Only an ended repeating goal counts as completed. One line per row, nothing added to the row budget.

**E2. The goal page (`/okrs/[id]`).**
- Details: the **Dates** row becomes **Repeats** for a repeating goal ("Every month, since October 2026" or "Every month, October 2026 to March 2027"); the **Check-ins** row becomes **Check-in reminders**.
- **Period control**: `MonthControl`, generalised to take an ordered list of period keys and labels (its month behaviour stays the default, so KPI reviews do not change), sits on the Summary card's top line: "‹ October 2026 ›  9 days left". It writes `?period=<key>`; Next is disabled past the current period. The whole page follows it: the ring and the On track? block, Targets, Effort and Activity.
- A **closed** period shows its result where the verdict is ("September: Hit, 112%"), every target read only, no Check in. A period inside its grace window shows one line in the Targets card, "Open for late numbers until 5 Nov", and keeps Check in.
- **Past periods** card (new card in the existing card pattern, after Targets, only when at least one period has closed): rows at 36px, one per period, newest first: label, the result as one pale `StatusChip`, "112 of 100" (single-target goals) or the progress %, and the 72px bar the Targets rows use; clicking a row moves the period control there; 12 rows then "Show more". Above the rows, a small bar trend of the last 12 periods (progress per period with a 100% reference line), drawn with the same recharts bar the dashboard chart card uses (`src/components/dashboards/widgets/chart-widget.tsx`).
- Activity shows the selected period's check-ins (and target edits); "All periods" is the default for one-time goals, as today.

**E3. My, Team and Company goals** keep their filters and grouping. **By person** (Team goals headers, "3 goals · 46% avg · 18h this month"): repeating goals contribute their current period's progress; the hours become the workspace zone's month (fixing the UTC month start at `goal-effort.ts:94`).

**E4. Effort and assess per period.** `computeGoalEffortBatch` gains a window: for a repeating goal the Effort card counts hours (TimeEntry.day) and tasks done (by `doneAt`) inside the selected period, labelled "This period"; one-time goals are unchanged. The Team goals Effort column shows the current period's hours for repeating goals. `GET /api/okrs/[id]/assess` takes `?period=`: the open period is paced on its own start and end (so day 20 of 30 with 40% done reads Off track), staleness counts from the later of the period start and the last check-in in it (day 1 is never "overdue"), and the words name the period ("On track for October."); a closed period returns its frozen result and skips the AI.

### F. Reminders, Inbox and notifications

- **A check-in is due**: the existing `okr-reminders` cron, made period aware: for a repeating goal, staleness counts from the later of the period start and the last check-in in the period; and once per period, two days before the end, the owner of a goal with a hand-checked target that has no check-in this period gets "October ends in 2 days. Add this month's numbers." Both are the existing `okr_check_in_due` kind, link to `/okrs/{id}` (not `/okrs`), with the em dash removed from today's text. Email stays as today (prefs-gated `due_reminders`).
- **A period started**: one aggregated Inbox row per owner per day, only for goals with a hand-checked target: "3 goals started October 2026" linking to `/okrs`. New kind `goal_period_started`. No email. Ten monthly goals must never mean ten notifications on the 1st.
- **A period closed**: one Inbox row to the owner at the final close: "{goal}: September, Hit (112%)" linking to `/okrs/{id}?period=2026-09-01`. New kind `goal_period_closed`. No email. Managers read results on Team goals; contributors are not notified (no per-person noise).
- Both new kinds get rows in `src/lib/inbox-kinds.ts` (the completeness test requires it), primary tab, people group, the Trophy icon.

### G. The performance score

- The score's month M keeps its existing key (`getCurrentPeriod`). One-time goals count as today.
- A repeating goal counts **the periods that belong to M**, where a period belongs to the month (workspace zone) of its last day: a monthly goal counts its month M; a weekly goal the mean of the weeks ending in M; a quarterly or yearly goal its period ending in M, or the open one containing M (live until it closes). Periods that ended before M or start after it do not count. Mapping by key, not by "the current period", keeps the October row on October even when the server's clock (UTC) and the workspace's (IST) disagree for a few hours at the month change.
- **At the final close** (end plus grace, so in the next month), if M's score row exists, its goal component is recomputed from the frozen results and the total re-composed from the row's **stored** breakdown; no other component is recomputed. Worst case of not doing it: a number entered on 3 November (inside the grace) never reaches October's score. Worst case of a full recompute: October's row picks up November's KPI and review inputs. Patching only the goal part has neither.

### H. Permissions

Unchanged where possible (`src/lib/goals/goal-rights.ts`, `src/lib/alignment-scope.ts`):
- Create a repeating goal: whoever can create that goal today (a Member, their own Individual goals; the manager tier, for their chain; Company goals, Owner/Admin, the People team or the owner). Manager assignment, `okr_assigned` and the notification are unchanged.
- Edit Goal type, Repeats every, Starts, Ends, Stop repeating, targets: Can edit on the goal (`canEditGoal`), as today's edit.
- Connect or change a target's source: Can edit on the goal **and** Can view on that List or table at that moment. Contributors cannot connect sources.
- Check in (current period, or the previous one inside its grace): Can edit or contributor, as today. Refresh: the same people.
- See periods, history and results: whoever can see the goal (`canSeeGoal`).

### I. API and MCP

- `POST /api/okrs`, `PATCH /api/okrs`: accept `repeat` (null or one of the four), `repeatStart` (a period key, current or later), `repeatUntil` (a day key or null); refuse `endDate` with `repeat` (400); apply A3's rules; the response carries the current period. Shared by `create_okr` (Ask AI), which gains an optional `repeat` (a one-line pass-through to the same validation; without it the assistant would keep creating monthly goals with due dates, the founder's exact complaint).
- `GET /api/okrs` rows gain `repeat` and `period: { key, label, startsAt, endsAt, closesAt, daysLeft } | null`; `progress`, `verdict` and `endDate` behave per E1.
- `GET /api/okrs/[id]` and the page read `?period=`.
- New `GET /api/okrs/[id]/periods?page=`: 12 periods a page, newest first, each with its targets' start, target, value and progress, result, and whether it is open for late numbers.
- `POST /api/okrs/[id]/check-in`: optional `periodKey`; 409 on a closed period; 409 on any sourced target.
- `POST` and `PATCH /api/okrs/[id]/key-results[/krId]`: accept `source` (validated: the List, Space or table exists in the org and the caller can open it; field and column ids exist; the kind fits the goal, C9) or `kpiId`; record `sourceById`.
- New `POST /api/okrs/[id]/refresh`: recount the goal's sources now (anyone who may check in; rate limited per goal).
- New cron `POST /api/cron/goal-periods`.
- MCP `list_my_goals`: each goal gains `repeat` (string or null) and `period` (label, startsAt, endsAt, or null); its `progress`, `status` and targets' `currentValue` already show the current period (B8). Output schema updated in step with the payload. No new MCP write tool.


## 3. Data

All additive, idempotent, catalogue guarded, declared in `prisma/schema.prisma`, listed last in `SQL_MANIFEST` (`scripts/deploy-migrations.mjs`) as a text edit, with a row in `prisma/sql/README.md`. **No existing row is rewritten.** Both files say at their head **"apply this file before the code"**: the new client selects every scalar on `findMany` without a `select` (the README's warning), and `OKR`, `KeyResult`, `KRCheckIn` and `Item` are all read that way.

**File 1: `prisma/sql/2026-10-27-recurring-goals.sql`** (step 1)

```sql
/* 2026-10-27 Recurring goals (docs/plans/recurring-goals.md). Additive and
   idempotent. EXISTING ROWS ARE UNCHANGED: every existing goal stays one time
   (repeat NULL), no period is created for it, every check-in keeps periodId
   NULL. APPLY THIS FILE BEFORE THE CODE. Rollback: drop the two new tables
   and the new columns. */

ALTER TABLE "OKR" ADD COLUMN IF NOT EXISTS "repeat" TEXT;
ALTER TABLE "OKR" ADD COLUMN IF NOT EXISTS "repeatUntil" TEXT;

ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "source" JSONB;
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourceById" TEXT;
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourceRefreshedAt" TIMESTAMP(3);
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "sourcePausedReason" TEXT;

CREATE TABLE IF NOT EXISTS "GoalPeriod" (
  "id"             TEXT NOT NULL,
  "okrId"          TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "cadence"        TEXT NOT NULL,
  "startsAt"       TIMESTAMP(3) NOT NULL,
  "endsAt"         TIMESTAMP(3) NOT NULL,
  "closesAt"       TIMESTAMP(3) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "progress"       INTEGER,
  "result"         TEXT,
  "closedAt"       TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoalPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KeyResultPeriod" (
  "id"           TEXT NOT NULL,
  "keyResultId"  TEXT NOT NULL,
  "periodId"     TEXT NOT NULL,
  "startValue"   DOUBLE PRECISION NOT NULL,
  "targetValue"  DOUBLE PRECISION NOT NULL,
  "currentValue" DOUBLE PRECISION,
  "progress"     INTEGER,
  "refreshedAt"  TIMESTAMP(3),
  "pausedReason" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyResultPeriod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KRCheckIn" ADD COLUMN IF NOT EXISTS "periodId" TEXT;

/* Then, each inside a DO block that first checks pg_constraint or pg_indexes:
   GoalPeriod_okrId_fkey        REFERENCES "OKR"("id") ON DELETE CASCADE
   KeyResultPeriod_keyResultId_fkey REFERENCES "KeyResult"("id") ON DELETE CASCADE
   KeyResultPeriod_periodId_fkey    REFERENCES "GoalPeriod"("id") ON DELETE CASCADE
   KRCheckIn_periodId_fkey      REFERENCES "GoalPeriod"("id") ON DELETE SET NULL
   UNIQUE GoalPeriod_okrId_key_key ("okrId", "key")
   INDEX  GoalPeriod_status_closesAt_idx ("status", "closesAt")
   INDEX  GoalPeriod_organizationId_idx ("organizationId")
   UNIQUE KeyResultPeriod_keyResultId_periodId_key ("keyResultId", "periodId")
   INDEX  KeyResultPeriod_periodId_idx ("periodId")
   INDEX  KRCheckIn_periodId_idx ("periodId")
   INDEX  OKR_repeat_idx ("repeat")
   No key to "User" (sourceById is a bare id), so no lock on it. */
```

**File 2: `prisma/sql/2026-10-27-item-done-at.sql`** (step 4): `ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "doneAt" TIMESTAMP(3);` plus a catalogue-guarded `("boardId", "doneAt")` index. Nullable with no default, so Postgres adds it without rewriting the table. The backfill is a script (`scripts/backfill-item-done-at.ts`, dry run by default, JSON backup first), not SQL, because "done" depends on each List's own status groups, which `isDoneStatus` knows and SQL would have to copy.

**Migration of existing goals:** none. Section A5 explains why; A3 is how a person converts one.

**Export:** the workspace export gains `repeat` on goals and a `goal-periods` file (period, result, progress, per-target values), so history leaves with the customer's data.


## 4. Steps

Each step: one builder, one read-only reviewer, high and medium findings fixed, one push. Then the final round of three reviewers testing everything before the founder's list. Every behaviour change carries a test that fails on the base commit (the builder proves it by restoring the changed sources from the base in a scratch copy and reporting the counts). Screenshots are taken by the lead with the local smoke harness, at 1280 and 390 wide.

**Step 1. The period engine and the data.**
- `src/lib/goals/goal-period.ts` (pure): `periodFor(cadence, instant, { zone, weekStart, fiscalStart })`, `nextPeriod`, `periodsFrom`, `graceDays`, labels, the zone-change seam (B2); `resultFor(progress, measured)` (B6).
- File 1 SQL, schema models, manifest and README rows.
- Must prove (unit): October in Asia/Kolkata starts at 30 Sep 18:30 UTC; a New York month across the November DST change has the right instants; Pacific/Auckland; Sunday weeks; April fiscal quarters and years; grace closes; no gap and no overlap across a zone change; no `hour12: false` anywhere; `npx prisma validate`.

**Step 2. Repeating goals on the server.**
- `settleGoalPeriods` (B3), the `goal-periods` cron route and its CRON-SETUP row; POST and PATCH `/api/okrs` (A1, A3, A4, I); check-in period routing, grace and 409 (B7, C1); the mirror onto `KeyResult` and the stored rollup (B8); target edits from the current period with the Activity line (B5); the KPI period match (C9); verdict pace and staleness on the period (E4); `GET /api/okrs/[id]/periods`.
- Must prove (route and lib tests failing on the old code): a monthly goal posted with no `endDate` is created with its first period; `repeat` with `endDate` is a 400; a check-in lands in the current period and the goal's progress is that period's; a check-in to a closed period is a 409 and one inside the grace is accepted; two concurrent settles create one period and one close; a target edit leaves a closed period untouched; a monthly KPI-linked target reads the period's month, not the latest; day 20 of 30 at 40% reads Off track.

**Step 3. The modal, the goal page and the list.**
- `CreateGoalModal` per A2 and A3; the goal page per E2 (Repeats row, the generalised period control, closed and grace states, Past periods card with the trend, Activity per period); the list per E1 (Due cell, Target hit chip, completed rule); Stop repeating in both menus (A4); the profile's this-quarter filter, Home's due line and the dashboard OKR card treat a running repeating goal as current.
- Must prove: a contract test that Repeating renders no Due date field and saves without one (the old modal refuses with "Pick a due date."); MonthControl's month default unchanged for KPI reviews; screenshots of the modal both ways, a goal page with three closed periods, a closed period, a grace period, the list with a repeating row, and phone width.

**Step 4. Numbers from a List.**
- File 2 SQL, `Item.doneAt` stamping in every status path (C3) and the backfill script; the dashboard row loader extracted from `computeWidget` into a shared function (dashboard results byte identical, its tests unchanged); `src/lib/goals/goal-source.server.ts`: count, sum, average, the windows, database-side filters, the 20,000 cap, the connector's access and the pause rules (C3, C5, C6, C8); `POST /api/okrs/[id]/refresh` and the cron refresh; the target editor (section 5, item 1) with Measured by: Check-ins, A List, A KPI; Refresh and Open source in the row menu; the private-source wording (C7).
- Must prove: a task done in September and edited in October counts in September only; un-doing a task clears `doneAt`; a connector who loses access pauses the source and the number stands; a viewer without the List sees the number and "From a private List", never the name; a filter over the cap pauses rather than truncating; dashboard stat results unchanged on the shared loader. Screenshots of the editor and a paused row.

**Step 5. Numbers from a table.**
- Table, column and filter pickers in the target editor (reusing the Tables filter kinds); `goal-source` table branch with server formula evaluation through the embed's engine path and memo; the 50,000 cap; module off, table deleted and column removed pause.
- Must prove: a sum over a formula column equals what the grid computes for the same rows; trashed rows never count; a date-column window in the workspace zone (a row dated 31 Oct counts in October in Kolkata and New York); Tables off pauses. Screenshots.

**Step 6. Reminders, score, effort, and the outside readers.**
- F (both crons, the two new Inbox kinds, the em dash and link fix); G (period mapping and the close-time patch); E3 and E4 effort windows and the workspace-zone month; I (MCP `list_my_goals`, Ask AI `search_okrs` and `create_okr`); the export (section 3).
- Must prove: ten monthly goals send one "started" row; the closed row links to its period; October's score row reads October's period at 01:00 IST on 1 November; a number entered on 3 November inside the grace changes October's goal component and nothing else; MCP output validates against its schema with `period`.


## 5. Risks, and what needs the founder's eye

1. **The target editor is the one visible new composition.** Measured by, the List and table rows, Counted by and a live "This month so far: 42 of 60" preview need a home bigger than the inline composer. The plan reuses the dashboard widget editor dialog as it is (preview on the left, the settings column on the right with `WidgetSourcePicker`, `WidgetFilterEditor` and the Metric picker), opened by a new "Edit target" row-menu item and by "More options" on the inline composer, which stays for quick hand-typed targets. Per the parity rule, this needs the founder's yes on a screenshot before step 4 is pushed.
2. **`Item.doneAt` touches the busiest write path.** Every status write must stamp it; the `updatedAt` fallback means a missed path under-counts the way today's analytics already do, never loses a task. The reviewer for step 4 checks every status writer.
3. **Two SQL files must be applied before their code** (founder steps, as usual), plus **one crontab row** for `goal-periods`. Without the cron nothing gets stuck (B3), but sources refresh only when the goal page opens and the period notifications do not send.
4. **Server load from table formulas.** Counting a large formula table re-evaluates it; the memo, the 50-minute refresh floor, the per-run time budget and the 50,000 cap bound it.
5. **Existing "monthly" goals stay one time** (A5). The founder's own team will need to switch the goals they meant as monthly with Edit.

Out of scope, on purpose: per-person copies of a goal (goals-rebuild decision 1 stands; a manager who wants each report's own monthly target creates each report's goal), counting tasks tagged with a KRA, the legacy Task table as a source (it is being retired), link, lookup and rollup columns, planning a different target for one future period, creating past periods, and automations on period events.
