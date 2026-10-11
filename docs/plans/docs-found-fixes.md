# Product fixes found by the public docs update

Each item is a place where the product said something untrue, or two places disagreed. Worktree `theywrk-agents`, on top of 4196dfa5. Nothing here is committed.

## 1. The Agent tier, described one way

**What was true.** The Agent tier is `User.accessLevel = AGENT`: a Member with the Agent flag (access spec 2.1 and 2.4, decision D13), meant for frontline staff such as support, warehouse or field teams. It is a person, never a bot. AI teammates hold no tier of their own; they act as the person who runs them (`src/lib/agents/acting.ts`). The server enforces these limits for every Agent:

- never deletes a task (`item-role.ts` `allowsItemAction`, whatever the level)
- never creates a Space (`space-create.ts` and the engine's `create_space` verb)
- is never anyone's manager (`checkManagerCandidate`, `PATCH /api/users/[id]`, bulk update, bulk import, dotted lines)
- is refused by most export routes.

Four places described it, three of them wrongly:

- the invite dialog: "A bot or service that works as a Member. It can edit what it is given, never has Full access, and never exports or invites."
- the Members drawer: "Agent is for frontline staff."
- the Who can do what page: "An AI teammate: works at the level it was given, never deletes a task and never exports.", plus a rule row headed "An AI agent".
- `src/lib/permissions.ts`: "External agents (limited access)". Nothing renders this one.

These claims were not true:

- **"bot or service", "AI teammate", "External".** An Agent is an employee.
- **"never has Full access".** The share rules for tools, SOP folders, teams and goals hold an Agent to Can edit. The Space, Folder and List rules do not (`node-rules.ts` A8 leaves that to Phase 8), so an Agent who owns a List still manages it.
- **"never invites".** The default matrix gives Agents and Members the same invite rights (none). An Admin can grant `people.create` to Agents on the Access page.
- **"never exports".** Doc export as Markdown has no Agent check on the server; the UI only hides the menu item. Exporting your own meetings and your own timesheet CSV are also open to Agents.

**What changed.**

- `src/lib/access/labels.ts`: new `AGENT_TIER_BLURB`, the one sentence: "For frontline staff, such as support, warehouse or field teams. An Agent works as a Member but can't delete tasks, create Spaces or be anyone's manager, and most exports are closed to them." Its comment says where each claim is enforced, and why "Full access" is left out.
- `src/components/layout/os/invite-modal.tsx`: shows `AGENT_TIER_BLURB`.
- `src/app/(dashboard)/settings/members/member-drawer.tsx`: the Tier helper ends with "Agent: " and `AGENT_TIER_BLURB`.
- `src/lib/access/permission-matrix.ts`: the Agent role row uses `AGENT_TIER_BLURB`. The rule row now reads "Someone on the Agent tier", not "An AI agent".
- `src/lib/permissions.ts`: the Agent description now reads "Frontline staff (limited access)".

**Tests.** New `src/lib/access/labels.test.ts` (11 tests):

- the sentence names frontline staff, never a bot, service, AI or outsider
- it promises only the limits listed above, never Full access, invites or "never exports"
- it holds no dashes
- all three screen files use `AGENT_TIER_BLURB` and contain none of the old sentences
- the matrix rows match it.

Against the old files, all 11 fail.

## 2. The Overdue notification switch

**What was true.** `notifyItemsDueToday` (`src/lib/notify-item.ts`) is the only code that writes a `task_overdue` notification, and nothing calls it: no route, cron or script. Its own comment says "NOT WIRED TO A CRON YET". Even so, the Overdue switch:

- showed on My settings > Notifications, on by default
- was part of the Focused preset, whose description promised "your overdue tasks".

**Decision: hide the switch, do not wire a sender.** No sender fits cleanly:

- `notifyItemsDueToday` reads 500 rows across every workspace in one query, with no paging, and uses server-local midnight.
- The one daily job that fits, the `tasks-due-today` run of `/api/email/send-reminders`, would need a new paged sweep per workspace.

The worst case for real people decides it. Wiring the switch as it was promised ("once a day while a task is past due") means anyone with a backlog of old overdue tasks gets one Inbox row, and one desktop alert, per task every morning. It is on by default and in Focused, so that happens on day one. Choosing a cap or a digest is a product decision. Hiding the switch costs nothing real: nobody gets an overdue ping today anyway, Home and My work already show an Overdue group, and managers still get the Monday overdue digest.

**What changed.**

- `src/lib/account/notification-presets.ts`:
  - `overdue` leaves `TASK_INBOX_KEYS` and Focused.
  - New `HELD_INBOX_KEYS = ["overdue"]`. Its comment names what turns the switch back on: call the sweep from a daily job, with a cap per person, then put the key back in `TASK_INBOX_KEYS` (and Focused) and its row back on the page.
  - Presets no longer write or read the key, so a stored choice is left as it is.
  - `INBOX_KEY_FALLBACK` keeps `overdue -> due_reminders`, so the stored choice reads the same once a sender exists.
- `src/app/(dashboard)/account/notifications/page.tsx`:
  - The Overdue switch row is gone. It now shows only as a Coming soon row behind Show upcoming features, the page's own pattern for features with no sender.
  - The Focused description now reads "tasks assigned to you and mentions".
- `src/lib/notify-prefs.ts`: a comment on the `overdue` type points to `HELD_INBOX_KEYS`. The type and `MUTABLE_NOTIFY_TYPES` stay, for `notifyItemsDueToday` and for stored choices.
- No preference API lists the keys: the preferences schema takes any boolean record, so no change was needed there.

**Tests.** `src/lib/account/account-helpers.test.ts`, new block "the held Overdue switch" (4 tests):

- `overdue` is not in `TASK_INBOX_KEYS` and is in `HELD_INBOX_KEYS`
- presets neither write nor read it, so a stored `overdue: false` leaves the preset at Default or Focused, not Custom
- `inboxKeyOn` still reads a stored choice
- the page has no `key: "overdue"` row, shows the Coming soon row, and Focused promises no overdue.

Against the old files, 3 of the 4 fail. The `inboxKeyOn` test passes on both, on purpose: it pins behaviour that did not change.

## 3. Analytics and the retired `/api/tasks`

**What was true.** Nothing calls `/api/tasks` (410 Gone). I searched all of `src`, including template strings and `"/api/" +` concatenation. What mentions it:

- history comments in `src/lib/analytics.ts`, `src/app/(dashboard)/analytics/analytics-client.tsx`, `src/app/api/me/work/route.ts`, `src/app/(dashboard)/tasks/[id]/route.ts` and `src/lib/delegated-items.ts`
- the retired routes themselves and the 410 table in `src/lib/work/legacy-task-api.ts`
- tests.

Outside `src`, `vercel.json` still lists a cron at the retired `/api/tasks/run-sla-check`. Prod does not run on Vercel, and `scripts/CRON-SETUP.md` already says to delete that row.

**What changed.** Nothing.

## 4. The public OpenAPI document

**What was true, and what changed** (`src/app/api/v1/openapi.json/route.ts`). The enums are now read from the lists the routes use: the Prisma enums `UserStatus`, `Frequency`, `SOPType`, `SOPStatus` and `TaskSource`, and `PRIORITY_OPTIONS` and `DEFAULT_STATUS_OPTIONS` from `src/lib/board-items-shared.ts`. Each fix:

1. **Task `status`** was `["PLANNED", "IN_PROGRESS", "COMPLETED"]`, the retired `Task` table's enum. The routes read and write `Item.status`, a nullable string whose values each List picks for itself (`Board.statuses`), so no enum is true. It is now a nullable string. The default set (TO_DO, IN_PROGRESS, DONE) is given as `examples`, and the description explains the per-List values. The GET `status` filter is documented the same way: exact, any case.
2. **`info.description`** held an em dash. It is now a colon. No served string holds an em dash or a double hyphen.
3. **Task `priority`.** The enum was right but missed that the value can be null. It is now nullable, and the enum comes from `PRIORITY_OPTIONS`.
4. **Task `date` and `assigneeId`** can be null in the list. Both are now nullable. `createdAt` was missing and is added.
5. **SLA.** "Create a task (optionally SLA-tracked)", "auto-escalates when breached", the "SLA-tracked work" tag and the `task.escalated` event all promised escalation. The SLA check is retired (410) and nothing escalates a task, so the text now says so. `escalatedAt` is described as set only on tasks carried over from the old task system.
6. **POST /tasks.** The body was missing `category`, which the route accepts. The defaults are now documented (date, priority NORMAL, source MANUAL), as are the 400 and 404 answers and that a new task lands on the assignee's Personal list.
7. **GET /tasks** documented no parameters. It now lists limit, cursor, assigneeId, status, from and to.
8. **KPI `weight`** (in the schema, and in POST with default 1) does not exist: KPI has no such column and the route ignores it. Removed.
9. **KPI POST `unit`** claimed a default of "#"; the route stores null. The default is removed. **`frequency`** claimed a default of "monthly"; the route uses "MONTHLY", from the `Frequency` enum. Both fixed.
10. **KPI `targetValue`, `unit` and `kraId`** are optional columns and are now nullable. The list's `kra` and `_count` fields are added.
11. **KPIRecord `actualValue` and `score`** are optional columns and are now nullable.
12. **Person.** `manager`, which the list returns, was missing and is added. `status` comes from `UserStatus` (same values as before).
13. **POST /people `firstName` and `lastName`** are accepted but never stored. They now say so.
14. **Kudos.** `giver` and `receiver`, which the list returns, are added.
15. **SOP.** `status` was a plain string and now uses the `SOPStatus` enum. `description`, `subcategory`, `kraId`, `createdAt` and `updatedAt` are added. The status, category and sopType filters are documented, and so is the default: published SOPs unless you ask for another status.
16. **KRA.** The list's `role` and `_count` are added, and so is the `roleId` filter.
17. **Responses.** Every list GET now points at a `{ data, nextCursor }` schema, and every POST 201 at its schema. The paging parameters are documented everywhere.
18. **`x-events`** listed seven events that nothing fires: task.escalated, review.created, review.completed, sop.published, sop.updated, okr.created and okr.updated. They are removed. The descriptions of the three that do fire are now exact. task.created used to claim "every task creation".

These were checked and found right: `sopType` (matches `SOPType`), `source` (matches `TaskSource`) and the Person status values.

**Tests.** New `src/app/api/v1/openapi.json/route.test.ts` (9 tests). It builds the document through `GET` and checks that:

- the Task status has no enum and its examples equal `DEFAULT_STATUS_OPTIONS`, and nothing in the document says PLANNED or COMPLETED
- the task filter uses the same values
- priority equals `PRIORITY_OPTIONS`
- source, person status, frequency, sopType and SOP status equal the Prisma enums
- the KPI fixes hold
- the nullable task fields are marked
- there is no SLA promise, and `x-events` is the three events that fire
- the added fields are present
- no served string, key or value, holds an em dash or a double hyphen.

Against the old file, all 9 fail.

## Verification

- `npx vitest run` across every touched folder and every test that imports a changed module: 287 files, 4120 tests, all pass. That covers src/lib/access, src/lib/account, src/components/layout/os, settings/members, src/app/api/v1, send-reminders, items updates, item-comment, kudos-give and every top-level src/lib test.
- The old-code proof: I swapped in the HEAD versions of the nine changed source files, ran the three new test files (23 fail), then put the new files back.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0.
- eslint on the 12 changed files: 0 errors. The 22 warnings were already there: grey utility classes in invite-modal.tsx and an unused `allFalse` in permissions.ts.

## Found, not fixed (outside this batch)

- **Doc export.** `/api/docs/[id]/export` does not refuse an Agent; only the menu item is hidden. Exporting your own meetings and your own timesheet CSV are open to Agents. Either close them, or keep the word "most" in the Agent sentence.
- **Agents in Spaces, Folders and Lists.** These rules do not hold an Agent to Can edit. Until they do, the Agent sentence cannot promise "never Full access".
- **Mutes and due-today pings.** The due-today sender (`send-reminders`, the `tasks-due-today` run) ignores per-object mutes, but the Muted items card says muting stops due date updates from a Space, Folder or List.
- **Stale product docs on due-today.** docs/product (status.mdx, how-it-connects.mdx, spaces-and-tasks.mdx, time-and-search.mdx) says due-today notifications never fire. They do fire, from that run, wherever its crontab row is installed.
- **`nullable` in OpenAPI 3.1.** The document declares OpenAPI 3.1 but uses `nullable: true`, which 3.1 ignores. Moving to `type: [..., "null"]` throughout is a separate pass.
- **POST /api/v1/people** drops `firstName` and `lastName`, although the `Invitation` table has both columns. Storing them is a one-line route fix.
- **POST /api/v1/tasks with an unknown priority** throws inside `createBoardItem` and answers 500, not 400. Its `source` is not validated either.
- **Webhook event names.** `/api/webhooks` `VALID_EVENTS` accepts names that nothing fires: the seven above plus task.completed. Meanwhile task.status_changed, task.assignee_changed and task.field_changed do fire but only reach a "*" subscription.

# Batch 2

Worktree `theywrk-agents`, on top of 2e652b21. Nothing here is committed. Another builder works in the same worktree on `src/lib/agents/*`, `src/lib/browser/*` and `docs/plans/ai-teammates-phase4.md`; none of those files were touched.

The first three items enforce what `AGENT_TIER_BLURB` says, rather than shrink the sentence: an Admin picking a tier for frontline staff relies on it. `src/lib/access/agent-tier.contract.test.ts` now holds every claim of the sentence to the code.

## 0a. "Can't be anyone's manager"

**What was true.**

- A role change never counted the person's team. PATCH `/api/users/[id]` (the Members drawer) and the bulk role change both run `applyRoleChange` and `planRoleChange` (`src/lib/access/membership.ts`), and neither looked at reports, so a manager made an Agent kept every report.
- A handover to an Agent moved the leaver's direct reports to the Agent (`runHandover` in `src/lib/people/handover.server.ts`; the transfer dialog and SCIM both use it).
- Three more paths wrote a manager without the rule: `sendInvitation` stored any `managerId` as sent (another workspace's person, or an Agent; the Members invite, Ask AI's invite tool and `POST /api/invitations` all use it), the acceptance (`/api/auth/accept-invite`) wrote the stored id straight onto the new person, and `POST /api/users` (a manager adding an account with a password) wrote `managerId` from the body.
- Already right: `checkManagerCandidate` on PATCH `managerId`, the bulk update, the bulk import and the dotted lines. SCIM writes no manager.

**Decisions.**

- Reports are counted solid and dotted, each person once. Removed people are left out; a deactivated report still counts, because reactivating them would put them back under an Agent. This is the set `pendingHandover` already counts.
- The transfer dialog's picker is one choice for the work, the reports and the Spaces together, so `managersOnly` is not passed: it would stop handing work to an Agent, which stays allowed. Instead the dialog asks the server where the reports would go for the person picked and says it before anything runs; Confirm waits for that answer.
- An accepted invitation whose manager has since become an Agent (or left) joins with no manager rather than failing. Worst case of failing: a new hire cannot join because someone else's tier changed. Worst case of joining with no manager: an Admin sets one in Members, and the Members list already has a No manager view.

**What changed.**

- `src/lib/access/membership.ts`: rule 6. `planRoleChange` refuses a change to AGENT while `target.reports > 0` with a 409, code `agent_has_reports`, and the sentence "An Agent can't be anyone's manager, and N people report to them. Move their reports to someone else first." The last-Owner refusal now carries code `last_owner` too. `applyRoleChangeIn` counts the team (`reportCountOf`) under the role lock, only when the change would make the person an Agent.
- `src/app/api/users/[id]/route.ts`: answers with the planner's code (every 409 used to be coded `last_owner`). The Members drawer already shows the server's sentence on the Tier row and in a toast.
- `src/app/api/settings/members/bulk/route.ts`: each refused person is reported with that code; the rest still change.
- `src/lib/people/reporting-lines.ts`: `planReportHandover` (pure): reports go to the recipient unless that makes a loop or the recipient is an Agent; otherwise up to the leaver's own manager, never an Agent and never into a loop, else to no manager. `reportHandoverNote` is the dialog's sentence.
- `src/lib/people/handover.server.ts`: `runHandover` uses the planner; new `previewReportHandover`.
- `src/app/api/users/[id]/handover/route.ts`: `GET ?to=<id>` answers only the report plan for that recipient.
- `src/app/(dashboard)/settings/members/members-shared.tsx`: the TransferDialog fetches the plan whenever the pick changes and shows, for example, "Sam Agent is on the Agent tier, and an Agent can't be anyone's manager. Their 3 direct reports go to Dana Lee instead. The rest still goes to Sam Agent."
- `src/lib/access/manager-candidate.ts` (new): `managerCandidateIn` and `agentIdsIn`, the same rule as `checkManagerCandidate`, inside `src/lib/access` because the tier is the engine's to read (the G7 lint rule), and free of request imports.
- `src/lib/people/send-invitation.server.ts`: refuses an Agent or an outside manager (400, `agent_cannot_manage`).
- `src/lib/auth/invite-facts.server.ts`: new `managerOnAccept`; `/join` no longer names a manager the acceptance will not write. `src/app/api/auth/accept-invite/route.ts` writes `managerOnAccept(inv)`.
- `src/app/api/users/route.ts`: POST checks Reports to the same way.

**Tests** (fail on the old code / total):

- `src/lib/access/membership.test.ts`: 6 new, 4 fail. The two that pass on both pin a change with no reports and a non-Agent tier change.
- `src/app/api/users/[id]/route.test.ts`: 1 new, 1 fails.
- `src/app/api/settings/members/bulk/route.test.ts` (new): 1 of 1.
- `src/lib/people/reporting-lines.test.ts`: 5 new, 5 fail.
- `src/lib/people/handover.server.test.ts` (new): 3 of 4 (the fourth pins a recipient who may manage).
- `src/lib/people/send-invitation.server.test.ts` (new): 3 of 4 (the fourth pins a valid manager).
- `src/app/api/users/route.test.ts` (new): 2 of 2.
- `agent-tier.contract.test.ts`: the dialog and route wiring, the drawer row, the acceptance.

## 0b. "Can't create Spaces"

**What was true.** POST `/api/spaces/[id]/duplicate` made a new Space for anyone with Full access on the source, an Agent included. Every other `prisma.space.create` caller was checked:

- `createSpace` callers: POST `/api/spaces` and a Space template both ask `mayCreateSpace`, which refuses an Agent with the access flag on or off. `seedStarterSpace` runs for the founder of a new workspace. The legacy Marketing import is Owner and Admin only.
- `trash.ts` restore puts back the same Space row it took; that is a restore, not a new Space.
- The handover moves ownership and makes nothing. No AI teammate tool creates a Space.

**What changed.**

- `src/lib/access/labels.ts`: `AGENT_NO_SPACES = "Agents never create spaces."`, the engine's own words (decideOrg `create_space`; the contract test holds them equal).
- `src/app/api/spaces/[id]/duplicate/route.ts`: 403 with those words for an Agent, after the read and Full access checks, so a Space they cannot open stays a 404.
- `src/lib/access/space-create.ts`: `spaceCreateRefusal(accessLevel)` gives an Agent the same words on POST `/api/spaces` and the template door.
- `src/lib/work/container-menu.ts`: the Space menu no longer offers Duplicate to an Agent. A Folder or List copy is not a Space and stays.

**Tests.** `src/app/api/spaces/[id]/duplicate/route.test.ts` (new): 1 of 2 fail (the other pins a Member's copy). The contract test covers the words, the menu row and both refusal doors.

## 0c. "Can't delete tasks"

**What was true.** An Agent with Full access on a List, Folder or Space could move it to Trash with every task in it (DELETE `/api/boards/[id]`, `/api/folders/[id]` and `/api/spaces/[id]` with `?hard=1`, then `moveToTrash`). The container menu hid Delete from Agents, but the routes did not refuse. Checked and fine:

- Single task delete already refuses an Agent (`allowsItemAction`).
- The bulk bar's archive is gated as a delete, so it refuses an Agent too.
- Delete permanently and Empty trash are Owner and Admin only.
- No other route removes tasks: `deleteBoardItem` has no caller, and the List links route only unlinks.

**Decision.** Archiving stays open to an Agent. It keeps every task and can be undone, and a single task's archive is open to them already. Only a delete of a container that holds tasks, archived ones included, is refused; an empty one may go.

**What changed.**

- `src/lib/trash.ts`: `moveToTrash(..., { keepTasks })` counts the tasks of exactly the Lists it is about to remove, inside its transaction and after its row locks, so a task added meanwhile waits and is counted. It throws `TrashHoldsTasks` before anything is written.
- `src/lib/access/container-trash.ts` (new): `trashContainer` runs the delete with `keepTasks` on for an Agent and turns a refusal into a 403 with code `agent_keeps_tasks` and "This List holds 12 tasks, and an Agent can't delete tasks. Archive it instead, or ask someone else with Full access to delete it."
- The three DELETE routes call `trashContainer`. The client's menus already toast the server's `error`.
- `src/lib/access/placement-routes.contract.test.ts`: its Folder check now follows the call to `trashContainer`, still after `checkFolderDelete`.

**Tests.**

- `src/lib/trash-keep-tasks.test.ts` (new): 2 of 2 fail on the old code.
- `src/lib/access/container-trash.test.ts` (new): 4 tests; the module is new, so the suite cannot load on the old code.
- The contract test checks that all three routes use it.

## 1. Exports

**What was true.** `/api/docs/[id]/export` refused neither an Agent nor a Guest, though the menu row's rule (`block-doc-editor.tsx`) is `!viewer.isAgent && viewer.orgRole !== "GUEST"`. The survey responses export let an Agent through when they were a culture organiser or the survey's creator; the pages hide its Export CSV from Agents. Several exports the browser makes itself were offered to Agents: a List's Export to CSV, the Space list's CSV, a table's File > Download, and the canvas tool strip's and the older canvas editor's PNG export. The canvas "..." row was already hidden.

**Every export route an Agent can reach, now:**

| Route | For an Agent |
| --- | --- |
| `/api/activity/export.csv`, `/api/analytics/export.csv`, `/api/me/everything/export.csv`, `/api/trash/export.csv` | closed (`viewer.isAgent`) |
| `/api/docs/[id]/export` | closed (this batch) |
| `/api/pulse-surveys/[id]/responses/export` | closed (this batch) |
| `/api/export/assets`, `/api/export/tools`, `/api/export/reviews/[cycleId]`, `/api/reviews/export.csv` | closed |
| `/api/forms/[id]/responses/export.csv`, `/api/tables/[id]/export` | closed |
| `/api/policies/[id]/ledger/export`, `/api/policies/compliance/export`, `/api/sop-assignments/compliance/export` | closed |
| `/api/skills/export`, `/api/users/export` | closed (Admin and never an Agent) |
| CSV branches of `/api/kudos`, `/api/kudos/leaderboard`, `/api/talent-assessment`, `/api/team/members-work`, `/api/weekly-reviews` | closed |
| `/api/export/all`, `/api/export/people`, `/api/audit-log/export`, `/api/audit?format=csv`, `/api/marketing/legacy/export`, `/api/settings/matrix-export` | closed (Owner or Admin only) |
| `/api/export/[type]` | timesheets and meetings open, the rest closed (below) |
| `/api/me/export` (Download my data) | open: their own records |
| `/api/calendar/ics/[token]`, `/api/meetings/[id]/ics` | open: their own calendar, and a meeting they attend or created |

On `/api/export/[type]`, the timesheet CSV is open with `scope=mine` (their own weeks) and the meetings CSV covers only meetings they attend or created; every other type needs the manager tier or an Admin, and AGENT is no manager level.

So `AGENT_TIER_BLURB` keeps "most exports are closed to them": every one still open hands the person their own records back. Its comment now lists where each claim is enforced.

**What changed.**

- `src/app/api/docs/[id]/export/route.ts`: 403 "Agents can't export docs." and "Guests can't export docs.", after the read checks.
- `src/app/api/pulse-surveys/[id]/responses/export/route.ts`: 403 "Agents can't export survey responses." first.
- `src/components/board-view/board-table-view.tsx`, `src/app/(dashboard)/spaces/[slug]/page.tsx`, `src/components/tables/table-editor.tsx`: no CSV control for an Agent.
- `src/components/canvas/canvas-editor.tsx` and `whiteboard-canvas.tsx`: one `canExport` (neither Agent nor Guest) for the "..." row, the tool strip's button (new `canExport` prop) and the older editor's export and image save.

**Tests.**

- `src/app/api/docs/[id]/export/route.test.ts` (new): 1 of 3 fail (the others pin a Member's download and the 404).
- `src/app/api/pulse-surveys/[id]/responses/export/route.test.ts` (new): 1 of 2.
- `agent-tier.contract.test.ts`: every route file under `src/app/api` with "export" in its path must be in its table (a new one fails until it is classified); each closed one carries its refusal; the open ones are exactly the four own-records routes; the browser exports are gated.

## 2. Due today and per-object mutes

**What was true.** The `tasks-due-today` run of `/api/email/send-reminders` honoured the Due soon switch only, so muting a Space, Folder or List did not stop its due-today rows, although every other task notification honours the mute (`notify-item.ts`) and the Muted items card says it stops due-date updates. docs/product said due-today notifications never fire.

**What changed.**

- `src/lib/notify-prefs.ts`: `unmutedRows`, the same mute check (`MUTABLE_NOTIFY_TYPES`, `placeMuteKeys`, `mutedObjectKeys`) for a batch where every row has its own place, with one preferences read.
- `src/app/api/email/send-reminders/route.ts`: the due-today read takes each task's Folder and Space, and the rows go through `unmutedRows`.
- docs/product `using/time-and-search.mdx`, `using/spaces-and-tasks.mdx`, `reference/how-it-connects.mdx` and `reference/status.mdx`: due today fires once a day from that run, follows Due soon and the mutes; overdue still sends nothing (its switch is held), and managers get the Monday digest.

**Tests.** `src/app/api/email/send-reminders/route.test.ts`, 2 new: 1 fails on the old code (the mute); the other pins the plain notification.

## 3. The OpenAPI document

**What was true.**

- It declared OpenAPI 3.1 but marked 30 schemas `nullable: true`, which 3.1 ignores (3.1 is JSON Schema).
- The SOP list's `_count` was missing.
- POST `/people` had no 201 schema.
- The 404s of POST `/kpis` and POST `/kpi-records` were undocumented.
- task.created claimed less than exact.

**Decision on task.created: say which creations fire it, do not dispatch from the rest.** Dispatching from every creation path would also run every "When a task is created" automation (`dispatchEvent` feeds the automation engine too) for each task of a duplicated List, a template, a daily repeat or an SOP spawn. For a subscriber, the worst case is hundreds of webhooks and automation runs from one copy. The worst case of documenting is a subscriber who knows exactly which tasks they will not hear about.

What the code does: a task added in a List (POST `/api/boards/[id]/items`), POST `/api/v1/tasks`, the integrations ingest route and an automation's Create a task step dispatch it. The brief listed automations among the silent ones; they are not (`emitChained`). Copies, templates, repeats, SOP spawn, form responses, meeting action items and the notetaker, quick add from My work, AI teammates, workflows and imports do not.

**What changed** (`src/app/api/v1/openapi.json/route.ts`):

- `orNull()` writes 3.1's form: "null" joins the type, and an enum that may be null lists null. No `nullable` is left.
- SOP `_count` (compliance, assignments).
- An `Invitation` 201 schema for POST `/people`, plus its 400 and 409.
- The 400 and 404 of POST `/kpis` and POST `/kpi-records`.
- The 400 of POST `/tasks` (item 5).
- `x-events` is read from the new shared list (item 6).

**Tests.** `route.test.ts` keeps all 9 round-1 tests passing. Their `nullable` assertions now read the 3.1 form. 5 new tests forbid `nullable` anywhere, require null in an enum exactly when the type allows null, and cover each gap above. Against the old file (with only the new events list present): 10 of 14 fail.

## 4. POST /api/v1/people names

**What was true.** `firstName` and `lastName` were accepted and dropped, though `Invitation` has both columns and the join form starts filled in from them (the People import keeps them).

**What changed.** `src/app/api/v1/people/route.ts` stores them, cleaned with `cleanPersonName` (the join form's own cleaning), or null. The OpenAPI text says they are kept.

**Tests.** `src/app/api/v1/people/route.test.ts` (new): 2 of 2 fail on the old code.

## 5. POST /api/v1/tasks priority and source

**What was true.** An unknown priority threw inside `createBoardItem` (500); any `source` was stored as sent.

**Decision.** Values match in any case and are stored in capitals: a lower-case priority always worked (`normalizePriority` upper-cases it), and refusing it now would break an integration that sends "high". Anything outside `PRIORITY_OPTIONS` or the `TaskSource` enum, or not a string, answers 400 naming the real values. Absent keeps the defaults, NORMAL and MANUAL.

**What changed.** `src/app/api/v1/tasks/route.ts`; the 400 is documented.

**Tests.** `src/app/api/v1/tasks/route.test.ts` (new): 2 of 2 fail on the old code.

## 6b. The Focused preset's sentence

**What was true.** Focused said it "keeps only what is aimed at you", but it never touches the four Talk and announcement switches, and it turns kudos (aimed at you) off.

**Decision: make the sentence exact, not widen Focused.** Widening it to turn announcements off is the worst case: a person picks Focused to cut task noise and silently stops getting company announcements. Changing the sentence costs nothing.

**What changed.**

- `src/app/(dashboard)/account/notifications/page.tsx`: "Focused keeps two switches on, tasks assigned to you and mentions, and turns the other work and people switches off. Talk and announcements keep their own switches."
- `src/lib/account/notification-presets.ts`: the comment by `HELD_INBOX_KEYS` says that when overdue rejoins `FOCUSED_ON`, everyone whose stored switches match Focused must be written `inbox.overdue = true` first. Otherwise their missing key reads `due_reminders` (off under Focused), they read as Custom, and they get no overdue rows that Focused promises.

**Tests.** `src/lib/account/account-helpers.test.ts`, 2 new: 1 fails on the old page (the sentence); the other pins that no preset writes a Talk key.

## 6. Webhook events

**What was true.**

- `/api/webhooks` accepted eight names nothing sends: task.escalated, task.completed, review.created, review.completed, sop.published, sop.updated, okr.created and okr.updated.
- It could not name three that are sent (task.status_changed, task.assignee_changed, task.field_changed), so those reached "*" subscriptions only.
- A name outside its list was dropped in silence, and the rest was saved.

The dispatcher already matches a subscription by name or "*" (`webhookDispatcher.ts`), so a subscription by name needed only to be allowed.

**What changed.**

- `src/lib/webhook-events.ts` (new): `WEBHOOK_EVENTS`, the one list, each with an exact description: kudos.created, kpi.recorded, task.created, task.status_changed, task.assignee_changed, task.field_changed.
- `src/app/api/webhooks/route.ts` accepts exactly "*" and those. An unknown name is refused with a 400 that names it; nothing is dropped in silence.
- The OpenAPI `x-events` reads the same list.

**Stored subscriptions.** `WebhookSubscription.events` is a string array matched with `has`. Nothing is rewritten:

- A stored name nothing sends stays stored, and stays quiet as it always was.
- GET `/api/webhooks` now reports it per subscription as `unsentEvents`.
- I cannot read production, so I do not know which stored rows hold such names. Any subscription made before this batch with task.completed, task.escalated, review.created, review.completed, sop.published, sop.updated, okr.created or okr.updated holds one; those names never fired.
- Not to be confused with the integration webhooks (Settings > Integrations, `broadcastWebhook`). They send `meeting_created`, `sop_published`, `reviews_finalized` and `user_invited` to Slack or a custom URL, a separate system this batch leaves alone.

**Tests.**

- `src/app/api/webhooks/route.test.ts` (new): 3 of 4 fail on the old code (the fourth pins "*" by default).
- `src/lib/webhook-events.test.ts` (new) reads every `dispatchEvent` and `emitChained` call in `src` and holds the list equal to the names sent, both ways.

## Verification

- `npx vitest run` over every test in the touched folders, every test that names a changed module, and the agent tests that import `send-invitation`: 374 files, 5064 tests, all pass. That covers `src/lib/access`, `src/lib/people`, `src/lib/account`, `src/lib/auth`, `src/lib/work`, top-level `src/lib`, and the users, settings, spaces, boards, folders, v1, webhooks, email, docs, pulse-surveys, template-center and auth API folders. Also 9 more files that read changed strings, and 7 agent tests importing `tools.ts`: 262 tests, all pass.
- Old-code proof. I swapped in the HEAD versions of the 35 changed source files and removed the 3 new modules, then ran the 19 new or edited test files:
  - 39 tests failed in the suites that load.
  - `container-trash.test.ts` and `webhook-events.test.ts` cannot load (new modules).
  - The OpenAPI test, run with only the new events list present: 10 of 14 fail.
  - The POST `/api/users` test, fixed last, run against its old route alone: 2 of 2 fail.
  - Every test that passes on the old code pins behaviour that did not change, and says so above.
  - I then put the new files back and checked each against the backup.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0.
- eslint on the 39 changed or new source files and the 21 test files: no new problems. Every changed file has the same count of errors and warnings as at HEAD. The 7 errors were already there: 5 G7 `accessLevel` property errors in `send-invitation.server.ts`, and 2 `no-explicit-any` in `send-reminders/route.ts`.

## Found, not fixed (outside this batch)

- **POST /api/v1/tasks with a bad `date`** becomes an Invalid Date, and **POST /api/v1/kpis with an unknown `frequency`** fails in Prisma. Both likely answer 500, not 400.
- **POST /api/users** does not check `departmentId` or `roleId` against the workspace.
- **The bulk role change to Agent** does not end the person's Google connection for AI teammates the way PATCH does (`endTeammateAccessFor`, Decision 27); the cron sweep is the backstop. This is the AI teammates track's file to change.
- **AI teammates make tasks without task.created** (`src/lib/agents/tools.ts` `createPersonalTask`). The event's description now says so.
- **Activity and Everything** show Export CSV to an Agent, whose click lands on the server's 403. Nothing leaks; the menu row should hide.
- **The Members drawer** shows the Agent refusal with the row's generic Retry, which refuses again until the reports move.
- **Folder mutes** silence only a task whose List sits directly in the muted Folder, in every task notification (`placeMuteKeys` knows one Folder). A sub-folder's task is not silenced.
- **The due-today run** reads today in the server's own clock, not each person's.
