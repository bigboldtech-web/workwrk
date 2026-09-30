# Data migrations

A **data migration** moves or rewrites user rows. It is not the same thing as a
schema change (those are `prisma/sql/*.sql`, described in `prisma/sql/README.md`).

Data is never lost. Every script in this directory that touches user rows obeys
all seven of these rules, and a script that does not is not run:

1. **Dry run by default.** No `--write`, no writes. Ever.
2. **A per-org report**, printed and saved, before anything is written: how many
   rows were read, how many would be written, and every row the mapping could
   not resolve, named.
3. **Row-count assertions.** Rows written must equal rows read, per org. A
   mismatch aborts that org's transaction.
4. **One transaction per org**, so a failure on org 9 cannot leave org 8 half
   migrated.
5. **Idempotent.** Re-running it after a partial failure finishes the job rather
   than duplicating it, keyed on the marker the first pass wrote. The marker
   that is actually READ BACK is the `LegacyRedirect` row, one per task, per
   task comment, per idea and per idea comment. `Item.metadata.legacyTaskId` is
   written as well, but it is a label for a human reading the blob, not a
   guard: nothing reads it, and `metadata` is a JSON column a wholesale write
   can replace. Do not treat it as a second lock.
6. **Source rows are never deleted.** The legacy table stays readable for at
   least one release after the migration; dropping it is a separate, later,
   deliberate step.
7. **The report is archived** as an `ActivityLog` row so there is a record in
   the product of what was moved and when.

## The approval gate

**Amended 2026-09-19.** The founder delegated this explicitly ("You have to do
it yourself. Do everything and push."), so `migrate-legacy-tasks.ts` now runs
automatically in the deploy, and the gate below no longer blocks it. The gate
still stands for every OTHER data migration, and for any new one, because the
delegation was given with this release's specifics in view.

What replaced it for `migrate-legacy-tasks.ts`, in `.github/workflows/deploy.yml`,
between a successful build and the pm2 reload:

1. The **dry run** runs first and is teed to `legacy-tasks-dryrun.log` on the
   box, so the log always shows what the write was about to do.
2. The **write** runs next and is teed to `legacy-tasks-write.log`.
3. Neither can abort the deploy (`|| true` plus a `MIGRATION-*-FAILED` marker
   to grep for): the product is fully functional without the migration, and
   only unmigrated legacy rows stay unreachable, which re-running fixes.
   Losing the reload over it would be the worse outcome.

It is placed there rather than in `npm run build` because the build must have
already proved itself, and nothing is serving the new code yet.

Why this is safe to run unattended, and the reasons are properties of the
script rather than assurances: it is dry-run by default so `--write` is always
deliberate; it works per organization inside a transaction with row-count
assertions on both tasks and comments; it is idempotent, reading back
`LegacyRedirect` and `metadata.legacyTaskId` at the start of each org, so a
second run reports "already migrated, 0 to write" and a run that died halfway
finishes the job; and it **never deletes or mutates a source row**, so `Task`
and `TaskComment` remain readable and the whole thing is reversible by
deleting the Items it made.

**The original gate, still in force for every other script:**

1. An agent runs the **dry run against production** (read-only) and saves the
   report.
2. The founder reads the report, in particular the unresolved rows.
3. The founder, not an agent, runs the same command with `--write`.
4. The founder confirms the assertion output and the `ActivityLog` row.

An agent may run `--write` **only** against the local database named in
`.env.local`, and only after the local dry-run report has been saved.

Note that `scripts/deploy-migrations.mjs` also applies the hand-written schema
files in `prisma/sql`, from an explicit `SQL_MANIFEST`, before the build. That
closed a real gap: `prisma migrate deploy` reads only `prisma/migrations`, so a
missed file meant the new release met a database without its tables.

Two things about how it applies them, both learned the hard way:

- It shells out to `npx prisma db execute`, NOT a second `pg` client. The first
  version opened its own connection and the deploy died before the build with
  nothing in the log; `prisma db execute` resolves its datasource the same way
  `prisma migrate deploy` does, which is the path that has been working on that
  box for months.
- There is no ledger. Every manifest file runs on EVERY deploy, so every file
  in the manifest MUST be idempotent (`IF NOT EXISTS` on every statement, and a
  backfill guarded on its own effect). `2026-07-21-operating-core.sql` is
  deliberately excluded for exactly this reason: 39 statements, no guards.

`scripts/check-schema-sql.mjs` runs in CI and fails the build when
`schema.prisma` declares a table or column that no migration and no manifest
file creates, measured against `scripts/schema-sql-baseline.json` (the objects
production already carries from the `db push` era). It exists because Phase 2
added `archivedById` to six models, wrote the SQL file, and never listed it in
the manifest: the generated client selected a column production did not have,
so every task read threw and the page said "could not load".

## The scripts

| Script | What it does | Writes? |
|---|---|---|
| `report-seeded-list-views.ts` | Reports the saved views `ensureCoreListViews` force-seeded onto every task List ("Board", "Calendar", "Gantt") that nobody has since renamed, configured, reordered or made default. spec-spaces-lists section 4 step 6. | **Never.** `--write` is refused: those views are the only current door to the Board, Calendar and Gantt renderers on a List, and the `ViewTypeSwitcher` that replaces them has not shipped. When it does, the refusal comes out and the rules stay. |

Dry run, anywhere (reads only):

```
npx tsx scripts/report-seeded-list-views.ts --report /tmp/seeded-views.json
```

## The exact commands

Dry run (safe anywhere, reads only):

```
npx tsx scripts/<script>.ts --report /tmp/<script>-report.json
```

Local write (agents may do this; local database only):

```
DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
  npx tsx scripts/<script>.ts --write
```

Production write (**the founder only**, after the gate above):

```
# on /www/wwwroot/workwrk.com, with the production DATABASE_URL in the env
npx tsx scripts/<script>.ts --report ./migration-report.json      # dry run first
npx tsx scripts/<script>.ts --write                               # only after approval
```

## The migration scripts, and their order

All six are written. A struck-through name means the script exists; **written
is not the same as run in production**, which is the founder's step every time
(see the approval gate above).

| Script | What it moves | Ships with | Depends on |
|---|---|---|---|
| ~~`migrate-notification-types.ts`~~ **WRITTEN, Stage C** | `Notification.type` uppercase values (`KUDOS`, `SURVEY`, `REVIEW`, `POLICY`, `SOP`, `TASK_ESCALATED`) lowercased | work-home W2 | the write-time normalisation, which landed with it: all fourteen writers now store the lowercase form, so the script cannot re-run forever |
| ~~`backfill-mentions.ts`~~ **WRITTEN, Stage C** | doc and SOP `EntityLink` mentions into `mention` notifications, `read = true` above 30 days old | work-home W2 | nothing; **this is what must run before `/me/mentions` can be redirected**, or those rows have no destination. The redirect is NOT in `next.config.ts` and `/api/me/mentions` is NOT deleted, precisely because the production run has not happened |
| ~~`migrate-legacy-tasks.ts`~~ **WRITTEN, Stage F** | every live `Task` and `TaskComment` into `Item` / `ItemUpdate` on the assignee's Personal list, with `metadata.legacyTaskId` and a `LegacyRedirect` row | work-home W4 | `LegacyRedirect` (shipped in `prisma/sql/2026-09-18-task-detail-phase2.sql`); every Personal list existing (the script creates a missing one); the consumer re-points, which shipped with it |
| ~~`migrate-ideas.ts`~~ **WRITTEN, Stage F** | every `Idea` into an Item on the seeded Ideas list, with a `LegacyRedirect` row | work-home W5 | the Ideas list template (seeded: `list.ideas-board`); **must run before the `/ideas` 308**, or the redirect is a delete. The redirect is deliberately NOT in `next.config.ts` yet |
| ~~`migrate-preference-keys.ts`~~ **WRITTEN, Stage F** | every `home.topPins` entry folded into the `favorite<Kind>Ids` array for its kind, so the rows behind the deleted top-pins strip become ordinary favorites | work-home W1 and W2 | the strict-schema keys existing (they do, as of Phase 2 Stage A); nothing else |
| ~~`migrate-public-sop-links.ts`~~ **WRITTEN, Phase 3 process unit** | `settings.access.publicLinks = "view"` for every org holding a PUBLISHED SOP with a `shareToken`, plus one `access.settings.migrated` audit row per org | the `/share/sop/[token]` toggle-10 fold (Phase 3 Stage D) | nothing in `prisma/sql` (it writes a JSON key on `Organization.settings`); run automatically by `.github/workflows/deploy.yml` between the build and the pm2 reload, see its section below |

## Stage C: the two that are written, and what the founder has to do

Both scripts ran their dry run against the LOCAL database, and
`migrate-notification-types.ts` also ran `--write` there. Neither has been near
production. Reports are in the session scratchpad
(`phase2-reports/notification-types-dryrun.json`,
`phase2-reports/mentions-dryrun.json`).

**1. Notification type normalisation.** Safe, and a pure rename of a routing
key: no row is deleted, nobody's notification changes owner, title, message or
link, and a second run matches nothing. `TYPE_ALIASES` in
`src/lib/inbox-kinds.ts` reads the old casing correctly even for rows the
script never reaches, so the Inbox is right before, during and after.

Rule 7 is met the way the rule asks and rule 4 is waived with a reason, both
stated in the script's header: `Notification` has no `organizationId` (the
model predates org scoping), so the RENAME is one global statement per type
and a per-org transaction has nothing to keep consistent that a single
statement does not. The RECORD is per org: after the writes the affected rows
are read back through their owners into a per-org tally and each workspace gets
one `ActivityLog` row of type `work.notification_types_normalised` carrying its
own number. A run that renames nothing writes no rows, so re-running never
leaves a second record of a migration that did nothing.

```
npx tsx scripts/migrate-notification-types.ts --report ./notif-types.json  # dry run
npx tsx scripts/migrate-notification-types.ts --write                      # after approval
```

**2. Mentions backfill.** This one WRITES NEW ROWS into other people's
Inboxes, so read the dry-run report first, in particular the `unresolved`
list, which names every EntityLink whose source is gone, whose user has left
the org, or whose mention pill was edited out of the block. None of those are
written and none of them are deleted.

```
npx tsx scripts/backfill-mentions.ts --report ./mentions.json        # dry run, read it
npx tsx scripts/backfill-mentions.ts --org <one org> --write         # pilot ONE org
npx tsx scripts/backfill-mentions.ts --write                         # after the pilot
```

**Only after that run succeeds** may `/me/mentions` be redirected to
`/inbox?tab=mentions` and `/api/me/mentions` deleted. Until then both stay, and
`next.config.ts` says so where the row would otherwise go.

## Schema objects Stage A shipped for them

`prisma/sql/2026-09-18-task-detail-phase2.sql` adds `LegacyRedirect`
(`organizationId`, `kind`, `legacyId`, `target`, unique on the first three).
As of Stage F it is read by `src/lib/item-gate.ts` (so a legacy task id opens
its task through the one task API), by `/tasks/[id]` and by `GET /api/me/work`.
It exists so the migrations above have somewhere to
write a permanent forwarding address rather than relying on a source row that a
later release deletes.

---

# Stage F: the Task and Idea migrations

Two scripts, both written, both run against the LOCAL database only. Neither
has been near production. Reports are in the session scratchpad
(`phase2-reports/legacy-tasks.txt`, `phase2-reports/legacy-tasks-write.txt`,
`phase2-reports/ideas.txt`, `phase2-reports/ideas-write.txt`).

## 1. `migrate-legacy-tasks.ts`: Task and TaskComment to Item and ItemUpdate

### Why this one is different from everything above it

It is the first migration in this phase that moves **user content**, not a
routing key or a derived row. A person's tasks, their descriptions, their
comments and their comment authorship all move. Read the dry-run report
properly, in particular the two lists it prints per workspace:

* **status values the mapping could not place.** Those rows still migrate, onto
  the destination list's first active status, and keep their original value
  under `Item.metadata.legacyTask`. Nothing is lost, but somebody should look.
* **NOT MIGRATED, no live person to own them.** These rows are read and
  **skipped**: their assignee and their creator have both left the workspace.
  They are not written and they are not deleted. They stay in the `Task` table
  and can be migrated later by re-running the script once somebody is
  reinstated, or left where they are.

### A hard ordering requirement, because a release got it wrong once elsewhere

**The production run must happen before, or in the same deploy as, the release
that carries this code.** The seven legacy `/tasks/*` list pages
(`assigned-to-me`, `today-overdue`, `backlog`, `board`, `calendar`, `gantt`,
`sprint`) are DELETED in this release, and they were the only UI over the
`Task` table. Between the deploy and the migration, a workspace's un-migrated
legacy tasks are still in the database, still undeleted, and **not reachable in
the product**.

Nothing is lost in that window and nothing is irreversible: the rows are there,
`GET /api/me/work` still returns `legacyTaskCount` (counting only rows with no
forwarding address) so the state is observable, and running the script closes
it. But it is a real window and it should be a short one.

### What a migrated task looks like afterwards

| Legacy | Becomes |
|---|---|
| `title` | `Item.title` |
| `description` | `Item.metadata.description` (where the task detail reads it) |
| `status` | the destination list's own status, by name and group |
| `priority` | `Item.priority` |
| `date` / `startAt` / `endAt` | `Item.startAt` + `Item.dueAt` |
| `completedAt` | `Item.metadata.completedAt` |
| `assigneeId` | `Item.ownerId` and `assigneeIds[0]` |
| `parentTaskId` | `Item.parentItemId`, when both land on the same list |
| labels | `Tag` + `TagAssignment`, tags created per org when missing |
| `estimateHours` | `Item.metadata.timeEstimate`, in MINUTES |
| `TaskComment` | `ItemUpdate`, original author and original `createdAt` |
| everything else | `Item.metadata.legacyTask`, verbatim |

