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

   ITS OPEN INVITATIONS END WITH IT (the step 2 review H1). A seat a workspace
   ended is no longer "already a member", so an invitation brings it back on
   acceptance. The same one-time step ends every open invitation (not
   accepted, expiresAt still ahead) to the address of each account it copies,
   in each workspace whose seat it ends: expiresAt becomes now, the way an
   invitation ends by itself, and the row stays for an Admin to resend
   (src/lib/access/seat-invitations.ts does the same for every seat the code
   ends). The address is matched in any case. Before this file every such
   acceptance was refused as "already a member", so nothing that worked
   before stops working.

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

   A PERSON'S PROFILE IN EACH WORKSPACE (D18, the step 3 review H2). Nine
   more columns on "OrganizationMembership", all nullable but "isAgent"
   (BOOLEAN, NOT NULL, default false): "departmentId", "roleId" (the job
   role), "officeId", "joinDate", "weeklyCapacityHours", "workSchedule",
   "customFields", "orgRole" and "isAgent". A move keeps the profile of the
   workspace being left on its membership and the account takes the
   target's (workspace-anchor.ts reanchorUser), as it does the level and the
   status, so an account moved into another company (D3, D6, the switcher,
   an invitation, the sign-in repair) no longer carries the first company's
   department, job role and the rest there. No key to "Department", "Role" or
   "Office": a membership names them by id, as the invitation does, and every
   reader shows one only when it belongs to the workspace it is read in.
   Personal details (name, photo, phone, date of birth) stay on the account,
   and so does the manager line.

   ITS ONE-TIME STEP, MARKED ON "OrganizationMembership"."departmentId" (its
   own marker, membership-profile-2026-11-02, which a later COMMENT ON that
   column MUST KEEP): a department, job role or office the account holds
   from a workspace other than the one it is anchored to moves onto its
   membership there (set on the membership, cleared on the account). One
   from a workspace it no longer belongs to stays where it is: nothing is
   deleted, and no reader shows it. Nothing else of the profile is copied:
   each membership starts with an empty profile there, a true answer, and its
   join date reads as the membership's own createdAt.

   Rollback: ALTER TABLE "OrganizationMembership" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "removedAt", DROP COLUMN IF EXISTS "endedWithAccount", DROP COLUMN IF EXISTS "departmentId", DROP COLUMN IF EXISTS "roleId", DROP COLUMN IF EXISTS "officeId", DROP COLUMN IF EXISTS "joinDate", DROP COLUMN IF EXISTS "weeklyCapacityHours", DROP COLUMN IF EXISTS "workSchedule", DROP COLUMN IF EXISTS "customFields", DROP COLUMN IF EXISTS "orgRole", DROP COLUMN IF EXISTS "isAgent"; the profile the one-time step moved stays on the memberships (copy it back to "User" first if the code goes back too). */

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
  /* The person's department in this workspace (D18), by id. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'departmentId' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
  END IF;
  /* Their job role in this workspace, by id. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'roleId' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "roleId" TEXT;
  END IF;
  /* Their office in this workspace, by id. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'officeId' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "officeId" TEXT;
  END IF;
  /* When they joined this workspace, or NULL for the membership's own createdAt. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'joinDate' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "joinDate" TIMESTAMP(3);
  END IF;
  /* Their weekly hours for Workload here, or NULL for the workspace's. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'weeklyCapacityHours' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "weeklyCapacityHours" DOUBLE PRECISION;
  END IF;
  /* Their own working days and hours here, or NULL. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'workSchedule' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "workSchedule" JSONB;
  END IF;
  /* Their values of this workspace's custom profile fields, or NULL. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'customFields' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "customFields" JSONB;
  END IF;
  /* The org role mirror of the level here (OWNER, ADMIN, MEMBER, GUEST), or NULL. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'orgRole' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "orgRole" TEXT;
  END IF;
  /* The Agent mirror of the level here. */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'isAgent' AND NOT attisdropped) THEN
    ALTER TABLE "OrganizationMembership" ADD COLUMN IF NOT EXISTS "isAgent" BOOLEAN NOT NULL DEFAULT false;
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
    /* Each workspace whose seat it ends: that address's open invitations there end too. */
    UPDATE "Invitation" i
       SET "expiresAt" = (now() AT TIME ZONE 'UTC')
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
     WHERE i."organizationId" = m."organizationId"
       AND lower(i."email") = lower(u."email")
       AND i."accepted" = false
       AND i."expiresAt" > (now() AT TIME ZONE 'UTC')
       AND (u."status" = 'INACTIVE' OR u."deletedAt" IS NOT NULL);
    COMMENT ON COLUMN "OrganizationMembership"."status" IS
      'The person''s status in this workspace while the account is anchored elsewhere (User.status is the anchored workspace''s). Keep this marker in any new comment: membership-status-2026-11-01';
  END IF;
END
$$;

/* ONE TIME (marker in the comment on the new "departmentId" column, which a
   later COMMENT ON must keep; D18): a department, job role or office the
   account holds from a workspace other than its anchor moves onto its
   membership there, and off the account. One from a workspace it no longer
   belongs to stays where it is (see the header). */
DO $$
BEGIN
  IF COALESCE(col_description('"OrganizationMembership"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"OrganizationMembership"'::regclass AND attname = 'departmentId' AND NOT attisdropped)), '')
     NOT LIKE '%membership-profile-2026-11-02%' THEN
    UPDATE "OrganizationMembership" m
       SET "departmentId" = u."departmentId"
      FROM "User" u
      JOIN "Department" x ON x."id" = u."departmentId"
     WHERE m."userId" = u."id"
       AND m."organizationId" = x."organizationId"
       AND x."organizationId" <> u."organizationId"
       AND m."departmentId" IS NULL;
    UPDATE "User" u
       SET "departmentId" = NULL
      FROM "Department" x
     WHERE x."id" = u."departmentId"
       AND x."organizationId" <> u."organizationId"
       AND EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id" AND m."organizationId" = x."organizationId" AND m."departmentId" = u."departmentId");
    UPDATE "OrganizationMembership" m
       SET "roleId" = u."roleId"
      FROM "User" u
      JOIN "Role" x ON x."id" = u."roleId"
     WHERE m."userId" = u."id"
       AND m."organizationId" = x."organizationId"
       AND x."organizationId" <> u."organizationId"
       AND m."roleId" IS NULL;
    UPDATE "User" u
       SET "roleId" = NULL
      FROM "Role" x
     WHERE x."id" = u."roleId"
       AND x."organizationId" <> u."organizationId"
       AND EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id" AND m."organizationId" = x."organizationId" AND m."roleId" = u."roleId");
    UPDATE "OrganizationMembership" m
       SET "officeId" = u."officeId"
      FROM "User" u
      JOIN "Office" x ON x."id" = u."officeId"
     WHERE m."userId" = u."id"
       AND m."organizationId" = x."organizationId"
       AND x."organizationId" <> u."organizationId"
       AND m."officeId" IS NULL;
    UPDATE "User" u
       SET "officeId" = NULL
      FROM "Office" x
     WHERE x."id" = u."officeId"
       AND x."organizationId" <> u."organizationId"
       AND EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id" AND m."organizationId" = x."organizationId" AND m."officeId" = u."officeId");
    COMMENT ON COLUMN "OrganizationMembership"."departmentId" IS
      'The person''s department in this workspace while the account is anchored elsewhere (User.departmentId is the anchored workspace''s). Keep this marker in any new comment: membership-profile-2026-11-02';
  END IF;
END
$$;
