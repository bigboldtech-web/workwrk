/* 2026-11-01 A person's status in each workspace (docs/plans/workspace-status.md,
   decisions D1 to D18, and its final review). WHAT THIS FILE DOES, in order:
   1. adds twelve columns to "OrganizationMembership" (the seat: "status",
      "removedAt", "endedWithAccount"; the profile: "departmentId", "roleId",
      "officeId", "joinDate", "weeklyCapacityHours", "workSchedule",
      "customFields", "orgRole", "isAgent") and one to "UserSkill"
      ("managerRatings"), every one catalogue-guarded, on every deploy;
   2. ONE-TIME step one, marker membership-status-2026-11-01 on the comment
      of "OrganizationMembership"."status": an ended account's state onto
      every one of its memberships, each marked, and those addresses' open
      invitations there ended;
   3. ONE-TIME step two, marker membership-profile-2026-11-02 on the comment
      of "OrganizationMembership"."departmentId": a department, job role or
      office the account holds from another workspace moved onto its
      membership there;
   4. ONE-TIME step three, marker membership-fixes-2026-11-03 on the comment
      of "UserSkill"."managerRatings": the home membership of an account
      anchored away from home given the account's join date, working week,
      schedule and custom fields where it holds none (copied, never moved);
      each manager rating of a skill keyed by the person's home workspace;
      and the API keys of people already gone revoked, each with an Audit
      row.
   Each one-time step is one DO statement that writes its marker in the same
   statement, so it never runs half and never runs twice. Nothing is deleted
   anywhere in this file.

   THE SEAT. Three columns on "OrganizationMembership": "status" (UserStatus,
   NOT NULL, default ACTIVE), "removedAt" (nullable) and "endedWithAccount"
   (BOOLEAN, NOT NULL, default false).

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
   ACCESS EXCLUSIVE on "OrganizationMembership" and on "UserSkill" for a
   moment each: constant defaults and NULL columns, so no rewrite. No key to
   "User" or to any other table.

   APPLY THIS FILE BEFORE THE CODE: the new client selects all twelve
   membership columns on every read of "OrganizationMembership" with no
   select, and "managerRatings" on every such read of "UserSkill", and the
   move writes them.

   EXISTING ROWS KEEP WHAT THEY SHOW TODAY (D16), by ONE-TIME step one,
   marked on the new "status" column as 2026-10-05-membership-admin-scopes.sql
   marks its own: an ended account's state is copied onto every one of its
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
   seat by its own workspace clears its mark (a SCIM deprovision of a seat
   already ended included). So for this data the worst case is exactly
   today's behaviour.

   ITS OPEN INVITATIONS END WITH IT (the step 2 review H1). A seat a workspace
   ended is no longer "already a member", so an invitation brings it back on
   acceptance. The same one-time step ends every open invitation (not
   accepted, expiresAt still ahead) to the address of each account it copies,
   in each workspace whose seat it ends: expiresAt becomes now, the way an
   invitation ends by itself, and the row stays for an Admin to resend
   (src/lib/access/seat-invitations.ts does the same for every seat the code
   ends). The address is matched in any case. Before this file every such
   acceptance was refused as "already a member", so nothing that worked
   before stops working. One harmless overreach: an open invitation sent to
   a second, live account with the same address is ended too; an Admin
   resends it.

   THE ONE-TIME MARKER LIVES IN THE COMMENT ON "OrganizationMembership"."status".
   A later file that runs COMMENT ON COLUMN "OrganizationMembership"."status"
   MUST KEEP the text membership-status-2026-11-01 in it: without it the next
   deploy runs the step again and ends seats a workspace decided to keep.

   WHY THE DATA STEPS ARE HERE AND NOT IN scripts/ (prisma/sql/README.md asks
   this argument of any data rewrite in this folder). They have to be atomic
   with the columns: from the moment the new release reads a membership's
   status, a membership left at its default ACTIVE under an ended account is
   a usable seat, and the sign-in repair (D7) would move that person into
   it, handing back a workspace nobody gave back; from the moment it reads a
   home membership's profile or a skill's ratings, an empty row would show
   the home workspace's data as lost. A script run after the deploy would
   leave that open in between.

   A person ended by the release before this one in the minutes between this
   file and the reload keeps a membership at ACTIVE. The new release treats
   them as it would have treated that change itself (D3): ended in the
   workspace that ended them, and their other workspaces untouched. A person
   the release before this one reactivates or restores in those minutes
   keeps the seats step one marked ended in their other workspaces, and the
   new release never brings those back: the plan's deploy notes give the
   check to run right after the reload and the statement to run at once when
   it finds anyone (the fixes review M2). If the deploy stops after this file
   and the old release keeps serving for longer (its check failed), the same
   notes say how to find and bring back the marked seats of anyone the old
   release reactivated meanwhile, and what else to run before the next
   deploy.

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

   ONE-TIME STEP TWO, MARKED ON "OrganizationMembership"."departmentId" (its
   own marker, membership-profile-2026-11-02, which a later COMMENT ON that
   column MUST KEEP): a department, job role or office the account holds
   from a workspace other than the one it is anchored to moves onto its
   membership there (set on the membership, cleared on the account). One
   from a workspace it no longer belongs to stays where it is: nothing is
   deleted, and no reader shows it.

   ONE-TIME STEP THREE, MARKED ON "UserSkill"."managerRatings" (its own
   marker, membership-fixes-2026-11-03, which a later COMMENT ON that column
   MUST KEEP; the plan's final review fixes):
   - THE HOME KEEPS WHAT IT SHOWED (integrity M3). Before this release a
     move carried the whole profile on the account, so someone anchored away
     from home at the deploy holds home's join date, working week, schedule
     and custom fields on their account, and the home membership (the
     "isPrimary" row) holds none. Without this, the first switch home after
     the deploy would give home an empty profile and leave home's values on
     the other workspace's row. So for every account anchored in another
     workspace than its home membership's, "joinDate", "weeklyCapacityHours",
     "workSchedule" and "customFields" are COPIED (never moved: the account
     keeps its own) onto the home membership, each only where that row holds
     NULL. A value the other workspace wrote while the person was there also
     arrives home: that is today's behaviour.
   - MANAGER RATINGS PER WORKSPACE (security M2). New column
     "UserSkill"."managerRatings" (JSONB, NOT NULL, default '{}'), keyed by
     workspace id: a manager's rating of a skill belongs to the workspace it
     was given in, so another workspace neither reads nor overwrites it.
     Every skill with a "managerRating" gets { <the person's home
     workspace>: that rating }, merged under any key already there. Home is
     the workspace of the account's "isPrimary" membership when it has one,
     else the account's own "organizationId" (the fixes review L3): before
     this release a move carried the ratings on the account as it carried
     the profile, so for someone working away from home at the deploy they
     are home's, as the join date and the rest are (integrity M3). A rating
     another workspace's manager gave while the person worked there cannot
     be told apart and lands with home. A legacy rating on the old 10-point
     scale is copied as it is and read as it is (the fixes review M1). The
     old "managerRating" column stays as it is (nothing deleted) and is no
     longer read for display.
   - API KEYS OF PEOPLE ALREADY GONE ARE REVOKED (security L4). Every key not
     revoked whose creator holds no live seat in the key's workspace (the
     rule src/lib/api-auth.ts applies: anchored there and neither INACTIVE
     nor removed, or a membership there neither INACTIVE nor removed) gets
     "revokedAt" = now, in UTC as the columns hold it. Those keys are already
     refused by the new release; revoked, they can never come back with a
     reactivation, and Settings, API keys shows them Revoked. Each one gets
     its Audit row in the same statement (the fixes review L7), as the
     revocations of a seat ending write one: an "ActivityLog" row of type
     api_key_revoked in the key's workspace, actor the system (no person),
     target the key, severity warning, metadata { name, prefix, createdById,
     reason: "creator has no live seat, deploy step three" }, dated now in
     UTC, its id "deploy-key-revoked-" and the key's id.

   Rollback: first copy each home workspace's manager rating back to the old column (the fixes review L6; the code before this release reads "managerRating" only, and this release no longer writes it): UPDATE "UserSkill" s SET "managerRating" = (s."managerRatings" ->> h."org")::int FROM (SELECT u."id", COALESCE((SELECT p."organizationId" FROM "OrganizationMembership" p WHERE p."userId" = u."id" AND p."isPrimary" = true ORDER BY p."createdAt", p."id" LIMIT 1), u."organizationId") AS "org" FROM "User" u) h WHERE h."id" = s."userId" AND jsonb_typeof(s."managerRatings" -> h."org") = 'number'; then ALTER TABLE "OrganizationMembership" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "removedAt", DROP COLUMN IF EXISTS "endedWithAccount", DROP COLUMN IF EXISTS "departmentId", DROP COLUMN IF EXISTS "roleId", DROP COLUMN IF EXISTS "officeId", DROP COLUMN IF EXISTS "joinDate", DROP COLUMN IF EXISTS "weeklyCapacityHours", DROP COLUMN IF EXISTS "workSchedule", DROP COLUMN IF EXISTS "customFields", DROP COLUMN IF EXISTS "orgRole", DROP COLUMN IF EXISTS "isAgent"; ALTER TABLE "UserSkill" DROP COLUMN IF EXISTS "managerRatings"; the profile step two moved stays on the memberships (copy it back to "User" first if the code goes back too); the revoked keys stay revoked (an Admin makes new ones). */

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
  /* A manager's rating of a skill in each workspace, keyed by workspace id (step three). */
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"UserSkill"'::regclass AND attname = 'managerRatings' AND NOT attisdropped) THEN
    ALTER TABLE "UserSkill" ADD COLUMN IF NOT EXISTS "managerRatings" JSONB NOT NULL DEFAULT '{}';
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

