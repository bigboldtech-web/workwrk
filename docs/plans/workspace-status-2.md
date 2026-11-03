# A person's manager and profile in each workspace (phase 2)

Founder, for phase 2 of "A person's status in each workspace": build everything. Three parts: the manager line per workspace, editing the profile a membership holds, and the pickers and Workload.

Phase 1 is docs/plans/workspace-status.md (D1 to D18, live at 8b0ce20d). Its words hold here: a **seat** is the account row where the person is anchored and a membership row everywhere else; **live**, **kept** and **usable** are workspace-seat.ts's.

## The problem

Phase 1 gave each workspace its own status, removal, level and profile for someone who belongs to several (D1, D18). Three things are still one per account, or anchored people only:

1. **The manager line.** `User.managerId` and every `UserDottedLine` row are read by every workspace the person belongs to. Pat is anchored at her agency A, where she reports to Max, and contracts for client B, where Dana leads her. While Pat last opened B, Bo (B's Owner) sets her Reports to Dana: the one column now says Dana in A too, and A's trees, reach, digests, review reviewers, timesheet approvers and weekly reviews follow B's choice. Batches 6 to 9 of the docs-found fixes worked around the one column (a line another workspace "relies on" is kept, asked about with a 409, moved with the account's end and logged in the other workspace). That is the most intricate code in the access layer, and it still lets one workspace change another's line.
2. **The profile on a membership is read-only.** D18 put Pat's B department, job title, office, weekly hours, working week and profile fields on her B membership. Members, the Directory and the record show them read-only with PROFILE_ELSEWHERE, and PATCH refuses them. B's HR cannot record that Pat gives B 10 hours a week, and Dana cannot set who Pat reports to in B.
3. **Pickers and Workload list people anchored here only.** Pat is in B's Directory, but whenever she last opened A, Dana cannot assign her a task, hand Max's work in B to her, or message her, and Teams > Workload leaves her out (the final review's "Day one" note). AI and MCP lookups by name or email miss her the same way.

## Decisions

Decided by the worst case of each option for real people (feedback_worst_case_planning), with data integrity first. The people: Pat (anchored at agency A, contracts for client B), Max (Pat's manager at A, and a contractor at B), Dana (Pat's lead at B), Bo (B's Owner), Ada (A's Admin), Rita (a manager B deactivated).

**E1. The solid line lives where the profile lives.** `User.managerId` keeps meaning the person's manager **in the workspace they are anchored to**. Each membership row gets its own `managerId`: the person's manager in that workspace. It is a key to User, `ON DELETE SET NULL` as User's own relation is, with an index on `(organizationId, managerId)` for "who reports to Max here". As with the profile, the anchored workspace's own stale membership row is never read as its line: every reader takes the anchored line from User, and the move overwrites that row when they leave.
- Options: (a) this; (b) a new table with one line per person and workspace, `User.managerId` dropped or kept as a mirror; (c) one line per account, as now.
- Worst case of (c): Bo's edit above. Max stops getting Pat's A digest, her A review goes to whoever launched it, her A timesheets wait for nobody, and Max loses her record's people data in A.
- Worst case of (b): every one of the readers of `User.managerId` changes at once, and a mirror that drifts from the table gives two answers to "who is Pat's manager in A", each granting reach.
- Worst case of (a): a reader the sweep misses reads `User.managerId` for a membership person: the account's line, filtered as today by managersWithSeatHere and the seat checks. Never worse than today, and E16's test finds it.
- Why a key: the line arrives on the account at a move, and `User.managerId` is a key, so a dangling id would fail the move itself (the placementThere lesson, phase 1). With the key, a manager's account deleted for good leaves `NULL` on every membership naming them, as it does on User.
- **Recommended: (a).**

**E2. Each workspace has its own dotted lines.** `UserDottedLine` gets `organizationId` (key to Organization, `ON DELETE CASCADE`, NOT NULL after the one-time step). The unique key becomes `(userId, managerId, organizationId)`, with indexes `(organizationId, managerId)` and `(organizationId, userId)`. A line two workspaces read today becomes two rows (E11). No swap is needed: each row names its workspace.
- Options: (a) this; (b) one row read by every workspace, with today's inference (the line is this workspace's when the manager holds a level here and no other workspace relies on it); (c) a JSON list on each membership.
- Worst case of (b): Max holds a level in A and in B, so Pat's dotted line to him is "B's" in B's eyes. Dana takes it off in B, the PUT deletes the one row, and A loses Pat's dotted line to Max with the reach it gave A's matrix manager (her A reviews and KPIs). The other way round, B cannot remove a line its own chart shows ("kept for another workspace").
- Worst case of (c): no index for "Max's dotted reports here"; every walk parses every membership's JSON.
- Worst case of (a): a reader the sweep misses ignores `organizationId` and reads every workspace's rows: today's behaviour.
- **Recommended: (a).**

