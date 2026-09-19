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
additive, so the currently running release ignores the new objects, and every
reader in the new release is written to tolerate them being absent for one
release anyway.

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
