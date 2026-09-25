# `prisma/sql` — hand-applied schema changes

`prisma migrate dev` is broken on this project: the local and production
databases have drifted from `prisma/migrations`, and `migrate dev` responds to
drift by offering to reset, which would destroy user data. `prisma db push` has
the same problem from the other side (it silently drops whatever the schema
file does not mention).

So every schema change ships twice:

1. as an **additive** edit to `prisma/schema.prisma` (new models, new optional
   columns, new enum values — never a rename, a retype, a drop, or a column
   that becomes required), followed by `npx prisma generate`; and
2. as **one idempotent SQL file in this directory**, named `YYYY-MM-DD-<slug>.sql`,
   that brings a database to the same shape and can be run twice with no effect.

## How the founder applies a file in production

From the repo root on the production box (`/www/wwwroot/workwrk.com`), with the
production `DATABASE_URL` in the environment:

```
npx prisma db execute --file prisma/sql/<the file>.sql
npx prisma generate
pm2 restart workwrk
```

`db execute` reads the schema path and the datasource URL from
`prisma.config.ts`, which resolves `DIRECT_URL` first and `DATABASE_URL`
second. Prisma 7 removed the `--schema` flag from this command; passing it is a
hard CLI error, so the two lines above are the whole thing.

Run it **before** the code that needs it is deployed. Every file here is
additive, so the currently running release ignores the new objects and
applying one early is always safe.

The reverse is **not** always safe, and one file says so at its own head.
Most readers in a new release are written to tolerate their columns being
absent for one release, but a Prisma `findMany` with no `select` emits every
scalar of the model, so the moment the generated client knows about a column
a database without it answers an error rather than a null. Where that is the
case the file's header says **apply this file before the code**; treat the
absence of that line as "either order works", not as a promise that a late
apply is fine.

## How an agent applies a file locally

Only ever against the local database named in `.env.local`, and only with this
command:

```
DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
  npx prisma db execute --file prisma/sql/<the file>.sql
```

Never `migrate dev`, never `db push`, never any other database URL.

## The files