**E3. The swap on a move.** `reanchorUser` swaps the line as it swaps the level, the status and the profile: the membership left keeps `User.managerId` (that workspace's line), and the account takes the target membership's `managerId`. With no target row, which no caller moves into, the account arrives with no manager rather than carry another workspace's (as arrivingProfile does). Every move gets it: D3, D6, the switcher, an invitation, the D7 repair, the hard delete (moveHomesOutOf).
- Worst case of not swapping: Pat switches into A and carries Dana as her A manager; Dana holds no seat in A, so A shows nobody and A's line to Max is lost.
- **Recommended: swap.**

**E4. What a manager here may be, and what happens to a line when the manager's seat ends.**
- A new or changed line here needs a manager who holds a **live** seat here, is not on the Agent tier here, is not the person, and closes no loop here (managerCandidateIn with `live`, unchanged). One correction: "deactivated" is read at the seat here (seatsHeldFor), so Rita, deactivated by B through her membership, is refused as "deactivated" rather than "not in this workspace" (manager-candidate.ts 54 reads the account's status today).
- When a manager's seat here ends, the handover moves **this workspace's** reports first (pendingHandover counts every report here, D3, D4 and D5 alike; SCIM runs the handover after the end, as now). Their reports in other workspaces are those workspaces' lines: untouched.
- A person's own line here stays on their ended seat, so a restore or a reactivation brings it back, and staleLinesOf checks it under the role lock, as today: cleared and logged when the manager's seat here is removed ("removed"), deactivated ("inactive", solid line only), on the Agent tier ("agent"), or absent ("elsewhere", never named).
- A manager who holds no seat here is never named or walked here (as today).
- endSeat and restoreSeat need no change: a line rides on the row that holds the seat, and the swap (E3) moves it.
- Options: (a) this; (b) any seat here, a deactivated one included; (c) keep moving another workspace's reports with the account's end (batch 8).
- Worst case of (b): B puts Pat under Rita. Pat's B review goes to nobody and her timesheets wait for ever.
- Worst case of (c): Max's last usable seat ends while A is suspended (D4): B's removal rewrites A's lines for a workspace that decided nothing, and when A comes back its team is gone.
- Worst case of (a): B cannot name a manager B has deactivated: the rule today.
- **Recommended: (a).**

**E5. Cycle checks per workspace.** Each workspace's lines form their own graph, checked under that workspace's role lock: lineAbove, wouldLoopIn, the dotted-lines peopleBelow, managerMapFor and wouldCreateCycle read this workspace's lines only.
- Worst case of a check across workspaces: Bo cannot make Max report to Pat in B because Pat reports to Max in A, and the refusal tells B how A is organised.
- Worst case of per workspace: none found. A loop needs a cycle in one workspace's lines, and those are checked under one lock.
- **Recommended: per workspace.**

**E6. The cross-workspace line machinery retires, in the same merge.** With E1 and E2 a line is only ever one workspace's, so these go: lineStandingsElsewhere and linesElsewhere; managerLineIsOthers, PATCH's 409 `manager_elsewhere` and `replaceOtherWorkspaceLine`; othersDottedLines and `keptElsewhere`; recordLinesOfOthers and the record's `managerElsewhere` and `dottedElsewhere` (named-here.ts keeps only its seat filter); the handover's `keepRelied`, `reportsStaying`, `reportsAtAccountEnd`, `reportsAlsoElsewhere`, `stays` and `alsoElsewhere` lines; moveReliedReportsAtEnd, followAccountEndLines and otherWorkspaceRows; handoverReportCount's relied exclusion; the transfer dialog's linesAlsoElsewhereNote lines, alsoElsewhereLogWords and the agent move's `stays`.
- Kept: the D17 note "Their other workspaces are not affected." (about the account, not the lines) and the handover GET's `alsoElsewhere` boolean behind it.
- Options: (a) retire with E1 and E2; (b) leave it.
- Worst case of (b): B removes Max, and the handover keeps Pat under Max in B "because A relies on the line". A's line is now A's own row, so in B Pat is listed under someone who left, managed by nobody.
- Worst case of (a): the change is wide and many tests pin the old words, so a slip shows as a handover that moves too little. The handover tests catch it.
- **Recommended: (a).**

**E7. Editing a membership person: who, and what.** Through the same doors and gates as for someone anchored here: relationTo over this workspace's tree (E1 makes Dana Pat's chain in B), canWritePersonGroup for "placement" and "reports-to", `chainWritesMembership` as today, the role lock for any line, the person's row lock with the seat read again (sameSeat), staleTabRefusal.
- **Editable:** job title, department, office (this workspace's own rows), weekly hours, working week, profile fields (merged key by key on the membership, as on User), Reports to, dotted lines. Status and role are editable as in phase 1.
- **Not editable here:** name, photo, phone and birthday, which are the account's (SHARED_IDENTITY_REFUSAL); two step, which is account-wide; the join date, which has no write door for anyone today; Admin scopes, because viewer.ts reads them from the anchored row only (a known limit).
- Every write lands on this workspace's membership row, never on the account, guarded as applyRoleChangeIn's membership write is: the seat not removed, the account still anchored where it was read. A new job title seeds its KRAs and SOPs here (seedAlignmentForUser), as for anyone.
- Options: (a) the same doors; (b) Admins and the People team only; (c) read-only, as now.
- Worst case of (c): Workload measures Pat against B's 40 hours while she gives B 10, so B overloads her and nobody can fix it.
- Worst case of (b): Dana sets everyone else's Reports to but not Pat's, so B's chart shows Pat with no manager for weeks.
- Worst case of (a): a manager in B edits B's values of Pat, which is their job for anyone. A never sees it.
- **Recommended: (a).**

**E8. What Members, the Directory and the record show for a membership person.** The same rows and controls as for anyone, where the viewer may write: the drawer's profileEditable, the Directory's canEdit and bulk selection, the record's Edit details and dotted lines. PROFILE_ELSEWHERE goes. The one read-only line on their row becomes the existing SHARED_IDENTITY_REFUSAL, and it covers the personal fields only. The record adds the people data this workspace now holds of them (weekly hours, working week, profile fields) for readers of people data, and their manager, dotted managers and reports here. Their KPI history, reviews and skills here stay out of the record (a known limit, and the next step). No new surface.

**E9. SCIM.**
- **(i) The manager attribute.** Today SCIM ignores it: the Users [id] route reads name, userName, emails and active only (PUT 226-240, PATCH 295-331).
  - Options: (a) keep ignoring it; (b) read the enterprise extension's `manager.value` (a WorkwrK user id, as SCIM ids are ours) on POST, PUT and PATCH, and write **this workspace's** line (the account's for someone anchored here, the membership's for someone here through one) under E4 and E5 and the role lock. A manager that fails the rule is not written, the rest of the push goes on, and an audit row says why.
  - Worst case of (a): an enterprise's Okta sends managers, nothing lands, and B's admins retype what their identity provider knows.
  - Worst case of (b): the identity provider's manager replaces an Admin's edit at its next push, which is what a provider does with the fields it owns. For Pat it writes B's line only, never A's.
  - **Recommended: (b).** Its own step, shippable after the core.
- **(ii) Groups (departments).** A Group's member add, remove and replace write this workspace's department: the account's for someone anchored here, the membership's for a membership person (today Groups/[id] filters `organizationId` and skips them). loadGroup lists both kinds, and DELETE counts both.
  - Worst case of skipping: B's Engineering group sync never places Pat, so B's department filter, groupings and audiences miss her.
- **(iii) Deprovision** hands over this workspace's reports only (E4, E6).

**E10. Invitations, bulk import and bulk update.**
- An invitation's Reports to lands on the membership on a **signed-in** join too: managerOnAccept under the role lock, written with the placement before the move, so the swap hands it to the account. Today that path writes no manager (accept-invite GET 151, POST 354-393).
- Bulk import still makes invitations, unchanged.
- Bulk update's change department, change manager and change office reach membership people and write their membership rows. `skippedElsewhere` is 0 from then on, kept in the answer for one release.
- Worst case of not: Pat, imported into B with Reports to Dana, joins with her existing account and lands with no manager, while a newcomer from the same file lands under Dana.

**E11. Existing data: one one-time SQL step, marked like D16.**
- **(i) Membership lines.** Every membership row of a workspace W other than the account's anchor gets `managerId` = `User.managerId`, where that manager holds a row in W (anchored in W, or a membership row for W) **in any state**, and is not the person.
  - Options: any state; kept seats only; live seats only.
  - Worst case of live only: B had deactivated Max and reactivates him next week; Pat's B line to him is gone, though B's chart would have shown it again today.
  - Worst case of any state: a line to someone removed in W is copied, shown nowhere, and comes back with a restore under staleLinesOf's check, exactly as today.
  - **Recommended: any state.**
- **(ii) The account's own line.** `User.managerId` is cleared where the manager holds **no** row in the anchored workspace. Such a line was carried in by a move from the workspace where it belonged, and (i) has copied it there when the manager has a row there.
  - Options: keep it on the account; clear it, keeping the old value in an audit row.
  - Worst case of keeping: Max never worked at B and joins B as a contractor a month later. The stored line wakes up, and on his first day Max reads Pat's B record, reviews and KPIs: reach B never gave.
  - Worst case of clearing: a line no workspace reads today leaves its column. Its old value is kept in an ActivityLog row in the anchored workspace (system actor, the manager's id in oldValue, a description naming nobody), so nothing is lost.
  - **Recommended: clear with the audit row.** This is the one place a value leaves its column, and the audit row is why that is acceptable under the founder's "nothing deleted".
- **(iii) Dotted lines.** A line belongs to each workspace where both the person and the manager hold a row (any state). The existing row takes the person's anchored workspace when it qualifies, otherwise the first qualifying one by id, and a copy is inserted for each other one. A line that qualifies nowhere is removed, with an ActivityLog row in the person's anchored workspace carrying it (manager id, note, weight, dates). Same worst cases as (ii).
- **(iv)** So nobody's manager changes on the deploy in any workspace that reads it: each workspace keeps exactly the line it showed and walked (the copy covers every workspace where the manager has a row, and the readers' seat filters are unchanged), and only lines no workspace read leave, with their records.
- The step runs once, marked on the comment of `"OrganizationMembership"."managerId"` (`workspace-lines-2026-11-03`; a later COMMENT ON that column must keep it). The audit rows are written as step three of 2026-11-01-membership-status.sql writes its own (a data-modifying CTE feeding one INSERT, `ON CONFLICT ("id") DO NOTHING`).

**E12. What the pickers show.** Everyone with a **live** seat here: anchored here and live, or a live membership here whose account is not ended (D12). Each is read in two indexed halves, never one OR with a membership sublink, merged by name, with this workspace's values (the membership's job title, the level held here for the Agent filter, the seat's status for `?reach=`).
- The same people may be assigned, messaged and handed work. The checks accept them: assignable.ts unknownUserIds, the conversations POST and the #general seed, the AI tools' lookups by email (create_task, send_kudos), MCP's livePersonByEmail.
- The List roster reads people at the seat here (node-world.ts loadPeople and loadOrgAdmins), so a membership person with access to a List is offered on it.
- Reach rules unchanged: a Guest sees only conversation partners.
- Options: (a) this; (b) anchored people only, as now.
- Worst case of (b): Pat is in B's Directory, but Dana cannot assign her the launch task, hand Max's B work to her or message her, depending on which company Pat opened last.
- Worst case of (a): a slower picker (one more indexed read). Nobody ended here is offered.
- **Recommended: (a).**

**E13. Workload.**
- Teams > Workload lists everyone in the team scope, which already holds membership people (teamScopeFor), with the seat's values: the membership's weekly hours and working week (none means this workspace's calendar), and the department here for the group and the filter.
- Space Workload reads the status at the seat here (someone B deactivated is not a row) and the capacity here. The List WORKLOAD view and the dashboard Workload card read the same.
- The capacity privacy rule (readsPeopleDataOf) is unchanged. canEditCapacity follows E7.
- Worst case of the account's values: Pat's 40 hours at A make B plan her as a full-time member of B's team.

**E14. MCP and AI tools read what the app reads.** They see people and lines only through the shared helpers (searchEmployeeRows, the trees, effectiveManagersOf, the lookups by email), so a teammate or an MCP client sees exactly the people and lines the person sees. No tool gets a rule of its own, and no tool is added. searchEmployeeRows reads both halves, and its department filter matches the membership's department here. The outward-answer rule (no levels in Talk and automation answers) is unchanged.
- Worst case of a tool with its own rule: Ask AI in B names Pat's A manager, or never finds her as a colleague.

**E15. Audiences and counts by department, job title or office include membership people placed here.** Goals, announcements, policies, surveys, Candor, SOP assignment by role, KRA seeding to a job title's holders, Settings' department member counts, and the boot's survey and Candor facts (boot/route.ts 243-245 passes the account's department) all read the membership's ids, through one helper in profile-here.ts with two halves.
- Options: (a) in this program, as its own step that may ship after the core; (b) later.
- Worst case of (b): B's HR places Pat in Engineering and sends Engineering a mandatory policy. Pat never sees it, and B's compliance list never shows her.
- Worst case of (a): an audience grows by the membership people placed in it, which is what placing them means.
- **Recommended: (a), step 8.**

**E16. One test lists every reader and writer.** A source-scanning contract test, `src/lib/access/workspace-lines.contract.test.ts` (in the way of kept-seats.test.ts), lists by file every read and write of `User.managerId`, the `manager` and `directReports` relations, `UserDottedLine`, `OrganizationMembership.managerId` and the placement and capacity columns on User, each with its class. It fails on any file it finds that is not listed.
- Writes of a line or a profile outside the new src/lib/access/seat-writes.ts are allowed only where an account is made here (users POST, the signed-out join, SAML just-in-time accounts) or moved (the swap).
- Worst case without it: a reader nobody found keeps reading the account's line in the wrong workspace, silently. The map behind this plan was built by reading, not by search (its first section says why), so the test is the net.

## Steps

As in phase 1: each step has one builder and one read-only reviewer, high and medium findings are fixed, then the next step starts. After the last step, three reviewers, the gate, the proofs, the SQL on the local database (twice on a copy, once fresh), merge, deploy and live checks.

**Steps 1 to 4 ship together, in one merge, and never apart.** Step 1's SQL clears account lines that today's readers read for other workspaces (E11 ii), so step 1 alone takes Max off Pat in A. Step 2 without step 4 leaves the handover writing account lines of every workspace. Step 4 without step 2 writes lines no reader reads. Steps 5, 7 and 8 need steps 1 to 4. Step 6 depends on none of them (it reads seats and the D18 placement only), so it could ship alone. The recommendation is one merge of steps 1 to 9.

1. **Foundation: schema, SQL, helpers, the swap, the contract test.**
   - Schema: `OrganizationMembership.managerId String?` with relation "MembershipManager" to User (`onDelete: SetNull`) and `@@index([organizationId, managerId])`; User's back relation. `UserDottedLine.organizationId String` with a relation to Organization (`onDelete: Cascade`), `@@unique([userId, managerId, organizationId])` in place of `[userId, managerId]`, and `@@index([organizationId, managerId])`, `@@index([organizationId, userId])`.
   - SQL: new prisma/sql/2026-11-03-workspace-lines.sql, listed last in SQL_MANIFEST (a text edit of scripts/deploy-migrations.mjs, checked with node's syntax check only, never imported), with a README row.
     - Columns are catalogue-guarded; the keys are added NOT VALID, then VALIDATE (no long lock on "User").
     - The one-time block (E11) runs in this order: membership lines; the account lines cleared with their audit rows; the old dotted unique dropped; dotted rows given their workspace, copies inserted, stranded rows removed with their audit rows; NOT NULL; the new unique.
     - The header says what the file does in order, and how to roll back: put the account lines back from their audit rows, delete the dotted copies, re-insert the removed rows from their audit rows, drop the columns, restore the old unique.
   - Helpers, reads (acting-workspace.ts):
     - `HeldSeat` and `PersonSeat` carry the line here, so seatsHeldFor and personSeatIn answer it: the row's managerId for someone anchored here, the membership's for anyone else, never the anchored workspace's own stale row.
     - New `reportsHereOf(organizationId, managerIds, db, { seats })`, two indexed halves ("User_managerId_idx" with organizationId; the new membership index), kept seats by default, live on request.
     - workspacePeopleLines' membership half reads `m."managerId"`, and workspaceDottedLines reads by `d."organizationId"`.
   - Helpers, writes: new leaf src/lib/access/seat-writes.ts.
     - `writeLineHere`, `moveLinesHere` (each row conditioned on still naming the leaver, the account half then the membership half, so a move landing at the same moment is caught by whichever row holds the line), `writeProfileHere` (the membership's customFields merged key by key) and `writeDottedHere`.
     - Each guarded as applyRoleChangeIn's two writes are. The one place that knows which row holds this workspace's line and profile.
     - It is new because today every writer writes User in place, and a copy of the two-row rule in each route is how phase 1's races happened.
   - workspace-anchor.ts: reanchorUser swaps managerId (E3); PROFILE_SELECT gains it.
   - seat-test-db.ts: the new columns, the SET NULL key, the dotted unique.
   - The E16 contract test, its list built from a real search and checked against the map; any file the map lacks is added to the plan's step that owns it.
   - Tests: the swap both ways, a move with no target row, the hard delete moving a home line, the SET NULL key, both halves of reportsHereOf, the anchored stale row never read, and the SQL file's text (marker, order, the copy and clear rules, the audit rows, NOT NULL, the rollback). Each new test fails on 8b0ce20d.

2. **Every walk and every reach reads this workspace's line.**
   - manager-lines.ts: factsHere from the seat's line; lineFactsAround, effectiveDirectReportIds, walkThroughAgents and reportsThroughAgents through reportsHereOf; effectiveManagersOf from the lines here; the dotted reads by organizationId.
   - manager-candidate.ts: lineAbove; "inactive" at the seat (E4).
   - team.ts and reporting-line.ts: the raw walks join the lines here. PostgreSQL allows one reference to the recursive name, so the step joins `team t` to a LATERAL subquery of two indexed halves (User by managerId and workspace; OrganizationMembership by workspace and managerId, the person anchored elsewhere, kept). getReportingChain names a workspace, or goes if nothing calls it.
   - membership.ts: reportCountOf, unattendedRecipient.
   - digest-recipients.ts memberManagersOf; person-access.server.ts managerMapFor; teams-counts.ts hasReportsFor; calendar/events' Team pill; app-floor-impact.server.ts.
   - Tests: Pat under Max in A and under Dana in B, with dotted lines to each. Each walk, the digest manager, the reviewer a launch picks, the approver a timesheet stamps, the weekly-review manager, rule 6 and the unattended recipient answer A's line in A and B's in B, before and after Pat switches. The raw walks are tested through the report-tree-seat double, which asserts the new clauses, and on Postgres by step 9.

3. **Every surface that shows a line shows this workspace's.**
   - users/[id] GET for both kinds: manager, dotted managers and reports through reportsHereOf (never the cross-workspace `directReports` relation); membershipRecord the same.
   - dotted-lines GET (by organizationId, for a subject of either kind); record-access's walk up and its dotted lines; my-team.
   - members-list (row, No manager); directory-list (rows, the Reports to filter, No manager, report counts and their sort, the chart's managerId and dotted ids); users/export; /api/users' manager columns.
   - named-here.ts loses the elsewhere fields (E6).
   - Tests: each surface in A and in B for Pat and for Max.

4. **Every write of a line writes this workspace's, and the relied-line machinery retires (E4 to E6, E10).**
   - PATCH Reports to (anchored here for now; step 5 opens it for membership people), without the manager_elsewhere 409.
   - Bulk update's change_manager through writeLineHere. The dotted-lines PUT writes this workspace's rows only, with peopleBelow over the lines here.
   - The handover: writeReportMoves through moveLinesHere; handoverReportCount counts every report here; the preview loses alsoElsewhere and stays.
   - moveAgentReports and agentPlanFor without stays. staleLinesOf and the clears on a restore and a reactivation (users/[id], scim-reactivate.ts) read and write the line here.
   - SCIM's deprovision without moveReliedReportsAtEnd. The signed-in join writes the invitation's manager onto the membership, and the GET names that manager to an existing account.
   - The dialogs' and the record's words for relied lines go: TransferDialog, the Remove dialog, the person record, the log sentences.
   - agent-manager-reads.contract.test.ts is rewritten for the new rules. Pending SCIM handover rows carrying `leavesOnlyHere` are still read, with the flag ignored.
   - Tests: B's removal of Dana moves B's reports only and A's lines stay; Max's D4 end with A suspended leaves A's lines; a dotted-line save in B keeps A's row; a restore in B clears a stale B line and never A's; Pat's join of B by invitation lands under the invited manager.

5. **A membership person's profile and lines are edited here (E7, E8, E9 ii, E10).**
   - PATCH for a membership person writes job title, department, office, weekly hours, working week, profile fields and Reports to on the membership (writeProfileHere, writeLineHere) under the role lock (lines), the person's lock and sameSeat. Personal and birthday fields are refused with SHARED_IDENTITY_REFUSAL. A new job title seeds its KRAs and SOPs.
   - accessFor's editable list for membership people. membershipRecord sends weekly hours, working week and profile fields to readers of people data.
   - The drawer's profileEditable, the Directory's canEdit and bulk selection, the record's Edit details and dotted lines for membership people.
   - Bulk update's department and office actions write membership rows. PROFILE_ELSEWHERE goes, and SEAT_FIELDS widens to the placement and Reports to groups.
   - SCIM Groups write and list the membership's department.
   - Tests: Dana, Bo and B's People team each edit Pat in B; A's values and line are unchanged; Max (chain-view through a dotted line only) is refused; a move landing between the read and the write is refused with nothing written; Workload and Members read the new hours.

6. **Pickers, assignment checks and Workload (E12 to E14).**
   - people/pick and /api/users read two halves. /api/users sorts by name in the database per half and merged; another sort with membership people among the matches is made in memory over the matching ids, as Members does.
   - assignable.ts: the roster, and unknownUserIds. node-world.ts loadPeople and loadOrgAdmins read at the seat here.
   - conversations POST and the #general seed; the AI tools' lookups by email; searchEmployeeRows; MCP's livePersonByEmail.
   - team/workload (people, department, capacity); Space Workload (status and capacity at the seat); the List WORKLOAD view and the dashboard Workload card.
   - The mention and add-to-conversation pickers, which this map did not open, are found by step 1's test.
   - Tests: with Pat anchored in A, Dana in B finds, assigns, hands work to and messages her, and Workload shows her B hours. Someone B deactivated is in none of them. A Guest's picker is unchanged.

7. **SCIM's manager attribute (E9 i).** The enterprise extension's `manager.value` on POST, PUT and PATCH, for both kinds, through writeLineHere under E4 and E5 and the role lock. A refused manager writes nothing of the line, the rest goes on, and an audit row says why.
   - Tests: an Okta-shaped PATCH and an Azure-shaped PUT, a loop, an Agent, a manager with no seat here, and Pat's A line unchanged by B's provider.

8. **Audiences and counts by placement (E15).** One helper in profile-here.ts, people placed here by department, job title or office, with two halves and the seat's state. Every audience reader in the map's section 4.2 goes through it, and so do the boot's Candor and survey facts.
   - Tests: Pat placed in B's Engineering gets B's Engineering policy, goal and survey, and appears in its counts. A's audiences are unchanged.

9. **A live proof** in the shape of scripts/live-proof-workspace-status.ts (local only, refuses any database but localhost), through the real routes:
   - Two workspaces, Pat in both. Max manages her in A, Dana in B, each with a dotted line.
   - Bo edits Pat's Reports to in B, and A's tree, digest manager and record are unchanged. Pat switches, and both lines hold.
   - B removes Dana: B's reports move, A's do not.
   - B edits Pat's hours, and Workload shows them. Dana assigns and messages Pat while Pat is anchored in A.
   - A bulk-imported invitation lands Pat's colleague under the right manager. SCIM sets a manager in B.
   - The raw walks run on Postgres.
   - No 500 in the dev server's log.

## Deploy notes (draft)

**Before the code: apply prisma/sql/2026-11-03-workspace-lines.sql** (the deploy runs it first, from the manifest). It adds one column to memberships and one to dotted lines, and runs one one-time step (marker workspace-lines-2026-11-03). That step copies each manager line into every workspace where that manager belongs, clears only the lines no workspace reads, and keeps each cleared value in an audit row. The coordinator tests it on the local database first: twice on a copy (the second run changes nothing) and once fresh. The shapes to include:
- a line whose manager is in both workspaces;
- a line whose manager is only in the membership's workspace;
- a line whose manager is in neither;
- a line to someone removed there;
- a dotted line read in two workspaces, and one read in none;
- an Agent manager.

What customers will notice, from the deploy on:

1. **Each workspace keeps its own Reports to and dotted lines** for people who work in more than one. Changing who someone reports to in one workspace no longer changes it in the other. Nobody's manager changes on the deploy in any workspace that showed one.
2. **People who work here through another workspace can be edited here** by the same people as anyone (Owners, Admins, the People team, the org-wide levels and their managers here): job title, department, office, weekly hours, working week, profile fields, Reports to and dotted lines. Their name, sign-in address, phone, photo and birthday stay theirs to change. The sentence "Their job title, department and other details here are read-only while they are working in another workspace" is gone.
3. **"Reports to someone in another workspace", "N lines kept for another workspace" and the question "Changing who they report to here changes it there too" are gone**, as is the Transfer dialog's line about reports who also report to them in another workspace.
4. **Deactivating or removing someone here hands over their reports here only.** Their team in another workspace stays with them there.
5. **A manager line an account carried in from a workspace where the manager never worked is cleared**, with an Audit log row in that workspace (it showed no manager before, and still shows none). A dotted line no workspace showed is removed the same way.
6. **The assign, hand over and new message pickers, Ask AI and MCP find people who work here through another workspace**, and Teams > Workload and Space Workload show them with this workspace's weekly hours.
7. **Someone who joins by invitation with an existing account lands under the invitation's Reports to.**
8. **SCIM:** an identity provider's manager attribute (the enterprise extension) sets this workspace's Reports to, and Groups place people who work here through another workspace in this workspace's department. (Step 7 and step 5.)
9. **Audiences by department, job title or office (goals, announcements, policies, surveys, Candor) include people placed there through another workspace.** (Step 8.)
10. **In the minutes between the SQL and the reload**, the old release shows no manager for some people who work in a workspace through a membership, and a dotted-line save there fails with "Something went wrong" (nothing is written). Both end with the reload.

Right after the deploy, the list (informational): membership lines naming someone who holds no live seat in that workspace, and dotted rows per workspace, for the coordinator to compare with the local runs.

## Risks and known limits

- **The raw walks' shape.** PostgreSQL allows one reference to a recursive name, so the walks join it to a LATERAL subquery of two halves. The in-memory test double cannot run SQL, so step 9 runs both walks on Postgres and EXPLAIN shows the two indexes used. The fallback, a workspace-wide `lines` CTE, reads every person of the workspace per walk, and viewer.ts walks on every request.
- **Cost.** Every walk round reads one more indexed table. reportTreeFor runs per request (memoised per request); the step 2 reviewer measures it on a 5,000-person workspace.
- **The map was built by reading, not by search** (no search tool in the planning session). E16's test, built in step 1 from a real search, is the net. Section 8 of the map lists files named but not opened.
- **A manager in both workspaces gets two independent lines** after the copy. An edit in one no longer follows in the other, which is the point, but someone used to the old behaviour may expect it.
- **The minutes between the SQL and the reload** (deploy note 10). Nothing is written wrong in them; a review launched in A in those minutes picks its launcher as the reviewer for those people.
- **Not in this program:** a membership person's KPI history, reviews and skills on their record here; an Admin's scopes on a membership (viewer.ts reads the anchored row's only); Who can see this record's People team, org-wide and Admin groups (anchored people only); SAML just-in-time accounts for people who belong elsewhere; HRSegment's department scope (its reader was not found).
- **getReportingChain** walks every workspace and no caller was found by reading. Step 2 gives it a workspace or deletes it.
- **Phase 1's known limits stand** (workspace-status.md, Known limits).

## Map

~/workwrk-launch-backup/agents/workspace-status-2/map.md lists every read and write of the manager line, the dotted lines, the profile fields and the pickers' people found at 8b0ce20d, with file:line, what each decides and its class.

## Coordinator's rulings (2026-11-03)

- E1 to E16: every recommendation taken as written. The join date stays read-only here (no write door for anyone today).
- **Order:** step 6 (pickers, assignment checks, Workload) depends on nothing else and is what real people feel first, so it is built, reviewed, gated and merged ON ITS OWN, first. Then steps 1 to 4 (one merge, never apart, as the plan says), with 5, 7, 8 and 9 in the same merge.
- **Search tools:** this session's subagents have no Grep or Glob. Builders use Bash (grep, rg, git) for every search; step 1's E16 contract test is written from a real search and lists what it found. Reviewers may use read-only Bash (grep, rg, sed -n, cat, git diff, git log) and nothing else.
