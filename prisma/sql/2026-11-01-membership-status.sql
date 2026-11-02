/* 2026-11-01 A person's status in each workspace (docs/plans/workspace-status.md,
   step 1, decisions D1 and D16). Three new columns on "OrganizationMembership":
   "status" (UserStatus, NOT NULL, default ACTIVE), "removedAt" (nullable) and
   "endedWithAccount" (BOOLEAN, NOT NULL, default false).

   WHY. A person has one account row ("User"), anchored to one workspace, and
   a membership row for every other workspace they belong to. Their access
   level and Admin scopes already belong to each workspace: a move between
   workspaces keeps the level of the one being left on its membership and
   takes the target's (src/lib/access/workspace-anchor.ts reanchorUser,
   prisma/sql/2026-10-05-membership-admin-scopes.sql). Their status and
   removal did not: "User"."status" and "User"."deletedAt" are one column
   each, so a workspace that deactivated or removed someone ended them in
   every other workspace too, and a workspace they worked in through a
   membership could not end them at all. Now each membership carries the
   person's status and removal in that workspace, and the move swaps them as
   it swaps the level. "User"."status" and "User"."deletedAt" keep meaning the
   status and removal in the workspace the account is anchored to, so every
   reader of them stays right without a change.

   Additive and idempotent: the deploy runs this file on every deploy.

   CATALOGUE-GUARDED. Each column is added only when pg_attribute says it is
   missing, so a deploy after the first takes no lock. The first apply takes
   ACCESS EXCLUSIVE on "OrganizationMembership" for a moment: constant
   defaults and a NULL column, so no rewrite. No key to "User".

   APPLY THIS FILE BEFORE THE CODE: the new client selects all three columns
   on every read of "OrganizationMembership" with no select, and the move
   writes them.

   EXISTING ROWS KEEP WHAT THEY SHOW TODAY (D16), by a ONE-TIME step, marked
   on the new "status" column as 2026-10-05-membership-admin-scopes.sql marks
   its own: an ended account's state is copied onto every one of its
   memberships. A membership of an account whose status is INACTIVE gets
   INACTIVE; a membership of an account with "deletedAt" set gets INACTIVE and
   "removedAt" = that "deletedAt". Today such a person can sign in nowhere, so
   they keep exactly that: nobody gains or loses access on the deploy. The HR
   labels (ON_LEAVE, PROBATION, PIP, NOTICE_PERIOD) are not copied: they are
   the anchored workspace's, and each membership starts at ACTIVE.

   EVERY SEAT IT ENDS CARRIES "endedWithAccount" = true. Before this file only
   the anchored workspace could end an account, so each copied seat is that
   workspace's decision, not its own. When the anchored seat is restored or
   reactivated (src/lib/access/workspace-status.ts restoreSeat), the seats
   still carrying the mark come back with it in the same transaction, as the
   account-wide restore brought every workspace back before; any write of a
   seat by its own workspace clears its mark. So for this data the worst case
   is exactly today's behaviour.

   THE ONE-TIME MARKER LIVES IN THE COMMENT ON "OrganizationMembership"."status".
   A later file that runs COMMENT ON COLUMN "OrganizationMembership"."status"
   MUST KEEP the text membership-status-2026-11-01 in it: without it the next
   deploy runs the step again and ends seats a workspace decided to keep.

   WHY THE DATA STEP IS HERE AND NOT IN scripts/ (prisma/sql/README.md asks
   this argument of any data rewrite in this folder). It has to be atomic with
   the column: from the moment the new release reads a membership's status,
   a membership left at its default ACTIVE under an ended account is a usable
   seat, and the sign-in repair (D7) would move that person into it, handing
   back a workspace nobody gave back. A script run after the deploy would
   leave that open in between.

   A person ended by the release before this one in the minutes between this
   file and the reload keeps a membership at ACTIVE. The new release treats
   them as it would have treated that change itself (D3): ended in the
   workspace that ended them, and their other workspaces untouched.

   Rollback: ALTER TABLE "OrganizationMembership" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "removedAt", DROP COLUMN IF EXISTS "endedWithAccount"; */

DO $$
BEGIN
  /* The person's status in this workspace while the account is anchored elsewhere. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'status' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';
  END IF;
  /* When they were removed from this workspace, or NULL. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'removedAt' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
  END IF;
  /* True on a seat the one-time step below ended with the whole account. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'endedWithAccount' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "endedWithAccount" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END
$$;

/* ONE TIME (marker in the comment on the new "status" column, which a later
   COMMENT ON must keep): an ended account's state onto every one of its
   memberships, each marked as ended with the account (see the header). A
   "removedAt" already set is kept. */
DO $$
BEGIN
  IF COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'status' AND NOT attisdropped)), '')
     NOT LIKE '%membership-status-2026-11-01%' THEN
    UPDATE "OrganizationMembership" m
       SET "status" = 'INACTIVE',
           "removedAt" = COALESCE(m."removedAt", u."deletedAt"),
           "endedWithAccount" = true
      FROM "User" u
     WHERE m."userId" = u."id"
       AND (u."status" = 'INACTIVE' OR u."deletedAt" IS NOT NULL);
    COMMENT ON COLUMN "OrganizationMembership"."status" IS
      'The person''s status in this workspace while the account is anchored elsewhere (User.status is the anchored workspace''s). Keep this marker in any new comment: membership-status-2026-11-01';
  END IF;
END
$$;
