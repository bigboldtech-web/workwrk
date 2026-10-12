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
