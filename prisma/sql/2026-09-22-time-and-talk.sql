-- 2026-09-22 - Phase 4, Time and Talk - the additive columns both units need.
--
-- Specs: docs/plans/ui-refresh/spec-planner.md section 4 step 1
--        docs/plans/ui-refresh/spec-talk.md section 4 step 4
--
-- Seven nullable or defaulted columns across three tables. Nothing is
-- renamed, retyped, dropped or made required, and no row is moved.
--
-- DEPLOY ORDER IS NOT FREE. APPLY THIS FILE BEFORE THE CODE.
--
-- An earlier draft of this header said the order was free because every
-- reader tolerates the columns being absent. That is true of the four
-- Conversation columns, which are read through explicit `select` lists, and
-- it is NOT true of the three Meeting and ActionItem columns:
--
--   * GET /api/meetings runs `prisma.meeting.findMany({ where, include })`
--     with no `select`, and Prisma emits every scalar of the model on that
--     shape, so the moment the generated client knows about
--     Meeting."createdById" and Meeting."deletedAt" it asks a database
--     without them for columns that do not exist.
--   * The same route's `where` is `{ organizationId, deletedAt: null }`.
--   * GET / PUT / DELETE on /api/meetings/[id] filter on "deletedAt" too.
--
-- So a release deployed ahead of this file answers 500 on the meetings
-- list and on every meeting page, rather than degrading. That is why
-- scripts/deploy-migrations.mjs carries this file in its manifest and says
-- the same thing at its entry: the two statements now agree.
--
-- The file is still additive and still idempotent, so applying it early
-- against the CURRENTLY RUNNING release is safe: that release selects none
-- of these columns and ignores them.
--
-- WHAT EACH COLUMN IS FOR
--
-- Meeting."createdById"   spec-planner section 1 Access: "the creator is
--   createdById (rule 5 = FULL)". The Meeting model records no creator at
--   all today, which is why GET/PUT/DELETE on /api/meetings/[id] scope to
--   the organization alone and any Member can hard-delete any meeting in
--   the org. Nullable forever: meetings written before today have no
--   recorded creator, and the reader falls back to "attendee, or Owner or
--   Admin" for those rows rather than guessing a person.
--   scripts/backfill-meeting-created-by.mjs fills the historical rows from
--   the meeting_created ActivityLog row that POST /api/meetings has always
--   written, else from a sole attendee, else leaves the row NULL and
--   reports it. It never guesses an owner, because createdById is the only
--   role that can delete a meeting.
--
-- Meeting."deletedAt"     spec-planner section 4 step 6 wires meetings into
--   the one Trash, and this column is the FORWARD-COMPATIBLE stamp for it,
--   not the mechanism Trash uses today. Be precise about which, because the
--   two are easy to confuse:
--
--   Trashing a meeting today captures the row, its attendees and its action
--   items into the Trash snapshot and then removes the row
--   (src/lib/trash.ts, the `meeting` entry and the delete switch). Restore
--   recreates all three with their original ids, so nothing is lost and the
--   meeting's URL still resolves afterwards. Nothing writes deletedAt.
--
--   The column and its index ship anyway, and every meeting read in this
--   release filters `deletedAt: null`, so moving to a soft delete later is
--   one line in trash.ts rather than an audit of every reader. Until that
--   line is written the filter is a no-op, which is why it costs nothing to
--   have it everywhere and would cost a leak to be missing from one place.
--
-- ActionItem."itemId"     spec-planner section 0 (comms detail issues):
--   "convertToTask has no idempotency: clicking twice creates two tasks".
--   The link back to the Item the conversion created is what lets the
--   second click reopen the first task.
--
-- Conversation."topic", "restricted", "findable", "archivedAt"
--   spec-talk section 4 step 4, verbatim: "Conversation.topic, restricted,
--   findable, archivedAt. Backfill: findable = true on every public
--   channel, restricted = false everywhere. No data moves; DMs and groups
--   untouched."
--   The defaults below ARE that backfill for every existing row, because
--   ADD COLUMN with a DEFAULT writes the default into every existing row:
--   restricted = false everywhere and findable = true everywhere. Statement
--   8 then makes the DM and GROUP case explicit rather than incidental:
--   a DM or a group is not a thing anyone browses for, so findable is set
--   to false on those two types. Channels keep findable = true, which is
--   the rule the spec states. Running it twice changes nothing.
--
-- THE DROP THAT IS NOT HERE. spec-talk section 0 also removes the
-- AnnouncementDismissal table. That is a deletion, not an addition, it is
-- gated on spec-work-home removing the /dashboard banner that writes it,
-- and it is recorded as a future file in scripts/MIGRATIONS.md. It is
-- deliberately not in this file.
--
-- Idempotent: every statement is ADD COLUMN IF NOT EXISTS, CREATE INDEX
-- IF NOT EXISTS, or an UPDATE whose WHERE clause is already satisfied on a
-- second run.

-- 1. Meeting.createdById
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
CREATE INDEX IF NOT EXISTS "Meeting_createdById_idx" ON "Meeting" ("createdById");

-- 2. Meeting.deletedAt
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Meeting_deletedAt_idx" ON "Meeting" ("deletedAt");

-- 3. ActionItem.itemId
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "itemId" TEXT;
CREATE INDEX IF NOT EXISTS "ActionItem_itemId_idx" ON "ActionItem" ("itemId");

-- 4. Conversation.topic
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "topic" TEXT;

-- 5. Conversation.restricted (false on every existing row, per the spec)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "restricted" BOOLEAN NOT NULL DEFAULT false;

-- 6. Conversation.findable (true on every existing row, per the spec)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "findable" BOOLEAN NOT NULL DEFAULT true;

-- 7. Conversation.archivedAt
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Conversation_organizationId_archivedAt_idx"
  ON "Conversation" ("organizationId", "archivedAt");

-- 8. A DM or a group is not browsable, so it is not findable. Channels keep
--    findable = true. Idempotent: the second run matches no rows.
UPDATE "Conversation"
   SET "findable" = false
 WHERE "type" IN ('DM', 'GROUP')
   AND "findable" = true;