"Everything else" is: `hoursSpent`, `category`, `incompleteReason`,
`recurringGroupId`, `externalId` / `externalSource` / `syncedAt` (the Google
Calendar idempotency key), `slaHours` / `escalatedAt` / `escalatedToId`,
`source` / `sourceRef`, `dayPosition`, `allDay`. Nothing is dropped.

`TimeEntry` rows follow their task: `TimeEntry.taskId` is copied to
`TimeEntry.itemId` (a column the schema already has), so a migrated task still
shows its logged hours. `taskId` is not cleared, so the move is reversible.

### One thing this changes that is not a field: WHO CAN READ THEM

A migrated task and its comments land on **that person's Personal list**, which
is a `PRIVATE` board. The people who can read a PRIVATE board are its members,
its owner, the OWNER of its Space (a Personal list has none) and **workspace
admins** (`src/lib/board.ts`, the PRIVATE branch of the visibility rule). So
after the migration a company admin can open any workspace member's migrated
tasks and comments.

That is the same rule every Personal list has always had, and it is not a new
grant invented by this script. It is written down here because it is a
readership question about other people's content and the founder is authorising
the move: if it is not acceptable, the answer is to change the PRIVATE rule
first, not to run this and find out afterwards.

**TASK custom fields: there are none.** spec-work-home W4 asks for "TASK
custom-field values to matching BOARD_ITEM fields". The
`CustomFieldDefinition` and `CustomFieldValue` models the schema comment at
`prisma/schema.prisma:3862` describes were never added to the schema,
`src/app/api/custom-fields` does not exist, and the three calls the legacy task
grid made to it were always silent 404s. The report prints a count of zero with
that reason rather than leaving a step that looks skipped.

### The commands

```
# 1. Dry run against production, READ ONLY. An agent may do this.
npx tsx scripts/migrate-legacy-tasks.ts --report ./legacy-tasks.txt

# 2. The founder reads the report. In particular the unresolved list.

# 3. Pilot ONE workspace, the founder's own.
npx tsx scripts/migrate-legacy-tasks.ts --org <orgId> --write

# 4. Check that workspace in the product: open My work, open a migrated task,
#    check its comments carry their original authors and dates, and follow an
#    old /tasks/<id> link.

# 5. The rest.
npx tsx scripts/migrate-legacy-tasks.ts --write
```

### Verification queries

```sql
-- Every legacy task has a forwarding address (or is on the unresolved list).
SELECT count(*) FROM "Task" t
  WHERE NOT EXISTS (
    SELECT 1 FROM "LegacyRedirect" r
     WHERE r."kind" = 'task' AND r."legacyId" = t."id"
       AND r."organizationId" = t."organizationId");

-- Items written by the migration, per workspace.
-- Keyed on LegacyRedirect, not on Item.metadata: the metadata label is a JSON
-- key any wholesale write to that column can drop, so counting it under-reports.
SELECT r."organizationId", count(*) FROM "LegacyRedirect" r
  WHERE r."kind" = 'task' GROUP BY 1;

-- Comments moved, per workspace.
SELECT count(*) FROM "LegacyRedirect" WHERE "kind" = 'task_comment';

-- Logged time followed its task (TimeEntry.taskId -> itemId; taskId is kept).
SELECT count(*) FROM "TimeEntry" WHERE "taskId" IS NOT NULL AND "itemId" IS NULL;

-- The record in the product (rule 7).
SELECT "organizationId", "description", "createdAt" FROM "ActivityLog"
  WHERE "type" = 'work.tasks_migrated' ORDER BY "createdAt" DESC;
```

## 2. `migrate-ideas.ts`: Idea to Item on a real list

Same pattern. Two things specific to it:

* **It creates a list.** One per workspace, named "Ideas", from the built-in
  `list.ideas-board` template, in the org's oldest workspace-visible Space. An
  org with no ORG- or WORKSPACE-visible Space is **BLOCKED and skipped**, with
  the reason printed, rather than having its ideas dropped into a private
  Space where the people who wrote them cannot see them. Seed the template
  first if the report says it is missing: `npx tsx prisma/seed-templates.ts --write`.
* **Votes become a number.** `IdeaVote` rows are counted into
  `Item.metadata.votes` and the voter ids are kept under
  `metadata.legacyIdea.voterIds`, so a real upvote field later can rebuild the
  votes rather than starting from a total. `IdeaVote` rows are not deleted.

```
npx tsx scripts/migrate-ideas.ts --report ./ideas.txt   # dry run, read it
npx tsx scripts/migrate-ideas.ts --org <orgId> --write  # pilot one workspace
npx tsx scripts/migrate-ideas.ts --write                # the rest
```

## 2b. `migrate-preference-keys.ts`: top pins become favorites

The smallest of the three and the only one that touches no user CONTENT, just a
preference. The top-pins strip under the top bar is deleted this phase, and
"Favorite > Top" collapses into one Favorite row, so `home.topPins` has no
reader and no writer left. Its entries are unioned into the matching
`favorite<Kind>Ids` array, which is what the sidebar FAVORITES section and
`/favorites` read. `home.topPins` is NOT cleared, so the fold is idempotent and
reversible, and a pin whose kind has no favorites array is reported rather than
guessed at.

```
npx tsx scripts/migrate-preference-keys.ts --report ./pref-keys.txt  # dry run
npx tsx scripts/migrate-preference-keys.ts --write                   # after approval
```

Verification: open `/favorites` as somebody who had top pins; the objects they
had pinned are rows there.

**Only after that run succeeds** may `/ideas` be redirected and
`ideas/page.tsx` plus `/api/ideas*` be deleted. Until then all of it stays, and
`next.config.ts` carries no `/ideas` row, for exactly the reason `/me/mentions`
carries none: redirecting before the rows have a destination is a delete, not a
redirect.

**The write door closes on its own, per workspace, the moment this script has
run there, and needs nothing from you.** `/ideas` and `POST /api/ideas` both
look the destination list up at request time
(`src/lib/work/ideas-destination.ts`, which matches the marker
`Board.settings.legacyIdeasList` first and the name second). When it exists:

* the page renders a strip saying "Ideas have moved to a List" with a link to
  it, the same honesty `/me/mentions` carries, and
* the "Share an idea" composer is not rendered, and `POST /api/ideas` answers
  **410 Gone** naming `/api/boards/<list id>/items` as the replacement.

That matters because an idea written into the `Idea` table AFTER the migration
has run is invisible everywhere except this retired page, and stays stranded
until somebody thinks to run the script a second time. Before the migration
there is no list, nothing to point at, and the page and the API behave exactly
as they always did.

Verification, per workspace, after `--write`:

```
curl -sS -X POST -H 'Content-Type: application/json' -b "$COOKIE" \
  -d '{"title":"probe","description":"probe"}' https://<host>/api/ideas
# expect: HTTP 410 {"error":"Gone","replacement":"/api/boards/<id>/items",...}
```

## 3. The one-release 410 window, and the drop file that is NOT written

`/api/tasks`, `/api/tasks/[id]/comments`, `/api/tasks/batch`,
`/api/tasks/reorder-day`, `/api/tasks/workload` and
`/api/tasks/run-sla-check` answer **410 Gone** as of this release, with a JSON
body naming their replacement (`src/lib/work/legacy-task-api.ts` holds the one
table). 410 rather than 404 because 410 says "this existed and is not coming
back", which is what a caller outside this repo needs to hear.

**The route files come out in the release AFTER this one.** Not now: a caller
that still hits them today should get the body that tells it where to go, not
the App Router's 404 HTML.

**`Task`, `TaskComment`, `TaskLabel` and `TaskLabelOnTask` are NOT dropped, and
this stage deliberately does not write the SQL file that drops them.** Rule 6
keeps a source table readable for at least one release, and several routes
outside this phase's scope still read it (`/api/v1/tasks`, the ICS feed,
`/api/calendar`, `googleCalendarSync`, `lib/goal-effort.ts`, `lib/agents/tools.ts`,
`lib/workflows/runtime.ts`). Those are re-pointed by their own units.

### The writers, which are a different and more dangerous list than the readers

A row a retired table is still GAINING is worse than a row it is still lending
out: the migration is a one-shot script, so anything written after it has run
is never picked up, and with the `/tasks/*` UI deleted it would be invisible
for ever. Eight code paths wrote `Task`. **Seven of them are re-pointed in this
release** and now write an Item on the assignee's Personal list, through the one
helper `src/lib/work/personal-task.ts`:

| Writer | What it is |
|---|---|
| `src/lib/templates/catalog.ts` | the in-product "Personal todo starter" template, five tasks |
| `/api/notetaker/save` | the AI notetaker's "spawn tasks" checkbox |
| `/api/meetings/[id]/action-items` (POST and PATCH) | "auto-create a task" and "Convert to task" |
| `/api/integrations/ingest` | the generic webhook's `task.create` action |
| `/api/v1/tasks` (POST, and GET with it) | the published API. The JSON shape is unchanged; the legacy-only fields come back out of `metadata.legacyTask` |
| `src/lib/agents/tools.ts` | the Sidekick `create_task` tool, and `search_tasks` with it |
| `src/lib/workflows/runtime.ts` | the Autopilot `create_task` action |

**The one that still writes `Task`, on purpose**, is
`src/services/googleCalendarSync.ts`. Those rows are not authored work: they are
a local mirror of somebody's Google Calendar, keyed on `externalId`, updated and
deleted by that service as the remote calendar changes, and the ICS feed
deliberately skips them because they are already on the subscriber's calendar
coming from Google. Turning that mirror into Items is the Planner unit's call.
It is listed here so that the drop preconditions below cannot be read as met
while it is still running.

When every reader is gone, the drop is a separate, deliberate, founder-run
step. The file it would be, for the record, so nobody invents a different one:

```sql
-- prisma/sql/YYYY-MM-DD-drop-legacy-tasks.sql  (NOT WRITTEN YET)
-- Preconditions, ALL of them, verified before this is applied:
--   1. migrate-legacy-tasks.ts has run in production for every workspace and
--      the first verification query above returns 0.
--   2. A full database backup exists and has been restored somewhere once.
--   3. `grep -rn "prisma\.task\b\|prisma\.taskComment\|prisma\.taskLabel" src/`
--      returns nothing.
--   4. At least one release has shipped with every reader already moved.
-- DROP TABLE IF EXISTS "TaskLabelOnTask";
-- DROP TABLE IF EXISTS "TaskComment";
-- DROP TABLE IF EXISTS "TaskLabel";
-- DROP TABLE IF EXISTS "Task";
-- DROP TYPE IF EXISTS "TaskStatus";
-- DROP TYPE IF EXISTS "TaskPriority";
-- DROP TYPE IF EXISTS "TaskSource";
```

The same applies to `Idea`, `IdeaVote` and `IdeaComment` once
`migrate-ideas.ts` has run everywhere and `/api/ideas*` is gone.

## 4. Consumers re-pointed in this release

Every one of these moved onto Items in the same change as the migration, so
none of them lands on a 410 or on a table nobody writes:

| Consumer | Was | Now |
|---|---|---|
| `services/performanceScoreService.ts` | counted `Task` rows filtered on the nullable `date` column | counts `Item` rows by `createdAt`, owner **or** assignee, done by the one cross-surface status rule |
| `/api/planner/events` | two queries side by side, `Task` and `Item` | one `Item` query, matching the assignee set rather than the owner alone, and every event carries a task URL |
| planner command bar, week grid, side panel | `POST /api/tasks` (wrote rows no task surface reads) | `POST /api/me/work`, which puts a real task on the viewer's Personal list |
| `components/docs/block-editor.tsx` task block | `GET /api/tasks/<id>`, a route that never existed | `GET /api/items/<id>`, which also resolves a pre-migration id through `LegacyRedirect` |
| block editor task pickers and Tasks embed | `GET /api/tasks?limit=` | `GET /api/me/items?status=open`, rows linking to `/item/<id>` |
| `/api/email/send-reminders` manager email | linked `/tasks/assigned-to-me` | links `/my-work` |
| `lib/products/catalog.ts` | `landingHref: /tasks/board`, `pathPrefix: /tasks` | `/my-work` for both. **This one needs a seed step**: `pathPrefix` is a column on the `Product` table and both `/api/products` and `/api/products/installations` serve the STORED value, so an existing workspace keeps advertising the dead `/tasks` prefix until the founder runs `npx tsx scripts/seed-products.ts` (its upsert rewrites `pathPrefix` on update) |
| `/api/ideas/[id]` status notification | linked the bare `/ideas` | links the migrated task when a forwarding row exists, else `/ideas` |
| `/api/email/send-reminders` overdue-tasks and tasks-due-today | queried `Task`; the due-today notification linked the bare `/tasks` | queries `Item` (done resolved through each row's own List statuses); the notification links `/item/<id>`, the task it names |
| `services/performanceScoreService.ts` done rule | `isDoneStatusName`, five hard-coded words | `isDoneStatus` over each row's own List statuses, so a renamed DONE column (and the seeded Ideas list's IMPLEMENTED / REWARDED / REJECTED) scores correctly |
| Space Tasks tab, Board / Team / Calendar / Gantt views | drew `Space.settings.workflow.statuses` for every row, so every row fell into "Unset" and labels printed raw enum values | resolves each row's chip from that row's own List, the same `statusesByList` map the List view already had |
| the seven `/tasks/*` list pages | deleted with no redirect (a soft 404 through the `/tasks/[id]` dynamic sibling) | a 308 each, in `next.config.ts` and as a route-handler twin beside the deleted page |
| `/tasks/[id]` | a page whose `redirect()` streamed, so it answered 200 with no `Location` and opened the task as a drawer over a blank host | a route handler: a real 308 to the migrated Item, or a 307 to `/item/<id>?from=legacy-task` on a miss |
| workload heatmap | `GET /api/tasks/workload` | already on Items: `workload-grid.tsx` takes rows as props. The route and its only caller (`components/tasks/workload-heatmap.tsx`) are both deleted; the capability lives on any List's Workload view and at `/team/workload` |

