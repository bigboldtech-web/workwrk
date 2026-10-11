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
