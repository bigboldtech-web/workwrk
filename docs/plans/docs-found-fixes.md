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

# Batch 3: notifications, API, docs and the browser

Worktree `theywrk-agents`, on top of de954765. Nothing here is committed. Another builder works in the same worktree on people, users, handover, membership, trash, the doc export route and `src/lib/access`; none of those files were touched. The items come from the batch 2 review's "api-and-notify" reviewer (six findings and its lows) and the "phase4-last-polish" reviewer's lows.

## 1. Meetings counted as tasks

**What was true.** `scripts/backfill-meeting-items.mjs` gives every meeting an Item on the workspace's hidden Meetings List (`settings.system`, item type `meeting`): owner the meeting's creator, assignees its attendees, due when it starts, no status. `openItemsOf` in `/api/email/send-reminders` read every List of the workspace, a null status counts as open, and neither the due-today read nor the overdue read spread `NOT_SYSTEM_ITEMS`. So a meeting's creator got a "Task Due Today" row for each of the day's meetings, and every Monday their manager's email listed every past meeting they ever made, by title, private ones included. The rows exist only where the backfill ran with `--write`.

**What changed.**

- `src/lib/system-items.ts`: `isSystemBoard`, read in code (a JSON filter `NOT settings.system = true` is NULL in SQL for a List without the key, and would drop every real List).
- `src/lib/reminder-sweep.ts` (new, pure): the rules both runs follow (below).
- `send-reminders`: `openItemsOf` leaves the hidden List out of its groups, the read spreads `NOT_SYSTEM_ITEMS`, and each row returned is checked again (`openTask`).

Every other Item sweep of a person's or a workspace's tasks had the same gap, and now spreads `NOT_SYSTEM_ITEMS`:

- `notifyItemsDueToday` (`notify-item.ts`, still not called);
- team workload, Team members (its grouped SQL leaves out `SYSTEM_ITEM_TYPES` too) and a person's work (`src/app/api/team/*`);
- the team calendar (`/api/calendar`, both reads);
- analytics (`src/lib/analytics.ts`);
- the performance score's task part (`calcTaskScore`: a meeting has no done status, so every meeting read as a task left undone);
- Everything (the rows and the facets);
- Talk updates (`talk-updates-server.ts`);
- an AI teammate's `list_tasks` (`agents/tools.ts`);
- "When a task's date arrives" automations (`schedule-server.ts`: an automation could have acted on a meeting's Item);
- search's task results (a meeting is found as a meeting already).

Already right: My work, Home, My items, the ICS feed, the calendar events, the field candidates, list links, dashboards and GET `/api/v1/tasks`. Not changed: the KRA and KPI rollups and goal effort read tasks by `metadata.kraId` or `kpiId`, which a meeting's Item never has; the repeat sweep reads `recurNextAt`, which it never has; the workspace export is all data; the handover's open-task count (`src/lib/people/handover.server.ts`) is the other builder's file (below).

**Tests.**

- `send-reminders/route.test.ts`: a meeting on the hidden List and one on a real List, due today and overdue: no row, and no title in the digest; the read's `itemType` filter and groups.
- `src/lib/system-items.sweeps.test.ts` (new): every sweep above spreads the fragment, read from the source (15 tests).
- `src/lib/reminder-sweep.test.ts` (new, 8 tests).

## 2. Archived places, every assignee, live people, once a day

**What was true.** Both runs counted tasks in an archived List and under an archived Space or Folder (archiving writes only its own row, so its Lists keep `archivedAt` null). Due today told only `ownerId`, though the Due soon switch says "a task assigned to you" and the docs say its assignee; it told people who were removed, deactivated or no longer in the workspace; and a second run the same day wrote every row again, though `scripts/CRON-SETUP.md` said "These jobs are idempotent".

**Decisions.**

- Every assignee is the union of `ownerId` and `assigneeIds`, each once. The overdue digest names each assignee in their own manager's digest, one line per task and person: a manager learns of a report's late task whether the report is the first assignee or another.
- Once a day per person and task, read by person (Notification's index leads with `userId`, never by `link`, which has none), as `notifyItemsDueToday` did. A read that fails sends anyway: a duplicate beats a missed deadline.
- The email digests of that endpoint stay as they are, and the doc now says so: a re-run of the overdue digests, policy acknowledgment, monthly evaluation or KPI recording emails everyone again. Recording what an email run sent is a separate change; the worst case of a duplicate digest is one extra email.

**What changed.**

- `src/lib/reminder-sweep.ts`: `sweepBoards` (archived List, Space or Folder at any depth, a loop in the tree stops the walk), `taskPeople`, `HAS_ASSIGNEE`, `liveInWorkspace` (not removed, not deactivated, anchored or a member here).
- `send-reminders`: `openItemsOf` reads the workspace's Lists, Spaces and Folders and keeps the live Lists; both reads take any assigned task; due today writes one row per live assignee after the switch, the mutes and today's rows already written.
- `scripts/CRON-SETUP.md`: the due-today row says who hears and that it writes once a day; Day-2 maintenance says which rows are safe to re-run.

**Tests** (`send-reminders/route.test.ts`): archived Space, child of an archived Space, archived Folder, child of an archived Folder; every assignee once, and a task with no first assignee; removed, deactivated, another workspace's and a member; three runs, the third a day later; the digest naming both assignees.

## 3. The product docs on events and reminders

**What was true.** `how-it-connects.mdx` said only five events are dispatched, `task.created` from the API and ingest only, `kudos.created` likewise, and "a rule on task created will not fire when you create a task in the app"; its map drew due-date notifications as a dotted "no cron yet" arrow. `status.mdx` said 5 of 16 triggers fire and that task created and kudos created rules never fire from the app.

**What changed**, from `src/lib/webhook-events.ts` and the dispatch sites:

- `how-it-connects.mdx`: the map's solid "due today, daily run" arrow and a dotted "overdue: no sender yet"; the table of the six events with every site (a List add, the v1 API, ingest and an automation's Create a task for `task.created`; the task edit, an AI teammate's edit, the bulk edit and an automation step for the three change events, with the 20 field cap; every kudos through `giveKudos` or `kudosAftermath`), the two time triggers, 8 of 19; the due-today paragraph (every assignee, once a day, never a meeting or an archived place).
- `status.mdx`: the Automation row (8 of 19, which fire from where) and the due-date row.
- `spaces-and-tasks.mdx`, `time-and-search.mdx`: each assignee, once a day.
- `src/lib/automation/registry-triggers.ts`: its header listed the emitters as the docs did, and now matches.

## 4. The KPI period

**What was true.** The OpenAPI example was "2026-Q1" in three places. `latestKpiValues` skips any period with a W or a Q, and compares every other key as a string with the month keys, so "October" or "2026-10-12" sorts after every real month and would pin a goal's live value. An integration that followed the example got 201 and a webhook, and its readings never moved a goal or counted as this month (the monthly "record your KPIs" email kept coming).

**Decision: refuse anything but a month key, with a 400 that says what to send.** Worst case of refusing: an integration built on the old example starts failing loudly, and is fixed by the error's own sentence. Worst case of accepting: its readings land and silently never drive a goal, for good. A month that has not started anywhere (fourteen hours ahead of UTC) is refused too: a forecast posted as next month would become the goal's live value. Any earlier month is taken, so history can be backfilled.

**What changed.** `src/lib/kpi-integration.ts` (new, pure): `integrationPeriodProblem` and `KPI_PERIOD_RULE`. The OpenAPI examples are "2026-10", the request body has the month pattern and says what other keys do, and the GET filter and the reading's own `period` say older keys are listed as stored and drive no goal.

## 5. A second reading for the same KPI, person and month

**What was true.** POST `/api/v1/kpi-records` created with no catch, so a second reading for the same key threw P2002 and answered a bare 500; a correction was lost. The ingest action did the same, and also wrote a reading for any user id it was sent, another workspace's people included.

**Decision.** There is no PATCH in the API, so a 409 would make a correction impossible, and the main integration case (a month's running total posted every day) would fail from the second day. So one reading per KPI, person and month:

- the same number again: 200, nothing changed, no webhook (a retry is safe);
- a different number while the month is open (this month or last, in any timezone, the months the in-app recorders write): 200, replaced, back to PENDING with no reviewer, since a manager's approval was of the old number and keeping it would show Approved on a number nobody approved;
- a different number for a closed month: 409 with the reading's `id` and code `kpi_month_closed`, as the in-app recorders never rescore a closed month;
- a create that loses a race decides again against the row that won.

**What changed.** `src/lib/kpi-integration.server.ts` (new): `recordIntegrationKpi`, used by POST `/api/v1/kpi-records` and the ingest `kpi.record` action (which now checks the person is in the workspace). `actualValue` and `targetValue` take a number or a string of one (`parseKpiNumber`); anything else is a 400. The OpenAPI documents 200, 201, 400, 404 and 409.

**Tests.** `src/app/api/v1/kpi-records/route.test.ts` (new, 7), `src/app/api/integrations/ingest/route.test.ts` (new, 4, the other workspace's person and a second reading among them), `src/lib/kpi-integration.test.ts` (new, 7).

## 6. Webhook signatures

**What was true.** POST `/api/webhooks` returned the `whsec_` secret and said to verify the signature with it, but `webhookDispatcher.ts` signed every delivery and retry with `secretHash`, the SHA-256 hex of the secret. A receiver that did what it was told rejected every delivery, and ten failures paused the subscription.

**Decisions.**

- The secret is kept sealed with the existing helper (`src/lib/connectors/seal.ts`, AES-256-GCM under `SECRETS_ENCRYPTION_KEY`) and every delivery is signed with it.
- An existing subscription has only the hash (its secret was never kept), so it keeps signing with the hash, exactly as before: a receiver that already verifies it keeps working. GET says which key each one signs with (`signing`: `secret` or `legacy_hash`, with a sentence), and the new rotate path moves it to the secret.
- A server that can't seal a secret makes no subscription (503): one made anyway would sign with a key its receiver was never shown.
- A sealed secret no key opens sends nothing (a delivery signed with the wrong key is only rejected): the delivery waits for its retry, marked "Not sent", and the subscription's failure count is left alone, since the receiver did nothing wrong.

**What changed.**

- **SQL**: `prisma/sql/2026-10-12-webhook-secret-sealed.sql`, `"WebhookSubscription"."secretSealed" JSONB` nullable, catalogue-guarded, catalogue only, no backfill, listed last in `SQL_MANIFEST` (a text edit) and declared in `prisma/schema.prisma`. It must run before the new build reads subscriptions, which the manifest does. I ran `npx prisma generate` locally so the type check sees the column (the client is gitignored).
- `src/lib/connectors/seal.ts`: `SEALED_COLUMNS` lists it (nullable), so `scripts/rotate-secrets-key.ts` moves it in a key rotation; that script's header names it.
- `src/services/webhookDispatcher.ts`: `signingKeyOf`, `signatureHeader` and THE SIGNING KEY note; the header comment's event list is now the real one.
- `src/app/api/webhooks/route.ts`: POST seals; new PATCH `{ id, rotateSecret: true }` makes a new secret, shown once, audited as `webhook_subscription_secret_rotated`; GET reports `signing` and never returns the sealed value; the message says exactly how to verify: `X-Workwrk-Signature: t=<timestamp>,v1=<signature>`, HMAC-SHA256 keyed with the secret over `<timestamp>.<raw body>`, lowercase hex, compared in constant time, a timestamp over five minutes old refused.
- The OpenAPI `info.description` and a new `x-webhook-signature` say the same, and what an older subscription signs with.

**Tests.** `src/services/webhookDispatcher.signing.test.ts` (new, 5), `src/app/api/webhooks/route.test.ts` (4 new), `seal.test.ts` (the list).

## 7. The API's other answers (lows)

- POST `/api/v1/tasks`: a `date` that is not a date answered 500 (an Invalid Date inside the create); a numeric string `slaHours` was stored as text and read back as null. Now 400 for either, `slaHours` read as a number (zero or less is no SLA, as before), and GET's `from` and `to` answer 400 too. The ingest `task.create` action reads them the same way (`src/lib/api-input.ts`, new).
- POST `/api/v1/kpis`: an unknown `frequency`, or a target that is not a number, answered 500; now 400 naming the values, a frequency in any case stored in capitals, as a task's priority is.
- GET `/api/v1/sops`: a `status` or `sopType` outside the enum answered 500; now 400, any case taken.
- `x-events`: the three change events say they fire from AI teammate edits too, and `task.field_changed` that one edit fires it for at most 20 fields.
- The 403s: `Forbidden` names the suspended or cancelled workspace; POST `/people` documents its own 403 with `code: seat_limit`. Every 4xx without a body now points at the `Error` schema.

**Tests.** `v1/tasks/route.test.ts` (3 new), `v1/kpis/route.test.ts` (new, 2), `v1/sops/route.test.ts` (new, 2), `openapi.json/route.test.ts` (7 new).

## 8. The Phase 4 browser lows

The seven lows of the polish's reviewer, fixed by Decisions 14 and 22 (the card is read after the start lock's transaction, not in it, and only for the held row; a time cap whose swap failed on an open row, and a read that fails after a lost end, hold the card with `notReachedNow`; "The person" for an empty name; the two NoOther sentences true for a continue; no quoted "Closed."). Each one, with its tests, is in docs/plans/ai-teammates-phase4.md, "After the last polish".

## Verification

- `npx vitest run`, the whole suite: 703 files, 10,206 tests, all pass.
- Old-code proof: a scratch copy of the worktree (node_modules linked, the shared worktree never touched) with the 31 changed source files put back from de954765, checked byte for byte, and the 4 new modules removed. The 18 new or edited test files: 68 tests fail.
  - `kpi-integration.test.ts` and `reminder-sweep.test.ts` cannot load (new modules).
  - Every new or changed test fails except three that pin behaviour that did not change: a valid month still answers 201 (kpi-records), an older subscription still signs with its hash (dispatcher), and a card read that fails after the start lock keeps the card's words (the test database cannot abort a transaction, so this one passes on both).
  - By file: send-reminders 6 of 6 new, ingest 4 of 4, kpi-records 6 of 7, kpis 2 of 2, sops 2 of 2, tasks 3 of 3 new, openapi 7 of 7 new, webhooks 4 of 4 new, dispatcher signing 4 of 5, seal 1 of 1 changed, sweeps contract 15 of 15, and the browser files 14 of 15 (the Phase 4 entry).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0 with every change here in place. A last run, after the other builder added `src/app/api/users/[id]/agent-reports/route.test.ts`, shows 7 errors, all in that file and none in this batch's.
- eslint on the 54 changed or new files: no new problems. The 2 errors and 3 warnings left were there at de954765 (`no-explicit-any` and an unused `subject` twice in `send-reminders/route.ts`, an unused `_req` in `webhooks/route.ts`).
- `npx prisma validate`: valid. `node scripts/check-schema-sql.mjs`: ok. `node --check scripts/deploy-migrations.mjs`: ok.

## Found, not fixed

- **The handover's open-task count** (`src/lib/people/handover.server.ts`, the other builder's file) reads `ownerId` Items with no `NOT_SYSTEM_ITEMS`, so a leaver's meetings may count, and be handed over, as open tasks.
- **GET `/api/v1/people`** passes `status` to the read unchecked (500 for an unknown value); left for the people track.
- **The API's KPI score** is `actual / target`, capped at 100, not the shared direction-aware `scoreKpiRecord`, so a lower-is-better KPI posted through the API or ingest scores high for a bad number.
- **The send-reminders email digests** send again on a second run the same day (now said in CRON-SETUP.md).
- **Two due-today runs at the same moment** could both write: the once-a-day check is a read before the write, with no lock. The cron runs once a day.
- **The due-today run** still reads today in the server's clock, not each person's.
- **Webhook receivers** can't tell from the header which key a subscription signs with; GET `/api/webhooks` says so, and there is no screen for it yet.
- **docs/product `how-it-connects.mdx`** still says analytics and the performance score read the legacy Task table; both read Item. Not about events or reminders, so left. `status.mdx` says the reminder cron needs registering by hand; I can't read the server's crontab.

# Batch 3: people, access and Trash

Worktree `theywrk-agents`, on top of de954765. Nothing here is committed. The items come from the batch 2 review's Agent tier findings. Another builder works in the same worktree on notifications, send-reminders, webhooks, `/api/v1`, docs/product, `src/lib/agents` and `src/lib/browser` (its part is above); none of those files were touched here. No SQL.

## 1. Deleting a Space locks the Space

**What was true (confirmed).** The Space branch of `moveToTrash` locked only the Lists already in the Space and their tasks. It never locked the Space row, and it deleted Lists and Folders by `spaceId`. Creating, moving (`moveList`, `moveFolder`), restoring or copying a List or Folder into the Space needs only a key-share lock on the Space row for its foreign key, so it committed during the delete:

- `Board.spaceId` is SetNull and `Folder.spaceId` cascades, so a List that arrived after the capture was deleted, with its tasks cascading, and no copy in the snapshot. A List restored from Trash at that moment had already lost its own TrashItem.
- An Agent's `keepTasks` count missed it: an Agent could delete an empty Space and take a 50-task List moved in meanwhile.

The Folder branch was safe for Lists. Its Folders are locked FOR UPDATE (`lockFolderBranch`), `Board.folderId` is a foreign key, and creates take `lockParentFolder`'s share lock. But it also deleted Lists by `folderId`, not by the ids it captured.

**What changed** (`src/lib/trash.ts`):

- A Space takes `SELECT id FROM "Space" WHERE id = ... FOR UPDATE` first, then its Folders FOR UPDATE (a Folder can't move out mid-delete), then its Lists and their tasks, as before. The `keepTasks` count runs after all three, over exactly the Lists it removes.
- Lists and Folders are deleted by the ids in the snapshot just written, never by `spaceId`. Canvases, tables and files already were. A row the capture never saw is never removed; at worst its SetNull keeps it.
- A Folder's Lists are deleted by the captured ids too.

A move into the Space while the delete holds it waits, then fails its foreign key: the mover gets an error and nothing is lost. Two crossing transactions can still deadlock. Postgres ends one, and the Space DELETE route answers "Couldn't delete this Space".

**Tests.** `src/lib/trash-space-lock.test.ts` (new): 4 tests, all 4 fail on the old code. They cover the lock order, deletes by id, the Agent count after the Space lock, and a Folder's Lists by id.

## 2. A restore re-checks the person's lines

**What was true (confirmed).** Removal keeps `managerId` and the dotted lines. `DELETE /api/users/[id]?restore=true` wrote `{ deletedAt: null, status: "ACTIVE" }` and checked nothing. Rule 6 never counted removed people (`reportCountOf` leaves them out), so a person removed in March whose manager became an Agent in June came back in August under the Agent. The Agent then had chain-view of their people data and was their manager reviewer.

**Decision.**

- **Solid manager.** Kept only while `managerCandidateIn` with `live` answers ok: same workspace, not removed, no Agent, not deactivated. A deactivated manager fails too: a deactivated person holds no reports (invariant 13; PATCH refuses a deactivation while reports remain), so restoring under one would make the state the invariant forbids.
- **Dotted lines.** Taken off when they point to an Agent or a removed person. A dotted line to a deactivated manager is kept, as a deactivation keeps dotted lines.
- **Worst cases.** Clearing: the person comes back with no manager; the answer says so and the No manager view lists them. Keeping: an Agent reads their people data.

**What changed.**

- `src/lib/access/manager-candidate.ts`:
  - `managerCandidateIn(org, id, { db, live })` can run inside the caller's transaction, and with `live` answers "inactive".
  - `agentIdsIn` takes a db.
  - New `staleLinesOf` and `staleLineWords`.
- `src/app/api/users/[id]/route.ts`, the restore transaction:
  - It takes the role lock, then the seats lock (PATCH's order), and reads `staleLinesOf` under them.
  - It clears `managerId` and deletes the failing dotted lines in the same transaction.
  - Each cleared line is logged as `reporting_line_changed`, for example "Restored Max Chen with no manager: Dana Ray is on the Agent tier, and an Agent can't be anyone's manager".
  - Open reviews follow (`followReportingLine`).
  - The answer says "Max Chen has been restored with no manager, because ... Set who they report to in Members." and lists `linesCleared`.

**Tests.** `src/app/api/users/[id]/route.test.ts`: 4 new restore tests, all 4 fail on the old code. They cover:

- a manager who became an Agent
- a deactivated or removed manager, and a kept one
- dotted lines
- the lock order.

## 3. An Agent is no one's manager in every read

**What was true (confirmed).** Rule 6 runs only on the change to AGENT. Agents made before it kept their reports and dotted lines, and every read followed the stored line:

- report trees: `relationTo` chain and chain-view, `hasReports`, the manager app floors, Team views and queues
- direct reports
- the manager a row names: review reviewer, weekly review manager, timesheet approver.

**Decision: no stored row is rewritten on its own.** Every read that grants reach goes through `src/lib/access/manager-lines.ts`:

- **An Agent's own reach is none.** Rooted at an Agent, every walker finds nobody below:
  - `team.ts` `getTeamUserIds`
  - `reporting-line.ts` `getSolidReportTree`, `getEffectiveReportTree`, `getSolidReports`, `getDottedReports`, and so `isInReportTree` and the engine's `viewer.reportTree`.

  `hasReports` and `peopleCtx`'s chain also check `viewer.isAgent`.
- **The people listed under an Agent report, in effect, to the next manager up the solid line who is no Agent** (`reporting-lines.ts` `effectiveManagerFrom`).
  - That is nobody when, past an Agent, the line ends, loops or reaches a removed person.
  - An Agent in the middle of a tree is walked through as before, so that manager already reached them. Nobody gains reach the trees did not give.
  - A stored manager who is no Agent is read as stored, as before.
- **A dotted line to an Agent counts for nobody.** It is a named extra relationship, and handing it up would give the manager above reach the line never gave. Worst case: someone loses a dotted relationship only an Agent held, which an Admin can give to a manager.

**Readers changed:**

- **Trees and the facts read from them.**
  - `src/lib/team.ts`, `src/lib/reporting-line.ts`
  - `src/lib/access/resolve.ts` `hasReports`
  - `src/lib/people/person-access.server.ts` `peopleCtxForViewer`
  - `src/lib/people/teams-counts.ts` `hasReportsFor`
  - `src/lib/alignment-scope.ts` (`leadsPeople`)
  - `src/lib/access/app-floor-impact.server.ts` (the Apps page's preview)
  - `src/app/api/calendar/events/route.ts` (`hasTeam`)
- **Direct reports and dotted lines.**
  - `src/app/api/kra-assignments/route.ts` (`?managerId`), `src/app/api/okrs/route.ts` (Direct reports only), `src/app/api/dashboard/team-dashboard/route.ts`
  - `src/lib/people/team-scope.server.ts` (My team and Workload's Direct view), `src/lib/process-run-access.ts`
  - `src/lib/team-rollup.ts`: an Agent among the directs is no sub-team lead.
  - `src/app/api/users/[id]/record-access/route.ts`: Who can see this record lists no Agent.
- **Review cycles.** The manager a review names is never an Agent:
  - the launch reviewer (`reviews/[id]/launch`)
  - the cycle GET lens and the manager review GET and PUT, through `reviewerFacts` (`review-cycle.server.ts`)
  - `followReportingLine`
  - the cycle page's team face.

  An Agent's launch stamp writes nothing on an open review (`effectiveReviewerId`, which can now answer null). With no manager above, only the People team and Admins write it until someone is named Reports to.
- **Weekly reviews.**
  - The recorded manager is the effective one at create and at submit.
  - `managerQueueWhereFor` drives the direct queue, the badge, the list and the chain. It is empty for an Agent and adds the people listed under one to the manager above.
  - The recorded-manager fallback never admits an Agent, in the decision route or in `legacy-resolve.ts`.
  - The reminders go to the effective manager.
- **Timesheets and purchase orders.**
  - The approver at creation is the effective manager (`timesheets`, `time-entries`, `time-entries/punch`, `purchase-orders` create and submit).
  - `timesheets/[id]` never treats an Agent as the approver for read, reopen or decide.
  - The Approvals queue shows a week whose stored approver is an Agent to the people the subject reports to, as an unclaimed week.
  - The submit notice goes to the effective manager.
- **KPI submissions** tell the effective manager and the dotted-line managers who are no Agent (`kpi-review.server.ts`).
- **SCIM.** `unattendedRecipient` (`membership.ts`) passes over an Agent to the live manager above.

**For Admins.**

- **The Members list.** Each Agent's row carries `agentReports` (live solid and dotted reports; `members-list.server.ts`).
- **The drawer.** For the people who write Reports to (Owner, Admin, People team), it shows under Reports to: "Sam Agent is on the Agent tier, and an Agent can't be anyone's manager, so Sam Agent doesn't manage the 3 direct reports and 1 dotted-line report still listed under them. Move them so the record matches: the 3 direct reports go to Dana Lee, and the dotted line is taken off."
- **Move their reports** calls `POST /api/users/[id]/agent-reports` (new; GET is the preview). It runs `moveAgentReports` in `handover.server.ts`, under the role lock:
  - The direct reports take the handover's own routing (`planReportHandover`, as if the Agent left with an Agent recipient): the first person up the line who is live and no Agent, else no manager.
  - The dotted lines to the Agent are taken off.
  - The move is logged, and reviews follow.
  - The button waits for the preview; a failed preview offers Retry.

**Checked, no change needed:**

- These decide by level or only count: the workflow engine, `cron/review-cycles` `managersFor`, `escalation-report` (a count) and PO decisions.
- `bulk-import` writes invitations, which are checked again at acceptance.
- These only display or filter: the directory, the org chart, the Members manager column, `talent-assessment`, `my-team`'s direct set, `team-alignment`'s direct label, and the person page's Reports to and Direct reports.

**Tests:**

- `src/lib/access/manager-lines.test.ts` (new, 9): the walkers, the helpers and `hasReports` over an in-memory workspace. The module is new, so the suite cannot load on the old code.
- `src/lib/people/person-access-agent.test.ts` (new): 1 of 2 fails on the old code. The other pins a manager's chain.
- `src/lib/people/reporting-lines.test.ts`: 8 new, all fail. They cover `effectiveManagerFrom`, `liveManagerFrom`, the plan with the line's facts, and `agentReportsNote`.
- `src/lib/performance/review-cycle.test.ts`: 1 new, fails.
- `src/lib/performance/review-cycle-agent.test.ts` (new): 3 of 3 fail.
- `src/lib/weekly-review-agent.test.ts` (new): 3 of 3 fail.
- `src/lib/access/app-floor-impact-agent.test.ts` (new): 1 of 1 fails.
- `src/lib/access/membership.test.ts`: 1 new (`unattendedRecipient`), fails.
- `src/lib/process-run-access.test.ts`: 1 new, fails. Its prisma mock gained `user.findUnique`.
- `src/app/api/users/[id]/agent-reports/route.test.ts` (new, 4). The route is new, so the suite cannot load on the old code.
- `src/lib/people/handover.server.test.ts`: 7 new, 6 fail. They cover `moveAgentReports` and its preview, the lock, and the walk past an Agent; the walk past a deactivated manager belongs to 5b. The seventh pins that a walk past an Agent never lands on a removed person. The batch 2 tests still pass; the mocks now answer both handovers.
- `src/lib/access/agent-manager-reads.contract.test.ts` (new): 12 of 12 fail. It holds each reader and each write to its wiring.

## 4. Doc export refuses a real Guest

**What was true (confirmed).** The route refused a Guest with `orgRoleOf({ accessLevel: ctx.accessLevel }) === "GUEST"`. A Guest is the stored `User.orgRole`, read with ACCESS_V2_TABLES on (`effectiveOrgRole`), and a Guest's level is EMPLOYEE, so the check never fired. The test set a "GUEST" level no row can hold. No other batch 2 change refused a Guest that way: the canvas, table and List controls read `useViewer().orgRole`, the engine's own answer.

**What changed.** `src/app/api/docs/[id]/export/route.ts` decides both refusals from the engine's viewer (`viewerFromSession`), the one the menu's `useViewer` reads. It also keeps the level check for an Agent.

**Tests.** `src/app/api/docs/[id]/export/route.test.ts` is rewritten to run the real `viewer.ts` hydrate. A Guest is modelled as the database holds one: level EMPLOYEE, stored orgRole GUEST, ACCESS_V2_TABLES on. 1 of 5 fails on the old code, the Guest test. The others pin the Member's download, the Agent's 403, the 404, and that with the flag off the same row is a Member, as everywhere else.

## 5. Lows

- **5a. Accepting an invitation.** `managerOnAccept` passes `live`, so a manager deactivated since the invitation went out is never written. The new person joins with no manager, as the batch 2 decision says. It reads inside the acceptance's transaction, under the role lock (5c).
  - Test: `src/lib/people/send-invitation.server.test.ts`, 1 new, fails on the old code.
- **5b. The handover walks up to someone who can manage.** `planReportHandover` takes the line's facts (`people`) and sends the reports to `liveManagerFrom(leaver's manager)`: the first person up the line who is live and no Agent, else no manager. Before, that was the leaver's own manager with no liveness check. `runHandover` and the transfer dialog's preview read the facts from `lineMapFor`.
  - Tests: the handover and `reporting-lines` tests above.
- **5c. Rule 6's races.** Every write of a reporting line now takes `lockOrgRoles`, the lock rule 6 counts under, and checks the manager again inside it. A change to Agent then either waits for the write and counts the new report, or lands first and is seen. The writes:
  - PATCH `/api/users/[id]` with a new Reports to
  - the bulk change of manager
  - the dotted-lines PUT
  - `POST /api/users`
  - the acceptance
  - the handover (now one interactive transaction, with the plan read under the lock)
  - the Agent move
  - the restore.

  Where seats are locked too, the role lock comes first, PATCH's order.
  - Tests that fail on the old code: 1 each in `dotted-lines/route.test.ts`, `users/route.test.ts` and `users/[id]/route.test.ts` (PATCH), plus the restore and handover lock tests and the contract test.
- **5d. TransferDialog.** When the reports plan cannot be read, Confirm stays held and the dialog says "Couldn't check where their direct reports go, so this waits until it can." with Retry.
  - `ConfirmDialog` gained `confirmDisabled`, which holds the confirm button and Enter but not Cancel. `busy` disables Cancel too, which would trap someone in a failed dialog.
  - Test: `agent-tier.contract.test.ts` holds the wiring. Its three batch 2 assertions on the old wiring (the plan key, the acceptance and the export marker) were updated, and fail on the old code.

## Verification

- `npx vitest run` over every test in the touched folders, every test that imports or mocks a changed module, and every test that reads a changed file's source: 346 files, 4551 tests, all pass.
- **Old-code proof.** In a scratch copy of the tree, I put the 49 changed source files back from de954765 and removed the 2 new modules, then ran the 19 new or edited test files:
  - 53 of 162 tests fail in the 17 suites that load.
  - `manager-lines.test.ts` and `agent-reports/route.test.ts` cannot load (new modules).
  - Every test that passes on both pins behaviour that did not change, and says so above.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0.
- **eslint** on the 70 changed or new files: 2 errors and 1 warning, the same counts as at HEAD (checked by linting each file's HEAD content).
  - The 2 errors are the G7 `accessLevel` read at line 261 of `src/app/api/calendar/events/route.ts`, already there.
  - The warning is the breadcrumb rule on `src/app/(dashboard)/reviews/[id]/page.tsx`.

## Found, not fixed

- **The Monday overdue digest.** `send-reminders` (the other builder's file) picks each assignee's stored `manager`, so it can go to an Agent. It should read `effectiveManagersOf`.
- **Canvases, tables and files moved into a Space while it is deleted.** They name the Space with no key, so the Space lock does not hold them back. One that arrives mid-delete stays live, pointing at the removed Space. Their moves and creates need a key-share read of the Space.
- **Displays of the stored line.** The person page's Reports to and Direct reports, the org chart, the Members manager column, `my-team`'s direct set and `team-alignment`'s direct label still show the stored line. They grant nothing.
- **No way to find them from the list.** The Members page has no filter for Agents with stored reports; the drawer shows them one at a time.
- **A purchase order's stored approver** who is an Agent can still read that one PO (`canSee`). Deciding needs the manager tier, which an Agent never has.
- **`sendInvitation`** accepts a deactivated manager at invite time; the acceptance drops them.
- **The report tree's depth cap of 6** counts an Agent in the middle of a chain as a level.
- **`weekly-review.ts` `getReviewForViewer`** has no caller. It was made Agent-safe anyway.

# Batch 4: digests, KPI readings, Trash and webhooks

Worktree `theywrk-agents`, on top of d08761d4. Nothing here is committed. The items come from the batch 3 review: the KPI reviewer, and the reviewer of notifications, Trash and webhooks. Another builder works in the same worktree on reviews, weekly reviews, `manager-lines.ts`, the report trees, `facts.ts`, the handover and every other reviewer or manager read. None of those files were touched here; `src/lib/access/manager-lines.ts` is only called. No SQL.

## 1. Who a manager digest goes to

**What was true (confirmed).** The Monday overdue tasks digest read each assignee's stored `manager`, and `digestManager` checked only that the manager was live and in the workspace, never their tier. Batch 3 then put every assignee into the digest. So an Agent who kept reports from before rule 6 got their people's overdue task titles every Monday, though an Agent is nobody's manager. The overdue SOP digest read the same stored line. So did the monthly evaluation reminder, through `directReports`, and it never checked the manager was in the reports' workspace at all.

**Decision.** A digest line about a person goes to their digest manager, `digestManagersOf` in `src/lib/access/digest-recipients.ts` (new):

- the manager they report to for every read that grants reach (`effectiveManagersOf`): the stored manager, or past an Agent the next person up who is none;
- live, holding a level in this workspace, and not the Agent tier there (a manager anchored elsewhere is read at their membership's role here);
- never the person themselves.

Only people anchored in the workspace have a digest manager there, as on the team pages (`getTeamUserIds` walks only people anchored in the workspace). Someone who works here through a membership reports to a manager in their own workspace.

- Worst case of this rule: an agency manager is not emailed about a client task of their person, which their Team page in the client workspace does not show either.
- Worst case of the stored line: an Agent, or a manager judged by another workspace's tier, reads this workspace's titles every week.

The same rule now drives all three emails. The monthly evaluation runs per live workspace, a page at a time of the people with a stored manager, and names the people listed under an Agent in the reminder of the manager above. A manager who is in none of their reports' workspaces gets no reminder naming them; they could not open those people's KPIs from their own workspace anyway.

## 2. What the overdue tasks digest names

**What was true (confirmed in the code).** `digest.add` ran with no access check, so a task's title reached a manager who cannot open its List. The team pages hold the opposite rule: a title on a List the viewer cannot open never leaks (`team/members-work`, `team/person-work` read only `readableBoardsFor`). Batch 3 widened it: every co-assignee's manager got the line. The digest also had one line per task and person, so one task shared by two of a manager's people read as "2 overdue items".

**Decisions.**

- **A task reaches a manager only when they can open it in the app.** That is Can view or more on its List, by the node resolver, or being one of its assignees.
- **A co-assignee's manager does get the task, under that check.** The team pages count every assignee on Lists the viewer can read.
  - Worst case of telling them: they learn by email of a task their Team page already shows them.
  - Worst case of not: a person's late work never reaches their manager whenever someone else is listed first, the gap batch 3 closed.
- **A task the manager cannot open is left out, not counted.**
  - Worst case of counting it unnamed: it tells a manager that hidden work about their person exists (an HR investigation may be about the manager).
  - Worst case of leaving it out: they miss one late task they could not open anyway.
- **One line per task and manager, naming each of their people on it** ("Uma One, Ugo One"). The count, the "Showing the 50 oldest of N" line and the subject count tasks. `overdue-reminder.ts` is unchanged: its rows are now tasks.

**Batched.** `listsEachCanRead` answers for every manager and List of a page over one world: one `loadRows` and one `loadAllGrants`, the rules evaluated per manager in memory. It is never a resolver call per task or per manager. Answers are kept per workspace run by (manager, List), so a later page asks only about pairs not seen yet.

**What changed.**

- `src/lib/access/digest-recipients.ts` (new): `digestManagersOf`, `listsEachCanRead`.
- `src/app/api/email/send-reminders/route.ts`: the three emails above. `managerSelect` and `digestManager` are gone.
- `docs/product/reference/how-it-connects.mdx` and `status.mdx`: who the digest goes to and what it names.

**Tests.**

- `send-reminders/route.test.ts`: 7 new and 1 changed. They cover the manager above an Agent, a line ending at an Agent, the SOP digest and the monthly evaluation, a task the manager cannot open, a co-assignee's manager (and one who is on the task), one read per page, and one line per task. Its mock answers both the old and the new reads, so the batch 3 tests run unchanged against both.
- `src/lib/access/digest-recipients.test.ts` (new, 4): the manager rules, a membership's role, and `listsEachCanRead` against the resolver's own answer for each viewer alone (`decideAll`), on a Private List.

## 3. KPI readings from an integration

**What was true (confirmed).**

- **The resend.** `integrationKpiWrite` counted a reading unchanged only when the number AND the target matched. With no `targetValue` sent, the target compared was the one the integration works out (`kpi.targetValue ?? 0`). That moves whenever someone edits the KPI's target, and it is not what an in-app writer stores for a qualitative KPI with no target (the rubric ceiling, 5). So after one target edit, the nightly sync's same number cleared a manager's approval in an open month (back to Pending, which reads "Not recorded") and answered 409 for every closed month it posted again, every night.
- **The empty reading.** An in-app reading with no number (a recorder saved the month with the KPI left blank) answered 409 in a closed month, "its reading holds a different number", though it held none. So the backfill the docs promise was refused for exactly the months people opened the recorder.

**Decisions.**

- **Only what the caller reported is compared:** the number, and the target only when it sent one. A different target sent is a change, so it replaces in an open month and answers 409 in a closed one.
- **The line a written number is scored against** is the target sent, or else the one the in-app recorders work out now: `resolveKpiLine(type, sent ?? KPI target)`. They do the same when they change a number.
  - Worst case of this: a corrected old month is scored against today's target, as an in-app correction is.
  - Worst case of keeping the stored target: a row created with no target keeps its 0 sentinel and scores 0 for good.
  - A new qualitative reading with no target now stores 5, as the in-app recorders do.
- **An empty reading is filled in any month the period rule takes, as a create would be.** It lands Pending with no reviewer, like every integration reading that changes a number. Its `managerNotes` are kept, as any integration write keeps them. Keeping a status on a number nobody reviewed would show a review that never happened.

**What changed.**

- `src/lib/kpi-integration.ts`: `integrationKpiWrite`'s `target` is the target sent, or null.
- `src/lib/kpi-integration.server.ts`: reads the KPI's type and works out the line.
- `src/lib/kpi-line.ts` (new, pure): `resolveKpiLine` and `QUALITATIVE_SCALE_MAX`, moved unchanged from `kpi-record.ts`, which re-exports both. The integration path can then read the one rule without that module's server imports.
- The OpenAPI POST `/kpi-records` says what a resend is compared with and that an empty reading is filled; its 409 names a different target sent.

**Tests.**

- `kpi-integration.test.ts`: 2 new.
- `v1/kpi-records/route.test.ts`: 4 new. They cover a target edit then the same number in an open month (approval kept) and in a closed month (200, while a different target sent is 409), a qualitative KPI's in-app row resent and created, and an empty row filled in a closed month.
- `openapi.json/route.test.ts`: 1 new.

## 4. Trash: the Space delete's lock order

**What was true (confirmed).** The Space delete locked the Space FOR UPDATE, then its Folders FOR UPDATE. I read every writer into a Folder:

- `moveList`, `moveFolder` (into a Folder), `createFolder`, `createBoard`, the List copy and a template applied into a Folder all take `lockParentFolder` (FOR SHARE on the Folder) first.
- They then write the row, whose foreign key takes a key-share lock on the Space.
- A restore from Trash takes no `lockParentFolder`. Its insert's two foreign keys take the Space and the Folder in the order Postgres checks them.

So the delete held the Space and waited on a Folder, while a mover held the Folder and waited on the Space. Postgres ended one, and `moveList` answered a bare 500.

**Decision: lock in the writers' order, and never wait while that could close a cycle** (`lockSpaceForDelete` in `src/lib/trash.ts`):

1. Every Folder of the Space, FOR UPDATE, in id order. A writer holding one needs only the Space next, which is still free, so it commits; a Folder that moved out is read again and left out.
2. The Space, FOR UPDATE NOWAIT. From here nothing can join it.
3. Any Folder that joined the Space's root between 1 and 2, FOR UPDATE NOWAIT.

Steps 2 and 3 never wait while the delete holds Folders. A restore can hold the Space's key and want a Folder the delete holds, and a writer can hold a late Folder and want the Space. NOWAIT answers at once instead: the attempt rolls back with nothing written, the writer finishes, and the delete starts again from step 1, up to 4 times with a short wait (`isLockBusy`: 55P03, 40P01, 40001, P2034).

**Why no deadlock is left with these writers.** In step 1 the delete waits only on writers that wait for nothing it holds: the Space is not taken yet, and a writer into one of its Folders needs only that Folder and the Space. In steps 2 and 3 it never waits. Later it waits only on Lists and tasks of the Space, and no writer above holds one of those while waiting for the Space or a Folder: a List moving within the Space keeps its Space key, and a List moving out needs only its new place.

Two crossings remain, and Postgres ends one side of each:

- A Folder moving inside the Space takes its new parent and then its own branch, not in id order. The delete starts again; `moveFolder` already answers 409 "Someone moved these folders at the same moment. Try again."
- A task moving between two Lists of the Space during the task locks: see Found, not fixed.

**Tests** (`src/lib/trash-space-lock.test.ts`): 2 changed and 3 new. They cover the order, the SQL (id order, NOWAIT on the Space and the late Folders), a busy Space started again with one snapshot, and giving up after four tries. The Agent count still runs under the locks and is never retried.

## 5. Webhooks, the sweep's loop, and due today once a day

**5a. A delivery whose secret no key opens.**

- **What was true (confirmed).** Each try that sent nothing raised `attemptCount`. After 8 (about 4 hours, for example `SECRETS_ENCRYPTION_KEY_PREVIOUS` removed too early in a rotation) every held delivery was marked FAILED for good. GET `/api/webhooks` still said `signing: "secret"`.
- **Decision: keep it, retrying, never failed for it.** A try that sends nothing is no attempt: `attemptCount` and the subscription's failure count are left alone, and it is tried again every 15 minutes.
  - Worst case of keeping: held rows grow at the event rate until the key is back or the secret rotated. Each run holds every due delivery of such a subscription in ONE write, so a backlog never fills the batch other subscriptions' retries wait in.
  - Worst case of pausing the subscription: every event while paused is dropped, the loss the finding was about.
- **GET** answers `signing: "unreadable"` with a sentence: nothing is sent, the deliveries are held and tried again every 15 minutes, and rotating the secret sends them signed with the new one. `x-webhook-signature.unreadableSubscriptions` in the OpenAPI says the same.
- **Found while there and fixed:** the retry run read a paused subscription's deliveries and skipped them with no write, so they stayed due for good, and a hundred of them would fill every batch. The run now reads only active subscriptions' retries, oldest due first.
- **What changed:**
  - `src/lib/webhook-signing.ts` (new): `signingKeyOf`, moved from the dispatcher, which re-exports it.
  - `src/services/webhookDispatcher.ts`: `holdUnsent`, `MAX_ATTEMPTS`.
  - `src/app/api/webhooks/route.ts`: GET's `signing`.
- **Tests:**
  - `webhookDispatcher.signing.test.ts`: 1 changed and 3 new. A held delivery at 7 sends is never counted or failed, and it goes out once the key opens (this one pins behaviour that did not change). The queue reads only active subscriptions.
  - `webhooks/route.test.ts`: 1 new and 1 changed. The changed one now uses a real sealed secret and also checks the hash is never returned; it pins.
  - `openapi.json/route.test.ts`: 1 new.

**5b. `sweepBoards` and a parent loop: no bug, so no behaviour change.** Each row has ONE parent, so a walk is a single path. A walk that comes back to a node it has seen has gone round the whole loop, and it stops at the first archived row. So a remembered false means no row from that one to the end of the walk is archived, and on a loop that end is the whole loop. Checked two ways:

- a brute force outside the repo: 1,579,446 cases (every parent shape of up to five Spaces, every archived set, every input order for up to four and two orders for five), no mismatch;
- `reminder-sweep.test.ts` (1 new): every shape of up to four Spaces against a plain walk. It passes on the old code too, because nothing changed. Swapping the walk's short-circuit makes it fail.

The reasoning is now the comment above `archivedWithAncestors`.

**5c. Due today, once a day.**

- **What was true (confirmed).** The check was a read before the write, so two runs at the same moment (a run by hand during the 07:00 row) both read no row and both wrote one.
- **Decision: a per-workspace advisory lock around the check and the write, not a unique index.**
  - An index would need a day expression in UTC while the run's day is the server's.
  - It would fail to build over the duplicates such runs already left.
  - It would lock the whole Notification table while it builds.
  - Each page's check and write now run in one transaction under `pg_advisory_xact_lock(hashtext('due-today:' || workspace))`, so a second run waits, then reads what the first wrote.
  - A check that fails still writes, outside the lock, as before: a duplicate beats a missed deadline.
- **`scripts/CRON-SETUP.md`** says exactly that: once a day by the server's clock, concurrent runs included, the failed check the one exception. The digest rows say who they go to and what they name.
- **Tests** (`send-reminders/route.test.ts`): two runs at once over a mock whose advisory lock really serializes, so each row is written once and the lock key is the workspace's. 1 more pins the fail-open write.

## Verification

- **The tests of every touched folder and every module that imports a changed one.** The whole suite: 712 files, 10,284 tests.
  - 10,252 pass.
  - The 32 that fail are all in the other builder's in-flight files: `manager-lines.test.ts`, `handover.server.test.ts`, `process-run-access.test.ts`, `weekly-review-agent.test.ts`, `agent-manager-reads.contract.test.ts`, `dotted-lines/route.test.ts`.
  - The same 32 fail identically with this batch's files put back to d08761d4, so none comes from here.
- **Old-code proof.** In a scratch copy of the worktree (node_modules linked, the shared worktree never touched), I put the 9 changed source files back from d08761d4, checked byte for byte, and removed the 3 new modules. Then I ran the 9 new or edited test files:
  - 25 of 98 tests fail in the 8 suites that load.
  - `digest-recipients.test.ts` cannot load (new module, 4 tests).
  - Of the 33 new or changed tests, the 4 that pass on both pin behaviour that did not change, each named above: the delivery that goes out once its key opens, GET's signing for an openable secret, the fail-open due-today write, and the loop proof.
  - By file: send-reminders 8 of 9, trash-space-lock 5 of 5, kpi-records 4 of 4, kpi-integration 2 of 2, openapi 2 of 2, dispatcher 3 of 4, webhooks 1 of 2, reminder-sweep 0 of 1.
- **Type check** (`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`): no errors in this batch's files. The 12 it reports are all in the other builder's in-flight `manager-lines.test.ts` and `weekly-review-agent.test.ts`.
- **eslint** on the 21 changed or new source and test files: 2 errors and 3 warnings, the same counts as each file's d08761d4 content (`no-explicit-any` twice and an unused `subject` twice in `send-reminders/route.ts`, an unused `_req` in `webhooks/route.ts`). None is new.

## Found, not fixed

- **The overdue SOP digest has no read check.** An SOP in a restricted SOP folder, assigned to a person, still reaches their manager by title. SOP folders have their own access rules (`sop-access.ts`, per session), not the node resolver's, so this needs a batched form of `sopVisibilityWhere`.
- **A task moved between two Lists of a Space being deleted** can deadlock with the delete's task locks, as since batch 3. Postgres ends one side: a deleted Space starts again, and the task move gets its route's error.
- **`moveList`** still answers 500 on a deadlock, though the Space delete no longer causes one.
- **An integration's `notes`** still overwrite the person's own note on an update or a fill (batch 3 review, low 4).
- **The API's KPI score** is still `actual / target`, capped at 100, not the direction-aware `scoreKpiRecord`.
- **A paused webhook subscription** still has no resume path, so its held and retrying deliveries wait until one exists.

# Batch 4: an Agent manages no one, everywhere

Worktree `theywrk-agents`, on top of d08761d4. Nothing here is committed. No SQL file. The items come from the batch 3 review's "agent-reach" findings (five) and its lows (nine). Another builder works in the same worktree on send-reminders, the overdue digest, `reminder-sweep.ts`, `kpi-integration*`, `trash.ts`, `webhookDispatcher.ts` and `src/lib/access/digest-recipients.ts` (their part is above); none of those files were touched here. Their digest reads `effectiveManagersOf`, whose signature did not change; their tests pass with this batch in place.

THE RULE (batch 3): an Agent manages no one. People listed under an Agent count under the next live non-Agent manager up. Stored rows are not rewritten. This batch makes it hold on every path, and reads the tier the person holds in the workspace whose lines are walked.

## 1. The sweep

Every read in `src/lib`, `src/app/api` and the server pages that grants reach, lists, counts, notifies or decides by a stored manager or reviewer stamp, each marked:

- **through**: already read through the rule before this batch (it now also reads the tier held in the workspace, item 2)
- **fixed**: not through the rule, changed now
- **safe**: grants nothing, or decides by something an Agent never holds; why is given.

### Report trees and their callers

The walkers: `team.ts` `getTeamUserIds`; `reporting-line.ts` `getSolidReportTree`, `getEffectiveReportTree`, `isInReportTree`, `getSolidReports`, `getDottedReports`, `getAllDirectReports`; `manager-lines.ts` `effectiveDirectReportIds`, `reportsThroughAgents`, `countedDottedReportIds`, `agentStoredReports`, `agentsWithStoredReports`; `viewer.ts` `reportTreeFor`. All read the tier held in the workspace now (item 2).

Fixed (they named no workspace, so the anchored row's tier decided, and for `getSolidReports` the anchored row's workspace too):

- `bulk-decide` (timesheet tree), `calendar` (Team), `calendar/events` (`hasTeam` and the tree), `export/[type]` (timesheet tree), `reviews/history`, `timesheets` (approve and team scopes), `timesheets/[id]` (read and decide), the weekly decision route's gate
- `legacy-resolve.ts` `resolveUser` (both walks) and `resolveWeeklyReview`
- `kpi-record.ts` `listKpiReviewsForManager` and `countKpiReviewsForManager` (no callers)
- `team-alignment.ts`, `team-rollup.ts`, `review-cycle-access.ts` `chainOf` (callers: the reviews list POST, the cycle GET, the launch, the cycle page and `cycleSubjectReach`, so calibration, finalize and peer-feedback POST), `weekly-queue.server.ts` `weeklyQueueCtx`, `review-cycle.server.ts` `cycleViewerCtx` (the cycle routes, talent)
- `weekly-review.ts` `managerQueueWhereFor`, `chainQueueWhere`, `countReviewsAwaitingManager`, `countChainReviewsAwaiting`, `countReviewsForManager`, `listReviewsForManager` (callers: the weekly queue, the Teams badges, `team/attention`, `team/weekly-reviews`); the direct queue is now scoped to the workspace too
- `teams-counts.ts` `hasReportsFor`.

Through (they already named the workspace, and now read the tier held there):

- `getTeamUserIds` callers: `kras`, `kra-assignments` (`?managerId` and team), `okrs` (tree), `activity` (list, types, CSV), `sop-assignments` (list and remind), `my-team`, `users` GET, `sops/[id]/people`, the goal page, `analytics.ts`, `process-run-access.ts`, `alignment-scope.ts` (`canTouchUserAlignment`, `goalRightsActor`), `goal-audience.ts` (both), `process-scope.ts`, `object-share/goal.ts`, `asset-query.ts`, `person-access.server.ts` `peopleCtxForViewer`
- `effectiveDirectReportIds` callers: `kra-assignments`, `okrs` (Direct reports only), `team-dashboard`, `team-scope.server.ts`; `countedDottedReportIds`: `okrs`, `team-scope.server.ts`, `process-run-access.ts`.

`viewer.reportTree` readers, safe because the engine's viewer now has an empty tree for an Agent (item 2): `resolve.ts` `hasReports` (also checks `isAgent`), `facts.ts` (now gated too), `analytics-view.ts`, `activity-scope.ts`, `review-cycle-access.ts` `mayStartReviewCycles`, `culture-gate.ts` (both), `candor.server.ts`, `person-access.server.ts` (also gated); `parity.ts` is the test harness.

### The manager a person reports to

`effectiveManagersOf` and `effectiveManagerOf` now walk at the tier each manager holds in the workspace, never answer the person themselves, and never someone who holds no level in the workspace (low 1, low 8). Through, every caller: the launch stamp, `followReportingLine`, `reviewerFacts`, weekly review create and submit, the weekly decision fallback, the weekly reminders, timesheet create and the submit notice, `time-entries`, `time-entries/punch`, purchase order create and submit, `kpi-review.server.ts` `notifyKpiSubmitted`, and the other builder's `digest-recipients.ts`.

### Review.reviewerId

- Fixed:
  - the cycle GET (`reviews/[id]`): rows stamped to the caller load only when the caller is no Agent; the lens, `isReviewer` and every row's `reviewerId` and `reviewer` name the writer, so the Team face's "mine" and "outstanding" match the drawer
  - the cycle list (`reviews` GET): a stamp shows its cycle, never to an Agent
  - `manager-review` GET with no `subjectId`: the reviews the caller writes (`reviewsWrittenBy`), never by stamp
  - `manager-review` GET `?subjectId=`: `reviewer` is the writer, so the drawer no longer says "Sam Agent writes this review"; with nobody writing it, it says so
  - `peer-feedback` GET `?reviewId=` and POST, `peers` GET: the writer, never the stamp
  - `reminders`: `owed` and the sender's reach by writer
  - `cron/review-closing`: `owed` by writer
  - `self-assessment` submit notice: to the writer
  - the launch's "You owe" rows: a launcher on the Agent tier (a People team member, say) is told nothing for the stamps that write nothing
  - the Teams badge (`teams-counts.ts` reviewForms) and the cycle page's Team face: `reviewsWrittenBy`
  - Download my data (`me/export`): reviews stamped to the person are left out in a workspace where they hold the Agent tier.
- Through: `manager-review` GET `?subjectId=` and PATCH (batch 3; now `writerFrom`), `followReportingLine`, the launch stamp itself.
- Safe: calibration (selects `reviewerId`; reach is the chain), finalize's `notOwnReviewUnlessSelfReviewer` (the self-reviewer with no manager, by design), `review-visibility.ts` (callers pass the writer; `subjectRowView` is the subject's own row), the person page's reviews (display, the field is stripped).

### WeeklyReview.managerId

- Fixed: `readWeeklyReview`'s read gate never admits an Agent recorded manager; `canDecideFor` reads the subject's manager as the rule reads it, never an Agent (low 6); the decision route tells no Agent recorded manager (`review.decided`).
- Through: the create and submit stamps, the decision route's fallback, `legacy-resolve.ts`, `getReviewForViewer` (no caller), `managerQueueWhere`'s recorded-manager clause (`managerQueueWhereFor` refuses an Agent first).
- Safe: the drawer's `manager` and `decidingForManager` (display); the Undo's decider fallback (only someone the gate admitted reaches it).

### User.managerId, not covered above

- Fixed: `teams-counts.ts` `hasReportsFor`, `calendar/events` `hasTeam`, `team-rollup.ts` classification (low 5), the accept-invite GET's `managerName` (low 8), the handover and the Agent move (item 3), PATCH Reports to, the bulk change of manager and POST `/api/users` (lows 3 and 4).
- Through: `alignment-scope.ts` `goalRightsActor` (the session's level; an Agent skips the count), `invite-facts.server.ts` `managerOnAccept` and `invitePlacement` (live, no Agent).
- Safe:
  - display or filter only: `team-alignment.ts`'s direct label, `my-team`'s direct set, the directory list, query and org chart, `members-list.server.ts` No manager, `team/members-work`'s manager filter (org-wide viewers only), `talent-assessment`'s manager field, the alignment page's Sub-teams pill, `peers`' suggestions and labels, `record-access` (lists; Agents filtered at the tier held here)
  - `app-floor-impact.server.ts`: previews only people anchored here, whose row's level is the tier here
  - `membership.ts` `unattendedRecipient` (SCIM): walks people anchored here, at the tier there
  - write-side checks, checked again at acceptance or under the lock: `send-invitation.server.ts`, `bulk-import`, Ask AI's invite tool and its preview, `person-access.server.ts` `checkManagerCandidate`, `agentIdsAmong`, `managerMapFor`
  - counts: `escalation-report.ts`, `membership.ts` `reportCountOf` (rule 6 must count the stored lines)
  - by level, never an Agent: the workflow engine's MANAGER rule, `cron/review-cycles` `managersFor`
  - `guards.ts` `transferTargetFor`: no caller.

### Dotted lines

- Fixed: `getDottedReports` (names the workspace), `countedDottedReportIds` and `countedDottedManagerIds` (the tier held here; a dotted manager who works here through a membership counts, an Agent here never), `teams-counts.ts` `hasReportsFor`, `calendar/events` `hasTeam`, the Agent move (item 3).
- Through: `getEffectiveReportTree` (root gated), `kpi-review.server.ts`.
- Safe: `team-alignment.ts` and `team-rollup.ts` dotted labels, the directory and the person page's dotted managers (display), `app-floor-impact.server.ts`, `record-access` (filtered), `reportCountOf` (rule 6), the dotted-lines PUT and GET (write side).

### Timesheet approverId

- Fixed: the Approvals queue reads which stored approvers hold the Agent tier in the workspace (`agentApproverIds`; `AGENT_APPROVER`, a filter on the anchored level, is gone), the submit notice's check names the workspace, and the punch route's "hours added to a closed week" notice goes to the manager above an Agent stamp.
- Through: `timesheets/[id]` `approvesAs` (the session's level), the approver at creation.
- Safe: `bulk-decide` (the manager tier gate, which an Agent never passes; its tree now names the workspace), the CSV export (the tree).

### Purchase order approverId

- Fixed: the detail's `canSee` never admits an Agent stamp (found, not fixed in batch 3); the approve queue shows an order stamped to an Agent as an unclaimed one.
- Through: the approver at create and submit. Safe: deciding (the manager tier), `bulk-decide`. Invoice `approverId` is only written by the decider.

### The rest

- **KPI reviewer** (`KPIRecord.reviewedById`): who decided; read only to label a decision and, for org-wide viewers, to list their own. Safe. `mayActOnKpisOf` is through (the chain, never an Agent).
- **Calibration** (`calibratedById`): an audit stamp, never read for access; calibration and finalize reach by the chain. Through.
- **One-on-ones**: meetings of type ONE_ON_ONE, read by attendance, no manager stamp. Safe.
- **Goal check-ins**: the OKR check-in routes gate on `canSeeGoal` and `canEditGoal` (the chain at the tier held here, `goalRightsActor` by the session's level). Through. The daily CheckIn has no manager stamp (found, not fixed, below).
- **Other decided-by stamps** (`AccessRequest.decidedById`, `AgentAction.decidedById`, `Idea.reviewerId`): audit, written by the decider. Safe.

## 2. The tier held in the workspace whose lines are walked

**What was true.** `managesNobody` read `User.accessLevel` on the anchored row. `reanchorUser` (switching workspace, or accepting an invitation while signed in) moves that row's level to the new workspace while the person's reports, and a session on another device, stay in the old one. So:

- Loss: Dana, a Manager in Acme with 8 reports, accepts an invitation to a client workspace as an Agent. Her phone still acts in Acme, but every walker answered nobody below her there. Worse, `getTeamUserIds`' SQL also required the root to be anchored in the workspace, so her team there was empty whatever her tier.
- Gain: an Agent in Acme with stored reports, anchored elsewhere as a Manager, got their whole stored tree back in Acme, and `facts.ts` gave Can edit on their people's records from `viewer.reportTree` with no `isAgent` guard.
- `effectiveManagersOf` read managers only where anchored, so it answered an Agent anchored elsewhere as the stored manager.

**What changed.**

- `acting-workspace.ts`: `levelHeldIn` takes a `db`; new `levelsHeldIn` (many people, two reads).
- `manager-lines.ts`:
  - `managesNobody(userId, organizationId, db)` is `isAgentOf(levelHeldIn(...))`.
  - `effectiveManagersOf` walks managers at the tier held here (a membership's role for someone anchored elsewhere).
  - `countedDottedManagerIds` reads the tier held here; `agentsWithStoredReports` uses `agentIdsIn`.
- `manager-candidate.ts` `agentIdsIn` reads the tier held here (so `reviewerFacts`, the dotted-lines lock check and the handover's recipient check do too).
- `reporting-line.ts`: every walker takes a `LineScope` (`organizationId`, and `rootIsAgent` when the root is the acting viewer). `getSolidReports`, `getDottedReports` and `getAllDirectReports` take the workspace.
- `team.ts`: `getTeamUserIds` takes `rootIsAgent`, and its root is someone anchored here or holding a membership here (an `EXISTS` on `OrganizationMembership`); the people below are still the workspace's own.
- `viewer.ts`: `hydrate` walks once without a tier read and empties the tree when the viewer holds the Agent tier here, by the token or by the level read fresh (`agentHere`).
- `facts.ts`: `managesSubject` reads `managed`, which is nothing for an Agent viewer.

The re-anchored case: a Manager here who is an Agent elsewhere keeps their tree, team, direct reports and the manager stamp; an Agent here who is a Manager elsewhere has none, and their people count under the manager above them here.

## 3. The handover and the role lock

**What was true.** `runHandover` held `pg_advisory_xact_lock(org-roles)` across the whole run: a read of every user in the workspace (`lineMapFor`), every open task, an `updateMany` per assignee set, the Spaces, Folders and Lists, and the reports, with a 60 second timeout. Every reporting-line write and role change waits on that lock inside Prisma's default 5 second interactive transaction, so a writer behind a long holder answered a bare 500. Each waiter holds a pooled connection while it waits: `src/lib/prisma.ts` builds `PrismaPg` with no pool size, so node-postgres keeps 10 per server process, and ten waiters stalled every request on the node.

**What changed.**

- `handover.server.ts`:
  - LINES: a transaction under the role lock holds only the report plan and the `managerId` writes (10 second timeout).
  - The plan reads only the leaver's line facts: their live reports, and the walk up from the leaver and from the recipient, one small read per step (`manager-lines.ts` `lineFactsAround`; `lineMapFor` is gone).
  - WORK: a second transaction without the lock: the Spaces, Folders and Lists, then the open tasks. Containers before tasks, the order a Space delete locks them, so the two no longer deadlock (low 7).
  - A busy lock stops the run before anything is written. Both halves move only what the leaver still holds, so a run that stopped half way is finished by running it again.
  - A meeting's hidden Item is no task: the run, `pendingHandover` and the handover route's summary all spread `NOT_SYSTEM_ITEMS` (batch 3 found this in this file; the deactivation gate and the run must agree).
  - `moveAgentReports` uses the same short locked transaction.
- `membership.ts` `lockOrgRoles`:
  - waits at most `ORG_ROLES_WAIT_MS` (3 seconds): `set_config('lock_timeout', ...)`, the lock, then `SET LOCAL lock_timeout TO DEFAULT`, so later waits in the transaction are as they were
  - Postgres' lock timeout (55P03), however the driver adapter wraps it, becomes `OrgRolesBusy`
  - with three transactions of the process already parked on a role lock, the next only tries the lock (`pg_try_advisory_xact_lock`) and answers busy at once.
- `org-roles-busy.ts` (new, pure): `OrgRolesBusy`, `ORG_ROLES_BUSY` ("Someone else is changing roles or reporting lines in this workspace right now. Try again in a moment."), `isOrgRolesBusy`, `rolesBusyAnswer`. `roles-busy.ts` (new): the 503 `roles_busy` response with `Retry-After: 2`, and `rolesBusyOrThrow` for `.catch()`.
- Every route whose transaction takes the lock answers 503 `roles_busy`, never a 500:
  - PATCH `/api/users/[id]` (Reports to, role, deactivation), the restore and the removal
  - POST `/api/users`, the dotted-lines PUT, the bulk change of manager
  - the handover POST and the Agent move
  - the accept-invite POST, with "This workspace is busy for a moment, so you haven't joined yet. Try again."
  - SCIM deprovisioning (a 503 the identity provider retries; after the deactivation, the pending row lets the retry finish)
  - the bulk role change (that person is reported, the rest still change)
  - Transfer ownership.

**The pool.** An interactive transaction holds one connection from BEGIN to COMMIT, so a waiter holds one. At most three are parked per process, each for at most three seconds, and the holder's locked section is now a few small reads and writes. Past three, a writer costs one round trip. At least seven of the ten connections stay free for every other request on the node.

## 4. The lows

1. **A loop through an Agent.** `effectiveManagerFrom` takes the subject and never answers them: P to Agent A to P names nobody, and so does a stored self-line. A self-stamped review writes only for someone with no stored manager at all, the launch rule for a one-admin workspace's founder (`writerFrom`), so a stamp the old loop put there writes nothing.
2. **The handover's recipient.** POST `/handover` and its preview refuse a deactivated recipient (409, "Dana Lee is deactivated, so they can't take over this work. Pick someone active."), and the plan never gives reports to one (`recipientInactive`).
3. **A deactivated manager.** PATCH Reports to, the bulk change of manager and POST `/api/users` check the manager with `live` under the lock: 400 `manager_inactive`, "That person is deactivated, and a deactivated person can't have reports. Reactivate them first, or pick someone else." PATCH keeps an unchanged manager as it was.
4. **Crossing edits.** PATCH re-checks the loop under the lock by walking up from the new manager (`wouldLoopIn`); the bulk change reads the line above the manager under the lock (`lineAbove`) and leaves out anyone on it. The dotted-lines check still runs outside the lock (below).
5. **Sub-teams.** No Agent leads a sub-team. In the org view, the people under an Agent at the top stand at the top themselves (`listedUnderAgents`). A direct's sub-team counts the people listed under an Agent below them (`effectiveReportsOfMany`).
6. **`canDecideFor`** reads the subject's manager as the decision route does, and never lets an Agent decide through a recorded stamp.
7. **The deadlock** with a Space delete: containers before tasks (item 3).
8. **The signed-in acceptance.** A stored manager who holds no level in the workspace is nobody's manager there (`effectiveManagersOf`), so the person's previous workspace's manager is never their reviewer, approver or weekly-review manager. The accept-invite GET names a manager only where the acceptance writes one (never for someone who already has an account).
9. **The Agent move** sends the plan the drawer showed (`expect`). Under the lock the move runs only if it still holds, else 409 `plan_changed` with "Their reports changed since this was shown, so nothing moved. Check where they go now and try again.", and the drawer reads the new plan.

## Tests

Fail on the old code / total, run against d08761d4 in a scratch copy (below):

- `src/lib/access/manager-lines.test.ts`: 6 new, all fail. The batch 3 "an Agent's own reach" test also fails, because its `managesNobody` call now names the workspace, which the old signature takes as a db. 7 of 15.
- `src/lib/access/viewer-agent-tree.test.ts` (new): 3 of 4. The fourth pins a manager at home.
- `src/lib/access/org-roles-lock.test.ts` (new): the suite cannot load on the old code (new modules). With only the two new pure modules beside the old `membership.ts`: 3 of 5 fail. The other two pin other errors passing through, and the busy answer.
- `src/lib/people/handover.server.test.ts`: 8 new, 6 fail. The two that pass pin a busy lock writing nothing (it did before) and a matching plan moving. The batch 3 lock-order test, now holding the locked half to the line writes, fails too. 7 of 19; the 11 earlier tests pass on both. Its double now answers both reads (`lineFactsAround` and `lineMapFor`).
- `src/lib/people/reporting-lines.test.ts`: 2 new, 2 fail.
- `src/lib/people/weekly-queue-agent.test.ts` (new): 3 of 4. The fourth pins a non-Agent recorded manager's read.
- `src/lib/weekly-review-agent.test.ts`: 1 new, fails. The edited "manager above" test fails on the old code too, as the queue is now wrapped in the workspace. 2 of 4.
- `src/lib/team-rollup-agent.test.ts` (new): 2 of 2.
- `src/lib/scim-deprovision.test.ts` (new): 1 of 2. The other pins a free lock.
- `src/app/api/reviews/[id]/review-writer.route.test.ts` (new): 8 of 10. Two pin: someone with no manager writes their own, and the manager above reads peer feedback through the chain.
- `src/app/api/users/[id]/route.test.ts`: 4 new, 4 fail.
- `src/app/api/users/route.test.ts`: 1 new, fails.
- `src/app/api/users/[id]/agent-reports/route.test.ts`: 2 new, 2 fail.
- `src/app/api/me/export/route.test.ts`: 2 new, 1 fails. The other pins a manager's export.
- `src/lib/access/agent-manager-reads.contract.test.ts`: 8 new and 7 edited batch 3 assertions, all fail. 15 of 20; the 5 that pass hold wiring that did not change.
- `src/lib/process-run-access.test.ts` and `src/app/api/users/[id]/dotted-lines/route.test.ts`: the doubles only (a row names its workspace; the lock's `lock_timeout` statements are not writes). Pass on both.

## Verification

- `npx vitest run`, the whole suite: 718 files, 10,345 tests, all pass, with the other builder's work in place.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, the shared worktree never touched), with the 55 changed source files put back from d08761d4, checked byte for byte, and the 2 new modules removed. The 17 new or edited test files: 58 of 179 tests fail in the 16 suites that load. `org-roles-lock.test.ts` cannot load (new modules); it is counted above.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0.
- eslint on the 74 changed or new files: no new problems. The 2 errors and 2 warnings left are at d08761d4 too, checked by linting each file's HEAD content: the G7 `accessLevel` read at line 261 of `calendar/events/route.ts`, the breadcrumb warning on the cycle page, an unused `isOrgAdmin` in `bulk-decide`.

## Found, not fixed

- **The dotted-lines loop check** reads the whole workspace's lines outside the role lock. Running it under the lock would hold the lock for that read; two crossing edits can still make a dotted loop. Dotted lines are not walked past one level, so a loop gives both people the other's record, no further.
- **GET `/api/check-ins`** lists every member's daily check-ins (mood, what went well, challenges) to anyone signed in, or one person's with `?userId=`. Not a manager stamp, but people data with no gate.
- **The membership role and the row.** `User.managerId` is one column for every workspace a person belongs to. This batch reads the tier per workspace and refuses a manager from another workspace, but a person who works in two workspaces still has one stored manager.
- **Stale stamps.** No stored row is rewritten. Open reviews and weeks stamped to an Agent wait for the manager above or for an Admin to move the Agent's reports; a one-off script running `followReportingLine` over every subject whose stamped reviewer is an Agent would heal them, and is the founder's call.
- **The SQL of `getTeamUserIds`** gained an `EXISTS` on `OrganizationMembership`. It is a read, written like the other raw reads of that table, and was not run against a database here (no SQL may run).

# Batch 5: check-ins, digests and KPI readings

Worktree `theywrk-agents`, on top of 648913b1. Nothing here is committed. No SQL. The items come from the batch 4 review's entry on `kpi-integration.server.ts` and `digest-recipients.ts` (its three findings and its lows 7 and 10), and items 1, 3, 4, 5 and 7 of the batch 5 list. Another builder works in the same worktree on the handover, users, people, Members, SCIM, the acceptance, set-owner, seats, `membership.ts`, `manager-candidate.ts`, `manager-lines.ts`, `reporting-line.ts`, `team.ts` and the review routes. None of those files were touched here; `person-access.server.ts`, `acting-workspace.ts`, `manager-lines.ts` and `reporting-lines.ts` are only called.

## 1. Check-ins are people data

**What was true (confirmed).** GET `/api/check-ins` listed the 50 newest check-ins of any person anchored in the workspace (mood, what went well, challenges, tomorrow's plan, name and avatar) to anyone signed in, and `?userId=` picked any person. Nothing in the app calls it: the person page's Check-ins tab was removed because no screen ever wrote one (`person-record.tsx`), so rows exist only where something posted to the API. The docs promise a peer "no mood check-ins" (`using/my-profile.mdx`). POST wrote only the caller's own (the session's id), but took a mood of "3" or 2.5 and failed inside the write with a 500, and any text length. The one other reader, GET `/api/ai/digest` (no caller in the app either), averaged every check-in in the workspace into "Team Mood" and a low-mood count for anyone signed in, so in a small team it told a colleague a peer's mood. No other route reads mood or similar personal entries (journal entries are accounting; pulse surveys keep their own anonymity rules).

**Decision.** The read follows the people-data ladder every people route asks (`relationTo`): your own always; anyone else's only where you read their people data here (Owner or Admin, the People team, the org-wide levels, or their manager chain, solid or dotted; an Agent's chain is empty; a Guest reads only their own). "In this workspace" is the level held here (`levelHeldIn`: anchored here, or a membership here), never `User.organizationId` alone, which is only the last workspace a person switched to on any device.
- Worst case of the anchor alone: an employee who once opened a partner workspace vanishes from their own company's reads and lands in the partner's.
- Worst case of the level held here: a check-in names no workspace (the table has no column), so someone in two workspaces has one set of check-ins, read in each by that workspace's own people-data readers of them. Found, not fixed, below.
- A `?userId=` the caller may not read answers 404, the same as a person who does not exist.

**What changed.**
- `src/lib/check-in-access.server.ts` (new): `readableCheckInsWhere` (the list's where), `mayReadCheckInsOf` (one person), `holdsALevelIn`, and `parseCheckIn` (a whole mood from 1 to 5, each text text or nothing and at most 2,000 characters, nothing else read from the body).
- `src/app/api/check-ins/route.ts`: GET reads through them; POST uses `parseCheckIn` (a body that is not JSON is a 400, not a 500).
- `src/app/api/ai/digest/route.ts`: the mood tiles read only `readableCheckInsWhere`, and no longer load people's names they never showed.
- It duplicates `inWorkspaceWhere`, which the other builder is adding to `acting-workspace.ts` in the same worktree; the two can be folded once both land.

**Tests.** `src/app/api/check-ins/route.test.ts` (new, 7, over the real `relationTo` and `levelHeldIn` and a database double that answers the where clauses): a colleague, a manager, an Admin (a member anchored elsewhere included, another company's person 404), an Agent and a Guest, signed out, and POST. `src/lib/check-in-access.test.ts` (new, 11): the list's where equals the one-person ladder for eight viewer shapes, and the parser. `src/app/api/ai/digest/route.test.ts` (new, 2).

## 2. The Monday digests, for people who work here through a membership

**What was true (confirmed).** `digestManagersOf` asked `effectiveManagersOf`, which answers only for people anchored in the workspace. The overdue tasks and SOP digests pass members too, but they got no manager. Dana, an Acme employee whose manager Sam is in Acme, switches to a partner workspace once: her late Acme tasks and SOPs reached nobody.

**Decision: answer for them in the digest, read the same way.** A live member here who is anchored elsewhere has their stored manager walked at the tier each manager holds here: past an Agent to the next person up, never themselves, never someone who holds no level here, never a deactivated or removed manager. Worst case of telling Sam: he learns by email of tasks he can already open, since the read check (item 3) still holds every title to a List he can view. Worst case of not: a person's late work silently reaches nobody once they touch a second workspace.

**What changed.** `src/lib/access/digest-recipients.ts`: `memberManagersOf`, a pass of the digests' own, so `effectiveManagersOf` (shared by the reviewer, approver and weekly-review reads) is unchanged. The other builder is widening `effectiveManagersOf` to members in the same worktree; once that lands this pass finds nobody it has not already answered and asks the database nothing (the people it is handed are then all answered), so it is correct on either tree and can then be removed. The monthly evaluation still reads only people anchored in the workspace (Found, not fixed). `how-it-connects.mdx` and `scripts/CRON-SETUP.md` say members are included.

**Tests.** `digest-recipients.test.ts`: 2 new (the walk for members, every case above; and no extra read when everyone is anchored). `send-reminders/route.test.ts`: 2 new (a member's manager here gets the task and the SOP line; past an Agent, never someone elsewhere, never the person themselves).

## 3. The read check, bounded

**What was true.** `listsEachCanRead` evaluated every manager on the page against every List on it, read every person's SpaceMember, FolderMember, BoardMember and AccessGrant rows on all of it, and ran with no pause; the caller then kept only the pairs it asked about. A 3,000-manager workspace with an old backlog did about 240,000 evaluations per 1,000-task page where about 1,000 were needed, in the web process, on Monday at 08:00.

**What changed.**
- `listsEachCanRead(organizationId, asks)` takes the (manager, List) pairs, evaluates each manager on their own Lists only, and gives the event loop a turn (`setImmediate`) between managers. Every answer is an asked pair, and `send-reminders` keeps each one for the workspace run, so no pair is asked twice.
- `loadAllGrants(rows, { userIds })` (`node-world.ts`) reads only those people's rows; `objectGrants` takes `userIds` (`access-grant-store.ts`). An evaluator reads one viewer's own rows only, so the answers are the same. Every other caller is unchanged.

**Tests.** `digest-recipients.test.ts`: 2 new (only the asked pairs are evaluated, one world for the Lists asked, one grant read for the asked managers only, never a denied one's; the event loop gets a turn) and the batch 4 resolver-equivalence test rewritten to the new shape. `send-reminders/route.test.ts`: 1 new (the pairs asked are each manager's own); its double answers both shapes, so the earlier tests run unchanged against both.

## 4. A qualitative KPI sent a target of 0

**What was true (confirmed).** For a qualitative KPI the stored line for a sent 0 (or less) is the rubric ceiling, 5, but the resend was compared with the 0, so the very same nightly body was a change: it cleared a manager's approval in an open month (back to Pending, which reads "Not recorded") with a webhook and a recalculation, and answered 409 for every closed month. And `0 ?? kpi.targetValue` kept the 0, so a KPI with its own target rating (say 4) was scored against 5.

**What changed.** `src/lib/kpi-integration.server.ts`: for a qualitative KPI a sent target of 0 or less is read as none sent, so the line falls back to the KPI's own target rating before the ceiling, and a resend is compared on its number alone. Any other sent target is compared as the line a write would store (`resolveKpiLine`). A quantitative KPI's 0 is stored and compared as sent, as before. The OpenAPI `targetValue` says so.

**Tests.** `v1/kpi-records/route.test.ts`: 4 new (open month keeps APPROVED for 0, -1 and "0"; a closed month answers 200; the KPI's own rating is the line; a positive target sent and a quantitative 0 still read as before). `openapi.json/route.test.ts`: 1 new.

## 5. Webhooks: a first try nobody recorded, and one body id

**What was true.** A delivery row was written PENDING before its first send, and the retry read only RETRYING rows. So when the write after the first try failed (holdUnsent for an unreadable key, or the failed or delivered mark), or the process stopped mid-send, the delivery stayed PENDING for good. And the first send's body `id` was a random value while a retry's was the delivery row's id, so a receiver could not tell the two were one delivery.

**Decision: at least once, with one id.** The row is written PENDING with a lease (`nextAttemptAt` 15 minutes ahead), and the retry reads PENDING rows whose lease has passed as well as RETRYING ones; the hold's backlog sweep takes them too. The lease is far longer than a send can take (10 seconds), so a first try still running is never sent twice by the retry. A delivery that went out but whose delivered mark failed may go out once more, with the same id, so the receiver can drop it.
- Rows written PENDING before this change have no lease and stay as they are: they may be months old, and sending them now would hand receivers stale events.
- Every try of a delivery carries the same `id` (the delivery's, the X-Workwrk-Delivery header) and `createdAt` (the row's). `info.description` says a receiver can de-duplicate by it. A retry's `data` is the stored payload, whose keys the database may order differently, as before.

**What changed.** `src/services/webhookDispatcher.ts` (THE FIRST TRY, `FIRST_TRY_LEASE_MS`, `deliveryBody`); a failed hold no longer rejects the dispatch. `openapi.json/route.ts`: the body id sentence.

**Tests.** `webhookDispatcher.signing.test.ts`: 3 new (the lease and the retry's read after a failed hold; a PENDING row read is sent and recorded; the first body's id and time equal the retry's) and 1 changed (the retry's query reads PENDING and RETRYING, still active subscriptions only, oldest first). `openapi.json/route.test.ts`: 1 new.

## 6. task.created from Ask AI and AI teammates

**What was true (confirmed).** `create_task` (`src/lib/agents/tools.ts`, the one tool both Ask AI and an AI teammate use to make a task) wrote the task to the person's Personal list and dispatched nothing. No other teammate tool creates a task.

**Decision: fire it.** Worst case of not firing: a subscriber that mirrors every task, and every "When a task is created" automation, silently misses each task a person asked AI to make, a growing share. Worst case of firing: an automation runs on a task the AI made at the person's request, exactly as on one the person typed. It is one task per call, never a copy or a batch (the batch 2 reason for leaving copies, templates and repeats silent does not apply), and inside an automation's teammate step the event counts toward that automation's chain (`chain-depth.ts`), so it cannot loop.

**What changed.** `tools.ts`: the List add's flat payload (id, boardId, title, status, ownerId, assigneeId, priority, dueAt, actorId as the person, createdAt), the dispatcher loaded on use as `registry-actions.ts` loads it, fire and forget; an event that cannot be sent never fails the task. `webhook-events.ts` (so the OpenAPI `x-events` and POST `/api/webhooks`), `registry-triggers.ts`, `how-it-connects.mdx` and `status.mdx` say exactly which creations fire it.

**Tests.** `src/lib/agents/tools-create-task.test.ts` (new, 4): the event and its payload; the task stands when the event cannot be sent; nothing for a task not made; the event's description and the docs row. `openapi.json/route.test.ts`: 1 new.

## 7. Export CSV on Activity and Everything

**What was true (confirmed).** Both "..." menus offered Export CSV to everyone; the two routes refuse an Agent and a Guest with a 403.

**What changed.** `activity-client.tsx` and `everything-view.tsx` read `useViewerRole()` (the boot viewer, at the level held in the workspace, the same source as the List and table exports of batch 2) and offer the row only to someone who is neither. A Guest is hidden too, since the routes refuse a Guest the same way.

**Tests.** `agent-tier.contract.test.ts`: 1 new (each menu's one Export CSV is behind the gate, and the routes refuse exactly those two).

## 8. GET /api/v1/people status

**What was true (confirmed).** `status` reached the read as sent; a value outside `UserStatus` failed inside Prisma with a 500.

**What changed.** `src/lib/api-input.ts`: `parseApiEnum` (any case, answered in capitals) and `apiEnumRule`. `v1/people/route.ts` answers 400 "status must be one of ACTIVE, INACTIVE, ON_LEAVE, PROBATION, PIP, NOTICE_PERIOD"; the OpenAPI documents the 400 and that any case is taken.

**Tests.** `v1/people/route.test.ts`: 2 new. `openapi.json/route.test.ts`: 1 new.

## 9. cancelledClosed

**What was true (confirmed).** A card cancelled when its browser ended for a person who left or was deactivated read "Cancelled: the browser closed before you decided, so nothing was done. Closed.", the doubling the last polish of Phase 4 fixed in `stepClosed`.

**What changed.** `teammate-copy.ts`: `cancelledClosed(why)` leaves the plain sentence alone for an end line that adds nothing, and `END_LINES_ADDING_NOTHING` is the one list (the plain "Closed" with or without its period, and "It didn't start."); `browser-rules.ts` builds `stepClosed`'s check from it, so the two never drift.

**Tests.** `teammate-copy.test.ts`: 1 new (every end reason: plain for left, deactivated, start_failed and none; the reason added otherwise; the shared list).

## Verification

- **Tests of every touched folder and every test that imports a changed module** (the access, agents, browser, automation and services folders; the v1, email, check-ins, ai, agents, automation, conversations teammates, integrations, sidekick and webhooks API folders; Activity and Everything; and the top-level `src/lib` tests that read changed files): 200 files, 3,862 tests, all pass with the other builder's work in place.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 21 changed source and docs files put back from 648913b1, checked byte for byte, and the new module removed. The 12 new or edited test files:
  - 31 of the 38 new or edited tests fail in the 11 suites that load.
  - `check-in-access.test.ts` cannot load (new module, 11 tests).
  - The 7 that pass on both pin behaviour that did not change, each named above: a PENDING row the retry reads is sent; no extra read when everyone is anchored; nothing is loaded for no List; the task stands when the event can't be sent; nothing for a task not made; an Admin's mood tiles; a positive target sent and a quantitative 0.
  - By file: check-ins 7 of 7, kpi-records 3 of 4 new, people 2 of 2, openapi 4 of 4, send-reminders 3 of 3 new, digest-recipients 4 of 6, dispatcher 3 of 4, tools-create-task 2 of 4, ai digest 1 of 2, teammate-copy 1 of 1, agent-tier contract 1 of 1.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0.
- **eslint** on the 31 changed or new source and test files: no new problems. The 2 errors and 3 warnings left are at 648913b1 too: `no-explicit-any` twice and an unused `subject` twice in `send-reminders/route.ts`, and the `exhaustive-deps` warning on Activity's `rows` memo.

## Found, not fixed

- **A check-in names no workspace.** Someone who belongs to two workspaces has one set of check-ins, read in each by that workspace's people-data readers of them. Scoping them needs a workspace column on `CheckIn` (SQL), written by POST from the session's workspace; existing rows would stay unscoped.
- **GET `/api/ai/digest`** still shows anyone signed in the workspace's team size, active KRAs, KPI reading count and average KPI score. Nothing in the app calls it.
- **The monthly evaluation reminder** reads only people anchored in the workspace, so a member's manager is not reminded about them (its people are read by `organizationId`). Once the other builder's `effectiveManagersOf` counts members, its read can widen the same way.
- **Webhook rows already PENDING** from before this batch (no lease) stay unsent; a one-off sweep could fail them for the record.
- **A failed delivered mark after a successful send** still counts as a receiver failure (`markFailed` in the send's catch), so a database blip can raise a subscription's failure count. The resend now carries the same id.
- **GET `/api/v1/people`** answers 500 for a `limit` that is not a number (`parseInt` gives NaN to `take`), as GET `/api/v1/sops` and `/api/v1/tasks` do.
- **`create_task`** turns a `dueIsoDate` that is not a date into an Invalid Date inside the create.

# Batch 5: handover, workspaces and locks

Worktree `theywrk-agents`, on top of 648913b1. Nothing here is committed. No SQL. The items come from the batch 4 review's entry on `handover.server.ts`, `manager-candidate.ts` and `users/[id]/route.ts` (its four findings and its lows 1, 2, 3, 5 and 7), and items 2 and 6 of the batch 5 list. Another builder works in the same worktree on check-ins, the digests (`digest-recipients.ts`, `send-reminders`), KPI integration, `src/lib/agents`, Activity, Everything and `/api/v1/people` (their part is above); none of those files were touched here. Their digests' member pass (`memberManagersOf`) still runs over this batch's `effectiveManagersOf`, which now answers for members too, so it finds nobody left to answer; their tests pass with this batch in place.

## 1. The handover never overwrites a change made while it runs

**What was true (confirmed).** `runHandover` read the leaver's open tasks outside any transaction, then WORK (after up to 10 seconds of `maxWait` and three container writes) wrote `ownerId` by that snapshot's ids with no owner condition, and replaced `assigneeIds` wholesale with sets built from the snapshot. A teammate who gave task T to Carol in between lost that change: T went to the recipient, Carol's assignment and any co-assignee added meanwhile were gone, and `tasksReassigned` still counted T.

**Decision.** Read and lock the tasks inside WORK, and write only what the leaver still holds. Worst case: a task reassigned in between stays with whoever has it now, so the leaver's list may be one task shorter than the dialog said. The other way, user-entered assignments are lost with no trace (the data-integrity rule).

**What changed** (`src/lib/people/handover.server.ts`, WORK):
- The candidates are read inside the transaction, then locked and read again: `SELECT id, "ownerId", status, "assigneeIds", "archivedAt" FROM "Item" WHERE id = ANY(...) ORDER BY id FOR UPDATE`. FOR UPDATE waits for an edit in flight and returns what it left; id order is the order `trash.ts` locks tasks in, after the containers as before.
- Only rows the leaver still owns, still open and not archived, are written. Each write sets `ownerId` and the rewritten `assigneeIds` together (ownerId IS assigneeIds[0]) and is conditioned on `ownerId = leaver`, so it can never take a task back.
- `tasksReassigned` is the sum of what the writes really changed.

## 2. The record of the report moves, and a handover that stops half way

**What was true (confirmed).** LINES committed the report moves; if WORK then failed (a timeout, a deadlock, a dropped connection), `runHandover` threw before `followReportingLine` and before the route's only audit row (`user_handover`). The route answered a bare 500, SCIM the same. A retry planned 0 reports, logged "0 direct reports" and followed nobody's reviews. No row anywhere recorded who moved whose reports where, and open reviews stayed stamped to the leaver.

**What changed.**
- `handover.server.ts`, LINES: each report moved gets a `reporting_line_changed` row (`targetId` the report, old and new `managerId`, "Moved Ida Ray from Leo Leaver to Rae Recipient in a handover", or "to no manager"), written with `createMany` inside the same locked transaction, so the record commits with the moves or not at all. SCIM's rows carry `actorType: "scim"`, "Identity provider".
- The rows name only people really moved: every write of a reporting line holds the role lock, so the plan read under it is what moves, and should a count ever differ the rows are read back first. To make that true, PATCH `/api/users/[id]` now takes the lock to clear Reports to too (it took it only for a new manager).
- `followReportingLine(plan.reportIds)` runs as soon as LINES commits, before WORK.
- A WORK failure throws `HandoverWorkFailed` (code `handover_partial`) carrying what LINES moved. `handoverPartialWords`: "Their 3 direct reports moved, but their open tasks and their Spaces, Folders and Lists didn't. Try again to move the rest."
- The handover POST answers it as a 503 with `Retry-After: 2`, the sentence and `partial` (what moved, and 0 tasks and containers), and writes no `user_handover` row claiming everything moved. Both dialogs show the route's error, so the person is told and nothing is deactivated or removed on that path.
- SCIM: `scimDeprovision` answers a 503 the identity provider retries, "This person is deactivated. Their 2 direct reports moved, ...". The pending row stays the latest word, so the retry moves the rest, as before.

## 3. The workspace anchor

**What was true (confirmed).** `User.organizationId` is the workspace a person last switched to, on any device (`reanchorUser`), not "the workspace they are in". Batch 4 read the tier held here for managers, but most reads of the line still asked for people anchored here. So a person who switched once dropped out of their manager's lines here:
- A restore cleared a manager who works here through a membership, deleted their dotted line, and said "Max has been restored with no manager, because Dana Ray is no longer in the workspace". PATCH, the bulk change, POST `/api/users`, invitations and their acceptance refused that manager as "not in this workspace".
- The handover and the Agent move skipped them on the walk up, so reports went to no manager, and never moved a report anchored elsewhere, who stayed under someone who had left.
- Rule 6 (`reportCountOf`) and the deactivation gate (`pendingHandover`) did not count that report, so their manager could be made an Agent, or deactivated, with them still stored underneath.

**Decision.** For reporting lines and the people they count, "in this workspace" is the level held here: anchored here, or a membership here (`levelHeldIn`, `levelsHeldIn`). "Removed" is a removed account (`deletedAt`) or someone who holds no level here, and "no longer in the workspace" is said only then. Worst case of the level held here: a line kept to someone who works here only through a membership, who is a member here. Worst case of the anchor: real lines deleted with a false sentence, and the promises "an Agent manages no one" and "a deactivated person holds no reports" bypassed.

Records stay anchored where a write would reach every workspace (below, "kept"): status, `deletedAt`, the names, `roleId`, `departmentId`, the one `managerId` and `accessLevel` are columns of the one User row every workspace reads. Opening those doors to someone anchored elsewhere would let one workspace's Admin or identity provider deactivate or remove a person in every workspace they belong to.

**What changed** (the shared pieces):
- `acting-workspace.ts`: `levelsHeldFor` (levelsHeldIn for rows already read, one membership read) and `inWorkspaceWhere(org)`, the `where` for a single query that must stay one.
- `manager-lines.ts`: `liveHereAmong` (who of these is not removed and holds a level here), and a private `factsHere` that gives every walk its line facts at the tier held here.

### The sweep

Every read in `src/lib/access`, `src/lib/people`, `src/lib/reporting-line.ts`, `src/lib/team.ts`, the users, people, Members, SCIM, accept-invite and handover routes (and the libraries those routes call) that decides "is this person in this workspace" or "does this person count here" by `User.organizationId`, each marked.

**Fixed: the level held here.**
- `manager-candidate.ts`:
  - `managerCandidateIn` (any workspace's row, then the level held here; an Agent here through a membership is refused, a Manager here through one is ok)
  - `lineAbove`, so `wouldLoopIn` (the walk goes on through people who work here and stops where the line leaves)
  - `staleLinesOf` (the manager through `managerCandidateIn`; a dotted line is "removed" only for `deletedAt` or no level here, "agent" at the tier held here)
  - `staleLineWords` (unchanged words, now only said when true) and new `clearedLineSentence`.
- `manager-lines.ts`:
  - `lineFactsAround` (the leaver's reports and the walk up)
  - `effectiveManagersOf` (the people it answers for: members too)
  - `effectiveDirectReportIds`, `walkThroughAgents` (so `effectiveReportsOfMany` and `listedUnderAgents`), `reportsThroughAgents`
  - `countedDottedReportIds`
  - `agentStoredReports` and `agentsWithStoredReports` (now one read, each person once per kind, never a self-line).
- `membership.ts`: `reportCountOf` (rule 6) and `unattendedRecipient`'s walk up (SCIM's recipient), both at the tier held here.
- `reporting-line.ts`:
  - `solidTreeRows`: it named no workspace at all; the root and everyone below now hold a level here and are not removed, and a person who holds none ends the walk there, as `effectiveManagersOf` treats them
  - `getDottedReports` and `getEffectiveReportTree`'s dotted read: they named no workspace and kept removed people (low 5).
- `team.ts` `getTeamUserIds`: the people below the root (anchored here before; the root already held either).
- `person-access.server.ts`:
  - `checkManagerCandidate` is `managerCandidateIn`, the one rule
  - `agentIdsAmong` (found and Agents at the tier held here; the dotted-lines PUT)
  - `managerMapFor` (the loop pre-checks; people who work here).
- `handover.server.ts`:
  - the LINES `updateMany` calls and the Agent move's (by the plan's ids, which hold only people here)
  - `agentPlanFor`'s dotted lines
  - `pendingHandover`'s direct reports (the deactivation gate counts what the handover moves).
- `team-scope.server.ts` (My team and Workload): everyone who works here, for the chain and for org-wide viewers alike.
- `employed.server.ts` `employedAmong` (SOP, policy and process-run assignees).
- `teams-counts.ts` `hasReportsFor` (low 5: it counted lines from every workspace and removed dotted reports) and `calendar/events` `hasTeam` (low 5: no `deletedAt`, and a dotted line from any workspace).
- `invite-facts.server.ts`: `managerOnAccept` (through `managerCandidateIn`) and `invitePlacement`'s manager name, so /join names the manager the acceptance writes.
- Routes:
  - `users/[id]/handover`: the recipient (GET `?to=` and POST) and the summary's direct reports. An Owner who works here through a membership was "not found", though `reportPlanFor` already took them.
  - `users/[id]/agent-reports`: the Agent (the move writes only their reports' lines, never their own row).
  - `users/[id]/record-access`: the managers up the line and the dotted-line managers.
  - `users/[id]/dotted-lines`: the loop walk's dotted rows, plus `managerMapFor` and `agentIdsAmong` above.
  - `users` POST: the address already here is `alreadyInOrg` (own row or membership), so no second account for one mailbox; Reports to through `managerCandidateIn`.
  - `people/bulk-import`: a row's Reports to may be someone here through a membership, at the role held here.
  - PATCH `users/[id]`, the bulk change of manager and `sendInvitation`: through `managerCandidateIn`, `wouldLoopIn` and `lineAbove`.

**Kept: the person's own record (it writes the one row every workspace reads).**
- `users/[id]` GET, PATCH and DELETE targets; `users/[id]/kpis`, `avatar`, `skills`, `seed-alignment`; `people/[id]/alignment`; the dotted-lines and record-access subjects; the handover's leaver.
- SCIM Users GET, PUT, PATCH, DELETE and POST's lookup; `scim-deprovision` (its person); SCIM Groups (they write `departmentId` on the row).
- `membership.ts` `applyRoleChangeIn` and `transferOwnership` targets, `workspace-admin.ts` `adminScopeTarget`: they write `User.accessLevel` or `User.adminScopes`, which are the anchored workspace's; for someone anchored elsewhere only the membership's role should change, which these do not do yet (found, not fixed).
- `people/bulk-update`'s selection: placement is a column of the row.

**Kept: lists of people, which decide no count.** The Members list (`members-list.server.ts`), GET `/api/users`, the people picker (`people/pick`), `backfill-role-defs`: the Members list, directory and pickers show the people anchored here (found, not fixed: members anchored elsewhere are missing from them).

**Kept: who holds Admin or the People team, as the engine reads it.** `admins.ts` `listOrgAdmins` ("Ask an admin"), `members-list.server.ts` `peopleTeamIdsFor` and its admin read, `facts.ts` and `viewer.ts` People team reads, `viewer.ts` `viewerForCron`'s first admin, `node-world.ts` admins, `object-share/common.ts`, record-access's three groups, the last Company Admin count in DELETE `users/[id]` (it only refuses more). The Owner guards use `liveAdminsOf`, which already counts memberships.

**Kept: the node and sharing engine's view of someone who is not the session.** `check-access.ts`, `gate.ts`'s owner card, `grants.ts` grant and removal targets, `node-access.ts` `nodeCtxForUser`, `node-world.ts` `loadPeople`, `object-share` (goal, SOP folder, team, tool, app door), `viewer.ts` `viewerForUser`, `job-title-holders.ts`, `legacy-resolve.ts` `resolveUser`. A member anchored elsewhere fails closed there (cannot be shared with or named as owner here), and nobody gains access. Changing one door without the engine would make a dialog grant what the resolver denies (found, not fixed).

**Kept: already right.** `acting-workspace.ts`, `self-facts.ts`, `node-access.ts` `nodeCtxFromSession`, `workspace-admin.ts` (the actor), `guests.ts`, `viewer.ts` hydrate, `workspace-anchor.ts` (the anchor itself), `invite-facts` `alreadyInOrg` and `liveAccountFor`, accept-invite's signed-in branch, `seats.ts` `seatsForAddress`, `liveAdminsOf`, `set-owner.ts`'s person, `app-floor-impact.server.ts` (a preview of people anchored here at their row's level; grants nothing), and the other builder's `digest-recipients.ts`.

## 4. The seat lock after the role lock waits a bounded time

**What was true (confirmed, PLAUSIBLE timing).** `lockOrgRoles` bounds its own wait and then puts `lock_timeout` back, and `lockWorkspaceSeats` (`SELECT ... FROM "Organization" FOR UPDATE`) waited without limit. It conflicts with every seat holder (a CSV import, an invitation, a plan change, Set Owner's 20 seconds) and with the key-share lock any insert naming the workspace takes. Past Prisma's 5 second interactive timeout the restore, PATCH reactivation, POST `/api/users` and the acceptance answered a bare 500 ("Something went wrong" at /join), holding the role lock all the while.

**What changed.**
- `seats.ts` `lockWorkspaceSeats(tx, org, { bounded: true })`: `set_config('lock_timeout', LOCK_WAIT_MS)`, the row lock, `SET LOCAL lock_timeout TO DEFAULT`; a 55P03 (however the adapter wraps it, `isLockTimeout`, now shared) throws `SeatsBusy`. Unbounded stays the default for callers that hold no role lock.
- `org-roles-busy.ts`: `SeatsBusy` is an `OrgRolesBusy`, so every route's existing busy mapping answers it: the same 503 `roles_busy` with `Retry-After: 2`, and its own sentence, "Someone else is adding people or changing seats in this workspace right now. Try again in a moment." `LOCK_WAIT_MS` (3 seconds, `ORG_ROLES_WAIT_MS` is it) and `LOCKED_TX` (a 10 second timeout, so both waits and the work fit; Prisma's default 5 seconds did not).
- Bounded, with `LOCKED_TX`: PATCH `users/[id]` (reactivation), the restore, POST `/api/users` (always), both branches of the acceptance (the signed-in branch now answers busy too, instead of a 500), SCIM reactivation and Set Owner.

## 5. The lows

- **5a. Set Owner** (`src/lib/admin/set-owner.ts`) takes `lockOrgRoles` first, then the workspace row (bounded), as every writer of Owner and Admin does. Someone on the Agent tier here (anchored, or through a membership) is refused, as Transfer ownership refuses them: "Pat Lee is on the Agent tier here, and an Agent can't be an Owner. A workspace Admin can change their tier first." A busy lock answers 503 to the staff route.
- **5b. The parked waiters, per workspace** (`membership.ts`). At most 3 parked per workspace and 6 per process (at least 4 of the 10 pooled connections stay free); the map holds a workspace only while it has a waiter, so it never has more than 6 entries. Three writers queued on one busy tenant no longer put every other tenant on the node into try-only mode. `parkedRoleWaiters` reads the counts.
- **5c. A review nobody's manager writes.** When `writerFrom` answers null (an Agent's stamp with nobody above, or a stored loop), the manager review PATCH refused everyone, Admins included. Now the People team and Admins write it, never the subject and never an Agent; their write leaves the stamp, so it stays theirs to share until someone is named Reports to and `followReportingLine` moves it. GET answers `canWrite` and `writesUnclaimed`, and the drawer says "No manager writes this review yet, so the People team and Admins write it. Set who they report to in Members, and it moves to that manager." The read-only line for the chain says the same.
- **5d. The dotted reads, `hasTeam` and `hasReportsFor`**: item 3.
- **5e. A reactivation re-checks the lines, as a restore does.** PATCH `users/[id]` reactivating someone and SCIM `active: true` take the role lock, then the seats (bounded), read `staleLinesOf`, clear a manager who no longer holds (left, deactivated, an Agent here, or not in the workspace) and take off a dotted line to an Agent or a removed person. Each is logged ("Reactivated Max Chen with no manager: Dana Ray is deactivated"), open reviews follow (SCIM, with no person acting, gives them to the first Owner, as its handover does), and PATCH answers `linesCleared` and "Max Chen has been reactivated with no manager, because Dana Ray is deactivated. Set who they report to in Members." A Reports to sent in the same edit is left to its own check.

## 6. From the batch 5 list

- **6a. A bulk change to the Agent tier** ended no AI teammate connection. `src/lib/access/role-change-after.ts` (new) `afterRoleChanges` is PATCH's path, now shared: after the changes commit, everyone made an agent account has `endTeammateAccessFor(org, ids, "no_access", actor)` (Google connections and teammate browsers), in one call, never failing the request. PATCH and the bulk route call it.
- **6b. Job title and department.** POST `/api/users` wrote `departmentId` and `roleId` as sent. Now blank, or the workspace's own: "That department isn't in this workspace" or "That job title isn't in this workspace", a 400 naming the `field`, also for a value that is not text. The others:
  - PATCH already checked (and the office).
  - The bulk change of department checks; no bulk action writes a job title.
  - The CSV import maps names to the workspace's own rows.
  - SCIM Groups write their own department's id; SCIM Users write neither.
  - `sendInvitation` stored all three as sent and the acceptance wrote them onto the person: now each must be the workspace's own (department, job title and office).
  - The other builder's `/api/v1/people` POST already checks both.

## Tests

Fail on the old code / total, run against 648913b1 in a scratch copy (below). 81 tests are new or edited; 73 fail on the old code. The 8 that pass on both pin behaviour that did not change, named here.

- `src/lib/people/handover.server.test.ts`: 11 new and 1 edited, all 12 fail. Locked task writes (a task reassigned meanwhile, an assignee added meanwhile, a task closed or archived meanwhile), the audit rows inside LINES and SCIM's actor, reviews before WORK, the partial error and its words, a report and a manager anchored elsewhere, `pendingHandover`. The batch 4 order test now reads `["begin", "lock", "write", "audit"]` then `[..., "item-lock", "item", "commit"]`; the batch 3 lock test allows the audit rows. Its double answers memberships, the item lock and the audit rows.
- `src/app/api/users/[id]/handover/route.test.ts` (new): 3 of 5. Two pin: a busy lock is still `roles_busy` and a full run is still logged; a recipient who holds no level here is still refused.
- `src/app/api/users/[id]/route.test.ts`: 9 new and 1 edited; 9 of 10 fail. A restore keeps a manager here through a membership and still drops one with no level or the Agent tier here; PATCH takes such a manager; clearing Reports to takes the role lock; reactivation (a deactivated manager cleared and said, a dotted line to an Agent, the lock order); the seat lock's 503 on a reactivation and a restore. One pins: a Reports to sent with the reactivation is left to its own check.
- `src/app/api/users/route.test.ts`: 5 new, all fail. Department and job title, a manager here through a membership, an address here through a membership, the bounded seat lock's 503.
- `src/lib/access/org-roles-lock.test.ts`: 6 new, 5 fail. Per workspace, the process cap, the bounded seat lock, SeatsBusy's 503, both waits inside `LOCKED_TX`. One pins the unbounded default.
- `src/lib/access/manager-lines.test.ts`: 6 new, all fail. Direct reports, the effective manager, an Agent here through a membership walked through, an Agent's stored count, the dotted reads (removed and foreign left out), the line facts. Its tree double now keeps to the workspace when the walk names one.
- `src/lib/access/membership.test.ts`: 2 new, both fail (rule 6 counts a report here through a membership and never one with no level here; SCIM's recipient).
- `src/lib/people/person-access-anchor.test.ts` (new): 4 of 4 (`managerCandidateIn` and `checkManagerCandidate`, `agentIdsAmong`, the loop walk and `managerMapFor`, `staleLinesOf`).
- `src/lib/people/send-invitation.server.test.ts`: 4 new, 3 fail. One pins the workspace's own placement passing.
- `src/lib/scim-deprovision.test.ts`: 2 new, both fail. `src/app/api/scim/v2/Users/[id]/route.test.ts`: 3 new, all fail.
- `src/lib/admin/set-owner.test.ts` (new): 3 of 4. One pins promoting a member who is no Agent through a membership.
- `src/app/api/reviews/[id]/review-writer.route.test.ts`: 3 new, 2 fail. One pins that the subject never writes their own unclaimed review.
- `src/app/api/settings/members/bulk/route.test.ts`: 2 new, 1 fails. One pins that a failed hook never fails the request.
- `src/lib/access/agent-manager-reads.contract.test.ts`: 4 new and 5 edited batch 3 and 4 assertions, all 9 fail (the PATCH and restore lock lines, the solid and team walks' SQL, the review PATCH, the acceptance's busy answers; `hasReportsFor`, `hasTeam`, team scope, record-access, the dotted walk, the import, every bounded seat wait, the drawer's sentence).
- `src/app/api/users/[id]/agent-reports/route.test.ts`: 1 new, fails. `src/lib/people/employed.server.test.ts`: 1 edited, fails. `src/lib/process-run-access.test.ts`: 1 edited and 1 new, both fail (its double answers the dotted reports' rows).

## Verification

- `npx vitest run` over every test in the touched folders, every test that imports or mocks a changed module, and every test that reaches one through imports (the import graph, transitively): 501 files, 6,752 tests, all pass, with the other builder's work in place. Their own test files (check-ins, the AI digest, digest-recipients, send-reminders, v1 people and KPI records, tools-create-task, the agent-tier contract) pass too.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 30 changed source files put back from 648913b1, checked byte for byte, and the new module (`role-change-after.ts`) removed. The 18 new or edited test files all load: 73 of 224 tests fail.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`: exit 0.
- **eslint** on the 31 changed or new source files and the 18 test files: no new problems. The 7 errors left are at 648913b1 too (checked by linting each file's HEAD content): the G7 `accessLevel` read in `calendar/events/route.ts`, and five in `send-invitation.server.ts`.

## Found, not fixed

- **People who work here through a membership are missing from Members**, the directory and the people picker, and their record cannot be edited, deactivated, removed or given a new role here until they switch back: those write the one User row every workspace reads, and a role change writes `User.accessLevel`, the anchored workspace's level. The worst case is an Admin who cannot demote an Admin who has switched away. It needs a per-workspace status and a role change that writes only the membership's role.
- **The sharing engine's view of another person** (`nodeCtxForUser`, `loadPeople`, grant targets, the object-share doors, `viewerForUser`) is anchored only, so a member anchored elsewhere cannot be shared with or named as owner here. It fails closed.
- **The People team and Admin lists** (`listOrgAdmins`, `peopleTeamIdsFor`'s HR fallback, record-access's groups, the cron's first admin) read the anchored row's level, as the engine does.
- **`User.managerId`, `roleId` and `departmentId` are one column each** for every workspace a person belongs to (batch 4's found, not fixed): a line set in one workspace is the line in every other.
- **A handover that stops half way** leaves its report moves in the Audit log and the work with the leaver; the dialog says so, but nothing retries it on its own.
- **The batch 4 review's lows 4, 6 and 8** were not in this batch: Download my data exports a non-Agent stale stamp's open rows; a removed stored manager is still answered as the effective manager while a foreign one falls back; `hashtext` keys can collide across workspaces and share a lock for a moment.

# Batch 6: check-ins by workspace, private digests, webhook claims

Worktree `theywrk-agents`, on top of 7b962c17. Nothing here is committed. One SQL file. The items come from the batch 5 review's entry on `check-in-access.server.ts` and `ai/digest/route.ts`: its two findings and its five lows. Another builder works in the same worktree on the handover, `manager-candidate.ts`, `acting-workspace.ts`, team scope, person access, dotted lines and the users routes. None of those files were touched here; `acting-workspace.ts`, `person-access.server.ts` and `kpi-review.server.ts` are only called.

## 1. A check-in belongs to the workspace it was written in

**What was true (confirmed).** `CheckIn` had no workspace column. Batch 5 read "in this workspace" as the level a person holds here, so Dana, anchored in Acme with a membership in the client workspace Globex, wrote her Acme mood and her challenges with her Acme manager, and every Globex Owner, Admin, People team member and org-wide level read them (GET `/api/check-ins`, `?userId=dana`, and the AI digest's mood tiles), whatever her anchor.

**Decision.** A check-in names the workspace it was written in, and every read takes only the rows of the workspace being read, the person's own included.
- POST writes `organizationId` from the session's workspace (the one the session acts in), never from the body.
- A row from before the column (null) has no workspace, and none is guessed. Others read it only where its person holds a level in exactly one workspace, the one being read (anchored here, every membership here); then it can only have been written there. Anyone who holds a level in two or more workspaces has their older rows read only by themselves. The person reads their own older rows wherever they work.
- Worst case of this: Admins of a person's only workspace keep reading what they read yesterday, and a person in two workspaces has older check-ins only they read; no screen shows check-ins. Worst case of any guess (the anchor, the oldest membership): health-grade notes about one employer shown to another.
- The person must still hold a level here for anyone else to read a row of this workspace (batch 5's rule), so a former member's check-ins are read by no one here.

**What changed.**
- `src/lib/check-in-access.server.ts`: `holdsALevelOnlyIn`, `checkInsOfWorkspace` and `checkInReach` (what a viewer reads: everyone's here, their own and their people's, or their own); `readableCheckInsWhere` takes each row only of this workspace. GET `?userId=` reads that same where, narrowed to the person, so a list and a single read never disagree.
- `src/app/api/check-ins/route.ts`: POST writes the workspace; GET as above.
- `src/app/api/ai/digest/route.ts`: the mood tiles read through the same where (item 2).
- **SQL**: `prisma/sql/2026-10-12-check-in-workspace.sql`: `"CheckIn"."organizationId" TEXT` nullable, a foreign key to `"Organization"` ON DELETE CASCADE (never SET NULL, which would turn a deleted workspace's rows into rows of no workspace, readable where their person now works alone), and an index on (`organizationId`, `createdAt`), which the digest's week and the list read. Additive, idempotent, each statement catalogue-guarded, no backfill. Listed last in `SQL_MANIFEST` (a text edit) and declared in `prisma/schema.prisma` (no Prisma relation, as on `AgentAction`). It must run before the new build: GET `/api/check-ins` and GET `/api/me/export` read `CheckIn` with no select. The client is gitignored; I ran `npx prisma generate` locally (checkpoint off, no database) so the type check sees the column.

**Tests.** `check-in-access.test.ts`: the nine viewer shapes (one new: a manager of people in two workspaces) now held to the rule for every person and every row (written here, in another workspace, before workspaces), plus three new: the review's scenario for a Globex Admin, People team member and VP; the older-row rule; the reach. `check-ins/route.test.ts`: two new (another workspace's Admin, by list and by `?userId=`; older rows) and POST edited (the workspace written, never the body's).

## 2. The AI digest shows only what the viewer may read

**What was true (confirmed).** GET `/api/ai/digest` (no caller in the app) loaded every KPI reading of the week with no viewer filter, to anyone signed in, a Guest and an Agent included: in a week with one reading, "KPI Updates: 1, Avg score: X" was that person's score. Every score null gave "Avg score: NaN". The low-mood alert counted check-ins ("4 team members" for one person's four low days). A plain Member's "Team Mood" was their own mood alone. "Team Size" counted removed and deactivated accounts and left out members anchored elsewhere. A check-in with no mood was averaged as a 3. "No KPI records this week" held an em dash.

**Decision.**
- KPI updates and active KRAs count only the people whose alignment data the viewer reads, the union of what GET `/api/kpi-records` lists (`visibleAlignmentUserIds`) and what it opens for one person (`mayActOnKpisOf`): everyone here for Owner, Admin, the People team and the org-wide levels; otherwise the viewer and the chain people `mayActOnKpisOf` opens (an Agent: their own alone). Read from `PeopleCtx` at the level held here, fresh, which holds the same sets (`orgWide` is those levels; `chain` holds the solid tree `visibleAlignmentUserIds` walks); passing a level into `visibleAlignmentUserIds` from a route is what the G7 lint rule forbids. Counted with `aggregate`, never loaded.
- A Guest's digest holds their own mood and check-ins and nothing about the workspace (no team size, KRAs, KPIs or SOPs). Worst case of hiding: an outside guest misses counts no screen shows. Worst case of showing: headcount, growth and performance counts reach an outsider.
- Each tile's label says whose it is: "Team Mood", "Your team's mood", "Your mood"; the same for check-ins, KPI updates and active KRAs. Published SOPs count only SOPs the viewer can open (`sopVisibilityWhere`, "That you can open").
- The low-mood alert counts distinct people ("4 people reported a low mood this week."), only for a viewer who reads other people's check-ins, and the mood tile says "1 person with a low mood". Team Size counts live people who hold a level here (`inWorkspaceWhere`, not removed, not deactivated); "new this week" is an account made here or a membership made here this week. No scored reading gives "This week", never NaN; a check-in without a mood is left out of the average. The KPI alert reads "No KPI records this week. Check that teams are tracking them." (or "for you", "for you or your team").

**What changed.** `src/app/api/ai/digest/route.ts`.

**Tests.** `ai/digest/route.test.ts` (rewritten, 9): a colleague's own tiles; an Admin's; a mood left out; the alert by people; a colleague's and an Agent's KPI and KRA tiles, counted by aggregate; a manager's and an Admin's; a Guest; no NaN, no dash; Team Size.

## 3. The overdue SOP digest's read check

**What was true (confirmed).** The overdue SOP digest named every overdue SOP to the person's manager by title with no read check (batch 4's found, not fixed), and batch 5's `memberManagersOf` extended it to members' managers. The digest-recipients header said every title was held to a List the manager can view, which was true for tasks only.

**What changed.**
- `src/lib/sop-access.ts`: `sopsEachCanRead(organizationId, asks)`, `sopVisibilityWhere`'s rules for many readers, each asked about their own SOPs, in the same few reads whatever the number of readers: the SOPs, one recursive read of the folders above theirs, the readers' grants on those folders and their assignments to those SOPs. The `sops`/`edit` capability is asked only for a reader whose answer rests on it (an unfiled draft). `sop-access.ts` is already on the G7 allow-list; the list did not grow.
- `src/lib/access/digest-recipients.ts`: `sopsEachManagerCanRead`, the same at the level each digest manager holds here (`DigestManager.accessLevel`, new), and a true header.
- `src/app/api/email/send-reminders/route.ts`: a SOP line is added only for a manager who can open the SOP; each (manager, SOP) pair is asked once per workspace run. The person's own reminder is unchanged. `scripts/CRON-SETUP.md` says so.

**Tests.** `src/lib/sop-access.test.ts` (new, 3): ten reader shapes held equal to `sopVisibilityWhere` over a folder tree (cascade, drafts, archived, a gone folder, another workspace, the author, an assignee, the capability); the reads are the same four for any number of readers and the capability is asked once; nothing read for nothing asked. `send-reminders/route.test.ts`: 1 new (a restricted SOP left out, asked once per pair, at the level held here). `digest-recipients.test.ts`: the wrapper's level, in item 4's test.

## 4. A Guest is no one's digest manager

**What was true.** `digestManagersOf` built each manager's viewer with `nodeCtxFromLevel`, which marks a Guest only for an unknown level. A Guest anchored here holds a Member's level with GUEST stored as their org role, so a Guest set as someone's Reports to was evaluated as a Member, and their overdue digest named tasks on workspace-wide Lists a Guest cannot open.

**Decision: skip them.** A Guest reads no one's people data here (`relationTo`), so a digest about a person's late work is not theirs. Read as `effectiveOrgRole` reads it: the stored GUEST where they are anchored here, or a level that maps to no role. Read whatever `ACCESS_V2_TABLES` says, as `guests.ts` `anyGuestHere` reads it: the column only narrows. Worst case of skipping: a Guest set as someone's manager gets no Monday email, as a deactivated manager gets none. Worst case of marking them a Guest and sending: still a person's overdue work told to an outsider. They are not walked past to the manager above (that walk is `manager-lines.ts`), so that person's late work reaches no manager, as under a deactivated one. The monthly evaluation reminder reads the same managers, so a Guest is not reminded either.

**What changed.** `src/lib/access/digest-recipients.ts`; `how-it-connects.mdx` and `scripts/CRON-SETUP.md` say "never an Agent or a Guest".

**Tests.** `digest-recipients.test.ts`: 1 new (a stored Guest here and an unknown level skipped; a manager anchored elsewhere read at the membership's level, their other workspace's stored role ignored; the level carried and passed to the SOP check). `send-reminders/route.test.ts`: 1 new (a Guest manager gets neither digest; the person still gets their own).

## 5. Webhooks: a send bounded by its body, and a claim before every send

**What was true.** The abort timer was cleared once the answer's headers arrived, and `res.text()` then had no timeout, so a receiver that trickled its body kept the first try open past its 15-minute lease, and the retry sent it again while it ran: "a first try still running is never sent twice" was untrue. The whole body was read into memory however large. And no row was claimed before a retry sent it, so two retry runs that overlapped (a slow run and the next five minutes' run) sent the same RETRYING rows twice.

**What changed.** `src/services/webhookDispatcher.ts`:
- `postOnce`: one send bounded as a whole by the 10 seconds, the body included; `readSnippet` reads at most the 500 characters it keeps, keeps what arrived when cut off, and cancels the rest. A 2xx whose body is cut off is still DELIVERED.
- THE CLAIM: the first try's claim is the lease its row is written with (no run reads it before then); a retry run claims each row it read in one write that pushes `nextAttemptAt` 15 minutes ahead and holds only while the row is still due by that run's clock, unsent since it was read (same `attemptCount`) and not done. A run that loses the claim sends nothing; a failed claim write is no claim. A claimed row whose run stops mid-send is due again when the claim passes. Delivery stays at least once, with one id.

**Tests.** `webhookDispatcher.signing.test.ts`: 4 new (a body that never ends is cut off at 10 seconds with what arrived kept, the delivery marked; no more than the kept characters pulled from a 100,000-character body; a claim before each send and nothing sent for a lost claim; two overlapping runs send a row once). Its double gained a real compare-and-set for claims; every earlier test runs unchanged.

## 6. An approved card keeps its automation's chain

**What was true (confirmed).** Inside an automation's teammate step, `create_task` for someone else is OUTWARD and waits for the person's approval. The approval ran later outside `withAutomationDepth`, so what it dispatched (task.created, and the task events of an approved `update_task` or `move_task`) started at depth 0: "When a task is created, ask a teammate to make a follow-up for Dana" asked again on every approval. `create_task`'s outward card had no automations line, which `update_task`'s and `move_task`'s carry.

**What changed.**
- `src/lib/agents/actions.ts`: `proposeAction` stores the step's chain depth in the card's stored input under `AUTOMATION_DEPTH_KEY`, written only from `automationDepthNow()` (any such key the call carried is dropped); the approval splits it off before `prepareCall`, so the call's input and any edit never carry it, and runs the tool inside `withAutomationDepth` at that depth. No new column. Every card is covered, not only `create_task`'s. A card run by the person's own rule runs inside the turn and already had the depth.
- `src/lib/agents/previews.ts`: `create_task` for someone else adds "It can start automations set up on this List." after the Personal list line. `tools.ts`'s comment says so.

**Tests.** `actions.test.ts`: 2 new (the depth stored inside a step and never from the call; an approved card runs at its depth, a plain one at none, and neither the handler nor `prepareCall` sees the key). `previews.test.ts`: 1 edited (the line). `test-fixtures.ts` records the depth a handler ran at, only inside a chain, so every other strict comparison is unchanged.

## Verification

- **Tests of every touched folder and every test that imports a changed module** (`src/lib/agents`, `src/lib/access`, `src/services`, the top-level `src/lib` tests, the check-ins, ai and email API folders, and every test naming a changed module): 406 files, 6,517 tests; 6,503 pass. The 14 that fail are in 4 files of the other builder's work in progress (`users/[id]/route.test.ts`, `users/[id]/agent-reports`, `users/[id]/dotted-lines` and the role-lock contract test, which reads those routes); none reads a file changed here. One of mine broke on the way (`sidekick/chat/route.approvals.test.ts` compares handler calls strictly) and was fixed by recording a depth only inside a chain.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run twice (the limit). The second run's only errors were two lines of this batch's test doubles (a weak-type check on `legacyLevelOfRow`'s argument in `send-reminders/route.test.ts` and `digest-recipients.test.ts`); both now take the helper's own parameter type. They were not checked by a third run; both files pass and lint clean.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 14 changed source, schema, script and docs files put back from 7b962c17, checked byte for byte, and the SQL file removed. The 9 new or edited test files: all 38 new or edited tests fail (check-in-access 13, check-ins 3, ai digest 9, digest-recipients 1, send-reminders 2, sop-access 3, webhooks 4, actions 2, previews 1); the 148 unchanged tests in those files pass on both.
- **eslint** on the 20 changed or new source and test files: no new problems. The 2 errors and 2 warnings left are at 7b962c17 too (`no-explicit-any` twice and an unused `subject` twice in `send-reminders/route.ts`).
- `node --check scripts/deploy-migrations.mjs`: ok. `npx prisma validate`: valid.

## Found, not fixed

- **Older check-ins of people in two or more workspaces** are read only by the person, by design: no backfill can tell where they were written.
- **Published SOPs in the AI digest** use the session for `sopVisibilityWhere`, as every SOP route does, so a token's level, not the fresh one.
- **A Guest digest manager is skipped, not walked past**, so their people's overdue work reaches no manager, as under a deactivated one. Walking past them is `manager-lines.ts`'s walk.
- **A retry claim is 15 minutes**, so a run stopped mid-send leaves its row due again then, not at its backoff time.
- **"New this week" in Team Size** counts an account made here or a membership made here; someone whose anchor moved here this week with an older account and no membership row here is not counted.

# Batch 6: a workspace writes only its own lines

Worktree `theywrk-agents`, on top of 7b962c17. Nothing here is committed. No SQL file; three new raw statements in code (listed under "Raw SQL"). The items come from the batch 5 review's entry on `handover.server.ts`, `manager-candidate.ts` and `acting-workspace.ts`: its three findings and the lows where a person sees a wrong result or loses data. Another builder works in the same worktree on check-ins, the AI digest, `digest-recipients.ts`, `send-reminders`, `webhookDispatcher.ts` and `src/lib/agents`; none of those files were touched here.

THE RULE: a workspace only ever writes the reporting lines it owns. `User.managerId` and `UserDottedLine` are one row each, read by every workspace the person belongs to.

**What "another workspace relies on the line" means** (`acting-workspace.ts` `linesElsewhere`, the one test every write below asks): the person works in another workspace too (anchored there, or a membership there) and the manager holds a level there that is not the Agent tier, so there the person reports to them ("relied"). A manager who holds only the Agent tier there is "shared". Read whatever the person's anchor is: `User.organizationId` is only the workspace they last switched to, so "anchored elsewhere" is no test of whose line it is. At most four indexed reads, two when nobody works anywhere else.

## 1. Moving reports never rewrites another workspace's line

**What was true (confirmed).** Batch 5 counted everyone who holds a level here as a report, so `agentPlanFor` and the handover's LINES plan moved a report anchored in workspace A, under a person who is an Agent here and a Manager in A, to someone of this workspace (or no manager). A then read the new column: the report lost their manager reviewer, approver and team placement there, recorded only in this workspace's Audit log. The handover did the same to a leaver's reports. The Agent move also deleted dotted lines A counts.

**Decision.** Leave out every report whose line another workspace relies on, whatever their anchor; move the rest as before. Worst case of leaving out: in this workspace the report stays listed under an Agent (every read already treats an Agent as nobody's manager) or under a leaver who is then deactivated, until someone sets their Reports to; the dialogs say so. Worst case of moving: another workspace's real reporting line silently rewritten. An Agent who is an Agent in the other workspace too, or holds nothing there, is no one's manager there either, so that report still moves.

**What changed.**
- `src/lib/people/reporting-lines.ts`: `planReportHandover` takes `stays` and answers them apart (in none of the moves); `linesStayNote`, the plain reason: "Ida Ray stays listed under Leo Leaver. They also work with Leo Leaver in another workspace, where that line still counts, so it's left as it is." It never names the other workspace: who else a person works for is not this workspace's to know.
- `src/lib/people/handover.server.ts`: `reportsStayingWith`; `handoverLinesFor` (so `reportPlanFor` and `agentPlanFor`) computes `stays` under the role lock. `runHandover` answers `reportsStaying` (also on `HandoverWorkFailed`), writes no audit row for them; `previewReportHandover` answers `stays`; `previewAgentReports` and `moveAgentReports` answer `stays` (solid and dotted, by name) and take off only the dotted lines this workspace owns. New `handoverReportCount`: the reports a handover moves, which `pendingHandover` (the deactivation gate) counts, so a report that stays never blocks a deactivation for good.
- Said where a person sees it: the Members transfer dialog (before, under the plan, and after, in the done message), the Directory's Remove dialog toast, the Members drawer's Agent notice (with nobody else to move, the sentence and no button), the `user_handover` and `reporting_line_changed` log rows, and SCIM's deprovision audit row.

## 2. A restore or a reactivation clears only lines this workspace owns

**What was true (confirmed).** `staleLinesOf` cleared a manager line and every dotted line to someone who holds no level here (PATCH reactivation, the restore, SCIM `active: true`), logged "is no longer in the workspace". For a person who also works in workspace A where that manager is, it deleted A's lines with no benefit here (reads here already treat such a manager as nobody), and the sentence was untrue: the manager had never been here.

**Decision.** A line is cleared only for:
- `removed`: the manager's account is removed (`deletedAt`), "is no longer in the workspace", said for this alone now.
- `inactive`: a deactivated manager (the solid line; dotted lines to a deactivated person stay, as before).
- `agent`: the Agent tier held here, unless another workspace relies on the line. I extended the lead's list here by THE RULE: an Agent here who is a Manager in the person's other workspace keeps that workspace's line (reads here already skip them), consistent with item 1.
- `elsewhere` (new): the manager holds no level here nor any level in another workspace the person works in, "Dana Ray doesn't work in this workspace". I kept clearing this case although the lead's list says "only" the three above: no workspace reads that line, and kept, it would come back to life the day that manager joins one of the person's workspaces, as their manager with nobody deciding it. The words are true whether or not they were ever here.
- A manager or dotted manager who holds no level here but holds one (any) in another workspace the person works in is kept.

**The sweep of other writes that cleared lines for "no level here".**
- PATCH, the restore and SCIM reactivation: through `staleLinesOf`, above.
- The Agent move's dotted lines: item 1.
- PUT `/api/users/[id]/dotted-lines`: it deleted every line the body left out, so saving a dotted line here deleted the person's dotted lines in their other workspace; and since the person record lists every dotted manager, a body naming one who holds no level here was refused "isn't in this workspace", so no dotted line of that person could be edited here at all. Now `othersDottedLines` (`manager-lines.ts`): a line to someone with no level here whom another workspace reads, or to an Agent here whom another workspace relies on, is never checked, replaced or deleted, named in the body or not. A line no workspace reads is still this workspace's to take off. GET answers only the lines this workspace manages.
- Nothing else clears a line: no route deletes a membership, SCIM writes no manager, and moving an anchor keeps the lines.
- Kept on purpose: PATCH Reports to and the dotted-lines PUT on a person anchored here still overwrite a line another workspace counts when an Admin here chooses to (the person's own record, batch 5's rule; refusing it would leave unwanted reach in this workspace).

**Files.** `src/lib/access/manager-candidate.ts` (`staleLinesOf`, `StaleLineReason`, `staleLineWords`), `src/lib/access/manager-lines.ts` (`othersDottedLines`), `src/app/api/users/[id]/dotted-lines/route.ts`.

## 3. Whole-workspace reads use indexes

**What was true (PLAUSIBLE, confirmed in the code).** `inWorkspaceWhere` is an OR with a membership sublink; as a query's only selective filter Postgres runs it as a Seq Scan of the global User table. It was the only filter in `teamScopeFor` for org-wide viewers (My team, Workload, `/api/team/attention`, members-work), `managerMapFor` (every Reports to, the bulk change, the dotted-lines GET for writers and PUT) and the dotted-lines `peopleBelow` join.

**What changed.**
- `acting-workspace.ts`: `workspacePeopleLines(org, { activeOnly })` and `workspaceDottedLines(org)`, one statement each of two indexed halves (below).
- `teamScopeFor` (org-wide), `managerMapFor` and `peopleBelow` read through them. The chain branch of `teamScopeFor` keeps `inWorkspaceWhere`: it is narrowed by id.
- Kept, each with a comment saying why: `teams-counts.ts` `hasReportsFor` and `calendar/events` `hasTeam` (narrowed by `User_managerId_idx` and `UserDottedLine_managerId_idx`), `record-access` (by id, and by `UserDottedLine_userId_idx`), `employed.server.ts` and the agent-reports gate (by id). The raw recursive walks in `team.ts` and `reporting-line.ts` join on `managerId`, so their `OR EXISTS` filters rows already narrowed.
- Found in the other builder's files: below.

### Raw SQL added (every statement; EXPLAIN as I read it against `prisma/schema.prisma`, no index in `prisma/sql` touches these tables)

1. `workspacePeopleLines`, two literal variants (the second adds `AND u."status" <> 'INACTIVE'` to both halves):
   ```sql
   SELECT u."id", u."managerId" FROM "User" u
    WHERE u."organizationId" = $1 AND u."deletedAt" IS NULL
   UNION ALL
   SELECT u."id", u."managerId" FROM "OrganizationMembership" m
     JOIN "User" u ON u."id" = m."userId"
    WHERE m."organizationId" = $1 AND u."organizationId" <> $1 AND u."deletedAt" IS NULL
   ```
   An Append of two branches, no sort or hash for duplicates (a membership is unique per person and workspace, and the second half leaves out the people anchored here). First half: Bitmap Index Scan on `User_organizationId_idx`, Bitmap Heap Scan filtering `deletedAt` (and `status`). Second half: Index Scan on `OrganizationMembership_organizationId_idx`, Nested Loop to `User_pkey` per membership with the filters. The planner may choose a Hash Join over a scan of User for the second half only when a workspace has so many memberships that it estimates that cheaper. `$1` is the workspace id in all three places.
2. `workspaceDottedLines`:
   ```sql
   SELECT d."userId", d."managerId" FROM "User" u
     JOIN "UserDottedLine" d ON d."userId" = u."id"
    WHERE u."organizationId" = $1 AND u."deletedAt" IS NULL
   UNION ALL
   SELECT d."userId", d."managerId" FROM "OrganizationMembership" m
     JOIN "User" u ON u."id" = m."userId"
     JOIN "UserDottedLine" d ON d."userId" = u."id"
    WHERE m."organizationId" = $1 AND u."organizationId" <> $1 AND u."deletedAt" IS NULL
   ```
   The same two halves, each then Nested Loop to `UserDottedLine_userId_idx` (or a Hash Join over `UserDottedLine` where the planner finds it cheaper; it never reads User beyond the workspace's rows).
3. The acceptance's invited Space (low 11), three statements in the acceptance's transaction:
   ```sql
   SELECT set_config('lock_timeout', $1, true)
   SELECT id FROM "Space" WHERE id = $1 AND "organizationId" = $2 FOR KEY SHARE
   SET LOCAL lock_timeout TO DEFAULT
   ```
   `$1` of the first is `'3000ms'` (`LOCK_WAIT_MS`). The second: Index Scan on `Space_pkey`, LockRows. No table for the others.

Changed, not added: `trash.ts`'s `SELECT id FROM "Board" WHERE "folderId" = ANY($1::text[])`, `... WHERE "spaceId" = $1` and `SELECT id FROM "Item" WHERE "boardId" = ANY($1::text[])` each gained `ORDER BY id` before `FOR UPDATE` (low 2): `Board_folderId_idx`, `Board_spaceId_idx`, `Item_boardId_position_idx`, then a Sort and LockRows, so rows are locked in id order.

## 4. The lows

- **The partial handover's words** (`handoverPartialWords`): with no report moved it said "Their direct reports were already moved", untrue for most leavers. Now "Their open tasks and their Spaces, Folders and Lists didn't move. Try again to move them." (the dialog and SCIM's 503).
- **Task lock order** (`trash.ts`): the List, Folder and Space delete locks Lists and tasks in id order, the order WORK locks tasks in. Bulk item edits still lock in no order (found, not fixed).
- **The deactivation gate under the lock** (PATCH `users/[id]`): `handoverReportCount` again inside the role-locked transaction, so a Reports to naming the person that landed after the first check is seen: 409 `handover_first`, nothing written.
- **Reactivation with an unchanged Reports to in the body**: the manager they already have, sent again, is no new Reports to (both checks skip it, and `staleLinesOf` reads it), so they never come back under a deactivated manager. An unchanged manager is also no longer refused on an unrelated edit.
- **Shared unclaimed reviews, last write wins** (data loss): GET answers `managerVersion` (`review-cycle.ts` `managerHalfVersion`, a hash of the manager half only, so the subject's own self review never makes a conflict); the drawer sends back the one it last saw. For a review the People team and Admins write, a save over someone else's change is refused (409 `review_changed`, "Someone else saved this review while you had it open. Open it again to see theirs"), and the drawer stops saving with the text kept on screen and on the device. A retry of a save that landed is no conflict. The write is conditioned on the row as read (`updatedAt`), read again up to three times, else 503 `review_busy`. The manager the line names writes alone, unchecked as before.
- **SCIM POST Users** (`scim/v2/Users/route.ts`): an address that already works here through a membership is the SCIM uniqueness 409, never a second account (two indexed reads: the address's accounts by `User_email_organizationId_key`, a membership here by `OrganizationMembership_userId_organizationId_key`).
- **Old invitations' placement**: `invite-facts.server.ts` `placementOnAccept` keeps the department, job title and office only when each is the invited workspace's own; the new-account acceptance writes that.
- **`unattendedRecipient`** walks past a deactivated manager to the live one above, as `liveManagerFrom` does, before the first Owner.
- **Set Owner** reads the Owners in its own transaction (`ownerIdsFor(org, tx)`), so no second pooled connection while it holds the locks.
- **The acceptance's Space grant** waits at most 3 seconds for a Space delete (raw SQL 3 above) and answers the acceptance's busy 503 ("This workspace is busy for a moment, so you haven't joined yet. Try again."), never a 500 at /join.
- Not fixed: the review's `effectiveManagersOf` low (one column, below).

## Tests

Fail on the old code / total, run against 7b962c17 in a scratch copy (below). 55 tests are new or edited in 17 files (2 new files); 48 fail on the old code. The 7 that pass on both pin behaviour that did not change, named here. Of the 48, four (`handover.server.test.ts`: the two Agent move answers, the dialog preview, and "still moves a report when the Agent is an Agent in the other workspace too") fail on the old code only because the answers gained `stays`.

- `src/lib/people/handover.server.test.ts`: 6 new and 4 edited, 9 fail. The review's Agent scenario, a report anchored here who also works there, dotted lines, an Agent there too, the handover leaving a report (named, no audit row, the gate), the partial words. Pins: a report anchored elsewhere whose line nobody else relies on still moves. Its double answers memberships in other workspaces.
- `src/lib/people/person-access-anchor.test.ts`: 4 new and 1 edited, all 5 fail (kept lines, an Agent here who manages there, removed and deactivated still cleared with true words, `managerMapFor` never reads by the OR alone; "fay" is now "doesn't work in this workspace").
- `src/lib/access/acting-workspace.test.ts`: 6 new, all fail (`linesElsewhere`, both statements' shape and values).
- `src/app/api/users/[id]/route.test.ts`: 6 new, 5 fail (restore and reactivation keep another workspace's lines, the "elsewhere" sentence, the unchanged deactivated manager, the gate under the lock). Pins: a removed account is still "no longer in the workspace".
- `src/app/api/users/[id]/dotted-lines/route.test.ts`: 5 new, 4 fail (the PUT keeps the other workspace's line, a body naming it is not refused, GET, the indexed walk). Pins: a line no workspace reads is still taken off. Its double reworked to answer per-person dotted lines and memberships.
- `src/app/api/reviews/[id]/review-writer.route.test.ts`: 3 new, 2 fail. Pins: the manager the line names, and a save with no version, write as before.
- `src/app/api/scim/v2/Users/route.test.ts` (new): 1 of 3. Pins: an address elsewhere only is still created; one anchored here is still refused.
- `src/lib/access/agent-manager-reads.contract.test.ts`: 2 new and 3 edited, all 5 fail (the acceptance's placement and bounded Space; the PATCH, dotted-lines and indexed-read wiring).
- `src/lib/auth/invite-facts.server.test.ts` (new): 2 of 2. `src/lib/people/reporting-lines.test.ts`: 2 new, both fail. `src/lib/access/membership.test.ts`, `src/lib/admin/set-owner.test.ts`, `src/lib/trash-space-lock.test.ts`, `src/lib/scim-deprovision.test.ts`, `src/app/api/scim/v2/Users/[id]/route.test.ts`, `src/app/api/users/[id]/agent-reports/route.test.ts`: 1 new each, each fails.
- `src/app/api/users/[id]/handover/route.test.ts`: 1 new (fails) and 1 edited (the partial answer's shape gained `reportsStaying`; passes on both).
- Fixtures only: `scim-deprovision.test.ts` and the handover route test's runHandover answers gained `reportsStaying: []`; the agent-reports route test's move answer gained `stays: []`.

## Verification

- `npx vitest run` over every test in the folders touched, every test that imports or mocks a changed module, and one more import hop: 156 files, 2,128 tests, all pass, with the other builder's work in place.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 29 changed source files put back from 7b962c17 and checked byte for byte. The 17 new or edited test files all load: 48 of 248 tests fail.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run twice: the first found two of my test fixtures missing `reportsStaying` (fixed); the second exit 0.
- **eslint** on the 29 changed source files and the 17 test files: no new problems. The 2 errors left are the G7 `accessLevel` read in `calendar/events/route.ts`, at 7b962c17 too (my change there is a comment).

## Found, not fixed

- **The AI digest's Team Size** (`src/app/api/ai/digest/route.ts`, the other builder's file): `prisma.user.count({ where: { ...LIVE, ...inWorkspaceWhere(orgId) } })` has the OR as its only selective filter, so it scans every workspace's User rows; its "new this week" count too. `workspacePeopleLines(orgId, { activeOnly: true })` gives the same people by the indexes.
- **The destination side of a move.** A report this workspace may move (no other workspace relies on the old line) can go to someone who also works in the report's other workspace, which then reads the new line. One column; refusing it would send most reports to no manager in organisations whose senior people belong to every workspace.
- **A report who stays keeps a leaver who is then deactivated** (deactivation is one column). Their other workspace sees a deactivated manager until someone there sets Reports to, and this one does too; the dialogs say so.
- **The person record** (GET `/api/users/[id]`) shows the manager, dotted-line managers and direct reports whatever workspace they are in, by name.
- **`effectiveManagersOf` answers for members** (the review's low): the other workspace's stored line decides who reviews them here. It needs a line per workspace.
- **WORK's container writes** (Spaces, Folders, Lists by `updateMany`) and bulk item edits lock rows in no order, so a deadlock with a delete over two shared rows is still possible; Postgres ends one side (WORK answers its 503 partial).
- A drawer opened before this build sends no version, so its saves are unchecked until it is opened again.

# Batch 7: check-ins settled once, the last lows

Worktree `theywrk-agents`, on top of 749b7435 (live). Nothing here is committed. One SQL file, new. The items come from the batch 6 review's entry on `check-in-access.server.ts`, `previews.ts`, the check-in SQL, the AI digest and `webhookDispatcher.ts`: its two findings and its eight lows. Another builder works in the same worktree on the handover, users, people, `manager-candidate.ts`, `acting-workspace.ts`, dotted lines, SCIM and the review routes; none of those files were touched here.

## 1. Older check-ins, settled once

**What was true (confirmed in the code).**
- Batch 6 let others read a check-in with no workspace (written before the column) where its person held a level in this workspace alone: `holdsALevelOnlyIn`, a Prisma `every` that compiles to `User.id NOT IN (SELECT userId FROM OrganizationMembership WHERE NOT organizationId = $1)`. That subquery has nothing selective (every account has a primary membership), so every Admin's, People team member's, org-wide level's or manager's read of GET `/api/check-ins`, and both check-in reads of GET `/api/ai/digest`, read every other workspace's memberships.
- The rule was asked on every read, so its answer moved. A workspace's hard delete cascades its memberships: Dana, anchored in Globex with a membership in Acme, wrote her Acme mood before the column; the day Acme was deleted she held a level in Globex alone, and every Globex Admin, People team member and org-wide level read those Acme rows. The sentence "then it can only have been written there" (module header, SQL header, route header, this doc) was untrue.
- The older batch 5 test, "the person holds a level here" (`holdsALevelIn`), was an OR with a membership sublink inside a relation filter that sits under the where's top OR, so Postgres plans it as one uncorrelated subplan over `User`, which it may run as a scan of every workspace's people. It was not narrowed by userId on the Admin, People team and org-wide branch.

**Decision: decide each older row once, at deploy, and read every row by its own column.** Others read a row only where `organizationId` is this workspace; a row still null is read only by its person, wherever they work. No read asks anything about the person.
- Worst case of this: a person who worked in two workspaces before the column keeps older check-ins only they read; no screen shows check-ins. Worst case of deciding on each read: a deletion widens who reads health-grade notes, as above.
- Why the "holds a level here" test can go too, not only be narrowed: a row written here is of someone who holds a level here, and stays so. POST writes the session's workspace and a session acts only where its person holds a level (`auth.ts` sends a token with no membership left home); no route deletes a membership (checked: no `organizationMembership.delete` or `deleteMany` and no raw delete in `src` or `scripts`); a move between workspaces keeps the one left as a membership (`workspace-anchor.ts`); a workspace's hard delete or an account's erasure deletes the rows with it (both foreign keys cascade); a removed account (`deletedAt`) is still anchored, as before. So the list and the one-person read (`mayReadCheckInsOf`, one indexed read by id, unchanged) agree on every row there can be. If a route ever deletes a membership, a former member's check-ins written here stay readable by this workspace's people-data readers while `?userId=` answers 404; the tests name this invariant (`canExist`).
- Every branch of `readableCheckInsWhere` now starts from an indexed CheckIn column: `userId` (`CheckIn_userId_idx`) for the viewer's own and their chain, `organizationId` with `createdAt` (`CheckIn_organizationId_createdAt_idx`) for everyone's here. None reads `User` or `OrganizationMembership`.
- The digest's two check-in reads go through the same where, so they are the same (item 2's test holds both).

**Null rows written in a deleted workspace.** After the backfill, any row still null is only ever its person's: no workspace's Admins, People team, org-wide levels or managers read it, whatever is deleted later. Such a row outlives the workspace it was written in (no key names it); it goes with the person's account, or by hand on request.

**What changed.**
- `src/lib/check-in-access.server.ts`: `holdsALevelIn`, `holdsALevelOnlyIn`, `checkInsOfWorkspace` and `othersHere` removed; `readableCheckInsWhere` reads `organizationId` alone for others; the header (SETTLED ONCE; A ROW WRITTEN HERE IS OF SOMEONE WHO HOLDS A LEVEL HERE) replaces the untrue sentence. `src/app/api/check-ins/route.ts` and `src/app/api/ai/digest/route.ts`: their headers.
- `prisma/schema.prisma`: the column's comment names both files and says a null row is its person's.

### SQL: `prisma/sql/2026-10-12-check-in-backfill.sql` (new)

`2026-10-12-check-in-workspace.sql` is live and unchanged. The new file is listed last in `SQL_MANIFEST` (a text edit, after the column's file) and named in the schema comment. One DO block:

```sql
IF COALESCE(col_description('"CheckIn"'::regclass,
     (SELECT attnum FROM pg_attribute WHERE attrelid = '"CheckIn"'::regclass AND attname = 'organizationId' AND NOT attisdropped)), '')
   NOT LIKE '%check-in-backfill-2026-10-12%' THEN
  UPDATE "CheckIn" c
     SET "organizationId" = one."organizationId"
    FROM (SELECT ci."id", u."organizationId"
            FROM "CheckIn" ci
            JOIN "User" u ON u."id" = ci."userId"
            JOIN "Organization" o ON o."id" = u."organizationId"
           WHERE ci."organizationId" IS NULL
             AND ci."createdAt" >= o."createdAt"
             AND NOT EXISTS (SELECT 1 FROM "OrganizationMembership" m
                              WHERE m."userId" = u."id" AND m."organizationId" <> u."organizationId")
             FOR UPDATE OF ci SKIP LOCKED
             FOR KEY SHARE OF o SKIP LOCKED) one
   WHERE c."id" = one."id";
  COMMENT ON COLUMN "CheckIn"."organizationId" IS '... check-in-backfill-2026-10-12';
END IF;
```

- **The predicate** is the decided one: anchored there, and no membership in any other workspace (a membership row in the anchor itself, which every account from before 2026-05-16 has, is still one workspace). Removed and deactivated accounts are included, as every read before counted them. I added one sure narrowing: a row older than the workspace it would go to stays null, since it cannot have been written there.
- **Once, by a marker, not by "only null rows".** The lead's note said a second run changes nothing because it touches only null rows. That holds for the rows it changed, but not for the rows it left: a row of someone in two workspaces stays null, and a later deploy, after one of those workspaces was hard-deleted, would give it to the other, which is the widening this removes. So the marker is the column's comment, written in the same transaction as the UPDATE (the convention of `2026-10-05-membership-admin-scopes.sql`); a later deploy reads it from the catalogue and takes no lock on `CheckIn`.
- **Locks.** ROW EXCLUSIVE on `CheckIn` (reads and new check-ins go on), ROW SHARE on `Organization`, ACCESS SHARE on `User` and `OrganizationMembership`, then the COMMENT's SHARE UPDATE EXCLUSIVE on `CheckIn` (it waits only for an autovacuum, which Postgres cancels for it, a manual vacuum or analyze, or an index build; bounded by the 5 s `lock_timeout` and the deploy's four tries). It never waits on a row: the rows are chosen FOR UPDATE SKIP LOCKED, and each row's workspace FOR KEY SHARE SKIP LOCKED, the lock the foreign key check takes, which the hard delete's FOR UPDATE on its Organization row (held up to 30 minutes) would otherwise make it wait for. A skipped row stays null, which reads as its person's alone. Its own row locks block only a delete of those very rows (a cascade) until it commits; nothing in the app updates `CheckIn`.
- **Not batched, and why that is acceptable.** The null rows are a closed set: every check-in since the batch 6 build names its workspace (POST writes the session's, which is always set), and before it nothing in the app wrote `CheckIn` (POST by hand, no screen), so the set is what people posted by hand before 2026-10-12. Batching inside the file would shorten nothing: the deploy runs a file as one transaction, so every batch's locks last to the same commit. A bound per deploy would decide the rest on a later deploy, which the marker exists to prevent. Its WAL is one new row version per changed row plus an entry in each of `CheckIn`'s four indexes (the column is indexed, so no HOT update), written once.
- **Plan as I read it** against `prisma/schema.prisma`: the null rows by `CheckIn_organizationId_createdAt_idx` (a btree holds nulls) or a scan of the small table; `User_pkey` and `Organization_pkey` per row; the anti-join by `OrganizationMembership_userId_idx`; LockRows; the UPDATE by `CheckIn_pkey`.
- **The one case left:** someone whose second workspace was deleted before this file runs looks like someone who only ever worked in one, and their rows written in the deleted workspace after the remaining one existed are given to the remaining one. Nothing in the database tells them apart (WorkspaceDeletion keeps no person). It is the batch 6 rule's answer at that moment, frozen, and never widened after.
- Safe before or after the reload; it runs before it. Never run here: no SQL was executed, the text is held by a test.

## 2. The AI digest's Team Size

**What was true (confirmed).** `workspacePeopleLines(orgId, { activeOnly: true }).then(rows => rows.length)` moved every id of the workspace over the wire to count them, on every call, and counted outside guests as "Team Size".

**What changed** (`src/app/api/ai/digest/route.ts`, `teamHalves`): two indexed counts, each from an indexed column: live people anchored here who are not Guests (`User_organizationId_idx`; `orgRole` null, or not GUEST, written out because Prisma's `not` alone leaves nulls out), plus live members here anchored elsewhere (`OrganizationMembership_organizationId_idx`, then each person by id; the planner may hash-join `User` for a workspace with very many memberships, the same accepted caveat as `workspacePeopleLines`' second half). "New this week" counts the same two halves. A Guest is read as the Monday digests read one (`digest-recipients.ts` NEVER A GUEST, `effectiveOrgRole`): the stored GUEST of someone anchored here. Someone here through a membership holds the membership's level, which never maps to Guest, so they count (their own workspace's stored GUEST is not this one's).

## 3. create_task's card line

**What was true (confirmed).** A task Ask AI or a teammate makes for someone else lands on their Personal list (`getOrCreatePersonalBoard`: no Space, no Folder, PRIVATE), and its card said "It can start automations set up on this List.", which reads as none for a Personal list. `task.created` runs every "When a task is created" workflow whose scope is Everywhere (a missing scope reads as Everywhere) or names that list, whose creator and publisher can open it (`engine.ts`, `author-reach.ts`); a Space or Folder scope cannot match a list in neither. No other trigger runs on it: workflows are picked by `triggerEvent` equal to the event, ACTIVE only.

**What changed.** `teammate-copy.ts` `PREVIEW_LINES.taskCreatedAutomations`: 'It can start "When a task is created" automations set to run Everywhere or on that list.' (the trigger's phrase and the workflows page's Where label); `previews.ts` uses it for `create_task` only. `update_task` and `move_task` keep their line (below).

## 4. Webhooks

- **The claim holds only for an ACTIVE subscription** (`claimForSend`, `subscription: { status: "ACTIVE" }` in the same conditional write). A subscription paused between the retry run's read and the claim gets no send; a pause that lands after the claim can still let that one send out.
- **A 2xx is never counted as the receiver's failure** (THE ANSWER IS KEPT APART FROM ITS BOOKKEEPING). The DELIVERED write and the subscription's success write sat in the send's try, so a database blip after a 2xx went through `markFailed`: back to RETRYING with a backoff, the failure count up (ten blips paused a receiver that did nothing wrong), sent again. Now only `postOnce` can fail a delivery. After a 2xx each write is tried three times (200 and 400 ms apart, `written`); a DELIVERED write that never lands leaves the row as its claim left it (the first try's lease or the retry run's claim), so it goes once more when that passes, with the same id, counted against no one, and the retry run still counts it delivered. The subscription's success is written even when the delivery's write never landed. A failed `markFailed` after a failed send no longer throws out of the dispatcher or the retry run (it was the same lease case).

## 5. A Guest who works here through a membership (re-confirmed: nothing to change in the digest)

`digestManagersOf` already reads a member's level here from the membership and passes it to `effectiveOrgRole` with no stored column, exactly as `viewer.ts` `hydrate` reads that person for every page here, and skips GUEST (batch 6's test holds it, `away-gus`). A membership's `role` is an `AccessLevel`, and every level maps to Member or above, so the engine itself never reads anyone here through a membership as a Guest, and the digest agrees with it. The real gap is upstream (found, not fixed, below).

## 6. The batch 6 SQL's locks (a note; the file is live and unchanged)

**What happened.** `2026-10-12-check-in-workspace.sql` has three DO blocks, and the deploy runs a file (with its `SET lock_timeout`) as one transaction. So the ADD COLUMN's ACCESS EXCLUSIVE lock on `CheckIn` was held to the commit: while the foreign key waited (up to 5 s a try) for SHARE ROW EXCLUSIVE on `Organization` and then scanned `CheckIn` to validate, and while the plain CREATE INDEX read the table. From the key to the commit, every insert, update and delete of `Organization` (a settings save, a signup) waited too. `CheckIn` is tiny and every row was null, so it was milliseconds.

**How a future file should do it, on a table that is not small:**
- The column alone in its own file (a nullable column with no default is catalogue only, so its ACCESS EXCLUSIVE lock is brief and nothing else is waited on while it is held), as Phase 4 split its columns.
- The foreign key added `NOT VALID` (no scan, a brief lock on both tables), then `ALTER TABLE ... VALIDATE CONSTRAINT` in a later file: it takes SHARE UPDATE EXCLUSIVE on the table and ROW SHARE on the referenced one, so reads and writes go on while it scans.
- The index built `CREATE INDEX CONCURRENTLY` by hand before the deploy: it cannot run inside a transaction, so never through `deploy-migrations.mjs`. The file then guards on `pg_indexes` and on `pg_index.indisvalid`, so a deploy finds it there, and a failed concurrent build (an invalid index) is dropped and built again by hand, never skipped as present.

## Tests

Fail on the old code / new or edited, run against 749b7435 in a scratch copy (below): 23 new or edited tests in 5 files; 19 fail on the old code. The 4 that pass on both pin answers that did not change, named here.

- `src/lib/check-in-access.test.ts`: 5 new, 10 edited, 1 removed (the two helpers' shapes). 11 fail. The nine viewer shapes are held to the settled rule over every row there can be (`canExist`), and a new person, Lea (her other workspace deleted); 5 fail (a manager, a dotted-line manager, an Admin, the People team, an org-wide level), 4 pass on both (a colleague, a Guest, a manager of people who work in two workspaces, an Agent: none of them read a null row before either). New: no read asks about the person (no `user` key, no membership); the review's hard-delete scenario for a Globex Admin, People team member and VP; the SQL file's predicate, its marker in the same block, SKIP LOCKED and its place last in the manifest (read as text). Edited: a row still naming no workspace is its person's.
- `src/app/api/check-ins/route.test.ts`: 2 edited, both fail (Lea's older row for Globex's Admin; a row still naming no workspace, by list and by `?userId=`, read only by its person). Fixture: another company's person's row is written in their own workspace, since no session writes a row where its person holds no level.
- `src/app/api/ai/digest/route.test.ts`: 1 new, 1 edited, both fail (the check-in reads carry no `user` or membership filter, for an Admin, a manager and a colleague; Team Size leaves out a stored Guest here, counts a member whose own workspace calls them a Guest and a null role, loads nobody).
- `src/lib/agents/previews.test.ts`: 1 edited, fails (the line, and that it names the catalogue's `task.created` phrase).
- `src/services/webhookDispatcher.signing.test.ts`: 3 new, all fail (a subscription paused since the read gets no send; a first try's DELIVERED write tried again after a 2xx with the receiver never marked failed; a retry whose DELIVERED write never lands left to its claim, counted against no one, still counted delivered). Its double gained a paused set and failing writes; every earlier test runs unchanged.

## Verification

- `npx vitest run` over every test of the folders touched and every test that names a changed module (`src/lib/agents`, `src/lib/automation`, `src/services`, the check-ins, ai, cron, webhooks, agents, conversations teammates, sidekick, v1, integrations and email API tests, `digest-recipients`, and the tests that read `deploy-migrations.mjs` or `prisma/sql` as text): 110 files, 2,241 tests, all pass with the other builder's work in place.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 8 changed source, schema and script files put back from 749b7435 and checked byte for byte, and the new SQL file removed. The 5 test files all load: 19 of 81 tests fail, the 19 above.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run once: exit 2, two errors, both in the other builder's in-progress test fixtures (`users/[id]/handover/route.test.ts` and `scim-deprovision.test.ts` lack `reportsAlsoElsewhere`); none in a file changed here.
- **eslint** on the 12 changed source, script and test files: no problems.
- `node --check scripts/deploy-migrations.mjs`: ok. `npx prisma validate`: valid.

## Found, not fixed

- **A Guest's standing does not travel with a move.** `reanchorUser` writes the level and scopes and leaves `User.orgRole` on the account, and a membership's role has no Guest value. So a Guest anchored in Globex who switches home keeps GUEST at home (narrower than they are), and in Globex now works through a membership read as a Member (wider). Needs an org role on the membership (SQL) and the engine to read it; in `workspace-anchor.ts` and `viewer.ts`, not here.
- **`update_task` and `move_task` cards** still say "It can start automations set up on this List.", while Everywhere, Space and Folder automations can run on those tasks too.
- **The backfill's one case left** (section 1): a person whose second workspace was deleted before the file ran.
- **A null row outlives the workspace it was written in**: only its person reads it.
- **A pause that lands after a retry's claim** still lets that one send out.
- **A `markFailed` that half lands** (the delivery marked, the failure count not raised) is not tried again.

# Batch 7: handovers move every report, other workspaces' lines are visible

Worktree `theywrk-agents`, on top of 749b7435. Nothing here is committed. No SQL file; three new raw statements in code (listed under "Raw SQL"). The items come from the batch 6 review's entry on `handover.server.ts`, `users/[id]/route.ts`, `manager-candidate.ts`, `acting-workspace.ts`, dotted lines and SCIM: its two findings and its seven lows. Another builder works in the same worktree on check-ins, the AI digest, `webhookDispatcher.ts`, `previews.ts` and `prisma/sql`; none of those files were touched here.

## 1. A handover moves every report

**What was true (confirmed).** Batch 6 left a report whose line another workspace relied on (`stays`) under the leaver. A handover's leaver is always deactivated or removed next (the transfer dialog, the Remove dialog, SCIM, which deactivates before the handover runs), and `status` and `deletedAt` are one column each, so the leaver was gone from that other workspace too. In both workspaces `effectiveManagersOf` still answered the leaver, so the report's open reviews, timesheet approvals and weekly reviews stayed with an account nobody could sign in to, `writesUnclaimed` was false, and `followReportingLine` skipped them. The other workspace had no record of anything. The Remove toast, the transfer dialog and the logs said "left as it is" / "stays listed under them", untrue once the removal landed, and the PATCH gate comment ("a deactivated person is never left holding a report") no longer held.

**Decision.** A handover moves every report who works here, as before batch 6. `stays` is kept only where its leaver stays a live manager in the other workspace: the Agent move, and (new, item 3e) SCIM ending a membership here. Worst case of moving: the other workspace's line changes, with a record there (below). Worst case of leaving: reports in both workspaces under a deactivated account, with no record there.

**What changed.**
- `src/lib/people/handover.server.ts`:
  - `runHandover`, `reportPlanFor`, `previewReportHandover`, `handoverReportCount` and `pendingHandover` move and count every report (`handoverLinesFor(..., keepRelied)`; only `agentPlanFor` and `leavesOnlyHere` pass true).
  - The other workspace's record (`otherWorkspaceRows`): for each moved report whose line another workspace relied on (`lineStandingsElsewhere(..., { leaving: true })`, so a leaver SCIM already deactivated still counts), one `reporting_line_changed` row in that workspace, in the same LINES `createMany`, so it commits with the move. `actorId` null, `actorType` "system", `actorLabel` "Another workspace". It never names this workspace, and names the new manager only where they hold a level there: "Moved Ida Ray from Leo Leaver to Rae Recipient, in a handover in another workspace they work in", "... to someone in another workspace, in a handover there", "... to no manager, in a handover in another workspace they work in".
  - `HandoverResult.reportsAlsoElsewhere` (and in `HandoverWorkFailed`'s lines); `reportsStaying` stays, empty except for `leavesOnlyHere`; the preview answers `alsoElsewhere` instead of `stays`.
- Every sentence that said the line was left (`src/lib/people/reporting-lines.ts` `linesAlsoElsewhereNote`, new):
  - The transfer dialog (`members-shared.tsx`), before: "Ida Ray also reports to Leo Leaver in another workspace. Leo Leaver's account ends there too, so that line moves with the rest, and that workspace's Audit log records it." After, in the done message, and in the Directory's Remove toast (`remove-person-dialog.tsx`): "Ida Ray also reported to Leo Leaver in another workspace. That line moved too, and that workspace's Audit log records it."
  - The `user_handover` row (`handover/route.ts`) and SCIM's deactivation row (`scim-deprovision.ts`): "1 of their reports also reported to them in another workspace, whose Audit log records the move".
  - `linesStayNote` is now said only by the Agent move (the Members drawer), where it is true.
  - The PATCH gate comment (`users/[id]/route.ts`) says what holds: every report who works here is counted and moved; a report who works only in another workspace is that workspace's line.

## 2. The person record says when a line is another workspace's

**What was true (PLAUSIBLE, confirmed in the code).** Batch 6's `namedHere` dropped a manager who holds no level here, so the record card and Edit details said "Reports to: Nobody". An Admin who picked someone wrote `User.managerId`, the one column the other workspace reads, believing the line empty. The same for dotted lines: a dotted manager who is an Agent here and a manager there was listed, the dialog let it be taken off, and the PUT kept it while answering 200 (the save tick was untrue, low 3c).

**Decision.** Say that a line is another workspace's, never whose. Replacing a Reports to another workspace relies on is asked first, then done when the person confirms. Worst case of asking: one more click for an Admin who means it. Worst case of not asking: another workspace's live line rewritten by someone who believed it was empty.

**What changed.**
- `src/lib/access/manager-lines.ts`: `managerLineIsOthers` (the stored manager holds no level here and `linesElsewhere` says "relied") and `recordLinesOfOthers` (that, plus the dotted lines `othersDottedLines`' rule keeps, in one pass; the rule is now one private function both use).
- `src/lib/people/named-here.ts`: `namedHere(card, here, others)` answers `managerElsewhere` (only for a manager it does not name) and leaves the kept dotted lines out of `dottedManagers`, as the dotted-lines GET does, counting them in `dottedElsewhere`. `dottedElsewhereWords`: "1 line kept for another workspace".
- GET `/api/users/[id]` answers `managerElsewhere` and `dottedElsewhere`.
- PATCH `/api/users/[id]`: changing or clearing a Reports to `managerLineIsOthers` answers 409 `manager_elsewhere`, `confirmWith: "replaceOtherWorkspaceLine"`, "Max Chen reports to someone in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too." A body with `replaceOtherWorkspaceLine: true` goes through; the flag is taken out before the field whitelist and writes nothing. The same manager sent again is no change.
- `person-record.tsx`: "Reports to: Someone in another workspace"; the dotted row shows the kept count.
- `edit-details-dialog.tsx`: the Reports to placeholder says "Someone in another workspace"; a 409 `manager_elsewhere` shows the sentence under the field with "Change it anyway" (resends with the flag) and "Keep it"; the line stays meanwhile. Under the dotted picker: "1 line kept for another workspace they work in, left as it is.", updated from the PUT's answer.
- The Members drawer (`member-drawer.tsx` `refusedSave`): the row says the sentence and "Retry to change it anyway.", and its Retry resends with the flag. Every other refusal reads as before.
- The org chart's edit mode shows the 409 sentence as the row's error, with no confirm (found, not fixed).

## 3. The lows

- **3a. `staleLinesOf` asks whose line it is first** (`manager-candidate.ts`). For a manager who holds no level here, `linesElsewhere` decides before anything about them: kept when another workspace reads it, else "elsewhere", with `name` null. Removed, deactivated and Agent are asked only of someone who holds a level here. The words never name them: "Max Chen has been restored with no manager, because the manager on their record doesn't work in this workspace.", and for a dotted line "Restored Max Chen without a dotted line to someone who doesn't work in this workspace". `staleLineWords` also says "their manager", not "Their manager", mid sentence.
- **3b. `linesElsewhere` answers nothing for a manager no workspace treats as one** (`acting-workspace.ts`): a removed or deactivated account, or a Guest there (anchored there with GUEST stored, read as `effectiveOrgRole` reads it). A Guest in one workspace who manages in another is answered by the other. `lineStandingsElsewhere` (new) answers the same with the workspaces that rely on each line (`reliedIn`), and `{ leaving: true }` for the handover's record. So the Agent move now moves a report off a deactivated Agent, and a dotted line to a deactivated person who holds no level here is this workspace's to clear.
- **3c. The dotted-lines PUT and GET answer `keptElsewhere`** (a count), and the PUT's `managerIds` are the lines this workspace manages. With item 2 the dialog no longer offers to take a kept line off.
- **3d. The unclaimed review's write** (`manager-review/route.ts`) writes the status only on a submit (MANAGER_REVIEW). A draft save wrote back the first read's status, so a self review submitted in between went back to PENDING, on both the conditioned and the unconditioned path.
- **3e. SCIM finds someone who works here through a membership, for deprovisioning only.** Worst case decided: the identity provider can never deprovision a fired person here. Their status is one column every workspace reads, so deactivating them would switch them off in their own company too; this ends their membership here instead.
  - GET `/Users?filter=userName eq` (and `externalId`) finds an account anchored elsewhere with a membership here (two reads by `User_email_organizationId_key`). The unfiltered list stays the people anchored here.
  - `[id]` GET reads them; PUT and PATCH with `active: false`, and DELETE, call `scimDeprovisionMember` and answer them inactive; every other field is answered as stored and never written.
  - `scim-deprovision.ts` `scimDeprovisionMember`: under the role lock, the same last-Owner refusal and no-recipient 409; the membership deleted, `tokenVersion` bumped (their sessions end on the next check; a new sign-in acts where they still belong), and the pending row (`metadata.member`) in one transaction; then `runHandover(..., leavesOnlyHere: true)`: a report whose line they still have in another workspace stays, and that report's open reviews here go to the recipient. An Owner here keeps their work, as the anchored Owner path does. The audit row: "Your identity provider removed Max Chen from this workspace. ..."
  - A retried deprovision after the membership ended still finds them (`formerMemberDeprovision`: the latest identity-provider row about them is a member one), finishing a pending handover or answering a harmless success; anything else is 404.
- **3f. A PATCH is one outcome** (`users/[id]/route.ts`). Every refusal inside the role-locked transaction is thrown (`PatchRefused`) and mapped after it, so it rolls back what the transaction wrote before it. A reactivation that took off stale dotted lines and then met a refused role change committed the deletions while the person stayed deactivated.
- **3g. WORK locks the containers in the delete's order** (`handover.server.ts`): Folders, then Spaces, then Lists, each `ORDER BY id FOR UPDATE`, then each `updateMany` writes only the locked ids still owned by the leaver. The order a Space delete takes them (`trash.ts`: a Space's Folders, the Space, its Lists, then tasks), so the two never wait on each other in a cycle.

### Raw SQL added (every statement; EXPLAIN as I read it against `prisma/schema.prisma`)

In WORK's transaction, before any container is written (`$1` the workspace id, `$2` the leaver's id):

```sql
SELECT id FROM "Folder" WHERE "organizationId" = $1 AND "ownerId" = $2 ORDER BY id FOR UPDATE
SELECT id FROM "Space"  WHERE "organizationId" = $1 AND "ownerId" = $2 ORDER BY id FOR UPDATE
SELECT id FROM "Board"  WHERE "organizationId" = $1 AND "ownerId" = $2 ORDER BY id FOR UPDATE
```

No index names `ownerId`. Folder: Index Scan on `Folder_organizationId_archivedAt_idx` (leading column), Filter on `ownerId`, Sort by id, LockRows. Space: `Space_organizationId_idx`. Board: `Board_organizationId_archivedAt_idx` (or `Board_organizationId_productSlug_idx`). The same rows the three `updateMany` calls already read by the same filters, one workspace each, now locked in id order. No other statement was added; every other read uses Prisma's own queries by primary or unique keys.

## Tests

Fail on the old code / total, run against 749b7435 in a scratch copy (below). 52 tests are new or edited in 15 files (1 new file); 48 fail on the old code. The 4 that pass on both pin behaviour that did not change, named here.

- `src/lib/people/handover.server.test.ts`: 7 new and 2 edited, all 9 fail. Every report moved and the gate counts them; the other workspace's row (its fields, never naming a stranger there, written in LINES); the new manager named there when they work there, and the row written for a leaver SCIM already deactivated; no manager there, and no row for a line it did not rely on; `leavesOnlyHere` keeps a relied line and its reviews go to the recipient; the container locks in order, by locked ids; nothing written for a kind with nothing locked. Edited: the preview's `alsoElsewhere`, the batch 4 WORK order (now the three locks first). Removed: batch 6's "the handover leaves a report" test. Its double tells raw statements apart by table.
- `src/app/api/users/[id]/route.test.ts`: 6 new and 2 edited, 7 fail. The record's `managerElsewhere` and `dottedElsewhere`; PATCH's 409 (change and clear); the confirmation and that it is no field; one outcome (a refused role change rolls back the dotted deletion). Edited: the two batch 6 sentences, now unnamed. Pins: no question when no other workspace relies on the line, or the manager works here, or the same manager is sent again. Its transaction double now rolls back on a throw.
- `src/lib/scim-deprovision.test.ts`: 6 new (1 replaces batch 6's stays test), all fail. `src/app/api/scim/v2/Users/[id]/member.route.test.ts` (new): 5 of 6; pins: someone anchored here takes the anchored path. `src/app/api/scim/v2/Users/route.test.ts`: 3 new, 2 fail; pins: the unfiltered list stays the people anchored here.
- `src/lib/access/acting-workspace.test.ts`: 3 new, all fail. `src/lib/people/person-access-anchor.test.ts`: 2 new and 1 edited, all fail (one batch 6 test replaced). `src/lib/people/named-here.test.ts`: 2 new and 1 edited, all fail.
- `src/app/api/users/[id]/dotted-lines/route.test.ts`: 2 new, both fail. `src/app/api/reviews/[id]/review-writer.route.test.ts`: 1 new, fails. `src/lib/people/reporting-lines.test.ts`: 1 new, fails.
- `src/app/(dashboard)/settings/members/member-drawer-retry.test.ts`: 2 new, both fail (the second, "leaves every other refusal as it was", fails on the old code only because `refusedSave` is new).
- `src/app/api/users/[id]/handover/route.test.ts`: 1 new (replaces batch 6's stays test), fails; 1 edited (the partial answer's shape gained `reportsAlsoElsewhere`; passes on both). Its `runHandover` answers gained `reportsAlsoElsewhere` (fixtures).
- Contract tests, wiring edited: `agent-manager-reads.contract.test.ts` 2 (the dotted PUT's transaction answer, runHandover's plan call, PATCH's catch), `agent-tier.contract.test.ts` 1 (the drawer's error line); all 3 fail on the old code.

## Verification

- `npx vitest run` over every test in the touched folders (`src/lib/access`, `src/lib/people`, `src/app/api/users`, `src/app/api/scim`, `src/app/api/reviews`, `src/components/people`, `src/app/(dashboard)/settings/members`) and every test that imports or mocks a changed module: 108 files, 1,804 tests, all pass, with the other builder's work in place.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 18 changed source files put back from 749b7435 and checked byte for byte. The 15 new or edited test files all load: 48 of 250 tests fail.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run twice: exit 0 both times (the second after the Members drawer change).
- **eslint** on the 18 changed source files and the 15 test files: no problems. One error my own test had (an `accessLevel` key in a PATCH body, the G7 rule) was fixed by sending `orgRole` and `memberTier`.

## Found, not fixed

- **The bulk change of manager and the CSV import** (`people/bulk-update`, `people/bulk-import`) write Reports to without asking about a line another workspace relies on. Only PATCH asks.
- **The Members list names the stored manager whatever workspace they are in** (`members-list.server.ts`), so the drawer's Reports to shows the other workspace's manager by name; the org chart shows "Nobody" for one and answers its PATCH with the 409 sentence and no confirm (the record and the drawer confirm).
- **In the other workspace, a report moved to someone who holds no level there** is read as having no manager, and their open reviews there stay stamped to the leaver: `followReportingLine` runs for this workspace only (run there, it would hand them to this workspace's actor).
- **SCIM for a member here:** `unattendedRecipient` reads the person anchored here only, so their work goes to the first Owner, never their manager here; an Owner through a membership keeps their Spaces, Folders, Lists and tasks here, and with their membership gone no transfer dialog reaches them; once deprovisioned, a POST for the same address makes a second account (as before batch 6), since they no longer work here.
- **Dotted lines to a deactivated person who holds no level here** are now cleared by a restore, a reactivation or the next PUT here (3b), though their own workspace keeps dotted lines to its deactivated people.

# Batch 8: check-ins follow the membership, and erasure

Worktree `theywrk-agents`, on top of 8e3f75af (being deployed). Nothing here is committed. Two SQL files, both new; `2026-10-12-check-in-backfill.sql` is unchanged and a test now holds its hash, since it may already have run in production and its marker means it never runs again. The items come from the batch 7 review's entry on `check-in-access.server.ts`, the backfill SQL, `check-ins/route.ts` and `webhookDispatcher.ts`: its two findings and its three lows. Another builder works in the same worktree on the handover, PATCH and DELETE `/api/users/[id]`, `manager-lines.ts` and the handover's locks, and a spec writer on `docs/plans/ai-teammates-phase5.md`; none of their files were touched here but five lines of `scim-deprovision.ts` (item 1).

Batch 7's sentences that were untrue, corrected in the code and here: "no route deletes a membership" (SCIM's member deprovisioning does), "a workspace's hard delete or an account's erasure deletes the rows with it" (only the hard delete, or a real User row delete, cascades; the erasure anonymises the row), and "it goes with the person's account" for a null row (it did not; it does now, item 3).

## 1. A check-in follows its person's membership

**What was true (confirmed).** Batch 7 dropped the "holds a level here" test on four claims, and at 8e3f75af one was false: `scimDeprovisionMember` deletes a membership (`scim-deprovision.ts` `deprovisionMember`). Vic, anchored in Partner, wrote Acme check-ins, stored with `organizationId` acme. Once Acme's identity provider ended his membership, every Acme Owner, Admin, People team member and org-wide level still listed his mood, what went well, challenges and plans in GET `/api/check-ins`, and the AI digest counted them, while `?userId=vic` answered 404. POST also trusted the session's workspace, which a token keeps for up to 5 minutes after its person left (`auth.ts` REVALIDATE_MS), so a just-removed member could still write a row there.

**The sweep of every way a person leaves a workspace.**
- The one delete of a membership in `src` and `scripts` is SCIM's (no other `organizationMembership.delete` or `deleteMany`, no raw `DELETE FROM "OrganizationMembership"`). Fixed below.
- A workspace's hard delete: its rows go by the foreign key on `CheckIn.organizationId`, and `moveHomesOutOf` moves its people elsewhere first. Nothing to do.
- A move (switcher, sign-in fallback, an existing account's invitation, the hard delete's move): `reanchorUser` keeps the workspace left as a membership. Nothing to do.
- DELETE `/api/users/[id]`: acts only on someone anchored here and sets `deletedAt`, so they stay anchored and their rows stay this workspace's, as before. A removed account can no longer write one (below).
- An account's erasure: item 3.

**Decision.** In the same transaction as the end, the person's check-ins of that workspace become theirs alone (`organizationId` null), and a check-in is written only while its person holds a level in the session's workspace. Worst case of nulling: a workspace no longer reads a former member's check-ins, which no screen shows, and which the one-person read already refused. Worst case of keeping: a former member's health-grade notes read there for good.

**What changed.**
- `src/lib/scim-deprovision.ts` (`deprovisionMember`): five lines right after `tx.organizationMembership.delete`, before the `tokenVersion` write: a four-line comment and `await tx.checkIn.updateMany({ where: { userId, organizationId }, data: { organizationId: null } })`. Nothing else in the file.
- `src/lib/check-in-access.server.ts`: `writeCheckIn` (THE WRITE), and the header's A ROW WRITTEN HERE paragraph rewritten as THE WRITE and THE LEAVING; any new code that deletes a membership must null that person's rows of that workspace in its transaction.
- POST `/api/check-ins` writes through `writeCheckIn`: 403 "You don't work in this workspace any more, so this check-in wasn't saved." for someone who holds no level in the session's workspace, a removed account (an erased one too) or a workspace that is gone; 503 "This workspace is busy for a moment, so your check-in wasn't saved. Try again." when a lock waits past 3 seconds. Nothing is written in either case.

**The write's locks, in one transaction** (`LOCKED_TX`, 10 seconds; every wait bounded by `LOCK_WAIT_MS` through a local `lock_timeout`):
1. The workspace's Organization row FOR KEY SHARE, the lock the row's own foreign key takes anyway. First, because a hard delete holds its Organization row FOR UPDATE before its cascade deletes the memberships: taken the other way round, a POST holding a membership and waiting on the Organization row, against a hard delete holding the row and waiting on that membership, is a cycle.
2. Their membership here FOR KEY SHARE, which SCIM's delete of it waits for. When the POST commits first, SCIM's null-out (a new statement after its delete, under READ COMMITTED) reads and nulls the new row; when the delete commits first, the POST finds no membership. SCIM takes the membership and then the account; the POST takes no lock on the account, so neither waits on the other in turn.
3. The account, read: anchored here or that membership, and no `deletedAt`.

What the first lock waits for: whoever holds the Organization row FOR UPDATE (the seat lock, the AI allowance's reservation, Access grants, a hard delete). The row's foreign key already waited on them since batch 6, with no bound; now a wait past 3 seconds answers the 503, never the transaction's 500.

Raw SQL added (EXPLAIN as I read it against `prisma/schema.prisma`):
```sql
SELECT set_config('lock_timeout', $1, true)
SELECT "id" FROM "Organization" WHERE "id" = $1 FOR KEY SHARE
SELECT "id" FROM "OrganizationMembership" WHERE "userId" = $1 AND "organizationId" = $2 FOR KEY SHARE
```
`$1` of the first is `'3000ms'`. The second: Index Scan on `Organization_pkey`, LockRows. The third: Index Scan on `OrganizationMembership_userId_organizationId_key`, LockRows. SCIM's null-out is Prisma's `updateMany` by `userId` and `organizationId` (`CheckIn_userId_idx`, or `CheckIn_organizationId_createdAt_idx`).

## 2. The backfill, narrowed

**What was true (PLAUSIBLE, confirmed in the code).** The backfill read "no membership but the anchor" as "only ever worked in one workspace". `workspace-anchor.ts` says moves made before `reanchorUser` kept no membership for the workspace left. Sam signed up in Acme after 2026-05-16 (no primary membership), accepted Globex's invitation as an existing account (a non-primary membership in Globex) and switched with the old switcher: anchored in Globex, his only membership Globex's, so his hand-posted Acme check-ins went to Globex for good. Its header's "the one case left" was not the only one.

**The exact predicate, from the schema and `workspace-anchor.ts`.** "Reached their anchor through a membership" is: a NON-PRIMARY membership row in that workspace.
- Every account from before 2026-05-16 has its home as its primary membership (`20260516130000_add_organization_membership`, for every live account).
- An account made since begins anchored with no membership at all (signup, a new account's invitation, SCIM).
- Every move needs a membership in the workspace moved to (the switcher lists memberships only; the sign-in fallback and `moveHomesOutOf` choose from them), and those are written non-primary (`organizations/create`, an existing account's invitation).
- `reanchorUser` writes the workspace left as primary only when the person has no primary yet, which is only ever their first home; an upsert of an existing row never changes `isPrimary`, and nothing else writes it.
- So a workspace with no membership row, or with the primary one, is where the account began, and the backfill's answer there stands.

**What changed: `prisma/sql/2026-10-12-check-in-backfill-narrow.sql` (new)**, listed last in `SQL_MANIFEST` (a text edit) and named in the schema comment. One DO block; it sets `organizationId` back to NULL, never to a workspace:
- (1) a row created before 2026-10-12T10:00:00Z naming a workspace in which its person holds a non-primary membership. Read by the row's workspace (the anchor at the backfill), never today's anchor, so a move since changes nothing. A row POST wrote before 10:00Z in a workspace reached through a membership becomes its person's alone too, which is safe.
- (2) any row naming a workspace its person holds no level in now (not anchored there, no membership there): the rows SCIM's end of a membership left readable while 8e3f75af served without item 1. A removed account is still anchored, so its rows stay.
- ONCE, BY ITS OWN MARKER, ONLY WHEN NOTHING IS LEFT. The marker is the column's comment, `check-in-backfill-narrow-2026-10-12`, and the new comment keeps the backfill's `check-in-backfill-2026-10-12`, so the backfill (run before it on every deploy, guarded on that text) never runs again. Rows are chosen FOR UPDATE SKIP LOCKED, as the backfill's are; but a skipped row would stay as wide as it is, so the comment is written only when a plain read after the UPDATE, with the same predicate, finds no row left. Otherwise the next deploy runs it again, which can only narrow.
- Locks: ROW EXCLUSIVE on `CheckIn`, ACCESS SHARE on `User` and `OrganizationMembership`, none on `Organization` (a null needs no key check), and the COMMENT's SHARE UPDATE EXCLUSIVE on `CheckIn`, under the deploy's 5 s `lock_timeout` and its retries.
- Plan as I read it: the rows naming a workspace by `CheckIn_organizationId_createdAt_idx` (or a scan of the small table); `User_pkey` per row; each EXISTS by `OrganizationMembership_userId_organizationId_key`; LockRows; the UPDATE by `CheckIn_pkey`. The read before the marker is the same without LockRows.

## 3. An account's erasure deletes the person's check-ins

**What was true (confirmed).** POST `/api/me/delete` anonymises the User row and never deletes it, so `CheckIn`'s foreign key cascades nothing, and neither the erasure nor its sweep touched `CheckIn`: an erased person's check-ins stayed, read by their workspace's people-data readers under "Deleted User", and the rows naming no workspace stayed for good.

**Decision.** Delete them: they are the person's own notes, not a record the workspace keeps (the AIQuery rows stay because they are the plan's count; nothing counts check-ins). Worst case of deleting: a workspace loses an erased person's moods, which no screen shows. Worst case of keeping: health-grade notes of a person who asked to be erased, readable for good.

**What changed.**
- `src/lib/agents/erasure-sweep.ts`: the part "checkins", FIRST in `ERASURE_PARTS`: one `deleteMany` by `userId` (`CheckIn_userId_idx`), of every workspace and those naming none. First, so the erasure's own pass deletes them the moment its transaction commits, whatever the size of the rest of the history (last, a heavy history kept them for days); the short transaction itself is unchanged. A check-in a session still signed in posts after the commit (POST refuses a removed account, but its read is not under the erasure's lock) is deleted by the last pass, two hours on. Header and `PART_RUNNERS`.
- `src/app/api/me/delete/route.ts` (header, "Things we DO erase") and `prisma/schema.prisma` (`AccountErasure.part`, `CheckIn.organizationId`): comments.
- **SQL: `prisma/sql/2026-10-12-check-in-erasure.sql` (new)**, listed after the backfill and before the narrowing. Two DO blocks:
  1. Once, by the table's comment (`check-in-erasure-2026-10-12`): the check-ins of every account already in the erased state, deleted. Finished erasures are never swept again, and one under way may be past the new first part in its last pass. The erased state is `erasedStateSql`, word for word (a test compares them), so an account an Admin restored, or removed after a restore, keeps its rows. Rows chosen FOR UPDATE SKIP LOCKED, the marker written only when a plain read after finds none left.
  2. The CHECK on `AccountErasure.part` gains 'checkins', dropped and added under its own name, guarded on its definition naming 'checkins', as the Phase 4 file did for 'browser'. That file's guard asks for 'browser', which the new list keeps, and round 6's adds its CHECK only when none of that name exists, so neither brings an old list back. It must run before the reload: the new build's erasure writes 'checkins' as its first part.
  - Locks: block 1, ROW EXCLUSIVE on `CheckIn`, ACCESS SHARE on `User` and `ConsentRecord`, the COMMENT's SHARE UPDATE EXCLUSIVE on `CheckIn`; block 2, last so it is held the shortest, ACCESS EXCLUSIVE on `AccountErasure` (one row per erasure ever) for its scan. Plan of block 1 as I read it: `CheckIn` with `User_pkey` per row, the newest erasure record by `ConsentRecord_erasure_userId_createdAt_idx`, LockRows, the DELETE by `CheckIn_pkey`.
  - Erasures made by the old build after this file runs and before the reload are swept by the new build's last pass, which starts from the first part.

## 4. The lows

- **GET `/api/check-ins` orders and limits in the database** (`readableCheckInsParts`, new; `readableCheckInsWhere` is their OR, so the digest counts as before). The parts share no row: for a viewer who reads everyone's here, their own rows naming no workspace (`{ userId, organizationId: null }`) and the workspace's (`{ organizationId }`, Index Scan Backward on `CheckIn_organizationId_createdAt_idx`, Limit 50); for anyone else, their own, and a manager's people's rows here. Each part is read newest first, `take: 50`, and the route keeps the newest 50 of them all (ties by id). An Admin's read is now at most 100 rows, never every check-in of the workspace.
- **Webhook bookkeeping that never lands is logged** (`webhookDispatcher.ts`): `written` logs on its last failed try ("[webhooks] delivery d1's 2xx was not recorded after 3 tries (PrismaClientKnownRequestError P2022); it goes again, with the same id, when its claim passes", and the subscription's success), and the four `markFailed` catches log "[webhooks] delivery d1: recording its failed send did not finish (...)". Only the error's name and Prisma code are said, never its message, which can quote what the write carried (a receiver's answer, a send's error, an address with a token in it), and the ids; never the URL, the payload or a secret.

## Tests

Fail on the old code / new or edited, run against 8e3f75af in a scratch copy (below): 25 tests new or edited in 6 files; 22 fail on the old code. The 3 that pass on both pin answers that did not change, named here.

- `src/lib/check-in-access.test.ts`: 5 new, 1 edited; 5 fail. The parts share no row and their OR is the where for every viewer shape, an Admin's being the workspace's column alone; the narrowing file (only ever NULL, both cases' predicate written out and asked twice, no Organization lock, SKIP LOCKED, the marker only after the plain read and keeping the backfill's); the manifest's last four. Pins: the backfill file's hash. PEOPLE gained Ved (his membership ended by SCIM), and `canExist` now says why a row of a workspace is always of someone with a level there; the nine shape tests pass on both.
- `src/app/api/check-ins/route.test.ts`: 4 new, all fail (a former member, a removed account and a gone workspace refused with nothing written; the locks in order in one transaction, bounded; 503 for each busy lock; an Admin's two reads, each ordered and limited, and the newest 50 of both). 1 edited, a pin: a session in the workspace the person is anchored in writes there (it used to sign Dana into a workspace where she held no level). Its double gained the write's transaction and ordered reads.
- `src/lib/scim-deprovision.test.ts`: 2 new, 1 fails (the null-out: that person, that workspace, in the transaction, after the delete and before the account write). Pin: nothing touched when no membership ends. Its transaction double gained `checkIn.updateMany`.
- `src/lib/agents/erasure-sweep.test.ts`: 4 new, all fail (every check-in of theirs deleted first, nobody else's; the erasure's own pass deletes them with time for one statement; one posted after is deleted by the last pass; the one-time delete's predicate is `erasedStateSql`'s words, SKIP LOCKED, its marker after the read, before the CHECK block). 5 edited, all fail on the old code only because the pass gained a first part: the CHECK's list read from the new file (the Phase 4 file's is the list without 'checkins', its guard still met), the start part `checkins` (recordErasure, settling twice), and two fake-clock deadlines one statement longer.
- `src/app/api/me/delete/route.test.ts`: 1 edited, fails on the old code (the row's first part).
- `src/services/webhookDispatcher.signing.test.ts`: 2 new, both fail (the 2xx and success lines by kind and code, no secret, address or payload; a failed mark logged on a first try and a retry, and nothing for a write that lands on its second try). Its double can throw a given error and fail every RETRYING mark.

## Verification

- `npx vitest run` over the 24 test files that name a changed module or read the manifest or `prisma/sql` (the six above, the AI digest, `run-due-agents`, `ingest`, the two SCIM `[id]` route files, `v1` KPI records and tasks, webhooks, the two access contract tests, `personal-activity`, `hues`, `tools-create-task`, the teammate automation registry, `browser/types`, `kudos-give`, `task-load-failure`, the webhook chain test): 330 tests, 324 pass. The 6 that fail are the other builder's work in progress: 4 in `scim-deprovision.test.ts` (its anchored-path tests: the mock has no `moveReliedReportsAtEnd`, which their change to `deprovision` calls) and 2 in `agent-manager-reads.contract.test.ts` (it reads `handover.server.ts` and `users/[id]/route.ts`). None touches a line changed here; all of mine pass.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 8 changed source, schema and script files put back from 8e3f75af and checked byte for byte, and the two new SQL files removed. The 6 test files all load: 22 of 117 tests fail, the 22 above.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run once: exit 2, four errors, all in the other builder's `src/lib/people/reporting-lines.test.ts`; none in a file changed here.
- **eslint** on the 12 changed source and test files: no problems.
- `node --check scripts/deploy-migrations.mjs`: ok. `npx prisma validate`: valid. No SQL was run.

## Found, not fixed

- **The narrowing's cutoff** (2026-10-12T10:00:00Z, as decided) is right only if the batch 6 build was live by then (749b7435 was committed at 09:08Z). Were it later, a row posted by hand between 10:00Z and that reload, by someone who reached their anchor through a membership, keeps the workspace the backfill gave it.
- **A SCIM end of a membership between the narrowing's run and the reload** (the old build still serving for the deploy's last minutes) leaves that person's rows of there readable; the file's marker means it never sees them.
- **A check-in posted after an erasure's commit** by a session still signed in lives until the erasure's last pass, two hours on.
- **The other builder's routes:** if PATCH or DELETE `/api/users/[id]` or the handover ever delete a membership, that transaction must null the person's check-ins of that workspace (THE LEAVING).
- **`?userId=` for someone else** still runs the viewer's own-rows part, an indexed read that finds nothing.

# Batch 8: relied lines move with the account's end

Worktree `theywrk-agents`, on top of 8e3f75af. Nothing here is committed. No SQL file; three raw statements in code changed their lock mode (below). The items come from the batch 7 review's entry on `handover.server.ts` and `manager-lines.ts`: its three findings and the lows where a person sees a wrong result or loses data. Another builder works in the same worktree on check-ins, the erasure sweep, SCIM's member deprovisioning rows, `webhookDispatcher.ts` and `prisma/sql`. In `scim-deprovision.ts` I changed only the anchored path (`deprovision`, `finishHandover`), and in its test only the handover mock and one new block; their member path and its tests are as they left them.

## 1. A line another workspace relies on moves with the step that ends the account

**What was true (confirmed).** Batch 7 made POST `/api/users/[id]/handover` move every report, a report whose line another workspace relied on included, and write that workspace's `reporting_line_changed` rows, all in LINES. Both dialogs run the handover first and the DELETE or the PATCH deactivation after it. Nothing checked that the account would really end, so the other workspace's live line was rewritten for an account that then stayed live, when DELETE answered "Only an Owner can remove an Owner", or refused the last Owner or the last Company Admin, or a demoted actor, or roles were busy, or the connection dropped, or WORK failed and the Admin cancelled, or the endpoint was called on its own. The dialog had said "Leo Leaver's account ends there too, so that line moves with the rest".

**Decision (the lead's).** The handover leaves those lines while the leaver's account is live; the step that ends the account moves them, in its own role-locked transaction, right before it writes status or deletedAt, with the other workspace's rows. Worst case: a direct PATCH or DELETE with no `handoverTo` sends them up the leaver's line instead of to the person the dialog picked; the answer and both Audit logs say where. The other way, another workspace's real line changes for nothing.

**What changed.**
- `src/lib/people/handover.server.ts`:
  - `runHandover` reads the leaver's status and deletedAt under the role lock (every deactivation and removal takes it). While the account is live, a report whose line another workspace relies on is kept (`reportsAtAccountEnd`, by name; no row there, and their reviews stay with their live manager). For an account already deactivated or removed, they move at once with that workspace's record, as batch 7 did. `leavesOnlyHere` (SCIM ending a membership) keeps them for good, as before.
  - `writeReportMoves` (new, private): the plan's writes and audit rows, shared by LINES and the new step.
  - `moveReliedReportsAtEnd(tx, ...)` (new): inside the caller's locked transaction, only the relied reports, to the recipient unless that is a loop, an Agent or a deactivated person (then up the leaver's line, else no manager), with "Moved Ida Ray from Leo Leaver to Rae Recipient as Leo Leaver was deactivated" here and "..., as Leo Leaver's account was ended in another workspace they work in" (or "to someone in another workspace, as Leo Leaver's account was ended there") in each workspace that relied on the line. `followAccountEndLines` moves their open reviews after the commit.
  - `handoverReportCount` (so `pendingHandover`, the `handover_first` gate before and under the lock) counts every report except those, so a deactivation is never held up by lines it moves itself.
- `src/app/api/users/[id]/route.ts`:
  - PATCH: `handoverTo` is taken out before the whitelist (it writes nothing on the person). The deactivation calls `moveReliedReportsAtEnd` after every refusal (Owner, last Owner, the role change) and right before `tx.user.update`; any later throw rolls it back. The answer carries `reportsAlsoElsewhere` and `reportsRehomed`; the log says "that line moved with the deactivation".
  - DELETE: the same step, after the Admin and Owner guards and right before `updateMany` of deletedAt, in a `LOCKED_TX` transaction. Found removed meanwhile, it throws `AlreadyRemoved`, so the moves roll back and the answer is the harmless success as before. `?handoverTo=` names the recipient.
- `src/lib/scim-deprovision.ts`: the anchored deactivation moves them in its own transaction (now `LOCKED_TX`), right before status is written, to the unattended recipient; an Owner's stay with them, as their work does. The `membership.changed` row counts them with the handover's.
- `src/app/api/users/[id]/handover/route.ts` `gateHandover` reads DELETE's own rule (`person-access.server.ts` `mayRemovePerson`, now also behind `accessFor`'s Remove): never self, Admins, and the manager tier over their solid chain, never on an Admin and never through a dotted line. POST reads the actor fresh (`freshWorkspaceActor`), as DELETE does. The `user_handover` row says "1 direct report also reports to them in another workspace, so that line moves only when their account ends".
- **Every sentence that says when the line moves:**
  - `reporting-lines.ts` `linesAlsoElsewhereNote(people, leaver, ends)`, before: "Ida Ray also reports to Leo Leaver in another workspace. That line moves only once Leo Leaver is deactivated (or removed), since that ends their account there too, and that workspace's Audit log records it." After: "... That line moved too, ...", now built from what the PATCH or DELETE answered.
  - The transfer dialog (`members-shared.tsx`) sends `handoverTo` with its PATCH or DELETE; if that step is refused, its error adds the "moves only once" sentence for the lines still waiting.
  - The Remove dialog (`remove-person-dialog.tsx`): the same, and its refused-removal error no longer says "reports moved" when none did, and adds the sentence.
  - The comments of `handover.server.ts`, the handover route, `users/[id]/route.ts` (header, the gate, the deactivation), `scim-deprovision.ts`, `reporting-lines.ts` (`planReportHandover`'s `stays`, `linesStayNote`) and both dialogs.

## 2. WORK's container locks are FOR NO KEY UPDATE

**What was true (confirmed).** Batch 7's `SELECT ... FOR UPDATE` on the leaver's Folders, Spaces and Lists took the one row lock that conflicts with the FOR KEY SHARE every foreign-key check takes. A task created in one of their Lists waited for the whole WORK run, and a task moved into one of their Lists, or a List moved into one of their Spaces, could deadlock with WORK (the mover holds the task or List and waits for the parent's key share; WORK holds the parent and waits for the task or List).

**What changed.** The three statements take `FOR NO KEY UPDATE`, still in id order. `ownerId` is in no unique index and has no foreign key on Folder, Space or Board (checked in `prisma/schema.prisma` and `prisma/sql`), so the `updateMany` that follows takes this same lock and nothing is upgraded.

**The Trash order still holds.** FOR NO KEY UPDATE conflicts with FOR UPDATE, which every Trash delete takes (`lockSpaceForDelete`: the Space's Folders in id order, the Space NOWAIT, the rest of its Folders NOWAIT; then its Lists and their tasks in id order; `lockFolderBranch` sorted; the List delete). So WORK and a delete still wait on each other only in the one order both take, Folders, then Spaces, then Lists, then tasks, each in id order, and a delete that would wait out of that order uses NOWAIT and retries. What no longer waits is only the key share, which takes no part in that order.

### Raw SQL changed (every statement; EXPLAIN as I read it against `prisma/schema.prisma`)

In WORK's transaction, before any container is written (`$1` the workspace id, `$2` the leaver's id); only the lock clause changed from batch 7:

```sql
SELECT id FROM "Folder" WHERE "organizationId" = $1 AND "ownerId" = $2 ORDER BY id FOR NO KEY UPDATE
SELECT id FROM "Space"  WHERE "organizationId" = $1 AND "ownerId" = $2 ORDER BY id FOR NO KEY UPDATE
SELECT id FROM "Board"  WHERE "organizationId" = $1 AND "ownerId" = $2 ORDER BY id FOR NO KEY UPDATE
```

The plans are batch 7's: Index Scan on `Folder_organizationId_archivedAt_idx`, `Space_organizationId_idx` and `Board_organizationId_archivedAt_idx` (or `Board_organizationId_productSlug_idx`), Filter on `ownerId`, Sort by id, LockRows. No statement was added.

## 3. PATCH asks about an Agent here who manages the person in another workspace

**What was true (PLAUSIBLE, confirmed in the code).** `managerLineIsOthers` and `recordLinesOfOthers.managerElsewhere` required the manager to hold no level here. Sam, an Agent here and Ida's Manager in workspace A, is named on her record; the Members drawer tells the Admin to move people off an Agent, and PATCH Reports to rewrote A's line with no question, while the Agent move and the dotted-lines rule (`dottedIsOthers`) kept it.

**What changed** (`src/lib/access/manager-lines.ts`): one private rule, `managerLineStanding`, for both: the line is another workspace's when `linesElsewhere` says "relied" and the manager holds no level here ("unnamed") or the Agent tier here ("agent"). `managerLineIsOthers` answers which (`OthersManagerLine | null`). PATCH's 409 `manager_elsewhere` names the Agent, a person of this workspace: "Ida Ray also reports to Sam Agent in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too." The unnamed sentence is as before. The record still names Sam (`named-here.ts` says "someone in another workspace" only for a manager it does not name).

## 4. The lows

- **Merged PATCH bodies** (`edit-details-dialog.tsx`, `record-write-queue.ts` `refusalIsAbout`, new and pure). The queue merges one person's PATCH bodies while one is in flight, so a job title and a Reports to rode one request, and the 409 `manager_elsewhere` also refused the job title, which was dropped under the Reports to sentence. A refusal that names its field (`field` or `fields`) and none of a waiter's keys is another field's: that waiter sends its own change again, alone, once.
- **A restore cleared a line another workspace still holds** (`manager-candidate.ts` `staleLinesOf`). For a manager with no level here, a deactivated manager in the person's other workspace now keeps the line (and a dotted line): an Owner the identity provider deactivated there keeps their reports on purpose until someone hands them over, and a restore or reactivation here cleared that line with nobody deciding. A removed manager is still "elsewhere". For a manager who holds a level here nothing changed (a deactivated one is relied on nowhere).
- **A direct DELETE had no handover gate.** DELETE now refuses with 409 `handover_first` (and `pending`) while open tasks, reports or Spaces, Folders and Lists remain, before the lock and again under it, as PATCH's deactivation does. The Remove dialog runs the handover for someone who owns only Spaces, Folders or Lists too (it skipped them, and their containers stayed with a removed account) and lists them in what they hold.
- **A handover after a removal wrote no other-workspace row** (`acting-workspace.ts`): `lineStandingsElsewhere`'s `leaving` now counts a removed leaver too.
- **Rows in another workspace during its hard delete:** `ActivityLog` has no foreign key to `Organization` (`prisma/schema.prisma`; no `prisma/sql` file adds one), so the insert never waits on that workspace's delete. Nothing to change.
- Not fixed, the SCIM member path the other builder has: its `tokenVersion` bump signs the person out of every workspace; the anchor read outside its transaction (a switch into this workspace meanwhile keeps their level here while the identity provider is told they are inactive); a suspended workspace answering the stored row to a member's non-deprovisioning PUT or PATCH; the check-ins invariant (theirs, above).

## Tests

Fail on the old code / total, run against 8e3f75af in a scratch copy (below). 37 tests are new or edited in 10 files (no new file); 29 fail on the old code. The 8 that pass on both pin behaviour that did not change, named here.

- `src/lib/people/handover.server.test.ts`: 6 new and 3 edited, 7 fail. A live leaver keeps the relied report (named, uncounted by the gate, no row there, its reviews unmoved); a removed leaver's handover moves it with the record; the three locks are FOR NO KEY UPDATE; `moveReliedReportsAtEnd` moves only the relied report, to the recipient, with both rows and their words; up the line with nobody or an Agent named, "was removed"; the new manager named there, a leaver deactivated already; nothing when no workspace relies on a line. Pins (2): batch 7's other-workspace record and its no-manager words, now for a leaver whose account has ended. Its double reads removed accounts.
- `src/app/api/users/[id]/route.test.ts`: 8 new and 1 edited, 5 fail. The deactivation moves them in its locked transaction before status is written, to `handoverTo`, answered and logged, and `handoverTo` is no field; a removal waits for the handover; a removal moves them before deletedAt, to `?handoverTo`; the 409 naming an Agent; a restore keeps lines to a manager deactivated in the other workspace. Pins (4): a refused or busy deactivation moves nothing; a refused removal moves nothing and one that finds them removed takes its moves back; no question when the Agent is an Agent there too; batch 7's removed dotted manager (edited from deactivated to removed, the case its title names). Its double gained the step, the gate's count and Owners.
- `src/app/api/users/[id]/handover/route.test.ts`: 3 new, all fail (DELETE's rule refuses, the fresh actor refuses, the log's words for the waiting line). Its `runHandover` answers gained `reportsAtAccountEnd` (fixtures).
- `src/lib/scim-deprovision.test.ts`: 2 new, 1 fails (the move inside the deactivation's transaction, before status, to the recipient, counted on the row). Pin: nothing moves for the last Owner or a busy lock. The 30th failure in the scratch run is the other builder's check-in test, which fails there only because their edit of this file went back to 8e3f75af with mine.
- `src/lib/access/agent-manager-reads.contract.test.ts`: 2 new and 2 edited, all fail (the step's place in PATCH, DELETE and SCIM; the dialogs' `handoverTo` and the three lock clauses; `runHandover`'s leaver read under the lock; DELETE's catch).
- `src/lib/access/manager-lines.test.ts`: 2 new, both fail. Its membership double reads `{ not }` and `{ in }`.
- `src/lib/people/person-access-anchor.test.ts`: 3 new and 1 edited, 3 fail (the deactivated manager there kept, `mayRemovePerson` twice). Pin: a manager deactivated here, and an Agent's dotted line, still cleared.
- `src/lib/people/record-write-queue.test.ts`: 2 new, both fail. `src/lib/access/acting-workspace.test.ts`: 1 new, fails. `src/lib/people/reporting-lines.test.ts`: 1 edited, fails.

## Verification

- `npx vitest run` over every test in the touched folders (`src/lib/people`, `src/lib/access`, `src/app/api/users`, `src/app/api/scim`, `src/components/people`, `src/app/(dashboard)/settings/members`) and every test that imports or mocks a changed module: 107 files, 1,826 tests, all pass, with the other builder's work in place.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the shared worktree never touched), with the 13 changed source files put back from 8e3f75af and checked byte for byte. The 10 new or edited test files all load: 30 of 239 tests fail, 29 of them mine (above).
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run twice: exit 0 both times.
- **eslint** on the 13 changed source files and the 10 test files: no problems (the first run found `accessLevel` literals in my new test, now `legacyLevelRow`).

## Found, not fixed

- **The dotted-lines PUT still takes off a dotted line to someone deactivated in the person's other workspace** who holds no level here (`othersDottedLines` reads `linesElsewhere`, which leaves deactivated managers out), while a restore now keeps it. Same column-per-person problem as batch 7's found list; changing it needs the manager's status in that read.
- **A relied report moved by a PATCH or DELETE with no `handoverTo`** (an old client, or a direct call) goes up the leaver's line, not to the person a handover before it picked. Both dialogs send it.
- **The member path's lows** (item 4, the other builder's file) and the anchored SCIM path deactivating, in every workspace, a person anchored here only because they last switched here (status is one column; it needs a per-workspace status).
- **The handover's own moves before a refused step:** this workspace's tasks, Spaces and the reports no other workspace relies on still move to the recipient before a DELETE or PATCH that is then refused for an Owner or the last Owner or Admin. They stay in this workspace, logged, and the dialog says so; the gate now refuses only what DELETE refuses for everyone (self, a manager on an Admin, a dotted-line manager, a demoted actor).

# Batch 9: the handover gate goes by the chain, and the last lows

Worktree `theywrk-agents`, on top of 9734270a (live). Nothing here is committed. No SQL file, and no raw statement added or changed. The items come from the batch 8 review (both entries): its one MEDIUM finding and its lows; two lows are left as notes (section 6). `docs/plans/ai-teammates-phase5.md` was not touched.

## 1. The handover gate goes by the solid chain

**What was true (confirmed).** `relationTo` answers "people-team" and "org-wide" before it asks the chain, for every non-Admin in the workspace, the viewer's own reports included. Batch 8 made the handover's gate (`gateHandover`) read DELETE's rule, `mayRemovePerson`, which passes any relation that writes for a manager-tier viewer. `ORG_WIDE_ALIGNMENT_LEVELS` (C_LEVEL, VP, DIRECTOR, HR) are all manager tier. So Dan, a Director, called GET `/api/users/mona/handover` on Mona, a VP in another tree, and read the titles of her open tasks, the Lists they sit in and her Spaces, Folders and Lists; then POST with `reassignToId` himself made him owner of all of them, private Spaces too, and manager of her reports, while her account stayed live. The People team at manager tier, the same. The route's header still gave the gate before batch 8 ("manager tier AND the target sits inside the caller's report tree"), which the code before batch 8 did not hold either (it passed any relation but none and self). A second door: DELETE's `?handoverTo=` and PATCH's `handoverTo` named who takes the relied reports, from anyone DELETE or PATCH status admits.

**Decision (the lead's).** The handover is decided on the solid chain itself: an Admin, or a manager-tier viewer whose `writeChain` holds the person, never on an Admin, never themselves. The org-wide levels and the People team keep Remove where DELETE already lets it land: DELETE refuses with `handover_first` while the person holds open tasks, reports or Spaces, so outside their tree they remove only someone who holds nothing. They never get the handover or its summary. Worst case of this: a Director removing a peer who holds work must ask an Admin or that peer's manager to hand it over first, and the 409 says so. Worst case of the old rule: anyone at Director level or in the People team quietly takes over a peer's private Spaces and work.

**What changed.**
- `src/lib/people/person-access.server.ts`: `mayHandOverPerson(ctx, subjectId, subject)` (new): `isAdmin`, or `managerTier && writeChain.has(subjectId) && !subjectIsAdmin`; never self, never a Guest. `mayHandOverPersonHere` (new) reads the person here by id for a non-Admin (an Admin is answered without the read, so the route's own 404 still says when the person is not here). `mayRemovePerson` is unchanged; its comment now says it is DELETE's rule only, and why the handover's is narrower. `mayRemovePersonHere` (its one caller was the handover) is gone.
- `src/app/api/users/[id]/handover/route.ts`: `gateHandover` asks `mayHandOverPersonHere` for GET (the summary and `?to=`) and POST; the header and the gate's comment say the real rule.
- `src/app/api/users/[id]/route.ts`: the record's `access.handover` (new, the narrower rule; `access.remove` is unchanged). PATCH's `handoverTo` and DELETE's `?handoverTo=` are read only when the actor may hand the person over; from anyone else the reports the step moves go up the person's line, as with no `handoverTo`. A 409 `handover_first` for an actor who may not hand over says "They still own open tasks, direct reports or Spaces, Folders and Lists, and only an Admin or a manager above them can hand those over. Ask one of them to, then try again." instead of "Hand over their work first". The header says both rules.
- `src/components/people/remove-person-dialog.tsx` and `person-record.tsx`: the dialog takes `canHandOver` (`access.handover`). Without it the dialog reads no summary (the handover would 403), shows no picker, says "Only an Admin or a manager above Leo can hand over their work. If they still hold open tasks, direct reports or Spaces, the removal waits until that is done.", and sends DELETE with no `handoverTo`.

## 2. Every report still listed moves with the account's end

**What was true (PLAUSIBLE, confirmed in the code).** PATCH's deactivation and DELETE call `handoverReportCount` (the gate) and then `moveReliedReportsAtEnd` in one READ COMMITTED transaction, each reading "relied" (`lineStandingsElsewhere`) itself, under this workspace's role lock only. Another workspace's SCIM can end the report's or the leaver's membership there in between: Ida was relied on at the gate, so not counted, and not relied on at the move, so she stayed under an account that then ended (invariant 13).

**What changed** (`src/lib/people/handover.server.ts` `moveReliedReportsAtEnd`): every report still listed under the leaver moves (`stays` empty). The gate has already refused, under the same lock, while any report it did not see as relied was left, so whoever is still listed is moved. Its one read of the standings now only decides the records: the other workspace's row, and `reportsAlsoElsewhere`, go to the lines relied on now. SCIM's anchored deactivation calls the same step with no gate before it, so there every report now moves with the deactivation, in its transaction, and the handover after it finds none left (its row still counts both, `finishHandover`). The function keeps its name, since every caller and contract test names it; its comment says what it does now.

## 3. The dialogs say what moved, and when a line moves

- **A refused removal** (`remove-person-dialog.tsx`; `reporting-lines.ts` `refusedRemovalWords`, new, pure). Batch 8 said "Their open work moved to Rae, but Leo is still here" after any handover, though Leo's one report whose line another workspace relies on moves nothing until the removal, and reports sent up the line went to someone else. Now from what the POST answered: "2 open tasks, 1 Space, Folder or List and 1 direct report moved to Rae, but Leo is still here: Only an Owner can remove an Owner. Kim Lo now reports to Dana Lee." When nothing moved, only "Leo is still here: Only an Owner can remove an Owner." and the waiting line's sentence. Reports that went only up the line say "Their direct report moved", never "moved to Rae". A line that moved at once (an account already ended) says so.
- **Someone already deactivated** (`previewReportHandover` answers `accountEnded`, read from the same two columns `runHandover` reads; `members-shared.tsx`; `linesAlsoElsewhereNote(..., "ended")`, new). The transfer dialog said "That line moves only once Leo Leaver is removed", while the handover moved it at once. Now: "Ida Ray also reports to Leo Leaver in another workspace. Leo Leaver's account has already ended there too, so that line moves with the handover, and that workspace's Audit log records it." A step refused after such a handover now says the line moved.

## 4. The whole gate under the lock

**What was true (confirmed; older).** PATCH's deactivation and DELETE counted open tasks and Spaces, Folders and Lists once, outside the lock (`pendingHandover`), and under it only the reports. A task assigned to the leaver, or a List given to them, in between stayed with the ended account. Batch 8's note ("before the lock and again under it" for all three) overstated it.

**What changed.** `pendingHandover(organizationId, id, db)` takes the caller's transaction; PATCH and DELETE read all three again under the role lock (`holdsWork`), with the same refusal. Under the lock that is the person's non-archived tasks' status by `Item_ownerId_idx` (as the first check reads them), three counts by the containers' `organizationId` indexes with `ownerId`, and the report count. All Prisma reads; no raw statement. What it cannot close is in Found, not fixed.

## 5. Check-ins: SCIM's retry, deadlocks, the lock comment, the member path's time, the erasure in batches, and a limit per post

- **SCIM's "gone" resume** (`scim-deprovision.ts` `deprovisionMember`). A retry from the identity provider that finds the membership already ended (by 8e3f75af, which did not null the rows) only finished the handover. Now, in the same transaction, under the role lock, when the account is not anchored here, it nulls their check-ins of this workspace (`checkIn.updateMany` by `userId` and `organizationId`), finished or pending. It only ever narrows, and twice changes nothing.
- **The member path's transaction** has `LOCKED_TX` (10 s), as the anchored path: the role lock's bounded wait, the membership delete's wait on a check-in POST's key share and two writes did not always fit Prisma's 5 s, whose timeout answered 500.
- **A deadlock in `writeCheckIn`** (40P01, or Prisma's P2034) answers the same 503 as a busy lock (`org-roles-busy.ts` `isDeadlock`, new, pure, read through `cause` as `isLockTimeout` is). It answered 500.
- **`writeCheckIn`'s comment** said the write takes no lock on the account. The insert's foreign key takes FOR KEY SHARE on the User row; a key update of it (email or organizationId, which a unique index holds: the erasure's email write, a move, `reanchorUser` in a hard delete) makes it wait, up to `LOCK_WAIT_MS`, then busy; SCIM's `tokenVersion` write is a NO KEY UPDATE and never conflicts. The conclusion (no cycle with SCIM) was right; the sentence is fixed.
- **The erasure's "checkins" part** (`erasure-sweep.ts` `deleteCheckIns`, new): `ERASURE_BATCH` at a time, the deadline asked before each batch. Each batch reads the next ids of theirs by `CheckIn_userId_idx` with LIMIT 500 and no ORDER BY, then deletes those ids (and `userId`) by `CheckIn_pkey`. Not by id order with a cursor as the review suggested: the table has no index on ("userId", "id"), so ORDER BY id would sort every remaining row of theirs for each batch. No cursor is kept: a deleted row never comes back, so the next read starts where the last stopped and a pass resumed from this part reads what is left. A small history is two statements instead of one.
- **POST `/api/check-ins` is limited per person** (`rateLimit("check-in:<userId>", CHECK_IN_RATE)`): 10 in 15 minutes, the limit change-password and the AppSumo redeem use, every post counted as they count them. Past it, 429 with `Retry-After` and "Too many check-ins in a short time, so this one wasn't saved. Try again in 15 minutes." Nothing is written.

## 6. Left as notes (the two lows the lead set aside)

- **Known window** (the review's first low): the narrowing file's marker can be written while 8e3f75af still serves. A just-removed member's POST there (no level check) can write a row that stays readable by that workspace's people-data readers for good; the file never runs again. Its SCIM half now heals when the identity provider retries (section 5); a run of predicate (2) after the reload would close both.
- **Older, out of scope** (the review's last low): a Reports to written in another workspace while a deactivation here is in flight can land under the ended account. It needs a lock on the manager's User row in every Reports to write, or a per-account lock.

## Tests

Fail on the old code / new or edited, run against 9734270a in a scratch copy (below): 34 tests new or edited in 9 files; 30 fail on the old code. The 4 that pass on both pin answers that did not change, named here.

- `src/lib/people/person-access-anchor.test.ts`: 4 new, all fail. "org-wide" and "people-team" at manager tier: refused outside their own solid tree though the label says org-wide or people-team, admitted inside it, never on an Admin, and DELETE's own rule still true for them; a dotted line, below manager tier, an Admin, a Guest; read by id.
- `src/app/api/users/[id]/handover/route.test.ts`: 3 new, 1 edited; 2 fail (a Director at manager tier outside his tree: GET, GET `?to=` and POST 403 with nothing moved; the People team the same). Pins: either hands over inside their own tree, never through a dotted line; the edited "refuses whom DELETE would refuse" (now a real manager over an Admin). Its double runs the real `relationTo` and gate over a viewer each test sets.
- `src/app/api/users/[id]/route.test.ts`: 4 new, all fail (open tasks and containers counted again under the lock, for PATCH and DELETE; `handoverTo` read only from someone who may hand over; the 409's words for one who may not; the record's `access.handover`). Its double's `pendingHandover` reads the transaction it is given.
- `src/lib/people/handover.server.test.ts`: 3 new, 5 edited; 7 fail (every report still listed moves, records only for the relied line; up the line with nobody or an Agent; a line no workspace relies on now still moves; `accountEnded` for a deactivated and a removed leaver, and in the two preview answers; `pendingHandover` reads through its transaction). Pin: nothing listed, nothing moved.
- `src/lib/scim-deprovision.test.ts`: 3 new, 2 fail (the gone branch nulls their check-ins here, finished or pending; the member path's `LOCKED_TX`, the anchored path's checked with it). Pin: nothing nulled where they are anchored here by the time it looks. Its double records each transaction's options and reads the anchor.
- `src/app/api/check-ins/route.test.ts`: 2 new, both fail (40P01, P2034 and a wrapped 40P01 answer the 503 with nothing written; 10 posts then a 429 with `Retry-After`, another person unaffected). Its double passes the limiter through for that one test only.
- `src/lib/agents/erasure-sweep.test.ts`: 1 new, 1 edited, both fail (1,001 rows deleted 500 at a time, read with no order, deleted by the ids read, stopping at the deadline and finished by the next pass, nobody else's touched; the first statements are the read and the delete by ids). Its double logs an `orderBy` and a delete's ids.
- `src/lib/people/reporting-lines.test.ts`: 4 new, all fail (`refusedRemovalWords` three ways; the "ended" words).
- `src/lib/access/agent-manager-reads.contract.test.ts`: 3 new, all fail (the handover's and the users route's gate and recipient, the whole gate under the lock in both; the Remove dialog's words and `canHandOver`; the transfer dialog's "ended").

## Verification

- `npx vitest run` over 110 files: every test in `src/lib/people`, `src/lib/access`, `src/app/api/users` (all of it), `src/app/api/check-ins`, the three SCIM route files and `src/app/(dashboard)/settings/members`, and every test that imports, mocks or reads a changed module (the AI digest, `run-due-agents`, `me/delete`, `verify-email`, the Google start route, `executor`, `check-in-access`, `erasure-sweep`, `rate-limit-memory`, `scim-deprovision`): 1,962 tests, all pass.
- **Old-code proof.** A scratch copy of the worktree (node_modules linked, no env file copied, the worktree itself never touched), with the 13 changed source files put back from 9734270a and checked byte for byte. The 9 new or edited test files all load: 30 of 267 tests fail, the 30 above.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`, run twice: exit 0 both times.
- **eslint** on the 22 changed files: no problems (the first run found nine `accessLevel` literals in my new tests, now `legacyLevelRow`).
- No SQL file, no schema change, no script changed. No SQL was run.

## Found, not fixed (this batch)

- **A task or a List given to someone after the in-lock count** and before their deactivation or removal commits still lands on the ended account: task and container writes take no lock the deactivation holds. Closing it needs the assignment paths to refuse an owner who is deactivated or removed.
- **The org-wide levels and the People team still write status and Reports to for anyone who is not an Admin** (`person-fields.ts` `canWritePersonGroup`, yesterday's door). So a Director can still deactivate a peer, or move a peer's reports to themselves one PATCH at a time; only the handover (Spaces, tasks, its summary) and the recipient a removal names are closed here.

**The docs-found track closes here.** Still found and not fixed, one line each, as each batch last recorded it (those a later batch fixed are left out), for the founder's list:

- (batch 9) A task or List given to someone between the in-lock count and the commit of their deactivation or removal goes with the ended account.
- (batch 9) The org-wide levels and the People team write status and Reports to for every non-Admin, so they can deactivate a peer or take a peer's reports one PATCH at a time.
- (batch 8 review) The narrowing's marker can be written while the old build serves, so a just-removed member's check-in posted then stays readable there for good.
- (batch 8 review) A Reports to written in another workspace while a deactivation here is in flight lands under the ended account.
- (batch 8) The dotted-lines PUT takes off a dotted line to someone deactivated in the person's other workspace who holds no level here, while a restore keeps it.
- (batch 8, 9) A relied report moved by a PATCH or DELETE with no `handoverTo` (an old client, a direct call, or an actor who may not hand over) goes up the leaver's line.
- (batch 8) SCIM's member path signs the person out of every workspace, reads the anchor outside its transaction, and a suspended workspace answers a member's PUT or PATCH with the stored row.
- (batch 8) The anchored SCIM path deactivates, in every workspace, someone anchored here only because they last switched here.
- (batch 8) The handover's own moves stay moved when the DELETE or PATCH after it is refused for an Owner or the last Owner or Admin.
- (batch 8) The narrowing's 10:00Z cutoff is right only if the batch 6 build was live by then.
- (batch 8) A check-in posted after an erasure's commit by a session still signed in lives until the last pass, two hours on.
- (batch 8) `?userId=` for someone else still runs the viewer's own-rows part, an indexed read that finds nothing.
- (batch 8, rule) Any new code that deletes a membership must null that person's check-ins of that workspace in its transaction.
- (batch 7) The bulk change of manager and the CSV import write Reports to without asking about a line another workspace relies on.
- (batch 7) The Members list names the stored manager whatever workspace they are in, and the org chart shows the 409 sentence with no confirm.
- (batch 7) In the other workspace, a report moved to someone who holds no level there reads as having no manager, and their open reviews there stay stamped to the leaver.
- (batch 7) SCIM for a member here sends their work to the first Owner, never their manager here; an Owner through a membership keeps their work with no dialog to reach them; a later POST for the same address makes a second account.
- (batch 7) A Guest's standing does not travel with a move between workspaces (needs an org role on the membership).
- (batch 7) The `update_task` and `move_task` cards name only automations set up on the List.
- (batch 7) A webhook pause after a retry's claim still lets that one send out, and a `markFailed` that half lands is not tried again.
- (batch 6) A report moved here can go to someone who also works in the report's other workspace, which then reads the new line.
- (batch 6) `effectiveManagersOf` answers for members from the one stored line, so the other workspace's line decides who reviews them here.
- (batch 6) Bulk item edits lock rows in no order, so a deadlock with a delete is possible (Postgres ends one side).
- (batch 6) Published SOPs in the AI digest are read at the session's level, as every SOP route reads them.
- (batch 6) A Guest digest manager is skipped, not walked past, so their people's overdue work reaches no manager.
- (batch 6) A webhook retry's claim is 15 minutes, so a run stopped mid-send sends again then, not at its backoff time.
- (batch 5) People who work here through a membership are missing from Members, the directory and the people picker, and cannot be edited, deactivated, removed or given a role here.
- (batch 5) The sharing engine's view of another person is anchored only, so a member anchored elsewhere cannot be shared with or named owner here.
- (batch 5) The People team and Admin lists read the anchored row's level.
- (batch 4, 5) `User.managerId`, `roleId` and `departmentId` are one column each for every workspace a person belongs to.
- (batch 5) A handover that stops half way is not retried on its own.
- (batch 5) Download my data exports a stale stamp's open rows.
- (batch 5) A removed stored manager is still answered as the effective manager.
- (batch 5) `hashtext` lock keys can collide across workspaces and share a lock for a moment.
- (batch 5) The monthly evaluation reminder reads only people anchored in the workspace.
- (batch 5) Webhook rows PENDING from before batch 5 (no lease) stay unsent.
- (batch 5) GET `/api/v1/people`, `/api/v1/sops` and `/api/v1/tasks` answer 500 for a `limit` that is not a number.
- (batch 5) `create_task` turns a `dueIsoDate` that is not a date into an Invalid Date.
- (batch 4) The dotted-lines loop check reads outside the role lock, so two crossing edits can still make a dotted loop.
- (batch 4) Open reviews and weeks stamped to an Agent wait for a move; a one-off `followReportingLine` script would heal them.
- (batch 4) A task moved between two Lists of a Space being deleted can deadlock with the delete's task locks.
- (batch 4) `moveList` answers 500 on a deadlock.
- (batch 4) An integration's `notes` overwrite the person's own note on an update or a fill.
- (batch 3, 4) The API's KPI score is actual over target capped at 100, not the direction-aware `scoreKpiRecord`.
- (batch 4) A paused webhook subscription has no resume path.
- (batch 3) Canvases, tables and files moved into a Space while it is deleted stay live, pointing at the removed Space.
- (batch 3) The person page, org chart, Members manager column, `my-team` and `team-alignment` still show a stored line to an Agent.
- (batch 3) The Members page has no filter for Agents with stored reports.
- (batch 3) `sendInvitation` accepts a deactivated manager at invite time (the acceptance drops them).
- (batch 3) The report tree's depth cap of 6 counts an Agent in the middle of a chain as a level.
- (batch 3) `weekly-review.ts` `getReviewForViewer` has no caller.
- (batch 3) The send-reminders email digests send again on a second run the same day.
- (batch 3) Webhook receivers can't tell from the header which key signs a subscription, and no screen shows it.
- (batch 3) `docs/product/how-it-connects.mdx` says analytics and the performance score read the legacy Task table.
- (batch 2, 3) The due-today run reads today in the server's clock, not each person's.
- (batch 2) The Members drawer shows the Agent refusal with the row's generic Retry.
- (batch 2) Folder mutes silence only a task whose List sits directly in the muted Folder.
- (batch 1) An Agent who owns a Space, Folder or List still manages it (`node-rules.ts` A8, Phase 8); the Agent sentence promises nothing else.