## `migrate-public-sop-links.ts` (Phase 3, process unit)

Carries every existing public SOP link over access toggle 10. For each
organization holding at least one PUBLISHED SOP with a `shareToken`, it sets
`settings.access.publicLinks = "view"` and writes one `access.settings.migrated`
ActivityLog row naming the count. Orgs with no public SOP stay on the Off
default; orgs already on "view" are reported and not written. It ships with the
change that makes `/share/sop/[token]` read the toggle, and it must be run
BEFORE that build serves traffic, or every public SOP link answers "This link is
no longer available" until it is.

**When, exactly. The deploy now does this for you.**
`.github/workflows/deploy.yml` runs the dry run and then the write between the
successful build and the `pm2 reload`, in the same slot
`migrate-legacy-tasks.ts` occupies. That window is the whole requirement: the
old release is still the one answering, so the links never stop resolving. Its
two logs land beside the build log on the box:
`/www/wwwroot/workwrk.com/public-sop-links-dryrun.log` and
`-write.log`. A failure there does not abort the deploy, so grep the job output
for `PUBLIC-SOP-WRITE-FAILED` and, if it is there, run the write by hand from
the deployed checkout. The commands below are that by-hand run, and are also
how to verify what the deploy did.

Running it earlier, from a separate checkout with the production
`DATABASE_URL`, is also safe: the write only sets a JSON key the old code never
reads. Running it late is the outage.

It depends on nothing in `prisma/sql` (the two Stage D SQL files are
unrelated to it), and it is idempotent, so a second run reports zero to flip.

Dry run first, on the production box:

```
npx tsx scripts/migrate-public-sop-links.ts --report /tmp/public-sop-links-dryrun.txt
```

Then the write, once the report reads as expected (the "would flip" count is the
number of orgs with public SOPs that are still on "off"):

```
npx tsx scripts/migrate-public-sop-links.ts --write --report /tmp/public-sop-links-write.txt
```

Verification, against an independent query rather than the report's own sum:

```
SELECT o.id, o.name, o.settings->'access'->>'publicLinks' AS public_links,
       COUNT(s.id) AS public_sops
FROM "Organization" o
LEFT JOIN "SOP" s ON s."organizationId" = o.id AND s."shareToken" IS NOT NULL AND s.status = 'PUBLISHED'
GROUP BY o.id, o.name, public_links
ORDER BY public_sops DESC;
```

Every row with `public_sops > 0` must read `public_links = view` after the
write, the per-org counts must match the report's, and a spot check of one live
token in a flipped org opens the page rather than the 404.

## `prisma/seed-templates.ts`: the eight built-in Doc templates (Phase 3, docs unit)

The retired `src/components/docs/note-templates.tsx` rows (Meeting notes, 1:1
meeting, Project brief, Weekly review, Daily standup, SOP draft, Decision log,
Post-mortem) are now built-in `DOC` rows in the same key-upserted seed as the
Space presets (`doc.meeting-notes` and so on, spec-docs-knowledge section 4
step 9). Until it runs, "New doc > From template" and `/templates?kind=doc`
show only the org's own saved templates; nothing else depends on it, and it
never touches a customer's rows (a key adopted by a non-built-in row is
reported and skipped). Idempotent: a second run reports every row unchanged.

```
npx tsx prisma/seed-templates.ts            # report only
npx tsx prisma/seed-templates.ts --write    # upsert the 17 built-in rows
```

Verification: `GET /api/template-center?kind=DOC` as any member lists the eight
with `builtIn: true`, and applying one creates a Doc whose body carries the
template's headings.

## Phase 4 (Time and Talk): `scripts/backfill-meeting-created-by.mjs`

`Meeting.createdById` arrived with `prisma/sql/2026-09-22-time-and-talk.sql`,
so every meeting written before that file has no recorded creator. The API
tolerates NULL (it falls back to "an attendee, or an Owner or Admin"), so this
is a quality step and not a prerequisite for the release.

The rule, in the order it is applied:

1. **The activity log.** `POST /api/meetings` has always written an
   `ActivityLog` row of type `meeting_created` carrying the `actorId`, so for
   every meeting scheduled through the product the real creator is on record.
   The earliest such row for the meeting wins, and only when its
   `organizationId` matches the meeting's.
2. **The sole attendee.** If the log has nothing and the meeting has exactly
   one attendee, that person is the creator by elimination.
3. **Otherwise left NULL and reported.**

Two rules were deliberately dropped after review, because both invented an
owner rather than recording one, and `createdById` is the only role that can
delete a meeting:

* *"the earliest attendee"* on a meeting with several. `MeetingAttendee` has
  no `createdAt` and every attendee was written in one `createMany` at
  creation, so the lowest cuid is the first name in the picker array, not the
  scheduler.
* *"else the first Owner of the organization"*. That handed delete rights over
  somebody else's meeting to an admin who never scheduled it, and it bought
  nothing: Owners and Admins already read and manage every meeting in the org.

A row left NULL is not a row anyone loses. Dry run by default; only rows with
`createdById = NULL` are ever touched, so a second run reports nothing to do.

```
node scripts/backfill-meeting-created-by.mjs                 # per-org report
node scripts/backfill-meeting-created-by.mjs --write         # apply
node scripts/backfill-meeting-created-by.mjs --org=<id>      # one org
```

Verification, against an independent query rather than the report's own sum:

```
SELECT COUNT(*) FILTER (WHERE "createdById" IS NULL) AS no_creator,
       COUNT(*) AS total
FROM "Meeting";
```

`no_creator` must equal the "left NULL" line of the report, and opening one
backfilled meeting as its creator must show the full edit surface.

## Phase 4 (Time and Talk): `scripts/backfill-channel-visibility.mjs`

A READ ONLY report on `Conversation.restricted` and `Conversation.findable`.
The SQL file's column defaults already leave `restricted = false` everywhere
and `findable = true` on every channel, and its statement 8 sets
`findable = false` on DMs and groups, so there is no backfill left to run.

```
node scripts/backfill-channel-visibility.mjs                 # per-org report
```

**There is no `--write`, and it must never come back.** The version of this
script that shipped first carried three unconditional `updateMany` statements
(`findable = true` on every channel, `restricted = false` on every
conversation, `findable = false` on every DM and group). On the day the SQL
lands those are no-ops. A week later they are a privacy downgrade: they undo
every channel an admin has hidden from Browse and publish every channel an
admin has made private. Run in production a few months after adoption, that
statement publishes every private channel in every organization, and no
`createdAt` guard can distinguish "still at the DDL default" from "set back to
the default deliberately" because the values are identical. The write half is
deleted; the report is what was worth keeping. Passing `--write` now prints
that explanation and writes nothing.

It exits non zero when the columns are absent, which is the honest answer to
"was the SQL applied".

## Future, NOT done in Phase 4: dropping `AnnouncementDismissal`

`docs/plans/ui-refresh/spec-talk.md` section 0 removes
`POST /api/announcements/[id]/dismiss` and the `AnnouncementDismissal` table.
Neither happens in Phase 4 Stage A, on purpose:

- The table's only writer is `src/components/dashboard/announcements-banner.tsx`
  on `/dashboard`, which `spec-work-home.md` owns. Dropping the endpoint before
  that unit removes the banner turns its Dismiss into a live 404.
- A DROP is not an additive change, so it cannot ride
  `2026-09-22-time-and-talk.sql`, which is additive only.

When `spec-work-home.md` confirms the banner is gone, the follow-up is one
file, `prisma/sql/<date>-drop-announcement-dismissal.sql`, carrying
`DROP TABLE IF EXISTS "AnnouncementDismissal";`, applied after the release that
removes the model and the endpoint (never before, or the deploy's Prisma
client still knows a table the database no longer has). Nothing reads the rows
today: `GET /api/announcements` has never filtered on them.

## Phase 4 close: two dated behaviours the founder should know about

Neither is a database change and neither needs a script. Both are dates baked
into code, so they need to be true when the release actually ships.

**1. Chat guest links now expire, and old ones have a 7-day grace.**
`src/lib/meeting-room.ts` signs an expiry into every chat guest code
(`c.<conversationId>.<epoch>.<exp>.<sig>`, 24 hours from the moment a member
copied one). Before this, a copied link was a permanent HMAC: the only
revocations were Reset guest link and a member leaving, so a link forwarded out
of the company stayed live indefinitely.

Codes minted before the release carry no `exp`. They keep working until
`LEGACY_GUEST_CODE_GRACE_UNTIL` (`2026-09-29T00:00:00Z`), then stop resolving.
**If this ships later than 2026-09-22, move that constant so the grace is still
seven days from the deploy**, otherwise in-flight invitations die on deploy day.
Past its own expiry a link answers 410 from `POST /api/calls/guest-token`, and
`/meet/<code>` answers the in-shell 404 rather than naming the conversation.

Meeting guest links are unchanged: they were already enforced against the row
(`scheduledAt + 24h`, 410) in `src/app/api/calls/guest-token/route.ts`.

**2. `GET /api/meetings` stopped returning meetings that record nobody.**
A meeting with no `createdById` and no attendees (the pre Phase 4 POST wrote
those whenever the caller supplied no `attendeeIds`) used to be listed for every
Member while `src/lib/meeting-access.ts` denied the detail page, so a row could
appear on `/meetings` and answer 404 when opened. The list now matches the gate.

The fix for the rows themselves is the data script, which is unchanged and is
still the founder's to run:

```
node scripts/backfill-meeting-created-by.mjs            # dry-run report
node scripts/backfill-meeting-created-by.mjs --write    # apply
```

Until it runs, an Owner or Admin still sees every meeting in the organization
(access rule 4) and can add the right people back to any orphan row.

---

## Phase 4 (Time and Talk), stage B: the Meetings List

`prisma/sql/2026-09-22-meeting-item.sql` adds `Meeting."itemId"`, the link to a
hidden per-organization "Meetings" List. It is in the deploy manifest, so the
column arrives with the release. The rows it points at do not: they are a data
script, and it is the founder's to run.

```
node scripts/backfill-meeting-items.mjs            # dry-run report, per organization
node scripts/backfill-meeting-items.mjs --write    # apply
node scripts/backfill-meeting-items.mjs --org=<id> # one organization
```

It creates one hidden Board per organization (`slug: "meetings"`, no Space, no
Folder, `visibility: PRIVATE`, `settings.hidden = true`) and one Item per live
meeting inside it, with `assigneeIds` = the meeting's attendees and `ownerId` =
its recorded creator. It never deletes, never edits a Meeting field other than
the new `itemId`, resumes if interrupted (an Item is found by
`metadata->>'meetingId'` before one is created), and asserts at the end that
every live meeting has an Item.

**Nothing changes if it never runs.** `src/lib/meeting-access.ts` is what
decides who may read, edit and delete a meeting, it is a pure function over
`createdById` and the attendee list, and it answers identically whether the
Item exists or not. These rows are the SHAPE the access engine will read when
it stops being inert (spec-planner section 1 Access resolves a meeting to
`{ type: "item", id }` so no `meeting` ObjectRef is ever added); writing them
now means that switch is one line in one file rather than a migration under a
deadline.

**The one thing to know before running it in production.** Those Items are
assigned to real people, so without a rule they would appear in My Work, in the
Today list, in the personal ICS feed and in every task picker as if a standup
were a task somebody had been given. `src/lib/system-items.ts` is that rule:
one constant (`SYSTEM_ITEM_TYPES = ["meeting"]`) and one `where` fragment
(`NOT_SYSTEM_ITEMS`) spread by the seven queries that answer "my assigned
work". Run the script only on a release that carries that file, which every
release from Phase 4 stage B does.

### Documented, not done here: `AnnouncementDismissal`

`docs/plans/ui-refresh/spec-talk.md` section 0 removes the
`AnnouncementDismissal` table along with `POST /api/announcements/[id]/dismiss`.
Phase 4 does **not** drop it. Dropping a table is not additive, and the schema
rule for this phase is additive-only, so it is recorded here as a future file:

* a migration dropping `AnnouncementDismissal` and the `dismissals` relation on
  `Announcement`,
* to be written only after a release in which nothing reads or writes either.

## Phase 4 (Time and Talk), stage C: `scripts/backfill-calendar-events.mjs`

**What it is for.** Two populations of rows that are calendar entries and
have spent their lives in a table for to-do items:

| Population | Where it lives now | How it got there |
|---|---|---|
| Google events | the legacy `Task` table, `externalSource = 'GCAL'` | the sync cron wrote there while the Planner read `Item`, so a connected Google Calendar produced rows that no surface in the product rendered. A person connected their calendar, granted access, and saw nothing. |
| Personal events | an `Item` on the person's personal list with a `startAt` and no `dueAt` | the Calendar's old "New event" popover POSTed to `/api/me/work`, so a block of focus time became a to-do that showed up in My work, in the open-task counts and in every "still to do" list. |

Both move into `CalendarEvent`
(`prisma/sql/2026-09-22-calendar-event.sql`), which is the table
`GET /api/calendar/events` reads.

