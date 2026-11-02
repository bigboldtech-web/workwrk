# A person's status in each workspace

Founder, 2026-11-01: "Start the real fix for people in two companies: a separate status for each workspace, first on the list after launch."

## The problem

A person has one account row (`User`), anchored to one workspace (`User.organizationId`). Every other workspace they belong to is an `OrganizationMembership` row. Their access level and Admin scopes already belong to each workspace: a move between workspaces (`reanchorUser`, src/lib/access/workspace-anchor.ts) keeps the level of the workspace being left on its membership and takes the target's. Their status (`User.status`) and removal (`User.deletedAt`) do not: they are one column each on the account.

So today, for someone who works in Company A and Company B:

1. **B deactivates or removes them, and they lose A too.** Status is one per account.
2. **B often cannot deactivate or remove them at all.** Members, the directory and every people route find a person with `organizationId = here`, so while they are anchored in A they are invisible to B's admins, and they keep B through the switcher. A departing contractor B cannot remove is a security hole.
3. **SCIM from B's identity provider ends their sessions everywhere** (the member path bumps the account's tokenVersion), and SCIM from A's ends the whole account.
4. **Counts judge B's members by the account's status.** Seats, Owners and Admins, digests, reminders and report trees count a membership person as live in B whenever the account is live, whatever B decided.
5. **The first attempt was reverted** (889a9e74). It moved a removed person's account to their other workspace, and that workspace's hard delete then cascaded the account, taking their conversations, kudos, KPI readings and reviews in the first workspace with it.

## Decisions

Decided by the worst case of each option for real people (feedback_worst_case_planning), with data integrity first.

**D1. The status lives where the access level lives.** `User.status` and `User.deletedAt` keep meaning the person's status and removal **in the workspace they are anchored to**. Each membership row gets its own `status` (UserStatus, default ACTIVE) and `removedAt` for that workspace. `reanchorUser` swaps them exactly as it swaps the level: the workspace being left keeps the person's status there on its membership, and the account takes the target's.
- Why: every reader of `User.status` for anchored people (hundreds of them: pickers, digests, the access engine) stays right without a change. Moving the status of every workspace onto memberships would touch all of them for no gain to anyone.
- Worst case of the other option (one status per account, as now): problems 1 to 4 stay.

**D2. A usable seat** is a membership whose `status` is not INACTIVE, whose `removedAt` is null, and whose workspace is not SUSPENDED or CANCELLED. HR statuses (On leave, Probation, PIP, Notice period) are usable: they are labels, not access. One shared where-builder states it; nothing writes the condition out by hand.

**D3. Ending someone in the workspace they are anchored to, when they have a usable seat elsewhere, moves them there in the same transaction.** The workspace being left keeps the ended status (and `removedAt` for a removal) on its membership. No account-wide tokenVersion bump. Their sessions acting here lose it at once, because every check of the acting workspace reads the membership (D7), and the token goes home to the new anchor at its next check. They stay signed in to their other workspace.
- Worst case of bumping instead: someone removed by a client is signed out of their own company on every device. The move costs nothing comparable.

**D4. With no usable seat elsewhere, ending works as today:** `User.status` INACTIVE (and `deletedAt` for a removal) with the tokenVersion bump. The account has nowhere left to work.

**D5. Ending someone who works here through a membership** writes only that membership: `status` INACTIVE, and `removedAt` for a removal. The row is never deleted (D8). Their account, their anchor and their other workspaces do not change.

**D6. Restoring or reactivating** writes the seat being restored, with the seat check as today. When the person's anchor is itself ended (they had nowhere else), the account moves to the workspace that restored them in the same transaction, so a person with a usable seat is never left anchored to an ended one.

**D7. Invariant, kept by every write: if any of a person's seats is usable, their anchor is usable.** Sign-in, Google sign-in and the session check repair a row that breaks it (old data) by moving the person to their best usable seat (primary first, then oldest, as sign-in picks today). `actingWorkspace`, `levelHeldIn`, `levelsHeldFor`, `freshWorkspaceActor`, `resolveActingPerson` and the session's off-anchor check treat an ended membership exactly like a missing one.

**D8. A membership row is never deleted for a removal.** It is the record that the person worked here, the way back for a restore, and what keeps their account safe. SCIM's member deprovision stops deleting it (it now ends it, D5).

