-- Phase 2, Stage C follow-up: "read" and "cleared" become two different things.
-- docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox)
--
-- WHY. The Inbox shipped with one boolean for two states. `Notification.read`
-- decided both "you have seen this" and "this is filed away in the Cleared
-- tab", because the Primary and Other tabs were defined as `read = false` and
-- the Cleared tab as `read = true`. Three things followed from that: selecting
-- a row auto-marked it read after 1.5s and the row left the tab under the
-- cursor, "Mark read" was a silent "Clear", and "Mark all read" emptied the
-- whole Primary tab. The spec says the opposite in three places, including the
-- row styling (unread surface vs read surface-1) which a tab of unread-only
-- rows could never show.
--
-- ADDITIVE ONLY. One new nullable column and one index. Nothing existing is
-- renamed, retyped, dropped or made required, so this file can be applied to a
-- live database while the current release is serving traffic. The readers in
-- the new release tolerate the column being absent for one release: every
-- Inbox query goes through src/lib/inbox-query.ts, which falls back to the old
-- read-only semantics when a query fails because the column is not there yet.
--
-- IDEMPOTENT. Re-running it is a no-op, including the one-time backfill, which
-- is guarded on a MARKER (a comment on the column itself) rather than on the
-- shape of the data, so a second run cannot re-file rows somebody has since
-- read even years later.
--
-- WHY A DATA REWRITE IS IN A SCHEMA FILE, which prisma/sql/README.md otherwise
-- forbids ("data migrations live in scripts/"). This one has to be ATOMIC with
-- the column's arrival. The instant "clearedAt" exists, the new release reads
-- the Cleared tab through it; a read row that has not been filed is a row in
-- Primary. If the backfill were a separate script the founder runs afterwards,
-- every workspace's entire notification history would sit in Primary for the
-- minutes or hours in between. It is bounded, reversible in meaning (a filed
-- row is one "Mark unread" from Primary), deletes nothing, and the exact
-- statement is printed below so the founder can read it before applying.
--
-- HOW TO APPLY IN PRODUCTION (founder, on the aaPanel Postgres):
--   npx prisma db execute --file prisma/sql/2026-09-18-notification-cleared-at.sql
-- then `npx prisma generate` and `pm2 restart workwrk`. Never
-- `prisma migrate dev` and never `db push`: this database has drift that both
-- of those would try to "fix" destructively.
--
-- Local (already applied by the authoring session, against .env.local only):
--   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
--     npx prisma db execute --file prisma/sql/2026-09-18-notification-cleared-at.sql

-- 1. The column.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "clearedAt" TIMESTAMP(3);

-- 2. The index the Cleared tab and the unread counter read through.
CREATE INDEX IF NOT EXISTS "Notification_userId_clearedAt_idx"
  ON "Notification" ("userId", "clearedAt");

-- 3. One-time backfill: preserve what people are looking at today.
--
-- READ THIS BEFORE APPLYING. It touches EVERY read notification in this
-- database, of any age, in every workspace. There is no date cut-off and there
-- is no per-org filter, on purpose: until this release every read row WAS the
-- Cleared tab, so every one of them belongs there. Leaving them NULL would
-- dump each workspace's entire notification history back into Primary on
-- deploy day, which is the outcome this statement exists to prevent.
--
-- NOTHING IS DELETED and nothing leaves the product. A row filed here shows on
-- the Cleared tab and is one click of "Mark unread" from Primary. clearedAt is
-- set to the row's own createdAt, so the Cleared tab is in the order people
-- remember rather than all stamped with the deploy time.
--
-- TWO GUARDS, and they do different jobs:
--
--   * THE MARKER, a comment on the column, is what makes a SECOND run of this
--     file a true no-op. The previous version guarded on "no row has a
--     clearedAt yet", which is a property of the DATA: it was all-or-nothing
--     across the whole install (one early-cleared row anywhere disabled the
--     backfill for every workspace) and it stopped being true the moment the
--     first person cleared anything, so it could not tell "already run" from
--     "run me". The marker can.
--   * THE PER-PERSON CLAUSE bounds the blast radius if the marker is ever lost
--     (a restore from a dump taken with --no-comments, say): somebody who has
--     cleared anything at all is already living under the new semantics and is
--     left completely alone.
DO $$
DECLARE
  marker CONSTANT text := 'clearedAt-backfill-2026-09-18';
  current_marker text;
BEGIN
  SELECT col_description(a.attrelid, a.attnum) INTO current_marker
    FROM pg_attribute a
   WHERE a.attrelid = '"Notification"'::regclass
     AND a.attname = 'clearedAt';

  IF current_marker IS DISTINCT FROM marker THEN
    UPDATE "Notification" n
       SET "clearedAt" = n."createdAt"
     WHERE n."read" = true
       AND n."clearedAt" IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM "Notification" x
          WHERE x."userId" = n."userId"
            AND x."clearedAt" IS NOT NULL
       );
    EXECUTE format('COMMENT ON COLUMN %I.%I IS %L', 'Notification', 'clearedAt', marker);
  END IF;
END $$;