**It copies. It does not move.** Not one `Task` and not one `Item` is
deleted or changed. Both populations keep rendering from their old homes
until the work-home unit retires the legacy table, and the calendar read
prefers the `CalendarEvent` row where both exist, so nothing appears twice.
That means this script can be run, checked, and run again with no window in
which anybody's calendar is missing anything.

**The personal-event rule is deliberately narrow.** An `Item` is taken only
when it is on a personal list, has a `startAt`, has no `dueAt`, has no
parent, and has no assignee other than its owner. Anything else is somebody's
actual work. The cost of being narrow is that a few blocks of focus time stay
tasks, which is what they are today. The cost of being wide would be
somebody's real task quietly becoming a calendar entry that no task list
shows, and that is not a trade a data script is allowed to make.

**Commands.**

```
node scripts/backfill-calendar-events.mjs                 # dry run, prints the report
node scripts/backfill-calendar-events.mjs --org=<id>      # one organization
node scripts/backfill-calendar-events.mjs --write         # apply
```

Dry run by default; a per-organization report either way; idempotent (GCAL
rows match on the `(userId, externalSource, externalId)` unique index,
personal rows on the `legacy-item:<id>` marker this script writes into
`externalId`); it asserts its counts after a write and exits non-zero on a
mismatch rather than reporting success over a half-done run; and it exits 0
with an explanation if `CalendarEvent` is not in the database yet.

**Production run: the founder's.** Apply
`prisma/sql/2026-09-22-calendar-event.sql` first (it is in the deploy
manifest, so a deploy does it), then run the dry run, read the report, then
`--write`.

## Phase 4, stage C: the three calendar feeds, and when the last two go

`spec-planner.md` section 0 row 13 folds three read endpoints into one and
keeps the old three for a release. As of this release:

| Route | State now | Next release |
|---|---|---|
| `GET /api/calendar/events` | THE calendar read. Tasks, meetings, personal events, Google rows and reminders, in one range read. | stays |
| `GET /api/planner/events` | a thin delegate: forwards to the one read, filters to `task` and `external`, and answers its old `{ events: [...] }` shape with the old bare ids | delete |
| `GET /api/calendar/meetings` | a thin delegate: forwards, filters to `meeting`, answers its old `{ meetings: [...] }` shape | delete |
| `GET /api/calendar` | NOT a delegate, kept whole | delete when its timer-session totals find a home |

`/api/calendar` is the exception and the reason is written at the top of the
file: it is the only place in the product that computes `taskTime` and
`activeByUser` out of `TimerSession`, while the new endpoint reports logged
minutes out of `TimeEntry` so the calendar footer agrees with the timesheet.
Those are two different numbers and delegating would have quietly changed
one of them. It has no caller in this repo.

Neither delegate has a caller in this repo either. They exist for a browser
tab that was open across the deploy and for anything outside this repo that
learned the URL.

## Phase 4, stage C: the Google sync now writes two rows, on purpose

`src/services/googleCalendarSync.ts` writes a `CalendarEvent` row AND the
legacy `Task` row it always wrote. That is deliberate and temporary:

* `GET /api/calendar/events` still reads the GCAL-marked `Item` rows the
  earlier legacy-task migration left behind, so the two sources agree in a
  workspace where `backfill-calendar-events.mjs` has not been run;
* `DELETE /api/integrations/google-calendar` (Disconnect) removes BOTH, so a
  disconnected calendar stops showing Google events whichever table they are
  in.

The legacy write goes when the work-home unit retires `Task`. Until then,
removing it early would leave rows in `Task` that nothing deletes.

## Phase 4, stage E: the `AnnouncementDismissal` table, and why it is not dropped here

`spec-talk.md` section 0 and section 4 step 9 remove a route and a table that
nothing read:

* `POST /api/announcements/[id]/dismiss` wrote an `AnnouncementDismissal` row
  for the caller. No read anywhere joined that table, so a person who
  dismissed a banner saw it again on their next load, and the endpoint had no
  organization check at all: any signed-in account could write a dismissal
  row against any announcement id in any workspace.
* Its only caller was `src/components/dashboard/announcements-banner.tsx`, on
  `/dashboard`.

Both are gone in this release. `/dashboard` is a 308 to `/home` (see
`src/app/(dashboard)/dashboard/route.ts`), the banner component had no
importer left (`grep -rn "AnnouncementsBanner" src` returned nothing but its
own file), and the endpoint directory is deleted.

THE TABLE IS STILL THERE, and that is deliberate. Dropping a table is the one
step that cannot be undone by a redeploy, so it waits one release behind the
code that wrote to it, in case a browser tab was open across the deploy or a
rollback puts the old bundle back. The file below is the drop, ready to run:

```sql
-- prisma/sql/2026-09-22-drop-announcement-dismissal.sql
-- RUN THIS ONE RELEASE AFTER the release that removed
-- POST /api/announcements/[id]/dismiss. Nothing reads or writes the table.
DROP TABLE IF EXISTS "AnnouncementDismissal";
```

When it runs, `prisma/schema.prisma` loses the `AnnouncementDismissal` model
(schema.prisma lines 2394 to 2402) and the `dismissals AnnouncementDismissal[]`
relation on `Announcement` (line 2385) in the same commit, and
`npx prisma generate` follows. Until then the model stays so that
`prisma db pull` and the generated client keep matching the live database.

Founder step, production, one release from now:

```
DIRECT_URL= DATABASE_URL="<prod url>" npx prisma db execute \
  --file prisma/sql/2026-09-22-drop-announcement-dismissal.sql
```

(No `--schema`: Prisma 7 removed the flag from `db execute`, and passing it
is a hard CLI error. The command reads `prisma.config.ts`, as
`prisma/sql/README.md` says.)

## Phase 4, stage E: announcements, what changed in data terms

No schema change. Three behaviour changes worth knowing about before the
deploy, because each one changes what somebody sees:

1. **Scheduled posts stop leaking.** `GET /api/announcements` never filtered
   on `publishedAt`, so a post scheduled for next Monday was readable by its
   whole audience the moment it was created, while its notifications waited
   for the `announcements-publish` cron. It is now invisible to everyone but
   its author until its publish instant. Any post currently sitting scheduled
   will disappear from readers' feeds on deploy and reappear on schedule.
2. **The oversight read narrows.** Every legacy manager level used to read
   every announcement in the workspace, including posts aimed at one
   department. It is Owner, Admin, the People team (`announcements.create` in
   the permission matrix) and the author now. A team lead with one report
   will see fewer announcements after this deploy, and each one will be a post
   aimed at them.
3. **The acknowledgment roster is the audience.** It used to be every
   non-deleted user in the organization minus the author, so a
   department-targeted must-acknowledge post reported the whole company as
   Pending. Existing `AnnouncementAcknowledgment` rows are untouched; only the
   denominator changes.

## Phase 5 (Data), stage A: `scripts/report-access-grants-tables-forms.ts` (DRY RUN ONLY)

**What it is.** The report half of spec-tables-forms section 4 step 1 and data
migration (a): per org, every table that becomes "Everyone at {org} · Can edit"
(standalone tables, org-wide today), every table that inherits its Space instead,
every form's resolved anchor under access change request T2 (the List it feeds,
else the Table, else none, with a destination that no longer exists named), every
creator who gains an explicit Full access row, every live public link with the
org's toggle 10 value, and every creator who is missing or inactive.

**What it is not.** It never writes, and `--write` is refused with exit code 2.
There is no grants store yet (no `AccessGrant` model; access step 4), and the
access engine stays inert until Phase 8. The write is a separate script that ships
with the engine flip, run from this report after the founder approves it. Rules
1, 2 and 7 above are satisfied by the report itself; rules 3 to 6 bind the write.

**Production run (read only, safe to run any time):**

```
DIRECT_URL= DATABASE_URL="<production url>" \
  npx tsx scripts/report-access-grants-tables-forms.ts --report /tmp/phase5-grants-report.md
```

Read the "Totals" block first. Resolve every "missing or inactive" creator (make an
Owner the holder) before the Phase 8 write. The local run of 2026-09-23 (Acme Corp):
4 standalone tables (4 Everyone · Can edit rows), 4 forms with no destination,
8 creator Full rows, 0 ghosts, 2 live public forms, toggle 10 stored as `view`.

## Phase 5 (Data), stage A: behaviour changes with no data step

- **`/api/forms/[id]/submissions` is now a one-release alias** of
  `/api/forms/[id]/responses`. It answers in place by calling the new handlers (no
  redirect, so no http/https hop can turn a POST into a GET), and its GET keeps the
  old bare-array shape. Delete `src/app/api/forms/[id]/submissions/route.ts` in the
  release after Phase 5.
- **A form Submit is idempotent.** The responder sends a `submissionKey` (32 hex
  characters) with every Submit and retries it on a network error or a 5xx; the
  response is stored with that key as its `FormSubmission.id`, so a retry whose first
  attempt landed returns the first response instead of writing a second response, a
  second task and a second row. No schema change: the id column already takes any
  string. A body without a key is written as before.
- **Answers are coerced to their field's type** before they are stored or pushed to a
  List or a Table (text, number, checkbox, list of options), so an object such as a
  formula cell can no longer be planted in a destination through a form.
- **Reading a form's responses** (`GET /api/forms/[id]/responses`) now needs the
  form's creator, an Owner or Admin, or a person who reaches the form's anchor; a
  Guest never reads them unless they made the form. It used to answer any session in
  the org.
- **Sending a form answer needs a session.** The old submit route wrote anonymous
  responses whenever `isPublic` was on. The decided access model caps a public link
  at Can view (access invariant 19), and the per-form "Accept responses from people
  without an account" switch (founder decision D16) needs the additive
  `FormDefinition.settings` column (build step 6), so it is not built in stage A.
  No product surface lost anything: the responder and the embed both 401ed for
  anonymous visitors on the READ, so no anonymous answer could be sent from the UI
  before this change. An external integration POSTing anonymously now gets 401
  `sign_in_required`.
  **Before deploy, list the forms this can affect** (public forms that took an
  answer with no signed-in sender in the last 90 days; read only, run on the box):

  ```sql
  SELECT f.id, f.name, f."organizationId", COUNT(s.id) AS anonymous_answers_90d, MAX(s."submittedAt") AS last_anonymous
  FROM "FormDefinition" f
  JOIN "FormSubmission" s ON s."formId" = f.id AND s."submittedById" IS NULL
  WHERE f."isPublic" = true AND s."submittedAt" > now() - interval '90 days'
  GROUP BY f.id, f.name, f."organizationId"
  ORDER BY last_anonymous DESC;
  ```

  An empty result means nothing in the wild depends on anonymous sending. A row
  means an integration posts to that form; name it to the founder, because it stops
  landing on deploy day until D16 ships (the answers are refused with 401, not lost
  silently: the caller sees the refusal).
- **Deleting a form moves it to the one Trash with every response** (TrashType
  `form`, children `submissions`); it used to be a hard delete. Deleting a table or a
  form, and changing either's public link, now needs its creator or an Owner or
  Admin; a public link change writes an `access.public_link.on` / `.off` audit row.
- **Toggle 10 is now read by `/api/public/tables/[id]` and `/api/public/forms/[id]`**
  the way `/api/public/docs` reads it: only an explicit `"off"` closes the links;
  an org that never stored the key keeps today's behaviour. The public table route
  also answers 404 while the Tables module is off. Settings > Access shows an org
  that never stored the key as "Not chosen yet" under the switch, instead of a flat
  Off the live links would contradict; choosing either way stores an explicit value.
- **The public table route memoises its evaluated snapshot per process** (8 tables,
  60 seconds, keyed on the table's and its rows' updatedAt and the row count) and
  limits each IP to 300 requests a minute, so paging or hammering an embed no longer
  re-runs the engine over the whole table on every request.

## Phase 5 (Data), stage C: the form builder's settings column, and nothing to backfill

- **Schema**: `prisma/sql/2026-09-23-form-settings.sql` adds `FormDefinition.settings` (JSONB, NOT NULL, default `'{}'`). It is in the deploy manifest (`scripts/deploy-migrations.mjs`), so `npm run build` applies it before `next build`. To apply it by hand on the box: `npx prisma db execute --file prisma/sql/2026-09-23-form-settings.sql`, then `npx prisma generate`. Apply it **before** the code: a form query with no `select` asks for every column.
- **No data script.** Every existing form gets `{}`, which `readFormSettings` reads as today's behaviour: accepting responses, never closing on its own, the canon confirmation message ("Thanks, your response has been recorded."), "Submit another response" offered, nobody notified. So no live form changes on deploy day, and there is nothing to dry-run.
- **Where a response went** is recorded on new responses only, under the reserved `$went` key of `FormSubmission.data` (a task id on the List, a row id on the table, or the reason it was not sent). Responses written before this release show "Not sent" in the Went to column with no reason; nothing rewrites them.
- **Deleting responses** (one, or all behind a typed confirm) is new and is a hard delete by the form's creator or an admin. A single deleted response is written in full to the audit log first (`form.response.deleted`, `oldValue.data`), so an admin can read it back; "Delete all" records the count (`form.responses.deleted`).
- **New cron row, NOT installed**: "Form responses daily summary", `POST /api/cron/form-daily-summary`, 8 AM daily, in `scripts/CRON-SETUP.md`. It is fail-closed (503 with no `CRON_SECRET`). Until the founder adds it, a form set to "Send a daily summary instead" is quiet.

## One access model (2026-09-24): `scripts/report-folder-overgrants.ts` (DRY RUN ONLY) and `scripts/apply-private-rule.ts`