| File | What it adds | Applied in production |
|---|---|---|
| `2026-07-21-operating-core.sql` | Operating Core: Scope, RoleInstance, OwnershipArea, RoleBoundary, Threshold | see the Operating Core notes |
| `2026-09-18-task-detail-phase2.sql` | `ItemUpdateAttachment`, `ItemUpdateReaction`, `LegacyRedirect`; `EntityLinkRelation` gains `BLOCKS` and `WAITING_ON` | **pending** |
| `2026-09-18-notification-cleared-at.sql` | `Notification.clearedAt` (nullable) + its index, so "read" and "cleared" stop being the same state. **It also rewrites data**: a one-time backfill stamps `clearedAt = createdAt` on EVERY read notification in the database, of any age, in every workspace, so that the history people have already read does not reappear in Primary on deploy day. Nothing is deleted and a filed row is one "Mark unread" from Primary. Guarded by a marker comment on the column, so a second run does nothing. Read the block above statement 3 in the file before applying. | **pending** |
| `2026-09-19-canvas-folder.sql` | `Whiteboard.folderId` (nullable) + its index, so a Canvas created from a Folder has a row on that Folder's page instead of disappearing into the Space | **pending** |
| `2026-09-19-template-key.sql` | `Template.key` (nullable, unique), the stable key `prisma/seed-templates.ts` upserts the built-in templates on | **pending** |
| `2026-09-19-archived-by.sql` | `archivedById` (nullable) on `Space`, `Folder`, `Board`, `Item`, `Doc`, `Whiteboard`, so Trash's "Archived by" column names the person who archived the row instead of its owner | **pending** |
| `2026-09-21-doc-lock.sql` | `Doc.lockedById` and `Doc.lockedAt` (both nullable) for "Lock page" (spec-docs-knowledge change request A4: while set, everyone below Full access is Can comment on that doc), and `Template.usedCount` (default 0) ensured for databases that predate it. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-21-contract-send-decline.sql` | `Agreement.signingOrder` (default false), `Agreement.sendMessage`, `Agreement.sentAt`, `Agreement.voidedAt` (nullable) for the Send for signature modal's order and message, and `AgreementParty.declinedAt`, `AgreementParty.declineReason`, `AgreementParty.viewedAt`, `AgreementParty.userAgent` (nullable) for the signing page's Decline, first-open stamp and signature evidence (spec-process section 2 `/agreements/[id]`, `/sign/[token]`). In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-21-agreement-archived-by.sql` | `Agreement.archivedById` (nullable), so Trash's Archived tab names who archived a contract instead of leaving that cell blank on every contract row. The reader falls back to a blank cell while the column is absent, so it is safe to apply after the deploy. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-22-time-and-talk.sql` | Phase 4, Time and Talk. `Meeting.createdById` (so a meeting has a creator to gate on) and `Meeting.deletedAt` (the forward-compatible soft-delete stamp: nothing writes it yet, Trash snapshots the meeting with its attendees and action items and restores all three, and every reader filters on it so switching to a soft delete later is one line), `ActionItem.itemId` (so "Convert to task" stops writing a second task on a second click), and `Conversation.topic`, `restricted` (default false), `findable` (default true) and `archivedAt` for channels. All seven are nullable or defaulted, nothing is renamed or dropped, and statement 8 sets `findable = false` on DMs and groups, which is not a thing anyone browses for. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-22-work-schedule.sql` | Phase 4, decided additions (b) and (c). A new `WorkSchedule` table (one row per organization: `workdays` as weekday numbers, `hoursPerDay`, `timezone`, `holidays` as JSON) so the Workload grid's capacity columns and the Timesheets week card stop asserting a Monday-to-Friday eight-hour week at every company, plus `TimeEntry.billable` (default false) and `TimeEntry.tags` (default empty) for time-tracking depth. Purely additive: an organization with no row, and a release deployed before this file, both read the same Monday-to-Friday eight-hour defaults, because `readOrgWorkSchedule` (src/lib/work-schedule-server.ts) wraps the query and answers the defaults when the table is absent. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-22-calendar-event.sql` | Phase 4, spec-planner section 2 `/planner` Data. A new `CalendarEvent` table: the home for a personal calendar entry (an event, focus time, out of office) and for the rows the Google sync cron brings in. Before it, "New event" on the Calendar wrote a personal TASK, so a block of focus time turned into a to-do that never got done, and the sync cron wrote into the legacy `Task` table while the Planner read `Item`, so a connected Google Calendar produced rows nothing rendered. Purely additive and deploy order is free: the table is created empty, and every reader (the calendar read, the event edit and delete routes, and the sync write) is wrapped and answers "no events" while the relation is absent. Copying the existing GCAL and personal-event `Task` rows across is a separate DATA step, `scripts/backfill-calendar-events.mjs`, which is dry-run by default and is NOT part of the deploy. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-22-meeting-item.sql` | Phase 4, spec-planner section 4 step 6. `Meeting.itemId` (nullable) and its index: the link to the hidden per-organization Meetings List, so a meeting is decided by the one Item ladder rather than by a new `meeting` ObjectRef in the access model. Purely additive, and access behaves identically with or without it, because `src/lib/meeting-access.ts` is a pure function over `createdById` and the attendee list either way. The Item rows are written by `scripts/backfill-meeting-items.mjs`, which is dry-run by default and is NOT part of the deploy. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-22-calendar-declined.sql` | Phase 4, spec-planner section 2 `/planner` Display menu. `CalendarEvent.declined` (NOT NULL, default false), so "Show declined Google events" (default off) has something to act on. Before it the switch persisted a preference and changed nothing on screen, and the Google sync never looked at the viewer's own reply to an invitation, so there was no data for it either. The sync now reads the `attendees` entry Google marks `self` and stamps the column; the calendar read filters on it unless the switch is on. Deploy order is free and CHECKED rather than asserted: the calendar read attempts the filtered query and falls back to the unfiltered one when the column is absent, and the sync write retries without the field. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-23-form-settings.sql` | Phase 5, the form builder (spec-tables-forms section 4 step 6). `FormDefinition.settings` (JSONB, NOT NULL, default `'{}'`): the form's own settings bucket for Accepting responses, Close on a date, one response per person, collect email, the confirmation message or redirect, "Submit another response", who to tell about a new response, the daily summary and the closed message. No backfill: an empty bucket reads as the defaults in `src/lib/forms/settings.ts`, which are exactly what every live form does today (it keeps accepting responses with the canon confirmation message), so no form changes behaviour on the day it lands. **Apply this file before the code**: a findFirst with no select asks for every scalar. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-24-phase5b-data.sql` | Phase 5b, the data layer. A new `ItemListLink` table (a task shown, with its subtask tree, in one more List; primary key (itemId, boardId), its own position, addedById with no foreign key, cascades from Item and Board) and a new `ReportSchedule` table (a dashboard or a saved view emailed on a cadence to org members, each copy computed under the recipient's own access; runLog holds counts only). No existing table gains a column; a secondary List's field values live in `Item.metadata` under the reserved key `$lists`. Deploy order is free: every link reader answers today's home-only read while the table is absent and the report routes answer a named 503. In the deploy manifest (`scripts/deploy-migrations.mjs`) | **pending** |
| `2026-09-22-drop-announcement-dismissal.sql` | Phase 4, stage E. `DROP TABLE IF EXISTS "AnnouncementDismissal"`. The only DELETION in this phase, and it is deliberately NOT in the deploy manifest: `POST /api/announcements/[id]/dismiss` and its only caller (the `/dashboard` announcements banner, which had no importer left) are removed in this release, and the table waits one release behind them, because a dropped table is the one step a redeploy cannot undo. Nothing reads it: no query in `src` joins it, and the rows record only "somebody hid a banner" on a page that is now a 308 to `/home`. Run by the founder, one release from now, with the command in `scripts/MIGRATIONS.md`. NOT in the deploy manifest | **held one release** |

Data migrations (scripts that move user rows rather than change shape) are not
here: they live in `scripts/`, are dry-run by default, and are described in
`scripts/MIGRATIONS.md`.

**The one exception, stated so it is not mistaken for a precedent.**
`2026-09-18-notification-cleared-at.sql` carries a data rewrite. It is here
because it has to be atomic with the column it backfills: the release reads the
Cleared tab through `clearedAt` from the moment the column exists, so a
separate script run afterwards would leave every workspace's whole notification
history sitting in Primary in the meantime. Any other data rewrite goes in
`scripts/` under the seven rules. If a second one ever looks like it belongs
here, it needs the same argument written into the file.