**D9. The hard delete never deletes an account that has a membership anywhere else.** `moveHomesOutOf` ranks the homes: a usable seat in an ACTIVE or TRIAL workspace, then SUSPENDED, then CANCELLED, then an ended membership. Moving into an ended one keeps the account, deactivated or removed there, with everything it did there. This is the condition the revert set before any removal may move an account (project_workwrk_launch_audit).

**D10. Erasing one's own account stays account-wide** and also ends every membership. No move ever revives an erased account: `reanchorUser` keeps `deletedAt` and INACTIVE on an erased account whatever the target holds.

**D11. Members shows everyone who belongs here.** People anchored elsewhere appear with this workspace's role and status, and the same filters (Active, Deactivated, Removed). For them an admin may change the role, deactivate, reactivate, remove and restore, with the same gates and the same handover as anyone. Their manager, department, job role and other profile details are the account's (the anchored workspace's) and stay read-only here, with one line saying why. Making those per workspace too is the next step (founder list section 1, item 1), not this one.

**D12. Every count reads this workspace's seat.** Seats, Owners and Admins (last-Owner and last-Admin checks included), digests, reminders, report trees, leaver sweeps and the staff console count a membership person only while their membership is usable and the account is not ended.

**D13. Re-inviting someone whose membership here was ended revives it** on acceptance: status ACTIVE, `removedAt` null, the invitation's level, under the seat check. An ended membership is not "already a member".

**D14. SCIM acts on this workspace only.** Deprovision from B ends B's seat (D3 or D5). Reactivation from B restores B's seat (D6). Neither changes another workspace or bumps the account's tokenVersion unless D4 applies.

**D15. Ending someone in a workspace revokes the API keys they created there.** Today a key keeps working after its creator leaves. The Remove and Deactivate dialogs say how many keys will stop working.
- Worst case of keeping them: an ex-employee holds a working key to the company's data. Worst case of revoking: an integration stops until an Admin makes a new key, which the dialog warned about.

**D16. Existing data keeps exactly what it shows today.** A one-time step in the SQL file (marked in the comment on the `status` column, like 2026-10-05-membership-admin-scopes.sql; a later `COMMENT ON` that column must keep the marker) copies an ended account's state onto its memberships: INACTIVE onto `status`, `deletedAt` onto `removedAt`. Nobody gains or loses access on the deploy. HR labels are not copied (they are the anchored workspace's). Every seat it ends carries `endedWithAccount`: before this change only the anchored workspace could end an account, so each copied seat is that workspace's decision. Restoring or reactivating the anchored seat (restoreSeat; step 3 routes the People PATCH and DELETE ?restore and SCIM's reactivation through it) brings those seats back in the same transaction, matching the kind (a reactivation brings back the deactivated ones at ACTIVE, a restore also clears `removedAt`), with no seat check, exactly as the account-wide restore did before. Any write of a seat by its own workspace (endSeat, restoreSeat on the membership, the seat a move leaves, and step 2's invitation revive) clears its mark, and from then on that workspace alone decides it. So for that data the worst case is exactly today's behaviour.
- Worst case of not marking them (the step 1 review, M1): someone deactivated by their anchored workspace before the deploy and reactivated by it after would stay ended in every other workspace, which none of them decided, and with personGoneNow aligned their AI teammate skills there would be deleted 30 days on.

**D17. The dialogs' warning changes.** "Removing them here ends their access there too, for now" becomes "Their other workspaces are not affected." and shows only when they belong elsewhere.

## Steps

Each step: one builder, one read-only reviewer, high and medium findings fixed, then the next. After the last step, three reviewers, the gate, the proofs, the SQL on the local database, merge, deploy and live checks. **Steps 1 to 4 ship together, in one merge; step 1 never ships alone** (the step 1 review, H1): routes steps 2 and 3 change still un-end an account without touching its memberships, and step 4's counts still read the account alone.

1. **Foundation.** Schema and SQL (D1, D16). Shared helpers in a new src/lib/access/workspace-status.ts: the usable-seat where-builder (D2), `endSeat` and `restoreSeat` (D3 to D6). The `reanchorUser` swap (D1, D10). `moveHomesOutOf` (D9). Erasure ends memberships (D10). `actingWorkspace`, `levelHeldIn`, `levelsHeldFor`, `inWorkspaceWhere`, `workspacePeopleLines` read the membership's seat (D7, D12).
2. **Sign-in, sessions, switching, invitations, AI apps.** auth.ts credentials and Google fallbacks and the session's off-anchor check (D7). `freshWorkspaceActor`. me/orgs and switch-org list and accept usable seats only. accept-invite and `alreadyInOrg` (D13). oauth eligibility and `resolveActingPerson` (D7).
3. **Members and the person's admin routes.** members-list includes membership people (D11). users/[id] PATCH status and role, DELETE remove and restore, and handover work for both kinds through `endSeat`/`restoreSeat` (D3 to D6). endTeammateAccessFor stays per workspace; API keys (D15). Dialog copy (D15, D17). Drawer read-only fields (D11).
4. **Counts and SCIM.** Everything in D12 and D14.
5. **A live proof.** Two workspaces and one person in both, through the real routes: B deactivates, A still works and B is gone from the switcher; A removes, the person lands in B; B's hard delete keeps the account; restore and re-invite.

## Out of scope, next

Manager, department, job role and the other profile fields per workspace (founder list section 1, item 1). Until then a person anchored elsewhere shows those fields read-only in B.

## Map

~/workwrk-launch-backup/agents/workspace-status/map.md lists every write and read of a person's status and every membership reader at 030f5e6d.

## Step 1, built

Branch `workspace-status` in ~/theywrk-launch, not committed. Nothing is wired into a route yet (step 3 does that); the behaviour that changes now is the move between workspaces, the hard delete's homes, the erasure and the acting-workspace reads.

### What was built

1. **Schema and SQL (D1, D16).** `OrganizationMembership.status UserStatus @default(ACTIVE)` and `removedAt DateTime?`. New file `prisma/sql/2026-11-01-membership-status.sql`, listed last in SQL_MANIFEST (text edit) with a README row. Both columns catalogue-guarded (pg_attribute), so only the first apply locks (ACCESS EXCLUSIVE on "OrganizationMembership" for a moment; a constant default and a NULL column, no rewrite; no key to "User"). A ONE-TIME step, marked on the "status" column's comment (`membership-status-2026-11-01`, as 2026-10-05-membership-admin-scopes.sql does): every membership of an account with status INACTIVE gets INACTIVE, and of an account with deletedAt gets INACTIVE and removedAt = that deletedAt (an earlier removedAt kept). HR labels are not copied. The header says why the data step must be in the file (atomic with the column: a membership left ACTIVE under an ended account is a usable seat the moment the new release reads it) and what happens to someone ended in the minutes between the file and the reload (the new release treats them as D3 would have). `node scripts/check-schema-sql.mjs` passes. **SQL to apply before the code:** this one file.
2. **The seat rule (D2)** in a new leaf module `src/lib/access/workspace-seat.ts`, re-exported by `workspace-status.ts`. A leaf because `workspace-anchor.ts` (the ranking) needs the rule and `workspace-status.ts` needs `reanchorUser`: one file for both would be an import cycle. One statement in three forms: `liveSeatWhere`, `keptSeatWhere`, `usableSeatWhere` (status not INACTIVE, removedAt null, workspace not SUSPENDED or CANCELLED); `seatIsLive`, `seatIsKept`, `seatIsUsable`, `workspaceIsOpen` over a loaded row; `liveSeatSql`, `keptSeatSql` for raw statements. A test checks the three forms agree on every combination.
3. **`endSeat` and `restoreSeat`** in new `src/lib/access/workspace-status.ts`. Both take the person's row lock first (`lockPerson`, `SELECT 1 FROM "User" ... FOR NO KEY UPDATE`), so a move landing at the same moment either sees the seat ended or is seen by it.
   - `endSeat(tx, { userId, organizationId, kind, now })`: anchored here with a usable seat elsewhere (primary first, then oldest, passing over a workspace where an account with the same email is anchored) moves there through `reanchorUser`, the seat left written ended (D3, no tokenVersion bump); anchored here with nowhere usable ends the account as today (INACTIVE, deletedAt for a removal, tokenVersion +1; D4); a membership here writes only that row, never deleting it (D5). Answers `moved` (with `anchoredIn`, `from`), `account_ended`, `membership_ended`, `already_ended` or `not_here`, so step 3's routes can audit and run side effects.
   - `restoreSeat(tx, { userId, organizationId, kind, status? })`: restores or reactivates the anchored seat as today, or the membership; when the anchor is itself ended, moves the account here in the same transaction (D6). Refuses, writing nothing: an erased account (`erased`), a seat not ended the way asked (`not_ended`), a reactivation of a removed seat (`removed`), no seat (`not_here`). When an account with the same email is anchored here the anchor cannot move: `anchorEnded: true` (a data fault needing a merge). The doc comment says the seat checks, role lock, handover and Owner guards stay with the callers.
4. **The `reanchorUser` swap (D1, D10)** in `workspace-anchor.ts`: the membership left gets the person's current status and removedAt = User.deletedAt, unless the caller names the leaving seat (`leaving`, which endSeat uses); the account takes the target membership's status and removedAt as User.status and User.deletedAt; with no target row it keeps its own. An erased account (`isErasedAccount`, the same test the users/[id] restore uses: deletedAt within a minute of the newest erasure consent record) never has deletedAt cleared or status raised. Header rewritten. It now takes the person's row lock too, and `takenBySameEmail` is shared with moveHomesOutOf.
5. **Erasure (D10):** `src/app/api/me/delete/route.ts` ends every membership in the same transaction, right after the account is anonymised: status INACTIVE, removedAt now where none was set (an earlier removal keeps its moment). Never deletes one. Header updated.
6. **`moveHomesOutOf` (D9):** ranks a live seat in ACTIVE/TRIAL, then SUSPENDED, then CANCELLED, then (an unknown workspace status, then) any ended membership, the ended ones in the same workspace order among themselves (`homeRank`). Every membership elsewhere still keeps the account; only AccountCannotMove stops it, as before. Moving into an ended membership lands the account ended there through the swap (the H1 case: removed from B, home A hard-deleted, the account lives on in B as removed).
7. **acting-workspace.ts (D7, D12):** `actingWorkspace`, `levelHeldIn`, `levelsHeldFor` (and `levelsHeldIn` through it) treat a deactivated or removed membership as none. `inWorkspaceWhere(org, { deactivatedToo? })` counts a live membership by default; `deactivatedToo` keeps a deactivated one (never a removed one) for a caller that keeps deactivated anchored people. `workspacePeopleLines` leaves out a removed membership always and a deactivated one with `activeOnly`; `workspaceDottedLines` leaves out a removed membership (a deactivated person's lines still count in the loop walk, as for anchored people). Anchored people keep their own rules.
   - The callers of `inWorkspaceWhere`, checked one by one (and listed with reasons in a test that fails when a new caller appears): default (ended = none) for goal-period-notify and employed.server, which already ask for live people only; `deactivatedToo: true` for calendar/events (the Team pill, 2 calls), users/[id]/agent-reports, users/[id]/record-access (2 calls) and teams-counts (2 calls), which filter User.deletedAt only and so keep deactivated anchored people; `deactivatedToo: !!opts.includeDeactivated` for team-scope.server, matching its workspacePeopleLines half. No caller needed removed people. Without the option these would have dropped every deactivated account's membership people on the deploy (the one-time step makes those memberships INACTIVE).

### Files

New: `prisma/sql/2026-11-01-membership-status.sql`, `src/lib/access/workspace-seat.ts`, `src/lib/access/workspace-status.ts`, `src/lib/access/workspace-status.test.ts`, `src/lib/access/membership-status-sql.test.ts`.
Changed: `prisma/schema.prisma`, `prisma/sql/README.md`, `scripts/deploy-migrations.mjs`, `src/lib/access/workspace-anchor.ts`, `src/lib/access/acting-workspace.ts`, `src/app/api/me/delete/route.ts`, `src/app/api/calendar/events/route.ts`, `src/app/api/users/[id]/agent-reports/route.ts`, `src/app/api/users/[id]/record-access/route.ts`, `src/lib/people/team-scope.server.ts`, `src/lib/people/teams-counts.ts`.
Tests changed: workspace-anchor, acting-workspace, me/delete, employed.server, users/[id]/agent-reports, agent-manager-reads.contract, token-version-bumps (the new bump classified `ends_at_next_request`), auth-workspace-move (its fake client gains `$executeRaw` for the row lock), and the six tests that pin the manifest's tail (oauth/sql, browser/types, skills/types, goals recurring-goals-sql, recurring-goals-kpi-identity-sql, item-completions-sql).

### Tests

- The 16 new or changed test files: 198 tests, all pass. Run against the base commit's sources (030f5e6d put back in a scratch copy, tests kept new), 64 fail on the old code: workspace-status 24 of 24 (the module is new), membership-status-sql 7 of 7 (the file is new), workspace-anchor 10 (13 new tests: the swap both ways, the named leaving seat, the row lock, the ranking, the H1 case, a live seat before an ended one; the three that pass on old are guards that old code also met), acting-workspace 7 of 7 new, me/delete 1 of 2 new (the other guards the refusal), employed.server 1, agent-reports 1, agent-manager-reads.contract 2, token-version-bumps 2, the manifest-tail tests 9, auth-workspace-move 0 (fake only).
- For the new code, which has no old version, nine mutations each made the tests fail: the erased guard removed, endSeat's ended leaving seat dropped, restoreSeat's anchor move dropped, any seat counted as usable, D4 without the sign out, a restore of an erased account allowed, endSeat without the lock, the rule ignoring removedAt, ended seats not ranked last.
- Wider runs, all green: src/lib/access and src/lib/people (97 files, 1,703 tests); the route folders users, me, calendar, auth, boot, ai, cron (23 files, 246 tests); every other test importing a changed module (183 files, 3,400 tests).
- Type check clean. ESLint clean on every changed file but two errors at src/app/api/calendar/events/route.ts:309 (an accessLevel read), which are on 030f5e6d too and not on a line this step touched.

### Left for later steps

- **Steps 1 to 4 ship together, in one merge (corrected by the step 1 review, H1).** Until step 2, the switcher (me/switch-org), me/orgs and the auth.ts fallbacks pick memberships by workspace status only. Live accounts with an ended membership do exist from the deploy on: the one-time step ends every membership of an ended account, and today's PATCH reactivation, DELETE ?restore and SCIM reactivation bring the account back without touching them. The move now refuses to land a live account in an ended seat (see "Step 1, review fixes"), so the worst case before step 2 is a refused switch or sign-in, never a lockout; step 2 makes those callers list and pick usable seats only.
- auth.ts's off-anchor check still treats any membership row as a seat (step 2, D7). `freshWorkspaceActor` likewise.
- accept-invite writes the membership before `reanchorUser`: step 2 should take `lockPerson` first there, and its upsert must revive an ended membership (status ACTIVE, removedAt null, endedWithAccount false, D13); since the review fixes, the move refuses (WouldLandEnded) rather than land the account ended.
- A membership row for the workspace a person is anchored to can exist (from an earlier move) and is stale while they are anchored there, as its role and Admin scopes already are. Every reader must take the anchored seat from User; the move overwrites that row when they leave.
- `lineStandingsElsewhere` (acting-workspace.ts) still reads memberships elsewhere of any status, so a line can count as relied on in a workspace that ended the person or the manager. Conservative (it keeps lines), not widening; step 4 should read the seat there.
- (Fixed by the review fixes, M2.) `lineFactsAround` and the other report-line reads left a person with a deactivated membership out; they now keep them, `inactive` from the membership.
- D6 when the anchor is in a suspended or cancelled workspace (not ended, but unusable): restoreSeat moves only an ended anchor, as specified; the sign-in fallback moves the others.

## Step 1, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status/step1-review.md; the coordinator's rulings were applied as given. Same worktree and branch, still not committed. Steps 1 to 4 ship together in one merge (corrected above, under Steps and in "Left for later steps").

### H1: a live account never lands in an ended seat

- `reanchorUser` (workspace-anchor.ts) now refuses, with nothing written, to land a LIVE account (not removed, not INACTIVE) in a seat that is not live there: it throws `WouldLandEnded`. Only a caller passing `mayLandEnded: true` may, and only `moveHomesOutOf` does (D9: that, or the cascade). endSeat's D3 target is usable by construction, and restoreSeat's D6 move is of an ended account, so neither meets it.
- Through today's callers, until step 2 answers it properly: the switcher throws with nothing written (before, Pat was signed out of every workspace), the session fallback is revoked for now, the sign-in fallback fails. A test proves each.
- The plan's false note ("nothing reaches it today") is replaced: today's PATCH reactivation, DELETE ?restore and SCIM reactivation bring an account back without touching the memberships the one-time step ended.

### M1: the seats the one-time step ended come back with the anchored seat

- New column `OrganizationMembership.endedWithAccount Boolean @default(false)`, in the same SQL file (catalogue-guarded, declared in the schema; the README row and the manifest comment updated). The one-time step sets it on exactly the memberships it ends.
- Cleared by every write of that seat by its own workspace: endSeat on a membership (an already-ended one included: nothing else is written, but that workspace now owns the decision), restoreSeat on a membership, and the seat a move leaves. Step 2's invitation revive must clear it too.
- restoreSeat's ANCHOR branch also brings back, in the same transaction and with NO seat check, every membership of the person still marked, matching the kind: a reactivation brings back the deactivated ones at ACTIVE and leaves a marked removal for a restore; a restore brings back both and clears removedAt. The answer lists them (`alsoRestoredIn`). The anchored workspace's own stale row is left alone. This is exactly the account-wide restore of today, so for legacy data the worst case is today's behaviour. D16 above says so.
- Known limit: when a workspace that is not the anchor restores the person first and the ended anchor moves there (D6), marks left on third workspaces come back only with a restore of the new anchored seat, which is live, so those stay ended until their own workspace restores them. Today no such first restore is possible (membership people are invisible to their workspaces), so this is never worse than today.

### M2: kept seats where deactivated people stay on the lines

- `levelHeldIn`, `levelsHeldIn` and `levelsHeldFor` take `{ keptSeats: true }`: a deactivated membership answers, a removed one never does. New `seatsHeldFor` answers kept seats with whether each is deactivated HERE (the membership's status for membership people; User.status is the anchored workspace's).
- Kept seats now: `reportCountOf` (rule 6); `factsHere` (so `lineFactsAround`, `effectiveDirectReportIds`, `effectiveReportsOfMany`, `listedUnderAgents`), with `inactive` from the seat; `liveHereAmong` (so `countedDottedReportIds`, `agentsWithStoredReports`); `agentIdsIn` (the Agent tier); `lineAbove` (the loop walk, as workspaceDottedLines); the names on a person's record (users/[id] GET); the dotted lines the dotted-lines GET lists (its PUT deletes every line of this workspace the body leaves out, so a hidden line would be deleted on the next save); the names the handover writes into another workspace's record.
- Live seats kept for: every decision about the person's own access (boot, viewer, self-facts, acting-person, agents acting and tools, person-access, oauth eligibility, check-in access, `managesNobody`), reach (`effectiveManagersOf`, `countedDottedManagerIds`, the digest's managers), whose a line is (`othersDottedLines`, `managerLineIsOthers`, `recordLinesOfOthers`, `staleLinesOf`: a manager deactivated here but live where the person also works keeps that workspace's line), `managerCandidateIn` and `unattendedRecipient`.
- New `src/lib/access/kept-seats.test.ts` lists every call of the four helpers with its choice and fails on a new one, with behaviour tests for each kept read.
- For step 3 or 4: `unattendedRecipient` (live) ends its walk at a manager deactivated here through a membership, so work goes to the first Owner rather than the next manager up (for an account deactivated before the deploy, a change on the deploy); `effectiveManagersOf` (live) gives a person deactivated here through a membership no manager here, so that manager loses reach over their record here (narrowing).

### M3: personGoneNow reads the seat

- `personGoneNow` (src/lib/skills/orphans.ts) uses `seatIsLive`: a membership deactivated or removed here means gone, as resolveActingPerson answers. orphans-gone.test.ts has both cases. This lets the skills of a person ended through a membership become orphans and, 30 days on, be deleted; it relies on step 3 routing today's restores through restoreSeat (M1's way back), so it must not ship without step 3.
- Other hand-written copies of the membership rule in src/lib, for step 4 (not changed; several grant reach or count seats): src/lib/team.ts:33 and :40 (report tree, raw EXISTS); src/lib/reporting-line.ts:115 and :124 (solid tree, raw EXISTS); src/lib/seats.ts:94 (openInvitedAddresses, raw), :105 (seatUse) and :168 (seatsForAddress); src/lib/check-in-access.server.ts:223 (raw FOR KEY SHARE on the row); src/lib/connectors/connections.ts:1181 to 1206 (LEAVERS_WHERE, raw); src/lib/agents/connector-access.ts:141 to 152 (workspaceMembersAmong, raw); src/lib/admin/workspace-use.ts:40 and :61 (raw); src/lib/admin/company-notifications.ts:61 (raw); src/lib/reminder-sweep.ts:101 (liveInWorkspace: any row); src/lib/reminders.ts:31 to 80 (by workspace status only); src/lib/access/digest-recipients.ts:110 and :153; src/lib/access/guests.ts:24; src/lib/access/membership.ts:180 (liveAdminsOf); src/lib/access/self-facts.ts:51 and :68 (soleAdminWorkspaces); src/lib/admin/set-owner.ts:89 to 130, company-patch.ts:146 and :370, company-detail.ts:76 and :108 (staff console); src/lib/scim-deprovision.ts:315; and, for step 2, src/lib/auth.ts:392, :729 and :773, src/lib/access/workspace-admin.ts:132, :221 and :229, src/lib/oauth/eligibility.ts:73, src/lib/auth/invite-facts.server.ts:132. Also acting-workspace.ts `lineStandingsElsewhere` (noted above).

### The lows

- L1: the hard delete (src/app/api/cron/org-hard-delete/route.ts) tries a company once more in the same run when Postgres ends its transaction to break a deadlock (40P01 or Prisma's P2034, read by the existing `isDeadlock`); a second one is that run's failure, and nothing else is retried. The header says a deadlock with a person's move is expected and harmless.
- L2: `moveHomesOutOf` takes the row lock of every person it may move, in id order, before it reads and ranks their seats.
- L3: the anchor tests log every read, and "row lock before it reads anything" checks the order. The SQL file is still checked as text; the coordinator runs it on a local database before merge (no SQL was run here).
- L4: the SQL header, the README row, the manifest comment and the column comment itself say the marker lives in the comment on `OrganizationMembership.status`, and a later `COMMENT ON` must keep it.
- L5: endSeat's `account_ended` answer carries `strandedIn`: the workspaces whose usable seat the account could not move to because an account with the same email is anchored there.

### Files

Changed in this pass: prisma/schema.prisma, prisma/sql/2026-11-01-membership-status.sql, prisma/sql/README.md, scripts/deploy-migrations.mjs, src/lib/access/workspace-anchor.ts, src/lib/access/workspace-status.ts, src/lib/access/acting-workspace.ts, src/lib/access/manager-lines.ts, src/lib/access/manager-candidate.ts, src/lib/access/membership.ts, src/lib/people/handover.server.ts, src/lib/skills/orphans.ts, src/app/api/users/[id]/route.ts, src/app/api/users/[id]/dotted-lines/route.ts, src/app/api/cron/org-hard-delete/route.ts. Tests: new src/lib/access/kept-seats.test.ts and src/app/api/me/switch-org/route.test.ts; changed workspace-anchor, workspace-status, membership-status-sql, agent-manager-reads.contract, auth-workspace-move, orphans-gone, org-hard-delete.

### Tests

- The 9 new or changed test files: 123 tests, all pass. Against the step 1 code (this pass's sources put back in a scratch copy, tests kept new), 37 fail: kept-seats 8 of 8, workspace-status 12 (the five new M1 and L5 tests, and seven whose answers gained `strandedIn` or `alsoRestoredIn`), membership-status-sql 6, workspace-anchor 3 (the guard, the leaving mark, the lock order), org-hard-delete 2, auth-workspace-move 2, orphans-gone 2, switch-org 1, agent-manager-reads.contract 1.
- Wider runs: src/lib/access, src/lib/people and src/lib/skills (106 files, 1,841 tests, all pass after one contract string was updated); the route folders users, me, calendar, auth, boot, ai, cron, kra-assignments and okrs (24 files, 252 tests); every other test importing a changed module (219 files, 3,714 tests: one failure, src/lib/agents/legacy-schedules.test.ts, which passes alone and touches nothing changed here).
- Type check clean (run once in this pass). ESLint clean on every file changed in this pass.