**What.** This release puts every node (Space, Folder, List, doc, table, canvas, form) on one access resolver (`src/lib/access/node-access.ts`) and one Manage access dialog. It fixes the reported bug ("admin on a folder gives the entire Space") **forward**: from this release a grant on a Folder never climbs to its Space or to sibling Folders, and the canvas Share chip no longer writes a Space row. **No existing row is touched on deploy.** Two scripts help the founder look at what the bug may have left behind and choose each workspace's rule for Private items.

**Why a report and not a clean-up.** A Space row the bug wrote and a Space row someone meant to write look the same in the database. Removing one by script would take access away from people who were given it on purpose, so neither script ever revokes a grant.

**Schema.** `prisma/sql/2026-09-24-access-grants.sql` adds the `AccessGrant` table (person grants on tables, canvases and forms). It is in the deploy manifest, so `npm run build` applies it before `next build`. By hand on the box: `npx prisma db execute --file prisma/sql/2026-09-24-access-grants.sql`, then `npx prisma generate`. Every reader answers "no grants" while the table is absent.

### `report-folder-overgrants.ts`: what it lists, per workspace

- **A. Space and Folder granted together** (a heuristic, never proof): every Folder grant whose person also holds a Space row in that Folder's Space, with both roles, both dates and both inviters. **SAME INVITER WITHIN WINDOW** marks the pairs one person wrote within `--window-minutes` (default 30) with a Space row below Owner.
- **A2. Space rows possibly written by the canvas Share**: Space rows (below Owner) whose inviter created or last edited a canvas in that Space within the window. **These cannot be told apart from deliberate Space shares.**
- **B. Folder grants inside an org-wide Space**, each marked "restriction impossible without changing the Space to Space members". Everyone at the org opens the whole of an org-wide Space, so the Folder grant only adds edit or manage rights on that Folder.
- **C. What the strict Private rule would change**: one sub-section per row of `NODE_ACCESS_DELTAS` (C1 N1, C2 N2, C3 N3, C4 N4, C5 N6, C6 N7), each row a person, a node, the change and the row that gives today's reach. **C7 (N5)** is strict only too: a sub-page would follow its parent page, and C7 names the people who open a sub-page today and would not. Under the legacy rule every page made before the workspace's cutoff keeps today's reach (see "The legacy cutoff" below). C8 lists anything the named rows do not explain (it should be empty).
- **D. Totals.**

`--write` is refused with exit code 2. The report never writes.

```
# Local (agents may run this; reads only)
DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
  npx tsx scripts/report-folder-overgrants.ts --report /tmp/folder-overgrants.md
#   --org <organizationId>    one workspace only
#   --window-minutes <n>      the SAME INVITER window, default 30

# Production, on /www/wwwroot/workwrk.com with the production DATABASE_URL in the env (reads only)
npx tsx scripts/report-folder-overgrants.ts --report ./folder-overgrants.md
```

### How to act on the report

