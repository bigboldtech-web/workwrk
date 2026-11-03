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

## Step 6, built

Branch `workspace-status-2` in ~/theywrk-launch, on 1bba1e95, not committed. **No SQL, no schema change, no flag.** It ships on its own, before steps 1 to 4: it reads seats and the D18 placement only, and uses nothing those steps add (no `OrganizationMembership.managerId`, no seat-writes.ts, no E16 test). The manager line is shown exactly as phase 1 shows it (the account's line, named only while that manager holds a seat here, profile-here.ts managersWithSeatHere).

### The one helper

New leaf `src/lib/access/seated-here.ts` (over workspace-seat.ts and joined-here.ts). Everyone with a seat in one workspace, read at the row that holds it: the account row for someone anchored here, the membership for anyone else, never the anchored workspace's own stale membership row.

- **Reaches**, each the rule a caller already applied to people anchored here, read at the seat: `any` (a seat here in any state, the callers that matched by `organizationId` alone), `kept` (not removed here), `live` (also not deactivated here, HR labels live, and for a membership the account not ended, D12), `active` (live and plain ACTIVE, the default pickers). A caller may split the kinds (`{ anchored, membership }`): today's rule for people anchored here, and a live seat for a membership person where what follows belongs to the account (a notification row, an email, a Talk membership), so a seat this workspace ended is never told anything from another workspace.
- **Two indexed halves**, never one OR with a membership sublink: `anchoredHereWhere` ("User_organizationId_idx") and `membershipHereWhere` ("OrganizationMembership_organizationId_idx", then each person by "User_pkey"), and the same rule as predicates (`anchoredAtReach`, `membershipAtReach`), which a test holds equal on every combination.
- `peopleHereByName`: a list, each half read by name in the database (first name, last name, id) up to skip plus take, then merged (`mergeOrdered`, `byName`) and cut. A page of the merge reads at most its own length of each half, so paging is consistent however the halves were cut. Takes person conditions for both halves, the Agent filter at the level held here (`noAgents`) and a department filter at the seat (`departmentIn`). `countPeopleHere` counts both halves.
- `peopleHereAmong` and `seatedHereAmong`: a check by id, the people by "User_pkey" first, then the memberships of those anchored elsewhere (two reads at most). `personHere`, `standingHere` (level here, kept, live), `personHereByEmail` and `peopleHereByEmails` (any case; the account anchored here first when two accounts share an address), `everyoneHereIds`, `adminsHereIds`, `capacityHereOf` (the weekly hours and working week each gives THIS workspace; none on a membership means this workspace's calendar).
- Every row carries `SeatHere`: kind, level, status, removal, department, job role and office ids, join date here (the membership's stored one, else joinedHere), and `accountEnded`.

### Each surface: before, now, test

Tests are in `src/lib/people/pickers-seat.test.ts` (the case of this step: Pat anchored at A with a live membership in B, an Employee and Developer in B's Engineering on 10 hours over Mondays and Tuesdays; Dana a Manager in B; Rita anchored at A and deactivated by B; Rex removed by B; Zed with no seat in B; Gus a Guest in B), on the in-memory database through the real routes, and `src/lib/access/seated-here.test.ts` for the helper.

The pickers:
- **GET /api/people/pick** (assign, hand over, new message, add people, mentions, meetings, Manage access, Reports to and every other picker over it). Before: people anchored here only, the job title from the account, the Agent filter on the account's level. Now: both halves merged by name; the reach at the seat (ACTIVE by default, not deactivated for reach=signin, not removed for reach=all's privileged readers); the Agent filter at the level held here; the job title the seat here holds, this workspace's own only (placementsHere). The ?ids= label lookup the same. A Guest still finds only the people they share a conversation with. Test: "the people pickers" (3).
- **GET /api/users** (the older pickers and lists: assign a process run, the share dialogs, the mention typeahead, the goal audience and announcement pickers, the meeting page). Before: anchored only. Now: the person conditions (team scope, search words, tags) on both halves; the seat conditions (removal, status, employed, department, level) on the row that holds the seat, a live status also needing the account not ended. Nobody here through a membership matches: the old single read, sorted and paged in the database. Otherwise a sort by first name, last name or email is read per half up to the page's end and merged; any other sortBy is read for every match at the seat that holds it and sorted in memory, as Members does. A membership row answers this workspace's status, level, join date, removal, department and job title (placementsHere), its reports here (reportsHere) and its KRAs here. The total counts both halves. Test: "the people list" (3).
- **The List roster** (assignable.ts listAssignableUsersForBoard, GET /api/boards/[id]/assignable). Before: `loadPeople` dropped anyone anchored elsewhere, and the final read was anchored only. Now: `loadPeople` and `loadOrgAdmins` (node-world.ts) read each person at the seat here (the level held here; denied when the seat is deactivated or removed here or the account is ended), and the final read is both halves at live seats. So a membership person with access to a List is offered on it; the Manage access panel and the read fan-outs (usersWhoCanRead) see them the same way. Test: "assigning" (roster on a List she was given, and on a List open to everyone).
- **The command palette's people** (GET /api/search): both halves, not removed. No new test (the same helper as the pickers).
- **The dashboard report recipient picker** (list-links-server.ts recipientOptions, recipientRows, memberViewer): both halves, each at the seat here (status, removal, level, Guest by the level here); the report built under the level held here. No new test (the helper is covered).

The checks behind them:
- **The task assignee check** (assignable.ts unknownUserIds, used by item create, item patch and items bulk). Before: anchored here and not removed. Now: a seat here not removed, either kind. A seat deactivated here stays known, exactly as a deactivated person anchored here does, so a task that still holds Rita can be edited (the assignee PATCH sends the whole set). Test: "accepts Pat as an assignee; refuses Rex and Zed".
- **Talk**: conversations POST (DM and group), POST /api/conversations/[id]/members and the #general seed. Before: anchored here and not removed. Now: anchored here as before, or a live membership seat. Nobody this workspace ended is added; someone it deactivated joins #general on their first visit after a reactivation, as anyone who joins after the seed does. The owner line of a conversation (GET /api/conversations/[id] and the Talk page) names the owner at their seat here. Test: "messaging (Talk)" (DM, group, #general).
- **The grant writer** (grants.ts setNodeGrant, removeNodeGrant: the Manage access dialog and the Space, Folder and List member routes). Before: the target had to be anchored here. Now: `standingHere`, in this workspace when kept, active when live, and the remaining-access description at the level held here. No route test of its own (the grant writer needs the whole node world); `standingHere` is tested in seated-here.test.ts.
- **Kudos**: giveKudos's receiver (the wall and Ask AI), POST /api/v1/kudos and the integrations ingest. Before: anchored here and not removed. Now: a seat here not removed; `viewerForUser` (viewer.ts) reads the level held here and hydrate the seat's status, so canReadTheWall refuses someone deactivated here. Test: "thanks Pat through Ask AI's send_kudos, and never Rita".
- **A task for a person**: createPersonalTask's guard (any seat here; each caller decides who may be given work), POST /api/v1/tasks and the ingest (any seat here, as createPersonalTask reads it). Test: "the AI tools assign Pat by her address".
- **Mentions**: POST /api/docs/[id]/mention (any seat here, then who can read the doc decides, each at the seat here); a task comment's mentions (item-comment.ts resolveMentions and notifyMentions: anchored as before, a membership person while their seat is live, since a mention also watches the task). Test: "mentioning" (2).
- **Meetings**: POST /api/meetings and PATCH /api/meetings/[id] attendees: anchored as before (any seat), a membership person while their seat is live; an edit keeps everyone already attending (before, it dropped every attendee anchored elsewhere).
- **Assets** (POST, PATCH, bulk assign) and **Tools** (bulk share, share): anchored as before, a membership person while live (a notification and an email follow).
- **Forms**: the notify list (GET names, PATCH check), the response notice and the daily summary (any seat here; who may read the responses decides, each at the seat here); the Responses tab's search by person and the names a person field holds.
- **A List's default assignee** (board-items.ts List defaults, PATCH /api/boards/[id], GET /api/boards/[id]/settings): live at the seat here.
- **Goals**: the owner checks (POST and PATCH /api/okrs, any seat here), Team goals' "no goals" list (live seats in the chain), and the goal audience: people named by id (the owner, a person assigned by name, a tag's holders) at an ACTIVE seat here, and the audience check accepts a seat here not removed. An audience by department or job role is step 8's.
- **Announcements** to people picked by name or to a Space's members, and **surveys** to people picked by name or a tag's holders: the check accepts a seat here not removed; the people reached are anchored here as before or a live membership seat. Audiences by department, office or the whole workspace are step 8's.
- **Settings, Teams**: the add check and the list (a seat here not removed). **Department head** (POST and PATCH /api/departments): a seat here not removed. **SOP folder access** (legacy PATCH) and **agreement parties**: a seat here.
- **Automations**: a picked person (resolveUser) must be ACTIVE at the seat here; "Notify admins" reaches Admins here through a membership too (adminsHereIds); a comment posts as the creator while ACTIVE here; the legacy workflow notify by email reaches a membership person while live. The notetaker save matches attendees and action item owners by id, email or name at the seat here.

The AI and MCP:
- **Lookups by email**: create_task's assignee (live; before: any account anchored here, removed ones included, exact case), send_kudos's receiver (live), create_okr's owner (live) and create_meeting's attendees (live), and `livePersonByEmail` (teammate-tools.ts: every teammate tool that names a person, the previews and MCP's write tools). Test: "finds Pat for the teammate and MCP tools by her address".
- **searchEmployeeRows** (Ask AI's search_employees and MCP's search_people): both halves at ACTIVE seats, the department filter by the department the seat here holds (the name looked up among this workspace's departments; another workspace's name finds nobody), the department and job title the seat holds, the level held here for the readers who see levels. The Guest rule and the outward-answer rule are unchanged. Test: "the AI and MCP people search".

Workload:
- **Teams > Workload** (GET /api/team/workload). Before: anchored only, the account's department and hours. Now: everyone in the scope (teamScopeFor already held membership people) at the seat here, live unless includeDeactivated; the department here for the group and the filter (this workspace's own only); the weekly hours and working week the seat gives this workspace (capacityHereOf). `canEditCapacity` is false for a membership person until step 5 (PATCH refuses their hours today, PROFILE_ELSEWHERE). Test: "Teams > Workload shows Pat with B's hours".
- **My team** (GET /api/team/members-work and the "+2" GET /api/team/person-work). Before: anchored only. Now: both halves within the scope, the department and job title filters by the seat here, Reports to by the account's line (as the Directory's filter), "no KRAs" by this workspace's KRAs; the rows' job title and department are the seat's; "needs attention" reads this workspace's weekly reviews, KPI records and KRAs only (for everyone: an old row of another workspace no longer counts). Test: "My team's rows".
- **The Space's Workload tab** (GET /api/spaces/[id]/workload). Before: liveHereAmong (kept seats) then the account's status, so someone B deactivated through their membership was a row. Now: live seats here, read at the seat, and the capacity the seat gives this workspace. Test: "the Space's Workload tab".
- **The List's WORKLOAD view** reads its members from GET /api/boards/[id]/members?live=1, which keeps only members who can still work here (the Share dialog still reads every member). Its capacity is the view's own setting, never a person's. Owners of open tasks still render as the view always drew them. Test: "the List's WORKLOAD view".
- **The dashboard Workload card** (widget-data.ts workloadResult). Before: anchored here and not removed (a deactivated person anchored here was a row), the account's hours. Now: live seats, as the Space tab, and the hours each gives this workspace. The chart by assignee and the list card's avatars name people at their seat here. Test: "the dashboard Workload card".

The surfaces the search found beyond the named ones (assets, tools, forms, a List's defaults, goals, announcements, surveys, Teams, department heads, SOP folders, agreements, automations, the notetaker, meetings, the grant writer, the report recipients, the command palette) have no test of their own in this step: each is one call of the helper, whose rule is tested on every combination of seat and account state, and their existing tests pass.

Names next to assignment: My Work's co-assignees (GET /api/me/work), Bird's eye cards, Everything's rows and owner breakdown, and the Space tasks export name people at their seat here (any state), so a task given to Pat never shows a blank chip.

### The search

rg over src for every `prisma.user` (and `tx.user`, `db.user`) findMany, findFirst, count and groupBy with an `organizationId` in its next lines (303 statements before this step, outside tests and test doubles), every client caller of /api/people/pick and /api/users with the write behind it, and every refusal sentence of the kind "isn't in this workspace". Outcomes:

- **Fixed in this step** (above): people/pick; users GET; assignable.ts (2); node-world.ts loadPeople, loadOrgAdmins; grants.ts (2); viewer.ts viewerForUser; conversations POST and seed, [id]/members, [id] owner, the Talk page owner; agents/tools.ts create_task, send_kudos, create_okr, create_meeting, searchEmployeeRows; teammate-tools.ts livePersonByEmail; kudos-give.ts; v1/kudos; v1/tasks; integrations/ingest (2); work/personal-task.ts; notify-item.ts emit; items/item-comment.ts (2); docs/[id]/mention; meetings and meetings/[id]; assets, assets/[id], assets/bulk; tools/bulk, tools/[id]/share; forms/[id] (2), forms/notify.ts, cron/form-daily-summary, forms/responses-server.ts (2); board-items.ts, boards/[id], boards/[id]/settings, boards/[id]/members; okrs (3); goal-audience.ts (2); announcement-audience.ts (4); performance/survey.server.ts, pulse-surveys, pulse-surveys/[id]; settings/teams and settings/teams/[id]; departments and departments/[id]; sop-folders/[id]/access; agreements/[id]/parties (2); automation/registry-actions.ts (3); workflows/runtime.ts notify; notetaker/save (6 lookups); search; list-links-server.ts (3); team/workload; team/members-work (3); team/person-work; spaces/[id]/workload; dashboards/widget-data.ts (3); me/work; work/birdseye-server.ts; everything.ts (2); spaces/[id]/tasks/export.csv.
- **Already at the seat** (phase 1 or before), no change: people/employed.server.ts employedAmong (policies, SOP assignments and process runs name people through it); users/[id]/handover recipientHere (Dana hands Max's work to Pat: its picker is people/pick, the recipient check refuses a seat deactivated here; users/[id]/handover/route.test.ts); team-scope.server.ts; teams-counts.ts; users/[id]/agent-reports and record-access; calendar/events' Team pill; my-team; members-list.server.ts; directory-list.server.ts; users/export; role-counts.ts; seats.ts; digest-recipients.ts; membership.ts; self-facts.ts; admin/company-detail, company-patch, set-owner; live-seats.ts; manager-candidate.ts; manager-lines.ts; acting-workspace.ts; workspace-status.ts; workspace-anchor.ts; auth/invite-facts.server.ts; people/bulk-import; users/[id] (personHere); scim Users and Users/[id]; connections and connector-access.
- **Audiences by department, job title, office or the whole workspace, step 8 (E15)**: announcement-audience.ts ALL, DEPARTMENTS, OFFICES; policies, policies/[id] (counts and ALL), policies/[id]/assignments (department and all); sop-assignments (department and everyone); goal-audience.ts DEPARTMENT and ROLE; survey OFFICES, DEPARTMENTS, ALL; performance/candor.server.ts; alignment-assign.ts; access/job-title-holders.ts; role-boundaries/request; people/roles/[id] page (a job title's holders); roles and departments (removed counts); settings/structure page; policy-compliance.ts; policy-ledger.ts; team-alignment.ts; role-defaults.ts and people/backfill-role-defs; services/performanceScoreService.ts; organization/ai-profile (headcount); boot facts.
- **A membership person's people data here, a known limit** (their KPI history, reviews, skills and KRAs stay out of the record): kra-assignments; kpi-records, batch and summary; kpi-integration.server.ts; kpi-review.server.ts; talent-assessment and performance/talent.server.ts; reviews, reviews/[id]/launch, cron/review-cycles; users/[id]/kpis, skills, seed-alignment, avatar; people/[id]/alignment; me/alignment; team/alignment page; goals/goal-contributor.ts; goal-effort.ts; okrs/[id]/check-ins; pulse-surveys responses and export; api/ai (an Owner and Admin snapshot); analytics.ts.
- **The manager line, steps 1 to 5**: users/[id]/dotted-lines; team/rollup page and team-rollup.ts; alignment-scope.ts; agents/previews.ts (a manager by id); people/bulk-update (change manager, department, office: step 5); email/send-reminders (managers); access/app-floor-impact.server.ts (a preview count over the lines).
- **The person's own access or account, not a picker**: talk-gate.ts talkGateForUser (a scheduled update's author); agents/acting.ts; skills/orphans.ts; auth/forgot-password and request-verify; workspace-admin.ts (two step reset); object-share/app-door.ts; public-link-audit.ts; workflows/runtime.ts's first Admin fallback.
- **Behind ACCESS_V2_TABLES (off)**: object-share/common.ts (the share target and the admin count), goal.ts, tool.ts, sop-folder.ts, team.ts. The object share module reads people anchored here throughout (its target, its panels, each object's own access), so it moves as one when the flag is turned on.
- **Names of creators, owners and actors shown on rows** (no choice, check or work is made from them), for the final sweep: template-center; tools and tools/[id]; export/tools; report-schedules; dashboards and dashboards/[id]; folders/[id]/contents; automation workflows, workflows/[id], usage and versions-server.ts; audit (2); trash-server.ts (2); calendar/events' names; public tables and public tasks; kudos leaderboard; boards/[slug] page (pinned by); spaces/[slug] and folders/[id] pages (List and Folder owners); talk-updates-server.ts; access/admins.ts ("Ask an admin"); access/gate.ts and check-access.ts (a node's owner on a locked page).
- **Not one workspace's people**: admin/analytics (staff console); cron/org-hard-delete; org/sign-out-everyone; marketing/legacy-import; templates/apply-tuesday (a solo workspace check); workspaces/[id]/members (no caller in the app); export/people and export/workspace-export.server.ts (anchored rows, phase 1's decision); access/facts.ts and viewer.ts (the People team, the first Owner); access/guests.ts; mcp/policy-admin.ts (token versions).

### Decisions made here (worst case first)

- **A check keeps the rule it had for people anchored here, read at the seat**; a picker offers live seats only. Worst case of a live-only assignee check: Dana adds Pat to a task that still holds Rita and the save is refused, because the client sends the whole set. Worst case of the kept check: a stale client assigns Rita, who is told nothing (notifications need a live seat) and sees nothing; the same as for a deactivated person anchored here today.
- **What is sent to the account needs a live membership seat** (notifications, mentions, emails, Talk memberships, the #general seed), because the account reads it in whichever workspace it is in. People anchored here keep their rule.
- **Ask AI's create_task needs a live seat for both kinds** (before: any account anchored here, removed ones included, so a task could land on a removed person's Personal list with a success message).
- **The dashboard Workload card reads live seats for both kinds**, as the Space tab does (before, a deactivated person anchored here was a row).
- **A membership person's hours are read-only in Workload** until step 5.

### Files

New: src/lib/access/seated-here.ts. Tests: src/lib/access/seated-here.test.ts, src/lib/people/pickers-seat.test.ts.
Changed (63): src/app/(dashboard)/tlk/[id]/page.tsx; src/app/api/agreements/[id]/parties, assets, assets/[id], assets/bulk, boards/[id], boards/[id]/members, boards/[id]/settings, conversations, conversations/[id], conversations/[id]/members, cron/form-daily-summary, departments, departments/[id], docs/[id]/mention, forms/[id], integrations/ingest, me/work, meetings, meetings/[id], notetaker/save, okrs, people/pick, pulse-surveys, pulse-surveys/[id], search, settings/teams, settings/teams/[id], sop-folders/[id]/access, spaces/[id]/tasks/export.csv, spaces/[id]/workload, team/members-work, team/person-work, team/workload, tools/[id]/share, tools/bulk, users, v1/kudos, v1/tasks (each route.ts); src/components/board-view/board-workload-view.tsx; src/lib/access/grants.ts, node-world.ts, viewer.ts; src/lib/agents/teammate-tools.ts, tools.ts; src/lib/announcement-audience.ts, assignable.ts, board-items.ts, everything.ts, goal-audience.ts, kudos-give.ts, list-links-server.ts, notify-item.ts; src/lib/automation/registry-actions.ts; src/lib/dashboards/widget-data.ts; src/lib/forms/notify.ts, responses-server.ts; src/lib/items/item-comment.ts; src/lib/performance/survey.server.ts; src/lib/reports/schedule.ts (a comment); src/lib/work/birdseye-server.ts, personal-task.ts; src/lib/workflows/runtime.ts.
Test double: src/lib/access/seat-test-db.ts (orderBy on a to-one relation's column; a conversation's members as a list relation; a list relation created with its row; the member tables' person and a member's conversation).
Tests changed (fixtures for the second half, no assertion weakened): people/pick route (the membership half mocked empty), kudos-give, automation registry-actions.teammate, agents goal-tools, previews, tools-create-task, tools-prechecks, tools-read-gates (the Guest rule now rides in the shared person conditions; the department filter is looked up among this workspace's departments and matched by id, a stronger check than before), mcp tools-read (departments and job titles as rows), integrations/ingest route, v1/tasks route, spaces/[id]/workload route (the mock answers each person's seat and the route judges it), spaces/[id]/tasks/export.csv route, work/birdseye-server.contract (the people read is the seat read in the viewer's workspace).

### Tests

- New: seated-here.test.ts 13 tests, pickers-seat.test.ts 23 tests, all pass. Against 1bba1e95's sources (the changed sources put back in a scratch copy, seated-here.ts removed, the tests and the test double kept new), **35 of the 36 new tests fail**: pickers-seat 22 of 23 (the Guest guard passes, as it should: a Guest's picker is unchanged), seated-here 13 of 13 (the module is new). Of the 14 changed test files, 7 tests fail on the old code (spaces Workload 2: the seat is judged by the route now; tools-create-task 2 and tools-read-gates 2: the new read's shape; the birdseye contract 1); the rest are fixture changes that pass on both.
- Wider: every test related to a changed source (vitest related over the 65 changed files): 325 files, 4,572 tests, all pass; the whole src suite: 926 files, 13,207 tests, all pass.
- Type check: clean, run twice at the end (and after each round of edits).
- ESLint on every touched file: no new problem. Three errors and eleven warnings are on 1bba1e95 too, on no line this step wrote: me/work route (an accessLevel read), sop-folders access (an explicit any), board-workload-view.tsx (design-system warnings).

### Deploy notes (step 6 alone)

No SQL to apply, no schema change, no environment flag. Rollback is the revert; nothing is written differently except what the rules below now allow.

What customers will notice, from the deploy on:
1. **People who work here through another workspace** (a membership) are offered and accepted everywhere people are picked: assign, hand over, new message, add people, mentions, meetings, Manage access and sharing, kudos, goal owners, audiences of picked people, report recipients, the command palette, Ask AI, AI teammates and MCP. They show this workspace's job title, department and level. Before, they were missing whenever they had last opened their other workspace.
2. **Teams > Workload, My team, the Space's Workload tab, the dashboard Workload card and a List's Workload view** show them with the weekly hours and working week they give this workspace (none means this workspace's calendar) and this workspace's department. Their hours cannot be edited here yet.
3. **Someone this workspace deactivated or removed is in none of the pickers and none of the Workloads**, whatever their status in another workspace. The Space's Workload tab no longer shows a person this workspace deactivated through their membership, and the dashboard Workload card no longer counts a deactivated person anchored here (as the Space tab never did).
4. **Notifications, mentions and emails** reach someone here through a membership only while their seat here is live.
5. **Ask AI's "create a task for" no longer assigns a removed or deactivated person** (it found any account anchored here), and the address now matches in any case.
6. **My team's "needs attention"** reads this workspace's weekly reviews, KPI records and KRAs only.
7. **A scheduled AI update in Talk** now counts the members who work here through a membership among its readers (recipientRows), so it says only what every reader may read, and a Guest here through a membership stops it as any Guest does. Before, those members were not counted, so an update could carry what one of them may not read. The person who set it up is still judged as before (talk-gate.ts talkGateForUser, anchored here).
8. Each picker read is two indexed reads instead of one, and /api/users adds one count.

For step 1's E16 contract test: src/lib/access/seated-here.ts reads the membership's placement and capacity columns (`departmentId`, `roleId`, `officeId`, `joinDate`, `weeklyCapacityHours`, `workSchedule`) and the User's (`departmentId`, `roleId`, `officeId`, `joinDate`, `weeklyCapacityHours`, `workSchedule`), class "read at the seat here"; /api/users, team/members-work and the Directory's reportsHere read `managerId` as phase 1 does.

### Left, for later steps and the final review

- The names of creators, owners and actors listed above, for the final sweep.
- The object share module behind ACCESS_V2_TABLES, as one piece when the flag is turned on.
- Audiences by placement or the whole workspace (step 8), a membership person's people data here (known limit), the manager line (steps 1 to 5).
- A List's Workload view still draws the owner of an open task whatever their seat, as it always did; a deactivation hands open tasks over first.
- /api/users with membership people among the matches and a sort other than a name reads every matching person's key, as Members does (L4 of phase 1's step 3 review).

## Step 6, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step6-review.md; every finding is fixed as the coordinator ruled. Same branch, still not committed. **No SQL.**

### H1: a meeting's action items

- POST /api/meetings/[id]/action-items refuses, before any write, an assignee who holds no seat here: anchored here and not removed as before, or here through a membership whose seat here is live (`personHere(orgId, assigneeId, { anchored: "kept", membership: "live" })`). 400, "That person can't be given an action item in this workspace. Pick someone who works here." Nothing is written: no action item, no task, no notification. The PUT gives a NEW assignee the same check; an item that already holds someone keeps them on any other edit. The PATCH (turn it into a task) asks createPersonalTask's own rule first and answers in words ("The person this action item is assigned to no longer works in this workspace. Assign it to someone else first.") rather than a 500.
- GET /api/meetings/[id] answers each attendee with `liveHere` (a live seat here, either kind). The meeting page's "Assigned to" list offers only attendees who are `liveHere`, and reads `/api/users?limit=500&employed=1`, so nobody this workspace deactivated or removed is offered. An ended attendee stays on the meeting's record.
- **Every caller of /api/users, the way the review found this one (the page's fetch):**
  - Now live only (`employed=1`), each a picker that offers people to act on: the meeting page; the Space, Folder and List share dialogs (share-space-dialog, share-folder-dialog, share-board-dialog, which also feed the Space dialog's add-by-department and office); the doc share popover (doc-share-modal); the mention typeahead without a List (mention-typeahead); the goal audience picker (goal-audience-picker); the announcement composer's people (composer-dialog).
  - Already live: the process run assign dialog (`employed=1`); use-people-picker's "team" source (`status=ACTIVE`: Start a run, Reassign).
  - Not a picker that acts on people, left: the board filter bar without a List (a filter of existing tasks, which may name someone who left); the Directory, the Org chart and a department's member preview (scope=directory, fields=chart: lists with their own status filters).
- **Every caller of /api/people/pick:** ACTIVE by default or `reach=signin` (live seats), except two that are not offers: the person filter's picker (person-filter-pick, `reach=all`, deactivated people only for Owners, Admins and the People team, as the Directory's Deactivated filter) and a Table's person cells naming who a cell holds (`ids` with `reach=all`).

### M1: work lands only on a seat here that is not removed

- createPersonalTask's guard, POST /api/v1/tasks and the ingest's task.create read `{ anchored: "any", membership: "kept" }`: every rule for people anchored here is kept, and a seat this workspace removed is refused (none of these calls worked for a membership person before step 6). So an automation or a zap that keeps naming Rex fails as it did before step 6.
- The notetaker: an attendee is matched at `{ anchored: "any", membership: "kept" }`; an action item's owner at `kept` for both kinds, exactly the task assignee check's rule (assignable.ts unknownUserIds), so a task the notetaker makes on a List never refuses the next assignee edit. Anyone else falls back to the person saving, as before.
- The legacy workflow runtime (lib/workflows/runtime.ts; its triggerEvent has no caller in the app): its create_task goes through createPersonalTask's guard, and its notify now refuses an id with no live seat here (`{ anchored: "any", membership: "live" }`), so an id of someone this workspace ended, or of another workspace, is never told.
- The action items routes: H1 above.

### M2: a goal's owner

POST and PATCH /api/okrs read the owner at `{ anchored: "any", membership: "live" }`, as Ask AI's create_okr does. A goal is never given to a seat this workspace ended, so nobody ended here is notified or emailed of it.

### M3: Manage access tells only a person who can work here

setNodeGrant writes the grant as before (a seat deactivated here keeps it for a reactivation) and sends its notice only when the target is active here (`targetActive`).

### M4: a Guest's command palette

GET /api/search applies people/pick's rule for a Guest: the people they share a conversation with in this workspace, in both halves, and nobody else. The rule now lives once, `guestConversationPartnerIds` in access/seated-here.ts, called by people/pick, searchEmployeeRows and the search (the same query each made). A Member's palette is unchanged.

### The lows

- **L1.** The Goals page's `?owner=` seed reads the person at their seat here (`{ anchored: "kept", membership: "live" }`), so "All goals" and "Set a goal" from Pat's record start with her. No test of its own (a server page); the rule is the helper's.
- **L2.** The deploy notes, below.
- **L3.** src/lib/people/access-seat.test.ts runs the real node world and evaluator: Pat, a member of B's Space, reads its doc; Rita (deactivated here) and Bea (not in the Space) do not; so a mention tells Pat only.
- **L4.** The tests below.

### Files

Changed in this pass: src/app/api/meetings/[id]/action-items/route.ts, meetings/[id]/route.ts, okrs/route.ts, search/route.ts, people/pick/route.ts, notetaker/save/route.ts, v1/tasks/route.ts, integrations/ingest/route.ts; src/app/(dashboard)/meetings/[id]/page.tsx, okrs/page.tsx, announcements/composer-dialog.tsx; src/components/layout/os/share-board-dialog.tsx, share-space-dialog.tsx, share-folder-dialog.tsx; src/components/docs/doc-share-modal.tsx; src/components/comments/mention-typeahead.tsx; src/components/okrs/goal-audience-picker.tsx; src/lib/access/grants.ts, seated-here.ts; src/lib/agents/tools.ts; src/lib/work/personal-task.ts; src/lib/workflows/runtime.ts. Test double: seat-test-db.ts (a meeting's attendees, an attendee's person).
New tests: src/lib/people/pickers-seat-review.test.ts (10), src/lib/people/access-seat.test.ts (3), src/app/api/search/route.guest.test.ts (4).

### Tests

- The 17 new tests pass. Against the step 6 code before this pass (a scratch copy with this pass's changes taken back, the tests kept), **15 of 17 fail**: pickers-seat-review 10 of 10 (H1 4, M1 4, M2 2), route.guest 3 of 4 (the Member's palette is a guard), access-seat 1 of 3 (M3). The two L3 tests pass on the step 6 code by design (they close a test gap, not a code bug) and fail on 1bba1e95, as does M3 (3 of 3).
- Wider: every test related to a changed source (vitest related over the 75 changed files): 328 files, 4,589 tests, all pass; the whole src suite: 929 files, 13,224 tests, all pass.
- Type check: clean, run twice.
- ESLint on every touched file: no new problem. The 3 errors (me/work's accessLevel read, sop-folders access's explicit any) and 132 warnings (design-system warnings in board-workload-view.tsx and the four share dialogs) are on 1bba1e95 too, on no line this step wrote.

### Deploy notes, added to step 6's

Note 3 now reads: **Someone this workspace deactivated or removed is in none of the pickers that offer people to act on** (assign, give an action item, hand over, message, mention, share, set a goal owner or audience, announce to), whatever their status in another workspace. The filter pickers of Owners, Admins and the People team still list deactivated people, as they do for those anchored here.

And:

9. **Ask AI's "set a goal for" (create_okr) needs the owner's live seat here** (before: any account anchored here, removed ones included). Ask AI's thanks (send_kudos) reads a live seat too: the wall already refused a deactivated person, and the answer is now "No user with email ... in this organization".
10. **A meeting's action item is given only to someone who can work here** (before: any id, an account of another workspace included, was given the item and told of it). Turning an item held by someone removed here into a task is refused in words.
11. **A task for someone this workspace removed through their membership is refused** by the public API, the ingest and automations, as one for someone with no seat here always was. The notetaker gives such an item to the person saving.
12. **A goal is never given to someone this workspace ended**, so they are neither notified nor emailed.
13. **Manage access no longer notifies someone deactivated here**; the grant is still written and works on a reactivation.
14. **A Guest's command palette names only the people they share a conversation with** (before: every person anchored here, a leak older than this step).
