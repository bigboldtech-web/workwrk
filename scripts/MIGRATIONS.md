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
  --file prisma/sql/2026-09-22-drop-announcement-dismissal.sql \
  --schema prisma/schema.prisma
```

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

## 2026-09-26: reserved field keys, a read-only report for the founder

- **No schema change and no data script.** The field-keys fix (4c1c0c66) stops NEW custom fields from taking a built-in column's key and reads existing clashes safely, so nothing must run for the product to be correct.
- **One read-only report to run on the box, once, after this deploys**: `npx tsx scripts/report-reserved-field-keys.ts`. It prints, per org, every custom field whose key is reserved and flags "SHARED SLOT" where a field shares the task's own metadata slot (for example a field keyed `description`, which is literally the task body). It writes nothing. Locally it found 1 harmless view-level clash in 258 Lists. If prod shows a SHARED SLOT row, bring it back for a human decision; do not script a rename.