/* ONE TIME, STEP THREE (marker membership-fixes-2026-11-03 in the comment on
   the new "UserSkill"."managerRatings" column, which a later COMMENT ON must
   keep; the plan's final review fixes and its fixes review): the home keeps
   what it showed, each manager rating keyed by the person's home workspace,
   and the API keys of people already gone revoked, each with its Audit row
   (see the header). One statement: none runs without the others, and the
   marker is written with them. */
DO $$
BEGIN
  IF COALESCE(col_description('"UserSkill"'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = '"UserSkill"'::regclass AND attname = 'managerRatings' AND NOT attisdropped)), '')
     NOT LIKE '%membership-fixes-2026-11-03%' THEN
    /* The home membership of an account anchored away from it: COPIED from the account, only where the row holds none. */
    UPDATE "OrganizationMembership" m
       SET "joinDate" = COALESCE(m."joinDate", u."joinDate"),
           "weeklyCapacityHours" = COALESCE(m."weeklyCapacityHours", u."weeklyCapacityHours"),
           "workSchedule" = COALESCE(m."workSchedule", u."workSchedule"),
           "customFields" = COALESCE(m."customFields", u."customFields")
      FROM "User" u
     WHERE m."userId" = u."id"
       AND m."isPrimary" = true
       AND m."organizationId" <> u."organizationId"
       AND ((m."joinDate" IS NULL AND u."joinDate" IS NOT NULL)
         OR (m."weeklyCapacityHours" IS NULL AND u."weeklyCapacityHours" IS NOT NULL)
         OR (m."workSchedule" IS NULL AND u."workSchedule" IS NOT NULL)
         OR (m."customFields" IS NULL AND u."customFields" IS NOT NULL));
    /* Each manager rating, keyed by the person's home workspace (the "isPrimary" membership's, else the account's own); a key already there wins. */
    UPDATE "UserSkill" s
       SET "managerRatings" = jsonb_build_object(
             COALESCE((SELECT h."organizationId" FROM "OrganizationMembership" h
                        WHERE h."userId" = u."id" AND h."isPrimary" = true
                        ORDER BY h."createdAt", h."id" LIMIT 1), u."organizationId"),
             s."managerRating") || s."managerRatings"
      FROM "User" u
     WHERE u."id" = s."userId"
       AND s."managerRating" IS NOT NULL;
    /* Every key not revoked whose creator holds no live seat in the key's workspace: revoked now, in UTC, each with its Audit row, actor the system. */
    WITH revoked AS (
      UPDATE "ApiKey" k
         SET "revokedAt" = (now() AT TIME ZONE 'UTC')
       WHERE k."revokedAt" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "User" u
            WHERE u."id" = k."createdById"
              AND u."organizationId" = k."organizationId"
              AND u."status" <> 'INACTIVE'
              AND u."deletedAt" IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM "User" u
             JOIN "OrganizationMembership" m ON m."userId" = u."id"
            WHERE u."id" = k."createdById"
              AND u."organizationId" <> k."organizationId"
              AND m."organizationId" = k."organizationId"
              AND m."status" <> 'INACTIVE'
              AND m."removedAt" IS NULL)
      RETURNING k."id", k."name", k."prefix", k."organizationId", k."createdById"
    )
    INSERT INTO "ActivityLog" ("id", "type", "actorId", "actorType", "organizationId", "description", "targetId", "targetType", "severity", "metadata", "createdAt")
    SELECT 'deploy-key-revoked-' || r."id", 'api_key_revoked', NULL, 'system', r."organizationId",
           'Revoked API key "' || r."name" || '" (prefix ' || r."prefix" || ') on the deploy: the person who made it no longer works in this workspace',
           r."id", 'api_key', 'warning',
           jsonb_build_object('name', r."name", 'prefix', r."prefix", 'createdById', r."createdById", 'reason', 'creator has no live seat, deploy step three'),
           (now() AT TIME ZONE 'UTC')
      FROM revoked r
    ON CONFLICT ("id") DO NOTHING;
    COMMENT ON COLUMN "UserSkill"."managerRatings" IS
      'A manager''s rating of this skill in each workspace, keyed by workspace id (managerRating is the old, account-wide one, no longer shown). Keep this marker in any new comment: membership-fixes-2026-11-03';
  END IF;
END
$$;