- **An A row**: confirm with the person (and whoever invited them) whether the Space row was meant. If it was not, remove the Space row from that Space's Manage access dialog ("..." on the Space, Manage access). The dialog says when the person still reaches the Space some other way, and it refuses to remove the last Full access holder.
- **In an org-wide Space (the Space's visibility is Everyone at the org), removing the Space row changes nothing**: the person still opens the whole Space as every org member does (section B). To restrict, change the Space to Space members first, and expect everyone without a row to lose it.
- **An A2 row** may be a deliberate share. Treat it like an A row: ask first.
- **Nothing is revoked automatically**, by these scripts or by the release.

### The legacy cutoff: existing rows keep today's reach, new grants follow the new rules

The legacy floor (the reach a person had before this release) is kept for the rows that existed before it, and only for them. Each workspace records the instant this release first decided access in it, `Organization.settings.accessLegacyCutoff` (an ISO time). The first request that reads it stamps it, with one guarded UPDATE that only writes while the key is absent, so it is set once on deploy day and never moves (changing the Private rule rewrites `accessModel`, a different key).

- A SpaceMember, FolderMember or BoardMember row created **before** the cutoff keeps everything it gave before (A8), under the legacy rule.
- A row created **at or after** the cutoff (a grant from the Manage access dialog, a member route, an accepted email invitation) follows the new rules only (A2): a Folder grant does not reach a Private List or a Private sub-folder inside it that does not name the person.
- A sub-page made before the cutoff keeps today's reach (every page with no location opened to the org); one made after it follows its parent page (A6).
- **Nothing to run.** No row is rewritten. If the key cannot be read or written, every row reads as existing: today's answer, never a loss.
- To look at it: `SELECT "settings"->>'accessLegacyCutoff' FROM "Organization" WHERE "id" = '<orgId>';`. Do not edit it by hand: moving it later would give newer grants the older reach, and moving it earlier would take reach away from rows that had it.

### `apply-private-rule.ts`: the rule for Private items, per workspace

Every existing workspace starts under the **legacy** rule: a person keeps at least the reach they had before this release (the legacy floor), so nothing that works today stops working on deploy. Under the **strict** rule an item marked Private inside a shared container is reached only by the people it names. **The founder applies the strict rule one workspace at a time, after reading that workspace's section C.** The rule is `Organization.settings.accessModel.privateRule`; absent reads as legacy.

The script is a dry run by default: it prints the workspace's current rule and the C totals. `--write` sets (`strict`, `legacy`) or removes (`clear`) that one settings key through `writeOrgSettingsKeys` and records an `access.private_rule_changed` activity row, in one transaction. It never touches a grant row, so `--rule legacy` or `--rule clear` puts every person's reach back exactly as it was.

```
# Local (agents may run this)
DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
  npx tsx scripts/apply-private-rule.ts --org <organizationId> --rule strict            # dry run
DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
  npx tsx scripts/apply-private-rule.ts --org <organizationId> --rule strict --write    # apply

# Production (the founder only, after reading section C of the report for that workspace)
npx tsx scripts/apply-private-rule.ts --org <organizationId> --rule strict              # dry run first
npx tsx scripts/apply-private-rule.ts --org <organizationId> --rule strict --write      # apply
npx tsx scripts/apply-private-rule.ts --org <organizationId> --rule clear --write       # undo: back to legacy
#   --actor <email or id>     who the activity row names (default: the workspace's first active Owner, else Admin)
```

## 2026-09-26: reserved field keys, a read-only report for the founder

- **No schema change and no data script.** The field-keys fix (4c1c0c66) stops NEW custom fields from taking a built-in column's key and reads existing clashes safely, so nothing must run for the product to be correct.
- **One read-only report to run on the box, once, after this deploys**: `npx tsx scripts/report-reserved-field-keys.ts`. It prints, per org, every custom field whose key is reserved and flags "SHARED SLOT" where a field shares the task's own metadata slot (for example a field keyed `description`, which is literally the task body). It writes nothing. Locally it found 1 harmless view-level clash in 258 Lists. If prod shows a SHARED SLOT row, bring it back for a human decision; do not script a rename.

## Phase 7 (AI, automation and add-ons), stage A: two request tables, one reversible cleanup

- **Schema**: `prisma/sql/2026-09-24-phase7-requests.sql` creates `IntegrationRequest` ("Request this" on /integrations, unique on organizationId, key and userId) and `AppSuggestion` ("Suggest an app" on Marketplace). Two new tables, no existing column touched. It is in the deploy manifest (`scripts/deploy-migrations.mjs`). By hand: `npx prisma db execute --file prisma/sql/2026-09-24-phase7-requests.sql`, then `npx prisma generate`. Deploy order is free: the catalogue reads zero counts and the two request routes answer a named 503 while the tables are absent. (Prisma 7's `db execute` no longer takes `--schema`; it reads `prisma.config.ts`, whose datasource is `DIRECT_URL || DATABASE_URL`.)
- **`scripts/cleanup-legacy-automation-workflows.ts`** removes the legacy Autopilot rows: `Workflow` rows with `kind = AUTOMATION`, which only the deleted `/autopilot` mock and `/api/autopilot/*` ever wrote and which nothing ever ran (`src/lib/workflows/runtime.ts` `triggerEvent` has no caller). APPROVAL rows are never touched. Dry run by default: it prints the rows per organization. `--export <file>` writes every AUTOMATION row with its `WorkflowRun` rows as JSON, and `--write` refuses to run without `--export` in the same command, so the delete always has its undo; it then asserts zero remain. `--restore <file>` recreates the rows from an export, skipping ids that already exist. Local run on 2026-09-27: 0 AUTOMATION rows and 0 APPROVAL rows, report at `phase7-reports/cleanup-legacy-automation-dry-run.txt` and the (empty) export at `phase7-reports/cleanup-legacy-automation-export.json` under the Phase 7 scratchpad, both written by the dry run with `--export`. Production, founder's step:
  ```
  DIRECT_URL= DATABASE_URL=<prod> npx tsx scripts/cleanup-legacy-automation-workflows.ts                       # read the report
  DIRECT_URL= DATABASE_URL=<prod> npx tsx scripts/cleanup-legacy-automation-workflows.ts --export legacy-automation.json --write
  ```
  Keep the JSON: `--restore legacy-automation.json` is the way back.
- **No data step, behaviour changes to know about**:
  - Tool and Asset deletes go to the one Trash (TrashType `tool` with its `ToolShare` rows, and `asset`) instead of erasing the row. Past deletes are already gone; nothing is backfilled.
  - `GET /api/assets?assignedToId=` now narrows within the caller's scope instead of skipping it. A colleague's profile Assets tab shows only what the viewer may already see (their own kit, their reports' kit, or everything for an org-wide role).
  - `GET /api/integrations` returns the connector catalogue. Its old body returned every `Integration` row with its `config` (API keys) to any signed-in person and had no caller in the app; the rows, without config, are `?records=1` for Owners and Admins.
  - Agent writes (add, create, pause, schedule, Run now, remove) are Owner and Admin. Adding a catalog agent always was; creating a custom agent and scheduling one were manager and above. Agent runs: Owners and Admins read every run; everyone else reads autonomous runs and their own.
  - Build apps is Owner and Admin (APP_RULES.build), pages and API alike, including `/api/build/generate`, which any member could call. **The Member exception, one exception so nobody loses what they could do before:** in an org that has built apps, a Member keeps USING them (the list shows the org's live apps plus their own archived ones; open any of them, add, change and delete rows) and gets an APPS > Build apps row; on the apps THEY created they also keep archive and restore. Creating a new app and AI generation are Owner and Admin (`src/lib/build/gate.ts`), and that is the one narrowing. **Founder decision still open, reported as a spec conflict** (spec-tools-misc 2.3 open question 1): whether a Member may build their own apps, as they could at HEAD. Before shipping, count who made the apps on production:
    ```sql
    SELECT u."accessLevel", a.status, count(*) AS apps,
           count(*) FILTER (WHERE jsonb_array_length(COALESCE(a.ui->'rows', '[]'::jsonb)) > 0) AS apps_with_rows
    FROM "App" a LEFT JOIN "User" u ON u.id = a."createdById"
    GROUP BY 1, 2 ORDER BY 1, 2;
    ```
    Apps created at a Member level are the ones whose makers can no longer make another; if that count is not zero, decide before the deploy.
  - Automation writes are unchanged (create, edit, publish, activate, deactivate and retry for a manager or above; delete and connections for Owner and Admin), but the Automation pages are now open to every Member to read, with every write control hidden for a viewer the write routes refuse (`GET /api/automation/me`).
  - The Cashkr-era automation triggers (leads, quotes, pickups, payments) and the Leads template are hidden, not deleted: an org that sets `Organization.settings.automation.legacyTriggers = true` gets them back, and a workflow already on one keeps it.
  - `settings.data.aiEnabled === false` turns the `ai` app key off (Ask AI and Agents answer `AppOff`, the API 403 `app_off`; scheduled agents skip the org), and the model calls of this phase's other surfaces answer 403 `ai_off` (`src/lib/ai/ai-off-gate.ts`: the meeting summary `POST /api/ai`, `/api/ai/cmdk-summary`, `/api/ai/inbox-suggestion`, `/api/build/generate`); absent reads as on. Automations are unaffected. **Still to follow with the switch's writer (Phase 8, Data > Retention and privacy):** the AI calls owned by other hubs (docs write/ask/summarize/extract-table, tables ask, canvas generate/analyze, forms generate, notetaker process, KRA and SOP generate, OKR assess, board field suggest, file summarize) do not read the switch yet. No org can turn it off before Phase 8 ships the control.

## Phase 7 (AI, automation and add-ons), stage C: the automation hub, one small table and one cron row

One additive schema file, `prisma/sql/2026-09-27-automation-cron-tick.sql` (the `AutomationCronTick` table, in the deploy manifest; see `prisma/sql/README.md`), and no data script. What the founder has to do beyond the manifest is one cron row:

- **`POST /api/cron/automation-schedule`** fires the two time triggers (a task's date arrives, every time period). The row is written in `scripts/CRON-SETUP.md` (every 5 minutes, `x-cron-secret`) and is NOT installed until the founder adds it to the root crontab. Until it runs, the two time triggers read "Not live yet" everywhere (the builder, the Workflows list, Templates): the cron stamps `AutomationCronTick` on every tick and the trigger catalog treats a stamp older than twenty minutes as not live, so a workflow on a time trigger can be published but is never shown as live on a host where nothing fires it. The endpoint FAILS CLOSED in production: with `CRON_SECRET` unset it answers 503 instead of running for anyone who POSTs to it.
- The webhook signing secret lives in the existing `IntegrationConnection.metadataJson` (the raw value is what signs each delivery; the API never returns it after the one-time display and the page gets only its last four characters), so connecting, rotating and disconnecting need no column. An org that connected the webhook before this stage has no secret until an Owner or Admin presses Save on Connections again, which makes one.
- `definition.scope` lives in the existing `AutomationWorkflow.definition` JSON. A row with no `scope` reads as Everywhere, so old workflows keep running exactly as before.
- Version restore writes a new `AutomationWorkflowVersion` row (and keeps the replaced draft as its own row when nothing else holds it). The engine runs the PUBLISHED version, not the draft, so a restore or a saved draft changes nothing live until Republish.

## Phase 7 (AI, automation and add-ons), stage E: the legacy Marketing module becomes a Space

No schema file: the two markers the resolver reads live in JSON columns that already exist (`Space.settings.legacySource = "marketing"` and `Board.settings.legacyKind` of `campaigns`, `content` or `events`; the spec's `metadata` column does not exist on either model), and the write-back is `customFields.migratedItemId` on each `Campaign`, `ContentItem` and `EventBrief` row. Two steps for the founder, in this order:

1. **Seed the rewritten "Marketing" Space template** (`space.marketing` in `prisma/seed-templates.ts`: three Lists, Campaigns, Content and Events, each with its own statuses and fields; it used to be two Lists with no fields). Idempotent by key, and an org that adopted the key keeps its own row:
   ```
   DIRECT_URL= DATABASE_URL=<prod> npx tsx prisma/seed-templates.ts            # report
   DIRECT_URL= DATABASE_URL=<prod> npx tsx prisma/seed-templates.ts --write
   ```
2. **`scripts/migrate-marketing.ts`** moves every organization's legacy rows onto tasks in a Marketing Space built from that template (`src/lib/marketing/legacy-import.ts` does the work; the same function sits behind the "Marketing (legacy)" row on Settings > Data, so an Owner can run their own org from the page instead). Dry run by default with a per-org report (rows read, already moved, to write, statuses that moved to a neighbour, owners no longer members, campaigns in another currency, columns folded into the description); `--org <id>` for one org; `--report <file>` saves it (`.json` for the full structure). Idempotent: the Space and Lists are found by their markers and a row whose `migratedItemId` names a task that still exists is skipped, so a second run moves only what the first did not. **Nothing is deleted**: the three tables and every row stay, each gaining `migratedItemId`. The write is not one transaction (it goes through `createSpace`, `applyListTemplate` and `createBoardItem`, the product's own creators, so the Space has its owner row, the Lists their views and every task its activity line); a run that stops part-way is resumed by running it again, and every run ends with a read-back that asserts every row points at a task on its List. Local run on 2026-09-27 against the test org (8 rows: 3 campaigns, 3 content, 2 events, one owner dropped, one status moved per kind, one campaign in EUR noted in its description): report and write log under the Phase 7 scratchpad (`phase7-reports/migrate-marketing-*.txt`); the second run reported 8 already moved, 0 to write. Production, founder's step:
   ```
   DIRECT_URL= DATABASE_URL=<prod> npx tsx scripts/migrate-marketing.ts --report marketing-dry-run.txt   # read it
   DIRECT_URL= DATABASE_URL=<prod> npx tsx scripts/migrate-marketing.ts --write --report marketing-write.txt
   ```
   The Space is created visible to the whole organization, because the legacy pages answered to any signed-in employee; narrowing it afterwards is the Owner's call. **One narrowing to know about, stated on the page's confirm, its success toast and the script's report:** the old pages let ANY signed-in employee add and edit campaigns, content and events; after the run every Member can VIEW the Space and its three Lists, and editing needs Space membership, which an Owner grants from the Space's share dialog. Nobody loses a record; a Member who edited yesterday edits again once added. Money fields on the Lists carry the org currency (`settings.currency`); a campaign stored in another currency does NOT have its budget or spend written into those columns (it would render under the wrong symbol and be summed with the rest): its figures go into the description as "Budget: 5,000.00 EUR" and "Spent: ..." lines, and the raw numbers sit under `metadata.legacyMarketing.budget` and `.spent` with `.currency`. The CSV export carries every row's own currency in a column, so it is the exact copy.

   **Guards on the write** (each reviewed against the worst case):
   - **The template is checked, not trusted.** The import refuses unless the built-in `space.marketing` template holds the three Lists by name, each with its own statuses and its own fields; an older seed (two Lists, no fields) is refused with the reason, since a run marks every row and there is no second chance. So step 1 above really is first: the "Import" button on Settings > Data answers "The Marketing Space template is not ready on this workspace yet" until the re-seed has run.
   - **One write at a time per organization.** The write holds a per-org advisory lock (`pg_try_advisory_xact_lock(hashtext('legacy-marketing-import:<orgId>'))` on a transaction kept open for the run); a second Owner's click, or the script overlapping a click, is told "An import is already running for this workspace" and writes nothing.
   - **A marker Space in any state is the marker.** An archived (trashed) Marketing Space, or List, still counts as migrated: no second Space is ever built beside it, the old `/marketing` links still resolve to it, the Data page says it is in Trash with a link to Trash, and the import answers "Restore it from Trash first" while it is there.
   - **The crash window re-links instead of duplicating.** If the process dies between creating a task and marking its row, the next run finds the task on the marker List by its provenance (`metadata.legacyMarketing.id`), writes the missing `migratedItemId` back and reports it as "re-linked", so no row ever gets two tasks.
   - **Counts are exact on the run where they matter.** `written` moves with every row, so a run that stops part-way reports what it actually wrote; the page shows the partial report with "run Import again to finish" (the API answers 200 with the report, the report's own `error` says it stopped).
   - **The read-back checks existence, not the List**, so a migrated task a person has since moved to another List (theirs to do) no longer fails a later re-run.
   - **A trashed task counts as moved**, in either of the two ways a task reaches Trash: archived in place (`archivedAt`, Trash > Archived) or deleted into a `TrashItem` snapshot (Trash > Deleted, which removes the `Item` row; on its own, or inside the snapshot of the List, Folder or Space it was deleted with). The rule is `legacyRowState` in `src/lib/marketing/legacy-map.ts`: a row is moved when any task, live or in Trash, carries its marker (the row's `migratedItemId`, or the task's `metadata.legacyMarketing`). `/marketing/{id}` for a campaign whose task is in Trash lands on the Campaigns List with "That campaign's task is in Trash", never inside the trashed task; the Settings > Data row says "moved, then put in Trash. Restore it from Trash." and offers no Import for it; the report counts it as "in Trash" and writes no task for it, so restoring the trashed task never makes two. Before 2026-09-27 only the `Item` table was read, so a task deleted to Trash counted as never moved and Import made a second one. Only a task deleted for good from Trash leaves its row importable again.
   - **A re-date writes the zone with the dates.** The correction of tasks an earlier run wrote verbatim sets `metadata.legacyMarketing.dateZone` in the same transaction as `startAt` and `dueAt`, and a task whose provenance names a `dateZone` is never corrected again, so a later run by an Owner in another zone cannot move its dates a second time.

- **Before the run**: `/marketing` and its four children send an Owner or Admin to `/settings/data?tab=import&legacy=marketing` (the row scrolls into view and pulses; for a workspace that never held a row it says so and links the Marketing Space template instead of showing nothing) and everyone else to the in-shell 404; a Guest always gets the 404. **After the run**: they 308 to the Space, the List or the task (`/marketing/{id}` to the campaign's task; a campaign created after the import lands on the Campaigns List with the notice "That campaign was not moved yet. An Owner or Admin can bring it over from Settings > Data", which deviates from spec 2.11's "It is in the list" because the campaign is not in the List; an id no campaign ever had is a 404). The five marketing pages are deleted; the whole thing is `src/app/(dashboard)/marketing/[[...slug]]/page.tsx`. **Two things to know when checking it:** (1) on a hard load the 308 and 307 are RSC redirects inside a 200 body (the page sits under the dashboard's streaming boundary, which the in-shell 404 needs), so curl and link unfurlers see 200 with no Location header while every browser lands on the target; do not file the 200 as a regression. (2) `ROUTE_HUB` keeps a `/marketing: home` row and a `ROUTE_TITLES` entry although spec-tools-misc section 4 says the prefix is dropped: the route-hub completeness test requires a row or a listed redirect exemption for every directory under `(dashboard)`, the resolver never paints, so no rail pill or crumb is ever derived from it; a deliberate, harmless deviation.
- **Kept for one release**: `GET /api/marketing/campaigns`, `/content` and `/events`, now Owner and Admin only through the Data gate (they answered any session and their POST and PATCH handlers let any employee create and patch campaigns; those handlers are gone). Delete the three routes with the next release, after the production run. The CSV export (`GET /api/marketing/legacy/export?entity=`) stays as long as the tables do.
- **Removed with the pages** (each had no other consumer, checked by grep): `src/lib/dept-home.ts` and `src/components/dashboard/dept-workspace-banner.tsx` (routed to /crm, /itsm, /legal, all long gone); the product-catalog entries `workwrk-assets` and `workwrk-campaigns` with their department recommendations, the `workwrk-campaigns` board tree, the Mira agent (its product is off-scope and `PRODUCT_TOOL_NAMES` already excluded it from `available`) and the "Q4 campaign launch" quick-start template (it wrote rows into the retired tables); the `GRAD` gradient map; the `.mkt`, `.camp`, `.cmps`, `.evts` and `.lib` CSS families. Existing `Product` and `ProductInstallation` rows for the two slugs stay in the database and are ignored: `seed-products.ts` only upserts what the catalog names.

## Phase 7 (AI, automation and add-ons), close: deviations to ratify and two decided additions deferred

No data step. This section is the founder's list of where the shipped hub reads differently from the canon and why, and of the two decided additions (competitor-gap 2026-09 section 7, decision 9 and gap 18) that did not ship in this phase.

- **Deferred, not dropped, the two "AI inline first" items still open.** (1) **AI field autofill** (ClickUp's AI field): no "Fill with AI" on a custom field yet. The inline entry points that did ship are the task strip, the list-row menu and the doc editor's `/ai` slash row; the only field-level AI call today is the Fields panel's name suggestions (`POST /api/boards/[id]/fields/suggest`), which suggests fields, not values. (2) **Agents that write project updates and standups into Talk channels**: no agent tool posts a message. The reason is mechanical, not a decision: posting into a conversation (membership check, markup strip, realtime publish, the Inbox notification keys) lives inside `POST /api/conversations/[id]/messages` and has no server library function, so an agent tool would have to copy that pipeline or call the route as the person. Extracting it is Talk-unit work; when that helper exists the tool is one `ToolDefinition` in `src/lib/agents/tools.ts` gated like the other agent writes. Both stay on the Phase 8 list.
- **`/sidekick?q=<text>` prefills and focuses the composer instead of sending.** spec-ai-automation's URL-state table says the text is sent immediately. The shipped behaviour waits for the person to read and press send, because a link (a Slack message, a bookmark, a palette row) firing a model call and a persisted chat turn on click is the worst case for a Member who did not write the text. One keypress more; nothing lost. Ratify or flip: the send is one line in `src/app/(dashboard)/sidekick/page.tsx` (the `ask` intent).
- **The CHATS "All chats" ghost row renders always**, not only past fifteen chats: it is also the door to Pinned and Archived and the one place an archived chat is restored, so hiding it under fifteen chats would leave an archived chat with no way back for a person with few chats. The label switches to "See all chats" past fifteen.
- **Build apps for a Member (the Member exception)** is above, in stage A, with the SQL to run before deciding.
- **A Member who created a Build app keeps managing it** (rename, fields, archive, restore, delete) through `canManageBuildApp`, the same rule as before this phase; a Member gets 403 on every other app. The new Edit fields modal (`/build/[slug]` "…") never touches rows: a removed field hides its column and every row keeps its values under the old key.
- **`/marketing` is now a redirect exemption** (`REDIRECT_ROUTES`) rather than a `home` hub row, which is what spec-tools-misc section 1 asked; the note in stage E that kept the row is superseded.
- **Not in this phase, for Phase 8's Settings > Apps and modules > Automations card:** the "Automation settings" row on the Workflows page "…" and the "Pause all automations" text link on Usage both point at that card, so they are added with it, not before it.

## Phase 6 (People), stage A: one SQL file, four backfills, two reports

Everything here is for the founder to run on production; stage A ran it on the local database only.

- **Schema**: `prisma/sql/2026-09-26-phase6-people.sql`, additive and idempotent (ADD COLUMN IF NOT EXISTS and CREATE ... IF NOT EXISTS only): `User.weeklyCapacityHours`, `presenceStatus`, `presenceUntil`, `workSchedule`, `customFields`; `Threshold.escalatedToId`; `KPIRecord.reviewedById`; `OKR.completedAt` (Mark complete on a goal; nothing re-derives it); `ReviewCycle.createdById`, `audienceType` (default `ALL`), `departmentIds`, `userIds`; `Review.potential`, `calibratedById`, `calibratedAt`; `TalentAssessment.source` (default `MANUAL`), `cycleId`; `PulseSurvey.createdById`; the new `CandorRespondent` table (unique per session and person, no answer column). It is in the deploy manifest (`scripts/deploy-migrations.mjs`), so `npm run build` applies it before `next build`. By hand on the box: `npx prisma db execute --file prisma/sql/2026-09-26-phase6-people.sql`, then `npx prisma generate`. Apply it **before** the code: the new scalar columns are on the Prisma models.
- **Backfills**, `npx tsx scripts/backfill-phase6-people.ts`, dry run by default, a per-organization report, `--write` to write, `--step=` to run one, `--report=<file>` to keep the report:
  - `talent-source`: `TalentAssessment.source = 'SCORES'` where `notes = 'Auto-placed from performance score'` and the source is still `MANUAL`. Nothing else on the row changes.
  - `survey-creator`: `PulseSurvey.createdById` from the earliest `ActivityLog` row of type `survey_created` for that survey, when its actor is a member of the survey's org. **Expect it to find nothing**: the survey create route never wrote that log (Phase 6 reconnaissance), so every existing survey keeps a null creator, which keeps it with the People team, Admin and the manager tier that could manage it yesterday. From this release `POST /api/pulse-surveys` stamps the creator. It is kept so a database that does carry the log (an import, a manual log) is handled.
  - `cycle-creator`: `ReviewCycle.createdById` from the earliest `ActivityLog` row of type `review_cycle.create` (written by `POST /api/reviews` since before Phase 6) whose actor is a member of the org, so the manager who started a cycle keeps managing it for their current chain. Cycles with no such log stay with the People team and Admin.
  - `dept-goal-assignees`: one `GoalAssignee { okrId, departmentId }` for each `DEPARTMENT` goal with a `departmentId` and no audience row for it, so the goal keeps showing in that department's My goals. Run it **before** the release that makes bare `/okrs` My goals is relied on; until it runs, `GET /api/okrs?mine=1` also carries the viewer's department goals directly, so nothing disappears either way.
  - Local run (2026-09-26, before the `cycle-creator` step existed): dry run and `--write` found 0 candidates for the other three steps in each organization; assertions passed.
  - Local run (2026-09-27, all four steps): the dry run found 2 review cycles with no creator in Acme Corp, 1 with a `review_cycle.create` log; `--write` stamped that one and left the other null (no log, so it stays with the People team and Admin); assertions passed, and a second dry run found 1 without a creator, 0 with a log, 0 to write. Every other step found 0. Reports: `phase6-reports/backfill-dry-run-2026-09-27.txt` and `backfill-write-local-2026-09-27.txt` under the Phase 6 scratchpad.
- **Reports, never write**:
  - `npx tsx scripts/report-department-colors.ts`: every department's stored colour (legacy hex, the dialog's CSS var, empty) and the eight-hue index it would become (`src/lib/people/department-hue.ts`). The write lands with the Departments rebuild, whose picker stores the index. Local: 6 hex rows mapped (the purple seed colours to Sky), 1 empty, 0 unmapped. It also prints a COLLISION line for every hue two or more departments would share, so a person can re-pick distinct colours in Teams > Departments before the dots stop telling them apart (local: Sky is shared by Engineering, Finance and HR).
  - `npx tsx scripts/report-escalation-thresholds.ts [--org=<id>] [--report=<file>]`: per org, every threshold joined by job title (`Threshold.roleId` to `User.roleId`, leavers excluded), how many people it matches, who an escalation would reach (the threshold's `escalatedToId`, else each holder's manager, with a count of holders who have neither and a warning when the named person has left), and for overdue-shaped triggers with a duration unit how many OPEN Items (owner or any assignee, done statuses excluded, read in id-cursor pages with no cap) would have crossed the threshold in the last 30 days. It has no `--write`: it cannot write. The counting rules are `src/lib/people/escalation-report.ts` (tests beside it). **Report only in Phase 6**: the job that escalates waits for the founder's approval (spec-teams-people T9). Until then the Thresholds card on `/people/roles/[id]` stays behind Show upcoming features with the caption "Not enforced yet", and no Threshold row is deleted. Founder step on production: run the report, save it, decide; on approval the job is written over Items and the card's wrapper and caption come off in the same change. Local 2026-09-28: 0 thresholds (a probe threshold created and removed through `/api/thresholds` matched 12 holders, all with no manager, 0 items in the window).
- **Behaviour changes with no data step** (so nobody is surprised):
  - The weekly review decision no longer overwrites `WeeklyReview.managerId` with whoever acted; the recorded manager keeps the row, and the actor is in the activity log (`weekly_review_decided`). A request for changes now needs a note in both places it can be made.
  - `POST /api/users` and `POST /api/people/bulk-import` no longer take an access level on trust: below Company Admin only Employee or Agent can be given (`src/lib/people/grantable-level.ts`); an import row asking for more is an error in the dry run.
  - A new review cycle records its creator; a manager's cycle covers their own reporting chain at launch; changing, launching, calibrating and finalizing a cycle is the People team's, an Admin's or the starting manager's; deleting one is the People team's or an Admin's. Cycles made before this release get their creator from `cycle-creator`; a cycle with no creation log stays with the People team and Admin. A starting manager's calibration and finalize rights cover only the people in their CURRENT chain, so a person who moved to another manager leaves the old manager's reach.
  - The subject of peer feedback now sees the aggregate rating only, never the written answers or who wrote them; the peer feedback list for a review and a person's review history now need the reviewer, the chain, the People team or an Admin.
  - The 9-box never shows a person their own placement, and places only people in the caller's scope.


### Phase 6, stage E (reviews, talent, candor, surveys): no schema, no data step

Stage E adds no SQL and needs no backfill: it reads the columns stage A's file added. What changes in behaviour, for the founder to know before the deploy:

- **Weekly reviews** (`/team/reviews`) now read `GET /api/weekly-reviews` (the chain scope, direct reports by default; KRA and KPI names, never ids). A draft someone has not submitted is listed as "Not submitted" but its body is never shown to anyone but its author. `POST /api/weekly-reviews/reminders` nudges the author of a draft, or the manager of a waiting review (never the sender), once in 12 hours.
- **Review cycles**: the named moves only. Draft to Active by Launch; Active to In calibration by Start calibration; Completed only by Finalize, and only once every review in the cycle is completed (a partial finalize leaves the cycle In calibration and says how many remain); Draft or Active to Cancelled by `POST /api/reviews/[id]/cancel` (nothing is deleted). A calibration change no longer moves the cycle. A submitted self review is read only (it used to fall back to "not started" on the next autosave); a submitted manager review freezes once calibration starts, and one never submitted can still be submitted. The composite uses Settings > Scoring and reviews > Score weights (kpi, sopCompliance, behavioral, peer; a part with no data is left out, not counted as zero) and the org's performance bands; the manager's scale words are the behavioural anchors when set, the built-in five otherwise.
- **Finalize** writes one talent placement per finalized review when "Also place these people on the talent grid" is on (the default): period = the cycle name, `source = 'CALIBRATION'`, `cycleId` set, never over a placement someone made by hand.
- **Talent**: `GET /api/talent-assessment` never writes; Fill from scores is `POST /api/talent-assessment/fill` behind a confirm that names the count; `DELETE /api/talent-assessment/[id]` removes one placement.
- **Candor**: prompts get stable ids when written (`p1`, `p2`...); answers are validated against them; one answer per person (CandorRespondent); results need four answers. Answers already stored under the old random ids cannot be matched after the fact (they were never matchable).
- **Surveys**: Save as draft is real; questions, audience and anonymity are fixed once a survey opens; a survey anyone answered cannot be deleted (close it); the Inbox rows and emails link the survey itself.
- **Inbox kinds written from this release**: `review_open`, `manager_reviews_due`, `candor_open`, `survey_open`, `weekly_review_reminder` (all registered in `src/lib/inbox-kinds.ts`).
- **Stage E review fixes (no schema, no data script)**: the cycle CSV's `?subjectIds=` now only narrows the caller's reach (it used to replace it); nobody's calibration, cycle CSV or cycle page lens includes their own review (a subject who is Admin or People team reads their row as its subject); the cycle list and its CSV follow app:reviews (a subject reaches their review by its link and their profile); weekly, talent, cycle and survey CSVs escape formulas; an anonymous survey's CSV is one row per answer with each question under four answers hidden (no per-person rows); the attributed survey CSV works again (it selected a relation SurveyResponse does not have); Reopen works on a survey whose close date passed; a repeated weekly decision answers 200 and reuses its one Inbox row; asking for peer feedback suggests who works with the subject and finds anyone active in the org by name, as before Phase 6; unsent candor and survey answers are kept per person and cleared on sign out.
- **Crons** (`scripts/CRON-SETUP.md`): the review cycles auto-open now tells the People team and Admins only, with a link to the cycle; the survey rotation links the survey; a NEW row, "Review closes in 3 days" (`/api/cron/review-closing`, 8:30 daily), is **not installed**: the founder adds it. All three refuse to run in production when `CRON_SECRET` is unset.

## Phase 8 (Settings, My settings, sign-in, access), stage A: no schema, no data step; three deferrals written down

Stage A ships the settings chassis, the fourteen settings redirects and the /register split. It has no SQL file and no backfill. Three things the specs list for A0 are deliberately NOT in it, recorded here so the count of redirects is not misread:

- **/welcome and /setup to /onboard (spec-account-auth A0(a), two of its ten 308s): deferred to A3.** They ship in the same change that repoints the two callers, never before them. Today `src/components/auth/register-form.tsx` pushes a fresh sign-up to `/welcome` (invited) or `/setup` (new workspace), and `src/app/api/onboarding-progress/route.ts` links `/setup`. A bare 308 now would send a freshly invited Member into the admin wizard (the worst case the A3 wizard, an offer not a gate, exists to remove). Until A3 both old pages keep answering 200 as they did at 9e2d21d1.
- **/me/mentions to /inbox?tab=mentions (settings-architecture 8.4): deferred until `scripts/backfill-mentions.ts` has run in production.** /me/mentions stays a page because it is the only door to doc and SOP mentions until then (the comment in `src/lib/settings-registry.ts` above SETTINGS_REDIRECTS).
- **/imports to /settings/data?tab=import: deferred to S5.** Until then /imports renders inside the takeover with the Data row active (`alsoActiveOn`) and the crumb Settings > Workspace settings > Data > Import.

One cosmetic difference is also recorded rather than fixed by editing `next.config.ts` (an edit there restarts the dev server): the query-matched `/settings?tab=shortcuts` row carries its matched `tab=shortcuts` along to `/account/shortcuts` (Next appends the source query; that page has no tabs, so it is inert). The registry's route twin now answers the identical Location, so config, twin and test agree. The config comment that says the target's own tab wins is true only for the themes row; correct it in A3 when the /welcome and /setup rows are added to the same table.

Invitation and create levels (review A fix): one rule, `src/lib/access/invite-level.ts` resolveGrantLevel, used by POST /api/invitations, POST /api/setup, the AI agent's invite tool and POST /api/users. HR may again invite at any non-admin level. No data changes: invitations already stored keep their level and accept as stored.

## Phase 8 (Settings, My settings, sign-in, access), stage B: sign-in and the wizard; one SQL file, no backfill

Schema: `prisma/sql/2026-09-30-phase8-settings-access.sql`, the ONE file for Phase 8 (later stages append guarded statements to it). Stage B adds two nullable columns, `User.termsAcceptedAt` and `User.passwordChangedAt`. It is in the deploy manifest and must land before the code (signup, join and reset write both). No row is read or written by the file and there is no backfill: a null reads as "not recorded". Applied locally 2026-09-30 with `prisma db execute`.

Behaviour changes with no data step, written down so nobody looks for a migration:

- **New workspaces are complete when they exist.** `seedOrgDefaults` (`src/lib/org/seed-org-defaults.ts`) runs inside both org-create transactions (POST /api/auth/register and POST /api/organizations/create): the six departments (as before), and, only where the key is absent, timezone (the signup browser's, else Asia/Kolkata), currency and fiscal month by that zone, language, the enforced password rules, the ten access toggles at their section 8 defaults, trash retention 60 days and `settings.console` at step 1. The General Space (visibility ORG, the creator its Owner, one "Tasks" List) is made right after, through `createSpace` and `createBoard`; a failure there is logged and does not undo the workspace. Existing workspaces are NOT back-filled: every reader already falls back to the same defaults, and a backfill would write values nobody chose.
- **No setup gate.** `(dashboard)/layout.tsx` no longer sends an Owner or Admin of an unfinished workspace to /onboard. The wizard is reached from /signup and from the "Set up {Org}" card on Workspace settings > Overview. Workspaces that hold the old `settings.setupCompleted: true` read as completed (`src/lib/setup/console-state.ts`), so no finished workspace is offered setup again; Finish writes `console.setupCompletedAt` and mirrors `setupCompleted: true`.
- **Retired routes.** GET/POST /api/setup and GET /api/onboarding-progress answer 410 and change nothing. /welcome and /setup 308 to /onboard (next.config.ts rows plus route twins). The businessType, industry and teamSize values /setup stored stay on the org untouched. Workspace settings Overview reads them (Industry, Team size), and Identity & culture edits them: Business type and Team size through the general section, Industry through the company profile (a stored settings.industry shows there until the first save moves it).
- **Invitations.** The raw token no longer comes back in the 201 of POST /api/invitations (it goes to the invitee by email only, as the GET already did). The inviter's personal message is kept in the `user.invited` audit row's metadata so /join can show it; invitations sent before this release show no message. A signed-out accept for an address that already has a live account anywhere is now a 409 `account_exists` and creates nothing (it used to create a second User row for the same mailbox); the person logs in and joins, which writes an OrganizationMembership and moves them into the joined workspace through `reanchorUser` (the one they leave stays a membership at their level there).
- **Tokens.** Email verification tokens are stored as their SHA-256 from this release; links mailed before it hold the raw value and are still honoured for their remaining 24 hours (the fallback never accepts a 64 hex value, so the stored hash itself cannot verify an address). A reset link is now claimed atomically, so two submits of one link cannot both change the password.
- **Email log.** EmailLog used to keep the full rendered HTML of every email, so every raw reset, verification and invitation link sat in plain text next to the hashed tokens. From this release a row for a secret-bearing template (password-reset, verify-email, invitation, invitation-space, invitation-space-resend, document-sign; `SECRET_LINK_TEMPLATES` in src/lib/email.ts) never stores the link variables, and its HTML is cleared the moment it is SENT or finally FAILED. Rows sent before the release still hold their links. Founder step, once, after deploy (idempotent, touches only closed secret rows, keeps the delivery log): `UPDATE "EmailLog" SET html = NULL, variables = '{}'::jsonb WHERE status IN ('SENT','FAILED') AND template IN ('password-reset','verify-email','invitation','invitation-space','invitation-space-resend','document-sign') AND html IS NOT NULL;` Rollback: none needed (a sent email is not re-sent from the log).
- **Signup email check** is case-insensitive (a second workspace for "Priya@Co.com" when "priya@co.com" exists is refused). Stored addresses are not rewritten.

## Phase 8 (Settings, My settings, sign-in, access), stage C: My settings; no schema, one browser-side data move

**No SQL file.** Every column this stage reads already exists: `User.presenceStatus`
and `presenceUntil` (Phase 6, `2026-09-26-phase6-people.sql`), `User.passwordChangedAt`
(Phase 8 stage B, `2026-09-30-phase8-settings-access.sql`). Every new preference key
lives inside the existing `UserPreference.home` and `sidebar` JSON columns, strict at
every level in `src/lib/preferences-schema.ts`.

**The one data move: browser storage to the server keys (settings-architecture 7.3).**
It runs in each browser, once, on the first load of the new release
(`src/lib/local-prefs-migration.ts`, run by `src/components/layout/os/shell-context.tsx`
through `src/lib/local-prefs-migration-runner.ts`):

| Browser key | Server key | Rule |
|---|---|---|
| `workwrk:os:sidebar-width` | `sidebar.width` | carried when the row has none |
| `workwrk:os:sidebar-collapsed` | `sidebar.collapsed` | same |
| `workwrk:os:profile-tool-pins:v2` | `sidebar.quickTools` | same |
| `workwrk:os:muted-notifs` ("1") | `home.notifications.mutedUntil` (24 hours from the carry, bounded so one stale browser cannot mute every device indefinitely) | same |
| `desktop-notifications-pref` | `home.notifications.desktop` | same |
| `workwrk:density` | `UserPreference.density` | same |
| `workwrk:task-saved-filters` | `home.work.savedFilters` | same; nameless entries dropped |
| `workwrk:os:presence` | `User.presenceStatus` / `presenceUntil` (PUT `/api/me/presence`) | only when the server has no status and the local one has not expired |
| `workwrk:os:active-app`, `:lens`, `:icons-only` | none | removed, nothing reads them |

The server always wins (another device, or a later choice, is never overwritten by an
older browser). A key is removed from the browser only after the write that carried it
answered ok, so a failed write retries on the next load. Before this stage the shell
deleted the first five keys on boot WITHOUT reading them; a browser that already lost
them lost nothing a person could see (the server defaults applied), and this stage
stops the deletion-before-read for everyone else.

The workload capacity key (`workwrk:team-workload:v1`) keeps its own one-time move
on the Workload page (Phase 6); it is not duplicated here.

Dry-run report (read only; refuses a non-local database without `--allow-remote`):

```
node scripts/report-local-prefs-migration.mjs --out /tmp/local-prefs-migration.json
```

It counts, per organization, the people who have NO server value for each key (the
people whose browser value, if they still hold one, will be carried up). Local run
2026-09-30: 35 orgs, 83 people, 6 with a preference row; saved under
`phase8-reports/local-prefs-migration-dryrun.json` in the session scratchpad.

**Behaviour changes with no data step**, for the release note:
- `POST /api/me/delete` now takes `{ confirm: "DELETE" }` (the old `{ confirm: <email> }`
  still works), refuses the workspace's last active Owner or Admin with 409 `last_admin`,
  and bumps `tokenVersion` so every other device's session ends.
- `DELETE /api/auth/mfa/enroll` takes the code in the JSON body (`?code=` still accepted
  for one release), refuses with 403 when the org requires two step verification for
  the role, and is rate limited (10 per 15 minutes per person). `POST /api/auth/mfa/enroll`
  refuses (409) to replace a live secret. Backup codes come from the CSPRNG.
- New `POST /api/auth/mfa/backup-codes` (a fresh app code, never a backup code; replaces
  the set in one write; audited `mfa_backup_codes_regenerated`).
- New `POST /api/auth/mfa/enrol-at-login` and the `MFA_ENROL_REQUIRED:<ticket>` login
  outcome (step 2b). Inert until Workspace settings > Security writes
  `settings.security.mfaRequired`; the ticket is bound to the user and their tokenVersion
  and lives ten minutes; it never issues a session.
- `POST /api/me/change-password` is rate limited (10 per 15 minutes per person).
- Per-object mute (`home.notifications.muted[]`, written by the Space, Folder and List
  menus) is now READ: status, comment and due-date notifications about work in a muted
  place stop; a task assigned to the person and a mention still arrive.
- `home.notifications.desktopRingCalls` is now read by the incoming call card.

## Phase 8 (Settings, My settings, sign-in, access), stage D: Workspace settings; four guarded statements, no backfill

**Schema.** Stage D appends to `prisma/sql/2026-09-30-phase8-settings-access.sql` (the one
Phase 8 file, already in the deploy manifest):

```
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actorType" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actorLabel" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "actingForId" TEXT;
ALTER TABLE "ActivityLog" ALTER COLUMN "actorId" DROP NOT NULL;
```

Every existing row reads as `actorType = 'user'` with its actor unchanged, so there is
no backfill and nothing to dry-run. Apply it before the code: the new release writes
the three columns (SCIM deprovisioning writes `scim` / "Identity provider", the audit
purge writes `system`, the Staff console's tenant audit row now lands through
`writeTenantRow`) and may write a null actor. Applied locally 2026-09-30 with
`prisma db execute`. **Rollback:** drop the three columns (only the label of non-person
rows is lost); `SET NOT NULL` on `actorId` succeeds only while no null row exists, so
roll back the code first, then delete or reassign the null-actor rows, then restore
the constraint. **Order matters for a rollback of the CODE too:** once the first
null-actor row exists (a SCIM change, an audit purge, a Staff console action), the
previous release's Prisma client, which declares `actor` as required, throws on ANY
query that includes `actor` over that row (the Audit log, the activity feeds), not
only on the `SET NOT NULL` step. So a code rollback to a release before stage D must
first reassign those rows to a real person (for example the Owner) or delete them.

**Flags.** One new flag, read at request time, default OFF, in no `.env`:
`SETTINGS_OWNER_SPLIT`. Off, every Admin counts as an Owner for the Owner pages
(Security, API, Billing, Retention, Delete workspace), exactly as today. On, only the
real Owners (SUPER_ADMIN, else the earliest live COMPANY_ADMIN) open them. Role changes,
ownership transfer, and deactivating or removing an Owner use the real Owner in both
states.

**Settings keys written for the first time** (all inside `Organization.settings`, strict
zod sections in `src/lib/settings/org-settings-sections.ts`, absent reads as the old
behaviour): `security.{minPasswordLength, requireUppercase, requireNumbers,
requireSymbol, passwordMaxAgeDays, sessionIdleMinutes, sessionMaxDays, mfaRequired,
lockoutThreshold, lockoutMinutes}`, `profile`, `locale`, `work.automationsPaused`,
`users.{allowedDomains, inviteDefaultRole, inviteExpiryDays}` (plus `autoJoin` and `defaultSpaceIds`, stored but read by nothing yet),
`retention.{trashDays, auditDays}`, `data.{aiEnabled, selfExport}`, `scoreWeights`
(read through `scoreWeightsOf`, which migrates the old five-key shape on read, never
on write).

**Behaviour changes with no data step**, for the release note:
- Sign-in policy is enforced: the password rules (with an optional symbol rule) apply
  at signup, join, reset and change; a password older than the max age puts the
  person on the change-password hold (proxy 403 `password_expired` on APIs, redirect
  on pages); the idle limit and the absolute session lifetime are checked on every
  token refresh (the lifetime counts from the first check after deploy for sessions
  already open); the lockout threshold and minutes apply per org and can only be made
  STRICTER than the built-in floor (8 failures, 15 minutes). `ENFORCE_MFA_AT_LOGIN`
  stays the floor for enrolled people; `mfaRequired` adds the audience (off, admins,
  everyone). Existing orgs stay "off".
- Role changes go through `src/lib/access/membership.ts`: only an Owner makes or
  changes an Owner, a workspace always keeps one Owner (409 `last_owner`), SUPER_ADMIN
  is never a pickable tier, and every change that is not a strict promotion bumps
  `tokenVersion` (the person's sessions end on their next check; a promotion lands
  within the five-minute revalidation). Audited `org_role.changed`.
- Only an Owner deactivates or removes an Owner (403 `owner_only`).
- `POST /api/org/sign-out-everyone` (typed "SIGN OUT", Owner page) bumps `tokenVersion`
  for everyone anchored to the org. Audited `security.sign_out_all`.
- SCIM deprovisioning (DELETE, or `active: false`) now hands open tasks, reports and
  owned Spaces, Folders and Lists to the person's manager, else the first Owner,
  refuses the last Owner, sets INACTIVE and bumps `tokenVersion`.
- `GET /api/audit?format=csv` exports up to 50,000 rows (audited `data.exported`);
  `GET /api/export/all` is the whole-workspace export (Spaces, Folders, Lists, tasks
  paged to 200,000, Docs, Tables, Goals) with the CSV formula guard.
- `POST /api/cron/audit-purge` (new, `?dry=1` supported) deletes audit rows older than
  `retention.auditDays` for orgs that set it, in batches, and writes one `audit.purged`
  row. The default is keep for ever, so it deletes nothing until an Owner chooses a
  period. The crontab row is NOT installed; see `scripts/CRON-SETUP.md`.
- `PATCH /api/offices` accepts only the office fields (mass-assignment fix) and keeps
  one headquarters.
- `/imports` is a 308 to `/settings/data?tab=import`. New `GET /api/org/admins` (the
  ask-an-admin strip: names of the workspace's Owners and Admins, any signed-in member).

**Stage D review fixes (behaviour, no schema):**
- Every change to who holds Owner or Admin (role change, bulk change, ownership
  transfer, deactivate or remove, SCIM deprovisioning) runs under one transaction-scoped
  advisory lock per workspace (`lockOrgRoles`, key `org-roles:<orgId>`) and re-reads, under
  the lock, whether the ACTOR is still an Owner or Admin. Two Owners demoting each other
  at once can no longer leave a workspace with nobody.
- The routes that change who can do what (role changes, ownership, sign-out-everyone,
  every workspace settings PATCH, API keys, workspace delete and restore) re-read the
  actor from the database (`freshWorkspaceActor`): a demoted Admin, or a session whose
  `tokenVersion` the account has moved past, is refused at once (403 `stale_session`)
  instead of at the five-minute session check. The session now carries its own
  `tokenVersion` (read-only; adopting a new one still needs the signed proof).
- One Owner set everywhere: `liveAdminsOf` counts admins anchored here AND admins by
  membership who are switched into another workspace (the same set as `ownerIdsFor`).
- "Log out everywhere" (sign-out-everyone) also ends the sessions of members switched
  into another workspace.
- SCIM deprovisioning of an Owner who is not the last one deactivates them (every
  session ends) but does NOT hand their work over unattended, and the audit row names
  who holds Owner now; a person hands an Owner's work over from Members. SCIM
  reactivation writes its own audit row ("work handed over stays where it went").
- The audit purge never deletes rows features read back: `weekly_review_decided`,
  `okr_created`, `user.invited`, `access.invited`, `access.matrix_retired`,
  `access.migrated`, `audit.purged`, `terms.*`, `staff.*` (`src/lib/audit-retention.ts`).
  Both retention rows now sit behind Show upcoming features, captioned "Not enforced
  yet", until the two cron rows are installed.
- The score-weights save merges into the stored weights, so the monthly performance
  score's `manager` and `self` keys survive; `scoreWeightsOf` shows the behavioural
  weight the review engine really uses (the default 30) for an older five-key blob.
- Invite rules: the workspace's own domain is always allowed and Invite rules ADD
  domains (`inviteDomainsOf`, one answer for invitations, SCIM create and the invite
  dialogs); a resent invitation lives as long as Invitation expiry says (was always 7
  days); every invite dialog starts on the Default role for invites
  (`GET /api/invitations?rules=1`).
- **Decision to ratify: the legacy `security.twoFactorEnabled: true` is NOT migrated to
  `mfaRequired: "everyone"`**, contrary to settings-architecture 5.10 and access-model-spec
  (migrate-on-read). Nothing ever enforced the old key, and honouring it now would hold
  every un-enrolled person at their next click in a workspace whose Owner never saw the
  rule. Worst case of this choice: an Owner who believes the old switch is on. So the
  Security page shows a note on any org that stored it ("an older setting says ... it
  was never enforced ... choose Everyone to require it"). To count the affected orgs
  before deciding: `SELECT count(*) FROM "Organization" WHERE settings->'security'->>'twoFactorEnabled' = 'true' AND settings->'security'->'mfaRequired' IS NULL;`
- Whole-workspace export copy now says what the ZIP holds (one CSV per object with ids,
  titles, owners, statuses and dates; no doc text, descriptions, comments, field
  values, table rows or files yet). The route still builds the ZIP in memory (up to
  200,000 tasks); a streamed or background export is the next step before large
  enterprise workspaces use it.

**Next step for custom roles** (not in this stage): the Members drawer still offers the
legacy seniority tier under Member so no capability is lost. When the access engine's
roles switch on (access step 4 and 5), the tier select is replaced by the role
picker, the matrix export on Data > Export ships the retired grid, and the transitional
Access page's legacy grid is removed.
