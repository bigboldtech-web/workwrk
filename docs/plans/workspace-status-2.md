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

**E1. The solid line lives where the profile lives.** `User.managerId` keeps meaning the person's manager **in the workspace they are anchored to**. Each membership row gets its own `managerId`: the person's manager in that workspace. It is a key to User, `ON DELETE SET NULL` as User's own relation is, with an index on `(managerId, organizationId)` for "who reports to Max here" (leading with the manager, so the key's SET NULL uses it too: the step 1 review L4). As with the profile, the anchored workspace's own stale membership row is never read as its line: every reader takes the anchored line from User, and the move overwrites that row when they leave.
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
- Every write lands on this workspace's membership row, never on the account, guarded as applyRoleChangeIn's membership write is: the seat not removed, the account still anchored where it was read.
- **A new job title seeds its KRAs and SOPs (seedAlignmentForUser) for a seat anchored here only**, as the bulk update does (ruled on the step 5 review M1, option b). For a membership person nothing is seeded: the job title, department and office are written, and the answer says plainly that KRAs and SOPs are not assigned to people who work here from another workspace's account (ALIGNMENT_NOT_HERE). Every other door that could make a KRA or SOP assignment for them refuses with the same sentence. Why: a KRA or SOP assignment names no workspace, and its readers (My KRAs, the KPI recorder, self-reports, review self-assessments, the weight total, the open SOP count) read every row of the person's, so a row B made for Pat showed and counted in A while B's own record of her showed none. A known limit; **the next step is KRAs, KPIs, reviews and skills per workspace, with those readers filtered by the workspace they are read in.**
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
   - Schema: `OrganizationMembership.managerId String?` with relation "MembershipManager" to User (`onDelete: SetNull`) and `@@index([managerId, organizationId])` (the step 1 review L4); User's back relation. `UserDottedLine.organizationId String` with a relation to Organization (`onDelete: Cascade`), `@@unique([userId, managerId, organizationId])` in place of `[userId, managerId]`, and `@@index([organizationId, managerId])`, `@@index([organizationId, userId])`.
   - SQL: new prisma/sql/2026-11-03-workspace-lines.sql, listed last in SQL_MANIFEST (a text edit of scripts/deploy-migrations.mjs, checked with node's syntax check only, never imported), with a README row.
     - Columns are catalogue-guarded; the keys are added NOT VALID, then validated, last in the file: the file is one transaction, so it is their place that keeps the lock on "User" short, not NOT VALID (the step 1 review L1).
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
   - Split from step 1, closed here (the step 1 review M1):
     - The solid halves that read the account line directly: membership.ts reportCountOf (no workspace filter at all, so rule 6 in B counts Pat's A line), teams-counts.ts hasReportsFor and calendar/events' Team pill (Max "has reports" in B through Pat's A line, Dana none through her B line), app-floor-impact.server.ts's managers, reviews/[id]/manager-review (the subject's account line into reviewerFacts), and the access parity job (scripts/access-parity-job.mjs and scripts/lib/parity-node-section.mjs: hasReports from `_count.directReports`, nightly at 02:15).
     - factsHere (manager-lines.ts) and unattendedRecipient (membership.ts) are handed the seat's line (HeldSeat.managerId) and still use the account's.
     - The two loop checks walk two graphs: the check before the lock (users/[id] PATCH, bulk-update: managerMapFor) walks the seat's lines since step 1, the locked one (wouldLoopIn, lineAbove) the account's. lineAbove at the seat closes it here; step 4's writers then write per workspace.
     - reportsHereOf has no caller yet: every "who reports to X here" read moves onto it.
     - Since the swap and E11 (ii), User.managerId is the anchored workspace's line, so a reader that takes it for a membership person reads another workspace's line there: digest-recipients' memberManagersOf here, the surfaces in step 3.
   - The done gate: flip each step 2 entry of workspace-lines.contract.test.ts to (a) with its new reason, then add 2 to MERGED.
   - Tests: Pat under Max in A and under Dana in B, with dotted lines to each. Each walk, the digest manager, the reviewer a launch picks, the approver a timesheet stamps, the weekly-review manager, rule 6 and the unattended recipient answer A's line in A and B's in B, before and after Pat switches. The raw walks are tested through the report-tree-seat double, which asserts the new clauses, and on Postgres by step 9.

3. **Every surface that shows a line shows this workspace's.**
   - users/[id] GET for both kinds: manager, dotted managers and reports through reportsHereOf (never the cross-workspace `directReports` relation); membershipRecord the same.
   - dotted-lines GET (by organizationId, for a subject of either kind); record-access's walk up and its dotted lines; my-team.
   - members-list (row, No manager); directory-list (rows, the Reports to filter, No manager, report counts and their sort, the chart's managerId and dotted ids); users/export; /api/users' manager columns.
   - named-here.ts loses the elsewhere fields (E6).
   - Split from step 1, closed here (the step 1 review M1): the dotted-lines GET still reads every workspace's rows by person, so after the SQL Max is listed twice for Pat, and a line held only in A whose manager holds a seat in B is listed in B, copied into B by B's next save, and cannot be taken off in B (the PUT deletes B's rows only). The GET by organizationId closes it, with step 4's writeDottedHere. members-list.server.ts, directory-list, my-team, the users GET and record-access read the account's line for membership people: another workspace's line since the swap.
   - The done gate: flip each step 3 entry to (a), then add 3 to MERGED.
   - Tests: each surface in A and in B for Pat and for Max.
   - **Step 3 partners, from the step 2 review** (displays that disagree with step 2's walks until step 3 lands; file:line on 22991ade plus step 2):
     - users/[id]/route.ts 447-448 and 531-536: the record's manager, dotted managers and reports, from the account line, `directReports` and every workspace's dotted rows.
     - record-access/route.ts 43-58, "Who can see this record": walks the account line and every workspace's dotted rows. It names Max as a reader of Pat's B record while the engine (viewer.ts reportTree) now gives him none, and it leaves Dana out.
     - members-list.server.ts 119, 128 and 250.
     - directory-list.server.ts: 114, 147 and 152 (the Reports to filter); 190, 212 and 311 (report counts and sort); 303 and 368; 428-473 (the chart's lines; the org chart's client loop check in org-tree.tsx walks these).
     - my-team/route.ts 41, 66 and 77: directReportIds and each member's managerId from the account line, while teamIds come from the walk here. Dana's My team lists Pat under Max.
     - users/export 45 and 63; /api/users 156-164 and 197-231.
     - dotted-lines GET 95-98; api/ai 97; team/members-work 91; reviews/[id]/peers 42, 61 and 84-86 with peerCandidateWhere's `subject.managerId`; named-here.ts.

4. **Every write of a line writes this workspace's, and the relied-line machinery retires (E4 to E6, E10).**
   - PATCH Reports to (anchored here for now; step 5 opens it for membership people), without the manager_elsewhere 409.
   - Bulk update's change_manager through writeLineHere. The dotted-lines PUT writes this workspace's rows only, with peopleBelow over the lines here.
   - The handover: writeReportMoves through moveLinesHere; handoverReportCount counts every report here; the preview loses alsoElsewhere and stays.
   - moveAgentReports and agentPlanFor without stays. staleLinesOf and the clears on a restore and a reactivation (users/[id], scim-reactivate.ts) read and write the line here.
   - SCIM's deprovision without moveReliedReportsAtEnd. The signed-in join writes the invitation's manager onto the membership, and the GET names that manager to an existing account.
   - The dialogs' and the record's words for relied lines go: TransferDialog, the Remove dialog, the person record, the log sentences.
   - agent-manager-reads.contract.test.ts is rewritten for the new rules. Pending SCIM handover rows carrying `leavesOnlyHere` are still read, with the flag ignored.
   - Split from step 1, closed here (the step 1 review M1 and L5): the locked loop check (wouldLoopIn at PATCH and bulk-update) with step 2's lineAbove at the seat; the five seat-writes.ts functions have no caller yet, so every line write is still the old one; the dotted-lines PUT's keep list goes with writeDottedHere. Two ends crossing workspaces (Pat manages Dana in A while Dana leads Pat in B: Pat's end in A locks Pat then Dana, Dana's in B Dana then Pat, under two role locks) deadlock; Postgres ends one (40P01) with nothing written, and the routes answer it as the role-busy "try again", never a 500.
   - The done gate: every writer the contract test names "step 4" goes through seat-writes.ts and each step 4 entry is flipped to (a), then 4 is added to MERGED.
   - Tests: B's removal of Dana moves B's reports only and A's lines stay; Max's D4 end with A suspended leaves A's lines; a dotted-line save in B keeps A's row; a restore in B clears a stale B line and never A's; Pat's join of B by invitation lands under the invited manager.
   - **The pairings, from the step 2 review** ("For step 4 (pairings)"). Each is a place where step 2 now reads THIS workspace's line while its partner still reads or writes the account's, or every workspace's dotted rows. All of them must close in the one merge. "Named" means the step 4 text above already names it. File:line on 22991ade plus step 2.
     1. **writeReportMoves, handover.server.ts 345 and 350**, writes `tx.user.updateMany({ where: { managerId: id, id: { in } } })`, while the plan comes from lineFactsAround (lines here, manager-lines.ts 118-121).
        - (a) Pat, whose B line names Dana, is planned to move and nothing is written. She stays under Dana in B after Dana leaves.
        - (b) When Pat's A line also names Dana, B's handover rewrites A's line to B's recipient or B's up-line, a cross-workspace write. Bo may hold no seat in A (Pat has no manager in A) or may hold one (Bo gains reach over Pat in A).
        - followReportingLine then reads the lines here (review-cycle.server.ts 353-355), so Pat's open B reviews stay with Dana.
        - Named: moveLinesHere. Held by handover.server.test.ts's three `it.fails` cases for (a) and its `it.fails` "never moves the account's line of a report here through a membership" for (b) (step 2 review fixes, L8): step 4 turns each to `it`.
     2. **handoverReportCount, handover.server.ts 819-827** (account lines at 820, the relied exclusion at 825), **and pendingHandover 841-852**, the deactivation and removal gate (users/[id] PATCH and DELETE).
        - B can end Dana while Pat's B line names her (not counted). Then effectiveManagerOf(B, Pat) names a removed Dana anchored in B (managersPastAgents answers a removed anchored manager as stored), so her reviews and timesheets go to a removed person.
        - The reverse: a report whose A account line names Dana is counted in B's gate though B's line names someone else.
        - Named. Held by handover.server.test.ts's `it.fails` "counts that report as pending before a deactivation".
     3. **The handover GET summary, users/[id]/handover/route.ts 236-244**: `directReports` from account lines. The `?to=` preview (previewReportHandover) reads lines here, so the Transfer dialog's count and its preview disagree. Named in the contract entry.
     4. **The relied-line machinery applied to pairs now drawn from lines here**: reportsStayingWith 487-491, handoverLinesFor's keepRelied 465-478, previewReportHandover's alsoElsewhere 549, moveReliedReportsAtEnd's lineStandingsElsewhere 634 and otherWorkspaceRows 411-454 (handover.server.ts).
        - These judge a (Pat, leaver) pair "relied elsewhere" when the leaver is a live manager in another workspace Pat works in, whatever that workspace's line says.
        - Worst case: B removes Dana with leavesOnlyHere, and Pat stays under Dana in B because Dana manages someone in A.
        - Named (E6).
     5. **moveReliedReportsAtEnd, handover.server.ts 614-668, and SCIM's deprovision (scim-deprovision.ts 176-188)** have the same write as 1, with SCIM's actor. Named.
     6. **agentPlanFor 702-718 and moveAgentReports 764-800** (handover.server.ts).
        - The solid plan now comes from the lines here, but the write at 785 is the account's.
        - The dotted read at 707-710 is every workspace's rows to the Agent, while the Members drawer's agentsWithStoredReports (manager-lines.ts 383) now counts this workspace's only. The drawer and the move's preview disagree.
        - The dotted delete at 787-788 names no organizationId. Worst case: Max is an Agent in B and deactivated in A. B's Admin moves his B reports, and A loses Pat's dotted line to Max (which A keeps for a reactivation), with no record in A.
        - The WRITERS gate forces the delete through removeDottedHere. The step 4 text above ("without stays") does not name the read at 707-710: it must read `organizationId` here too, or the preview counts A's rows and says lines were taken off that never were.
     7. **staleLinesOf, manager-candidate.ts 196-245**, reads the account line and every workspace's dotted rows. Its clears are users/[id]/route.ts 1034, 1079 and 1349-1351 and scim-reactivate.ts 123-124.
        - The dotted deletes name no organizationId: a restore in B deletes A's copy of the same pair.
        - `managerId: null` lands on the account, so B's reactivation of Pat can clear A's line.
        - Pat's actual B line is never checked: B restores her under Rita, removed in B. Nothing leaks, because the walks stop at Rita, but the stale line stays.
        - Named.
     8. **PATCH Reports to's 409 manager_elsewhere, users/[id]/route.ts 882-898** (managerLineIsOthers). Since E1 the account line is the anchored workspace's alone, so the question "changing it here changes it there too" is now untrue. Worst case: Ada changes Pat's A line off Max, an Agent in A who manages Pat in B, and is asked to confirm a change that no longer reaches B. Named.
     9. **bulk-update change_manager, people/bulk-update/route.ts 116-119.** The write `tx.user.updateMany({ where: { id: { in: go } } })` has no workspace and no person lock. A person who switches workspace between the read at 57-60 and the write has another workspace's line written. Named (writeLineHere).
     10. **The dotted-lines PUT, users/[id]/dotted-lines/route.ts.**
         - The keep list from othersDottedLines (manager-lines.ts 422-431, every workspace's rows by person): a B copy whose manager holds no live level in B but is relied on in A can never be taken off in B.
         - 138 filters out `subject.managerId`, the account's line. For a membership subject (step 5) that drops a B dotted manager who is Pat's A manager.
         - Named, except the 138 filter, which step 5 names too.
     11. **The signed-in join, accept-invite**: it writes no membership line. Since step 2 the reads take the membership's line, so Pat joining B with an existing account shows no manager in B and is in nobody's B tree until the E10 write lands. Named.
   - **From the step 3 review** ("For step 4"; ~/workwrk-launch-backup/agents/workspace-status-2/step3-review.md). Each is a screen step 3 made read THIS workspace's line while a write, or a screen tied to one, still uses the account's line or every workspace's rows. All must close in the one merge. File:line on the step 3 tree.
     1. **The handover GET summary, users/[id]/handover/route.ts 236-244** (account lines naming the leaver, then liveHereAmong): the one surface still naming another workspace's reports. In B, Max's Remove and Transfer dialog lists Kai and Pat (their A lines; both hold seats in B) while his B record lists Bea only; Dana's lists Lee only while her record lists Lee, Max and Pat. Pairing 3. Fix: reportsHereOf (kept).
     2. **The deactivation and removal gate, handover.server.ts 819-852** (handoverReportCount, pendingHandover): Dana's B record shows three reports, the gate counts Lee only, so Bo can deactivate Dana after handing over Lee and Pat and Max stay under her in B. Pairing 2, held by handover.server.test.ts's `it.fails` cases.
     3. **The dotted-lines PUT's keep list, users/[id]/dotted-lines/route.ts 154 and 181-183** (othersDottedLines, manager-lines.ts 422-431, every workspace's rows by person).
        - These rows are now listed wherever a B row's manager holds a kept seat here: the record (users/[id]/route.ts 478 for a membership person, 560-563 for someone anchored here), the dotted-lines GET (107-116), the chart (directory-list.server.ts 472 and 512), Edit details and the org chart's picker.
        - Two shapes are listed there and never taken off by the PUT: (a) a B row to an Agent here who is a live manager in another workspace the person works in (named in step 3); (b) a B row to someone deactivated here through a membership who is live in another workspace the person works in (Rita): levelsHeldIn's live default leaves her out, linesElsewhere answers "relied", dottedIsOthers keeps the row. Before step 3 the GET hid it (`!others.has`); now it lists it (kept seats).
        - Worst case: Bo removes Rita from Pat's dotted lines in B; Edit details ticks the save and says "1 line kept for another workspace they work in, left as it is" (edit-details-dialog.tsx 438-450), untrue since E2; the org chart's picker (org-tree.tsx 134-142) says nothing; Rita is back on the next load.
        - Fix: writeDottedHere replaces this workspace's rows with the body; othersDottedLines, `elsewhere`, `checked` and `keptElsewhere` go. dotted-lines/route.test.ts's two "kept for another workspace" describes pin the keep list and are rewritten. The filter at 149 (`subject.managerId`, the account's line) is step 5's.
     4. **PATCH Reports to's 409 manager_elsewhere, users/[id]/route.ts 901-912** (managerLineIsOthers): the record no longer says "Reports to someone in another workspace" and the dialog's placeholder (edit-details-dialog.tsx 234 and 400) never says "Someone in another workspace", but PATCH still asks "changes it there too" when an anchored person's line names an Agent here, or someone with no level here, who is a live manager in another workspace the person works in. Untrue since E1. Pairing 8.
     5. **The Agent move's preview, handover.server.ts 702-737** (agentPlanFor, previewAgentReports): it counts every workspace's dotted rows to the Agent (711), while the Members drawer's agentReports and the record count B's rows only; its `stays` names the people whose dotted line is another workspace's, which says in B that Pat has a dotted line to Max in A. Pairing 6.
     6. **The stale-line clears on a restore and a reactivation, users/[id]/route.ts 1048-1051 and 1368, scim-reactivate.ts 123** (manager-candidate.ts staleLinesOf): B's restore of Pat can clear her account line, which is A's, and delete A's dotted copy; the answer's `linesCleared` then names a clear B's record never showed. users/[id]/seat-lines.test.ts "a line nobody relies on any more is cleared on a restore" pins that cross-workspace clear (the account line becomes null) and is rewritten. Pairing 7.
     7. **The client words with no source any more** (the contract test skips "use client" files, and named-here.ts is now (a), so no done gate reminds this step):
        - person-record.tsx 117, 120 and 667-679 (managerElsewhere, dottedElsewhere) and edit-details-dialog.tsx 35, 38, 234 and 400: step 3's GETs never send these, so the branches are dead;
        - edit-details-dialog.tsx 238 and 440-450 (`dottedKept`, fed by the PUT's keptElsewhere), and dottedElsewhereWords (named-here.ts 34) with its named-here.test.ts case: they go with the keep list (item 3).
     8. **The signed-in join, accept-invite**: Pat joining B with her existing account under an invitation naming Dana shows no manager on any step 3 surface in B until E10's write lands. Pairing 11.

5. **A membership person's profile and lines are edited here (E7, E8, E9 ii, E10).**
   - PATCH for a membership person writes job title, department, office, weekly hours, working week, profile fields and Reports to on the membership (writeProfileHere, writeLineHere) under the role lock (lines), the person's lock and sameSeat. Personal and birthday fields are refused with SHARED_IDENTITY_REFUSAL. A new job title seeds its KRAs and SOPs for a seat anchored here only; for a membership person the answer says none were assigned (E7, the step 5 review M1).
   - accessFor's editable list for membership people. membershipRecord sends weekly hours, working week and profile fields to readers of people data.
   - The drawer's profileEditable, the Directory's canEdit and bulk selection, the record's Edit details and dotted lines for membership people.
   - Bulk update's department and office actions write membership rows. PROFILE_ELSEWHERE goes, and SEAT_FIELDS widens to the placement and Reports to groups.
   - SCIM Groups write and list the membership's department.
   - The dotted-lines PUT's filter at users/[id]/dotted-lines/route.ts 138 drops `subject.managerId`, the account's line: for a membership subject it must drop the line here instead (the step 2 review, pairing 10), or a B dotted manager who is Pat's A manager is dropped.
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
   - **The walk through a manager anchored elsewhere, measured at 5,000 people** (the step 2 review L1): Max anchored at A leads 5,000 people there and reports to Dana in B; every request Dana makes in B walks through him (viewer.ts reportTreeFor), and the anchored half reads his A rows from the heap by "User_managerId_idx" only to drop them by workspace. Measure Dana's tree in B; add an index on "User"("managerId", "organizationId") in a later SQL file only if it is slow.
   - **The Directory's sort by reports at 5,000 people** (the step 3 review L3): since step 3 it is made in memory for every query (directory-list.server.ts orderedInMemory), so each page turn and each export sorted by reports reads every matching person's keys (directoryOrder) and runs reportsHereOf over all their ids (two `IN` lists the size of the workspace). Measure a page and the export at 5,000 people; if slow, keep the ordered ids for the session, or count with one grouped statement per half.
   - **The bulk update and SCIM Groups at 5,000 people** (the step 5 review L5): bulk Change department, Change office and Change manager write each person under their row lock in one transaction (BATCH_TX, 20 seconds; past it the 503 "try again"), and a SCIM Group PUT writes each named member in a small transaction of their own (four statements). Measure a bulk change of 2,000 (the cap) at 5,000 people and a Group PUT of 5,000 members; if slow, lock each half in one `FOR NO KEY UPDATE ... WHERE id = ANY(...) ORDER BY id` and write each half with one guarded updateMany.
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
10. **Between the SQL and the new release's first request (the window, corrected by the step 1 review H1)**, the release before serves on the new data and writes no membership line:
    - every move it makes (the switcher, D3's end that moves an account, D6's restore that moves one, the D7 sign-in and session repair, an invitation joined with an existing account, the hard delete's move home) leaves the workspace left with no line on its membership and carries the account's line in as the new workspace's (a manager with no row there included);
    - its handover moves account lines only, so a membership line naming the leaver stays, and that person then reports to someone that workspace ended;
    - a membership it makes gets no copy of the account's line;
    - it shows no manager for some people working somewhere through a membership, and a dotted manager twice;
    - a dotted-line save that adds a line fails with "Something went wrong" (nothing written), and one that only takes lines off, or its clears on a restore or a reactivation, may take off a copy where that manager is deactivated or an Agent.
    None of it leaves a record, so the check below runs right after every deploy. **A deploy that stops after the SQL** (the unpack, the checksum, the swap or the new release's check failed, and the build before it is put back) leaves the release before serving on the new data, and every move until the next deploy loses a line: **redeploy at once**, then run the check and the recovery.

**Right after every deploy of this release, the check.** Record T0, when the SQL applied (the file writes it into the marker comment, "applied ... UTC"; the deploy log's "deploy-migrations: applied 2026-11-03-workspace-lines.sql" line says the same), and T1, the new release's first request (the reload's line in the deploy log). Run prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql with T1 written in (psql -v ON_ERROR_STOP=1). When its lists (a), (b) or (d) show anything, run prisma/sql/after-deploy/2026-11-03-workspace-lines-window-recovery.sql with the same T1, then the check again. The recovery puts back each move's lines from what the rows still hold (the membership left takes the account's line, the account takes its new workspace's own row's, the one the SQL copied there), and copies the account's line onto a membership made in the window, under each person's row lock, never over a line the new release wrote, each change with its Audit row. What it cannot tell, and list (c) (the handovers), that workspace's Admin sets by hand; list (e) names the dotted-line writes of the window. Also informational: membership lines naming someone who holds no live seat in that workspace, and dotted rows per workspace, for the coordinator to compare with the local runs.

## Risks and known limits

- **The raw walks' shape.** PostgreSQL allows one reference to a recursive name, so the walks join it to a LATERAL subquery of two halves. The in-memory test double cannot run SQL, so step 9 runs both walks on Postgres and EXPLAIN shows the two indexes used. The fallback, a workspace-wide `lines` CTE, reads every person of the workspace per walk, and viewer.ts walks on every request.
- **Cost.** Every walk round reads one more indexed table. reportTreeFor runs per request (memoised per request); the step 2 reviewer measures it on a 5,000-person workspace.
- **The map was built by reading, not by search** (no search tool in the planning session). E16's test, built in step 1 from a real search, is the net. Section 8 of the map lists files named but not opened.
- **A manager in both workspaces gets two independent lines** after the copy. An edit in one no longer follows in the other, which is the point, but someone used to the old behaviour may expect it.
- **The window between the SQL and the new release's first request** (deploy note 10, corrected by the step 1 review H1). The release before's moves in it leave the workspace left without its line and carry the account's line across; its handover leaves membership lines on the leaver; a membership it makes gets no copy; a review launched in A then picks its launcher as the reviewer for those people. The after-deploy check lists all of it and the recovery puts back what the rows still hold; the rest is set by hand. A deploy that stops after the SQL leaves that release serving on the new data and must be redeployed at once.
- **Not in this program:** a membership person's KRAs, SOP assignments, KPI history, reviews and skills here (none is assigned to them here since the step 5 review M1; the next step makes them per workspace, with their readers filtered); an Admin's scopes on a membership (viewer.ts reads the anchored row's only); Who can see this record's People team, org-wide and Admin groups (anchored people only); SAML just-in-time accounts for people who belong elsewhere; HRSegment's department scope (its reader was not found).
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

## Step 1, built

Branch `workspace-status-2` in ~/theywrk-launch, on f16c2220 (main, with phase 1 and step 6 live), not committed. **Steps 1 to 4 ship together, in one merge, never apart**: this step's SQL clears account lines and gives each dotted line its workspace while most readers still read the account's line and every workspace's dotted rows (steps 2 and 3).

### What was built

1. **Schema (E1, E2).** `OrganizationMembership.managerId String?` with relation "MembershipManager" to User (`onDelete: SetNull`) and `@@index([organizationId, managerId])`; User's back relation `membershipReports`. `UserDottedLine.organizationId String` with a relation to Organization (`onDelete: Cascade`), `@@unique([userId, managerId, organizationId])` in place of `[userId, managerId]`, `@@index([organizationId, managerId])` and `@@index([organizationId, userId])` (the single-column indexes stay); Organization's back relation `dottedLines`. `npx prisma validate` passes; the client was regenerated (no database read).
2. **SQL**, new `prisma/sql/2026-11-03-workspace-lines.sql`, listed last in SQL_MANIFEST (a text edit of scripts/deploy-migrations.mjs, checked with node's syntax check only, never imported), with its README row; the 2026-11-01 row now says it is followed by this one. In words below.
3. **Reads (acting-workspace.ts).** `HeldSeat` and `PersonSeat` carry `managerId`, this workspace's line: the account's for someone anchored here, the membership's for anyone else, never the anchored workspace's own stale row. seatsHeldFor's rows must pass the account's line (both callers already select it); personSeatIn reads it with the seat (a row passed without it costs one more read, so the line is never guessed; node-access.ts now selects it with its row). New `reportsHereOf(organizationId, managerIds, db, { seats })`: who reports to these managers here, two indexed halves (User by "User_managerId_idx" then the workspace; memberships by the new (organizationId, managerId) index, the person anchored elsewhere), kept seats by default, live on request (seated-here.ts reaches), each answer with its kind and whether it is deactivated here. workspacePeopleLines' membership half reads `m."managerId"`; workspaceDottedLines joins `d."organizationId" = this workspace` in both halves.
4. **Writes, new leaf src/lib/access/seat-writes.ts (E16).** The one place that knows which row holds a seat's line and profile. Each function takes the person's row lock (lockPerson) and writes only while the row still holds the seat, as applyRoleChangeIn's two writes: the account while anchored here and not removed, the membership while not removed and its account still anchored where it was read (`SeatRef`: the workspace, and where the account was anchored when read). False (or null), nothing written, when a move landed in between.
   - `writeLineHere(tx, seat, managerId)`: the solid line (null clears it); a line to oneself throws before anything.
   - `moveLinesHere(tx, { organizationId, fromId, moves })`: the handover's moves, each row conditioned on still naming the leaver here, the account half then the membership half, the people locked first in id order, answering exactly who moved (updateManyAndReturn).
   - `writeProfileHere(tx, seat, patch)`: department, job title, office, weekly hours, working week, and the profile fields merged key by key with what that row holds. No join date (no write door, E7).
   - `writeDottedHere(tx, seat, lines)`: replaces the person's dotted lines in this workspace only; and `removeDottedHere(tx, organizationId, pairs)`, this workspace's rows of these person and manager pairs (the stale clears and the Agent move of step 4 need it; no seat guard, since a removal lands on no seat's row).
5. **The swap (E3).** reanchorUser: PROFILE_SELECT gains `managerId`; the membership left keeps the account's line (`leavingProfile`), the account takes the target membership's (`arrivingProfile`), none with no target row. Every move gets it (D3, D6, the switcher, an invitation, the D7 repair, moveHomesOutOf). Dotted lines need no swap (E2).
6. **The test double (seat-test-db.ts).** A membership's `managerId` and `manager` (a key to User, P2003 on a write naming no account); a dotted line's `organizationId` (required, P2011) and its unique key (P2002); Postgres's delete actions (an account's memberships and dotted lines cascade, every line naming it becomes null; a workspace takes its accounts, memberships and dotted lines); `updateManyAndReturn`; and updateMany now writes nothing when a row breaks a key, as one statement does.
7. **The E16 contract test**, `src/lib/access/workspace-lines.contract.test.ts`, below.
8. **Touched beyond the plan's list, and why.** `src/app/api/users/[id]/dotted-lines/route.ts`: the new unique broke its upsert's type, so its upsert names this workspace, its new row carries it, and its delete takes this workspace's rows only (E2: without that, B's save would delete A's copies). Everything else of that route (the keep-elsewhere list, an anchored-only subject, peopleBelow) is step 4's. `src/lib/access/node-access.ts`: one column in the session check's select (see 3). `src/lib/access/workspace-profile.test.ts`: its seed named a manager with no account, which the key now refuses; Amy is seeded, and the one assertion that pinned "the manager line stays on the account" asserts E3.

### The SQL in words

1. Every deploy: `OrganizationMembership.managerId` (TEXT, nullable) and `UserDottedLine.organizationId` (TEXT, nullable until step 2 below) are added, and the indexes `OrganizationMembership_organizationId_managerId_idx`, `UserDottedLine_organizationId_managerId_idx` and `UserDottedLine_organizationId_userId_idx` built, each only when the catalogue says it is missing.
2. Once, marker `workspace-lines-2026-11-03` on the comment of `"OrganizationMembership"."managerId"` (a later COMMENT ON that column must keep it), one DO statement:
   - (i) every membership of a workspace other than the account's anchor takes the account's line, where that manager holds a row there in any state (anchored there, or a membership there) and is not the person; never over a value, never the anchor's own stale row;
   - (ii) the account's line is cleared where the manager holds no row in the anchored workspace, each in one data-modifying statement with its ActivityLog row there (`reporting_line_changed`, actor the system, target the person, the old manager in oldValue, a description naming nobody, id `deploy-line-cleared-` and the person's id, ON CONFLICT DO NOTHING);
   - the old unique `UserDottedLine_userId_managerId_key` is dropped;
   - (iii) each dotted line takes the person's anchored workspace when the manager holds a row there, otherwise the first workspace by id where both hold one (any state); a copy is inserted for each other such workspace (id `deploy-dotted-`, the line's id, `-` and the workspace's id; the note, weight, dates and createdAt copied); a line that qualifies nowhere is deleted, each in one data-modifying statement with its ActivityLog row in the person's anchored workspace carrying it (manager, note, weight, both dates, createdAt; id `deploy-dotted-removed-` and the line's id);
   - `organizationId` is set NOT NULL, the unique on (userId, managerId, organizationId) built, and the marker written last.
3. Last, the two keys, NOT VALID, then validated (each guarded by the catalogue): the membership's manager to User (ON DELETE SET NULL) and the dotted line's workspace to Organization (ON DELETE CASCADE). The deploy runs a file as one transaction, so the keys are last: the share lock a key takes on "User" and "Organization" (it holds off their writes, never their reads) is held only for the two validation scans and the commit. A line copied from a manager deleted meanwhile fails the validation, which rolls the whole file back.
4. The header says what the file does in order, why the data step is in the file, what the minutes before the reload look like, and the rollback: the account lines back from their audit rows, the copies deleted, the removed lines re-inserted from theirs, the oldest of a pair kept, the columns, keys and indexes dropped, the old unique restored. The only rows it deletes are the dotted lines no workspace reads, each with its record; nothing else leaves its column but (ii)'s lines, each with its record.

### The E16 contract test: its list

Built from a real search (rg and a scanner script over src/ and scripts/, then each file's lines read), checked against the map, then frozen into the test, which reproduces the search and fails on any file it finds that is not listed, any listed file it no longer finds, or a change in what a file touches. It found **148 files** (140 in src/, 8 in scripts/): 78 touch the line, 18 the dotted lines, 100 the profile.

- **(a) 41**: reads or writes the seat here, or is right as it is (seated-here.ts, profile-here.ts, viewer.ts, seat-writes.ts, workspace-anchor.ts, pure helpers, rows shown only when they belong here, invitations, accounts made here, local proofs).
- **(b) 86**: step 2: 28; step 3: 11; step 4: 10; step 5: 5; step 8: 32 (E15, in this program; the brief's "steps 2 to 5" plus the audiences). "via X" entries follow a helper and need no edit of their own.
- **(c) 21**: the person's own account (me, me/export), WeeklyReview.managerId stamps, the plan's known limits (a membership person's KPI history, reviews, skills, talent and alignment here; HRSegment), the access backfill and the object share module behind ACCESS_V2_TABLES.
- **The write rule.** 15 files write a line or a profile column: seat-writes.ts; the swap (workspace-anchor.ts, "moved"); accounts or seats made here (users POST, accept-invite's joins, seed-demo-org: "made"); a deleted department cleared from removed accounts for its key (departments/[id]: "key"); two local proofs; and seven named for the step that moves them into seat-writes.ts: step 4 (people/bulk-update, users/[id], users/[id]/dotted-lines, handover.server.ts, scim-reactivate.ts) and step 5 (scim Groups and Groups/[id]).
- **Not in the map by path: 33 of the 86 (b) files.** 19 of them are named by step 6's search above. These 14 are named by neither, and are added here to the step that owns them:
  - step 2: scripts/report-app-floors.ts (the same preview as app-floor-impact.server.ts);
  - step 3: src/app/api/reviews/[id]/peers/route.ts (peer suggestions "Their manager", "Reports to them", "Same manager", "Same department" from the account's line and department);
  - step 5: src/lib/agents/connector-tools.ts (a teammate's working days from the account's working week: capacityHereOf, E13, missed by step 6's search);
  - step 8: scripts/report-escalation-thresholds.ts, announcements/[id]/acknowledge, announcements/[id], candor/[id]/respond, offices (member counts), okrs/my-okrs, pulse-surveys/[id]/respond, roles/[id]/alignment (holder counts), src/lib/people/culture-gate.ts, src/lib/sop-compliance.ts, src/lib/workflow/engine.ts (several named by concept in the map's section 4.2).

### Decisions made here (worst case first)

- **Every seat write takes the person's row lock.** Worst case without it: B writes Pat's B line on her membership while she switches into B; the move reads the membership before this write commits, carries the old line onto her account, and the new one is left on a row nobody reads. With it: the move waits, or lands first and the write refuses ("seat_changed"). Cost: a crossing with another transaction locking the same people in id order is a deadlock Postgres ends with nothing written (said in moveLinesHere).
- **moveLinesHere answers from the rows it wrote** (updateManyAndReturn), not a re-read: a person in the plan whose line here already named the new manager is never reported as moved.
- **The keys are last in the file's one transaction.** Worst case of adding them first: every write of "User" waits behind the one-time step on the first apply.
- **removeDottedHere is a fifth function.** Step 4's stale clears and Agent move remove lines of several people; with writeDottedHere's replace-the-set only, each would read and rewrite whole sets.
- **The dotted-lines PUT's delete is this workspace's rows only already in step 1**, since the schema change made the route change anyway, and leaving it would let B's save delete A's copies.
- **The contract test scans scripts/ too, and counts any `managerId`** (WeeklyReview stamps and parameters named so are listed with their reason), so a new reader cannot hide behind a model's name.
- **Deploy note 10, corrected**: a dotted-line save in the minutes before the reload fails only when it adds a line; one that only takes lines off, and the old release's clears on a restore or a reactivation, delete by person and manager under the old rule, which keeps a line another workspace relies on but may also take off a copy where that manager is deactivated or an Agent (the SQL header says so).

### Left for steps 2 to 5

- **Step 2.** The solid halves that read the account line directly (added by the step 1 review M1): membership.ts reportCountOf (no workspace filter at all), teams-counts.ts hasReportsFor, calendar/events' Team pill, app-floor-impact.server.ts, reviews/[id]/manager-review's subject line, and the access parity job's hasReports (scripts/access-parity-job.mjs, scripts/lib/parity-node-section.mjs); and the two loop checks walking two graphs (lineAbove at the seat). factsHere still takes `r.managerId` (the account's line; HeldSeat now carries the seat's); lineFactsAround, effectiveDirectReportIds, walkThroughAgents and reportsThroughAgents through reportsHereOf; effectiveManagersOf and unattendedRecipient from the lines here; every dotted read by organizationId (countedDottedReportIds, countedDottedManagerIds, agentsWithStoredReports, reportCountOf, dottedRowsHere, team-alignment.ts, team-rollup.ts, teams-counts.ts, calendar/events, app-floor-impact); lineAbove and "inactive" at the seat (E4); the raw walks of team.ts and reporting-line.ts and getReportingChain; digest-recipients' memberManagersOf; weekly-queue.server.ts's `row.user.managerId`; review-cycle.server.ts's reviewerFacts and peer pool; alignment-scope.ts, email/send-reminders, the team alignment and rollup pages; and every "via" entry of the list. Until then a dotted line read in two workspaces is two rows to a reader that reads by manager alone.
- **Step 3.** users/[id] GET and membershipRecord (reportsHereOf, never `directReports`), the dotted-lines GET, record-access, my-team, members-list, directory-list, users/export, /api/users, api/ai's report count, team/members-work's Reports to filter, reviews/[id]/peers, named-here.ts's elsewhere fields.
- **Step 4.** PATCH Reports to through writeLineHere without the 409; bulk update's change_manager; the dotted-lines PUT through writeDottedHere with peopleBelow over the lines here; the handover through moveLinesHere and reportsHereOf, its relied-line machinery and acting-workspace.ts's lineStandingsElsewhere and linesElsewhere retired; moveAgentReports and the stale clears (users/[id], scim-reactivate.ts) through writeLineHere and removeDottedHere; accept-invite's signed-in join writing the invitation's manager onto the membership; previews.ts and the invite tool's manager at the seat; agent-manager-reads.contract.test.ts rewritten; the list's writers named "step 4" moved into seat-writes.ts.
- **Step 5.** A membership person's profile and lines through writeProfileHere and writeLineHere; person-fields.ts (PROFILE_ELSEWHERE, SEAT_FIELDS); team/workload's canEditCapacity; SCIM Groups; connector-tools.ts's working days at the seat.

### Tests

- New: `src/lib/access/workspace-lines.test.ts` (17: the swap both ways and a line set while there, a move with no target row, the anchored stale row overwritten on leaving and never read, D3, the hard delete moving a home line, the SET NULL key, the membership key, NOT NULL and the dotted unique, seatsHeldFor and personSeatIn in A and in B before and after a switch, both halves of reportsHereOf, kept and live, never another workspace's line); `src/lib/access/seat-writes.test.ts` (23: each write on the row that holds the seat in A and in B, the other workspace's row untouched, the lock before the write, a switch landing while it waits for the lock, a removed seat, a line to oneself, the handover's two halves and exact answer, the people locked in id order, the profile fields merged key by key, the dotted set replaced here only and removeDottedHere); `src/lib/access/workspace-lines-sql.test.ts` (16: the columns and indexes guarded, the dotted column nullable at add, the marker, the plan's order, each of E11's rules, both audit rows through a data-modifying CTE, the only delete, NOT NULL and the unique, the keys last NOT VALID then validated, the header, the rollback in order, the manifest, the README row, the schema, and the schema guard refusing the tree without it); `src/lib/access/workspace-lines.contract.test.ts` (8); 2 new in acting-workspace.test.ts (the membership half's line, the dotted lines by workspace). People throughout: Pat anchored at A under Max, working at B under Dana; Max contracting for B.
- Changed (9, no assertion weakened): acting-workspace.test.ts (the dotted read's values gain the workspace twice), kept-seats.test.ts (HeldSeat's line), workspace-profile.test.ts (E3, above), and the six that pin the manifest's tail (membership-status-sql, item-completions-sql, recurring-goals-kpi-identity-sql, recurring-goals-sql, oauth/sql, skills/types).
- All 13 files: 158 tests pass. **Against f16c2220's sources** (a scratch copy, this step's tests and test double put in): **65 of the 75 new and changed tests fail**: workspace-lines 14 of 17, seat-writes 23 of 23 and workspace-lines-sql 16 of 16 (the module and the file are new), the contract test 1 of 8, acting-workspace 3, kept-seats 1, workspace-profile 1, the manifest pins 6. The 10 that pass there test the test's own machinery by design: the contract test's scanner self-tests, its marks, its write rule and its named readers (7), and the three key tests of the double (SET NULL, the membership key, NOT NULL and the unique), which all fail with f16c2220's double.
- Wider: every test related to a changed source (`vitest related` over acting-workspace.ts, workspace-anchor.ts, seat-writes.ts, seat-test-db.ts, node-access.ts and the dotted-lines route): 289 files, 3,597 tests, all pass. The touched folders (src/lib/access, people, goals, oauth, skills; src/app/api/users, scim, auth, me, cron, people; check-in-access): 204 files, 3,065 tests, all pass.
- Type check clean, run twice at the end. ESLint clean on every touched file. `node scripts/check-schema-sql.mjs` passes (and refuses the tree without this file in the manifest, naming both columns). Nothing applied to any database: the coordinator runs the file in rolled-back transactions on the local database.

### Deploy notes (step 1, in the one merge of steps 1 to 4)

- **Apply prisma/sql/2026-11-03-workspace-lines.sql before the code** (the deploy runs it from the manifest, last): the new client selects `OrganizationMembership.managerId` and `UserDottedLine.organizationId`. The first apply holds ACCESS EXCLUSIVE on "OrganizationMembership" and "UserDottedLine" for the whole file (NULL columns, no rewrite, then the one-time step), and the keys' share lock on "User" and "Organization" for the validation and the commit; later deploys read only the catalogue.
- The local runs the plan asks for (twice on a copy, the second changing nothing; once fresh) should include the shapes in the draft notes above, plus: a person whose anchored workspace's own stale membership row names an old manager (never read, overwritten on the next move), and a dotted line from a person to themselves if any exists (it qualifies wherever the person holds a row and is copied there, as the rule says; no such line can be saved today).
- Checks right after the SQL (informational): `SELECT count(*) FROM "ActivityLog" WHERE "id" LIKE 'deploy-line-cleared-%'`, `... LIKE 'deploy-dotted-removed-%'`, `SELECT count(*) FROM "UserDottedLine" WHERE "id" LIKE 'deploy-dotted-%'`, and the plan's list of membership lines naming someone with no live seat in that workspace. **Superseded by the review fixes**: right after every deploy, the window check and, when it lists anything, the recovery (deploy note 10 and "Step 1, review fixes").
- What customers notice comes with steps 2 to 4 (the draft notes above). Step 1 alone must never ship (E11 ii takes Max off Pat in A for today's readers).

## Step 1, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step1-review.md; every finding is fixed as the coordinator ruled (H1, M1, M2 and every low accepted). Same branch, still not committed. **The SQL file changed in three places the coordinator re-runs** (L2's second guard, L4's index order, and the applied time in the marker comment for H1); the one-time step's rules are as tested. Two new files under prisma/sql/after-deploy/, **not in the manifest**: the window check and its recovery.

### H1: the window between the SQL and the new release's first request

- **The words.** The SQL header (its "THE WINDOW" paragraph), deploy note 10, the Risks line and step 1's deploy notes now say exactly what the release before loses in the window: every move it makes (the switcher, D3's end, D6's restore, the D7 repair, an invitation joined with an existing account, the hard delete's move home) leaves the workspace left with no line and carries the account's line in as the new workspace's; its handover moves account lines only, leaving membership lines on the leaver; a membership it makes gets no copy; it shows no manager for some membership people and dotted managers twice; its dotted-line writes fail (adding) or may take off a copy (removing). And that **a deploy that stops after the SQL must be redeployed at once**, then the check and the recovery run.
- **T0 is recorded by the file**: the one-time step writes its marker with the moment it ran, `workspace-lines-2026-11-03, applied YYYY-MM-DD HH24:MI:SS.MS UTC` (an `EXECUTE format` of the COMMENT ON, in the same statement). The deploy log's "deploy-migrations: applied 2026-11-03-workspace-lines.sql" line says the same. T1, the new release's first request, comes from the deploy log (the reload's line) and is written into the check and the recovery by hand; left as `<T1>`, every statement fails (not a timestamp). Each window starts five minutes before T0: a move the old release began just before the file waited for its lock and was stamped by the app's clock.
- **The check**, prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql, read-only, run with `psql -v ON_ERROR_STOP=1` right after every deploy of this release. It stops first, with where to take T0 from, if the comment holds no applied time. Then the window, and five lists:
  - (a) account lines naming someone with no row in the anchored workspace (the file left none and the new release writes none: each is a line carried in);
  - (b) the old release's moves (an account and a membership elsewhere written in the window, that membership's line NULL), each with `recoverable`;
  - (c) membership lines naming someone whose seat there ended since T0 (its handovers), set by that workspace's Admin;
  - (d) memberships it made in the window with no line where the file would have copied one, with `recoverable`;
  - (e) its dotted-line writes in the window, from their Audit rows.
- **The recovery**, prisma/sql/after-deploy/2026-11-03-workspace-lines-window-recovery.sql, for what the check marks recoverable, under each person's row lock (`FOR UPDATE OF u`):
  - a move: the membership left takes the account's line (that workspace's, carried across), and the account takes its new workspace's line from that workspace's own membership row, where the file copied it (E11 i); for a row made in the window, the file's own rule;
  - a membership made in the window, for an account not written since before it: the file's copy.
  - **It picks a move only** when the account and the membership left were written in the window within a minute of each other (one transaction), nothing was written since T1 (the account, the row left, the new workspace's row), the row left is the person's only NULL row written in the window, and the account's line is the left workspace's (that manager holds a row there) or none. **It writes** the row left only while still NULL, the account only while it still holds the line read, so it never writes over a line the new release wrote; each change has one ActivityLog row (actor the system, old and new manager; ids `deploy-window-left-`, `deploy-window-anchor-` and `deploy-window-made-` with the person's or the membership's id), which keeps a second run from matching anything. Nothing is deleted.
  - **What it cannot put back, set by hand**: the handovers (c); a person written since T1; two moves leaving two NULL rows; a hard delete in the window (the row left went with its workspace); the dotted copies (e).
- **Prevented in code instead?** No, neither is safe:
  - A repair at the session check or the move (a NULL membership line filled from the account) cannot tell a lost line from the true "no manager here", and the account's line is the anchored workspace's: filling from it is the stored line that wakes up which E11 (ii) exists to stop, at every move, for everyone, for good.
  - A database trigger completing the swap for the old release's moves would close the move half in SQL, but it is a hidden second writer of every move, there until a later file drops it, and leaves the handover and the made memberships open. Rejected.
  - So the check and the recovery are the answer, as phase 1's M2 was.
- **Tests**: src/lib/access/workspace-lines-window-sql.test.ts (11), in the way of membership-status-sql.test.ts (text), holds:
  - T0's format: the window's pattern parses exactly what the file writes;
  - T1's placeholder in every statement, and the five-minute start;
  - the guard first;
  - the check writes nothing, and its five lists;
  - the recovery picks with exactly the check's CTEs (`moved`, `made`, plus the row lock) and each rule above;
  - its three writes and their conditions, its audit rows and ids, ON CONFLICT, no delete;
  - both files outside the manifest, with their README rows, named by the file's header.

### M1: a step that forgets a reader cannot merge

- **The entries.** The five the review names now say their solid halves in the contract test (membership.ts reportCountOf with no workspace filter, teams-counts.ts hasReportsFor, calendar/events' Team pill, app-floor-impact.server.ts, reviews/[id]/manager-review's subject line), and so do step 2's text and step 1's "Left for step 2". The review's list of splits went into the plan under the step that closes each:
  - step 2: the solid halves; factsHere and unattendedRecipient handed the seat's line but using the account's; the two loop checks walking two graphs; reportsHereOf with no caller; the account line read for membership people;
  - step 3: the dotted-lines GET by person (Max twice; a line held only in A, listed and copied in B, impossible to take off there); the surfaces reading the account line;
  - step 4: the locked loop check; seat-writes.ts with no caller; the keep list; L5's deadlock.
- **The done gate.** The contract test gains `MERGED` (the steps whose builder has finished, empty now) and `MERGE_NEEDS` (2, 3, 4, 5, 7, 8). An assertion refuses any (b) entry, or any writer named "step N", of a step in MERGED. Each step's builder flips its entries to (a) (and moves its writers into seat-writes.ts) with the new reason, then adds its step. The merge of steps 1 to 4 (with 5, 7 and 8) needs MERGED to equal MERGE_NEEDS; the final review checks that, and then no (b) entry of the program remains.

### M2: the scanner sees every file type and shape, and every writer

- **Where it looks**: every .ts, .tsx, .mjs, .js and .cjs file of src/, scripts/, prisma/ (seed.ts included) and services/, node_modules and generated code left out.
- **New shapes**: `manager: null`, `manager: { is` and `manager: { isNot` (line); `dottedLines` (dotted: Organization's back relation, and the people routes' field). Each has a self-test.
- **The writes, by file and top-level function, whatever the shape.** A write of User or a membership whose data names a line or profile column, or whose data is held elsewhere (a variable, a shorthand, a spread: users/[id] PATCH's own `data.managerId = next` then `update({ data: write })`); any write of a dotted line; a raw UPDATE of those columns; an assignment to `.managerId`; a relation write on the line (`manager: { connect`, `directReports: { set`, ...). A new list, `WRITERS`, holds each writing file with its functions and its allowance, and the test fails on a writer or a function not listed. A data object held elsewhere that holds none of these columns is "none", saying what it holds (membership.ts, workspace-status.ts, scim Users/[id], previews.ts, the Directory's filter builders). Each shape has a self-test.
- **New entries**:
  - scripts/access-parity-job.mjs and scripts/lib/parity-node-section.mjs: (b) step 2, hasReports from the cross-workspace `_count.directReports`, nightly;
  - prisma/seed.ts: (a), an account made here;
  - scripts/reconcile-role-kras.mjs: (b) step 8, a job title's holders;
  - scripts/backfill-kra-roles.mjs and scripts/reset-alignment.mjs: (c), one-off scripts over the people anchored there;
  - guards.ts now also shows "dotted".
- **The list now**: **154 files** (140 in src/, 13 in scripts/, 1 in prisma/): 81 touch the line, 19 the dotted lines, 103 the profile.
  - (a) 42; (b) 90 (step 2: 31, step 3: 11, step 4: 10, step 5: 5, step 8: 33); (c) 22.
  - **26 writers**: none 6, proof 6, step 4: 5, made 4, step 5: 2, key 1, seat 1, moved 1.

### The lows

- **L1.** The header, the keys' comment and the plan's step 1 text say it is the keys' place at the end that keeps the lock on "User" short (the file is one transaction), not NOT VALID, which stays as harmless.
- **L2.** The one-time step also runs only while "UserDottedLine"."organizationId" is still nullable (`attnotnull` false), a guard only this step changes; a later COMMENT ON that drops the marker can no longer rerun it.
- **L3.** The rollback's re-insert is `ON CONFLICT DO NOTHING` (the new unique too), it then deletes the audit rows it consumed ('deploy-line-cleared-', 'deploy-dotted-removed-'), so a later apply writes its own, and its last sentence names a line moved by a swap as well as one set.
- **L4.** The membership index is ("managerId", "organizationId"), `OrganizationMembership_managerId_organizationId_idx` (schema, SQL, README, the plan's E1 and step 1): it serves reportsHereOf's membership half (both equalities) and the key's ON DELETE SET NULL, so the hard delete scans no table per account it removes.
- **L5.** moveLinesHere's note names the crossing that keeps id order (Pat's end in A, then Dana's in B, under two role locks); step 4's text says to answer 40P01 as the role-busy "try again", never a 500.
- **L6.** weekly-reviews/[id]/manager-review is (b) step 2, via isInReportTree and effectiveManagerOf.
- **L7.**
  - "reads two halves" now records each half's `where` and holds its index's columns (the accounts by line then workspace, the memberships by line and workspace, neither an OR); the index itself is EXPLAIN's, in the planted cases.
  - "holds the plan's named readers" now reads the code: each named (b) entry still makes the account-line read its mark says (team.ts's recursive join, reportCountOf's unfiltered read, factsHere's `r.managerId`, the Team pill, lineAbove's select, members-list's account line, the dotted-lines GET by person, the parity job's `directReports`), and seated-here.ts still selects the membership's placement. When a step changes one of these reads it flips the entry and drops that line.
  - The test double holds User.managerId as a key to User too (P2003), with a test that a swap can never carry a dangling id onto the account; the 46 suites on the double pass with it.
  - The rollback is checked as text; running it is in the coordinator's planted cases.
- **L8.** The whole suite ran (below), not only the related set.

### Files

New: prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql, prisma/sql/after-deploy/2026-11-03-workspace-lines-window-recovery.sql, src/lib/access/workspace-lines-window-sql.test.ts.
Changed: prisma/sql/2026-11-03-workspace-lines.sql, prisma/schema.prisma (the index order), prisma/sql/README.md (the row, and the two after-deploy rows), src/lib/access/seat-test-db.ts (User's key), src/lib/access/seat-writes.ts and acting-workspace.ts (comments), docs/plans/workspace-status-2.md (E1, step 1, the splits under steps 2 to 4, deploy note 10, the check, the Risks line, step 1's lists and notes, this section).
Tests changed: workspace-lines.contract.test.ts (M1, M2, L6, L7), workspace-lines-sql.test.ts (the guard, the applied time, the index, the header, the rollback), workspace-lines.test.ts (L7: the two halves, the account's key).

### Tests

- This pass's files: workspace-lines-window-sql (11, new), the contract test (9: the scanner's self-tests for every new shape and writer, the list, the marks, the writers by file and function, the done gate, the named readers read in the code), workspace-lines-sql (16), workspace-lines (18: the two halves by their columns, and the account's key, new), seat-writes (23), browser/types (8): 85 tests, all pass.
- **L8, the whole suite** (`TZ=UTC npx vitest run`, as the gate runs it) found one more test pinning the manifest's tail that step 1 missed, src/lib/browser/types.test.ts (`vitest related` never picks it up: it imports nothing changed). It now ends with this file, an addition, nothing weakened. Step 1's "the six that pin the manifest's tail" is seven.
- Its second run: 971 files. 966 pass, with 13,746 tests. Five failed on wall-clock timeouts under load, not on an assertion: three workers timed out loading a module (settings, teammate grant route, dotted-lines route) and two tests passed their 5-second limit (sheet-grid-keys, shortcut-reference). Those five files pass on their own (57 tests). The first run's one assertion failure was browser/types, fixed above.
- Type check clean, run twice (with a 6 GB heap, as the gate sets it). ESLint clean on every file touched in this pass. `node scripts/check-schema-sql.mjs` passes, and `npx prisma validate` passes with the index reordered (client regenerated). No SQL applied to any database.
- Not run here: the after-deploy check and recovery, and the rollback, are checked as text. The coordinator runs them on the local database against the f16c2220 code's moves and handover, with the review's planted cases.

### Deploy notes, added to step 1's

- Apply the SQL as before (the deploy runs it, last). **Then, right after every deploy of this release, the check** (prisma/sql/after-deploy/2026-11-03-workspace-lines-window-check.sql, T1 written in, psql with ON_ERROR_STOP), **and when (a), (b) or (d) lists anything, the recovery** (prisma/sql/after-deploy/2026-11-03-workspace-lines-window-recovery.sql, the same T1), then the check again; list (c) and anything not recoverable to that workspace's Admin.
- **Record when the SQL applied**: the marker comment holds it ("applied ... UTC"); keep the deploy log too, with the reload's line (T1).
- **A deploy that stops after the SQL: redeploy at once**, then the check and the recovery.
- For the planted cases (the review's list): the window cases with the f16c2220 code on the migrated copy (the old reanchorUser for Pat, A to B, losing A's line; the old handover of Dana in B leaving Pat's B line), then the check and the recovery putting both back (the handover by hand); EXPLAIN on the renamed index; the rollback with a line saved in two workspaces and one re-saved.

## Step 2, built

Branch `workspace-status-2` in ~/theywrk-launch, on 22991ade (step 1 committed on main f16c2220), not committed. **No SQL, no schema change, no flag.** It ships only in the one merge of steps 1 to 4 (see "Left for step 4": the handover still writes the account's line while its plan now reads the line here).

### The rule

Every walk and every reach reads THIS workspace's line: User.managerId for someone anchored here, the membership's own managerId for someone here through a membership (never the anchored workspace's own stale row), and only the dotted lines whose organizationId is this workspace. Each reader keeps the seat rule it had (kept or live, which kinds); only the source of the line changed.

Helpers (acting-workspace.ts and manager-lines.ts, the access layer):
- `reportsHereOf` now answers the level held here with each report (`level`: the account's where anchored here, the membership's role otherwise), so the walks down know the Agent tier without another read.
- New `linesHereOf(organizationId, ids)`: the line each person's seat here holds (kept seats, through seatsHeldFor), null for no line, absent for no seat.
- New `managersPastAgents(organizationId, people)`: the walk up past Agents that effectiveManagersOf and the digests' memberManagersOf share, each manager read at their seat here (line and tier here; a membership manager counts only while live, as levelsHeldIn read it before).

### Each reader: before, now, test

Tests named here are in src/lib/access/workspace-lines-reads.test.ts (new, on the in-memory database through the real reads: Pat anchored at A under Max and at B under Dana, a dotted line to Kai in A and to Lee in B, Max a Manager in B, Kai in B too) unless another file is named.

- **manager-lines.ts**
  - factsHere. Before: the seat's level and status, the account's line (`r.managerId`). Now: the seat's line (`seat.managerId`). Test: "the handover's line facts hold B's line in B and A's in A".
  - lineFactsAround, effectiveDirectReportIds, walkThroughAgents (effectiveReportsOfMany, listedUnderAgents), reportsThroughAgents, agentsWithStoredReports' solid half. Before: `user.findMany({ managerId })`, every account line naming them. Now: reportsHereOf, both halves. Tests: "Dana has Pat in B, Max has her in A only", "an Agent's stored reports here are this workspace's".
  - effectiveManagersOf. Before: each person's account line, each manager walked by the account line. Now: each person's line at their seat here (people answered as before: anchored here, or a live membership), and managersPastAgents. Tests: "answers Max in A and Dana in B, before and after Pat switches", "never names a manager whose seat here ended". The reviewer a launch picks, the approver a timesheet stamps and the weekly-review manager all read this.
  - countedDottedReportIds, countedDottedManagerIds, agentsWithStoredReports' dotted half. Before: every workspace's rows. Now: `organizationId` here. Test: "Kai counts in A and Lee in B; A's row never counts in B".
  - othersDottedLines, managerLineIsOthers, recordLinesOfOthers: untouched (step 4 retires them).
- **manager-candidate.ts**
  - managerCandidateIn. Before: "in this workspace" by levelHeldIn (live), "inactive" by the account's status, so Rita, deactivated by B through her membership, was "not_found". Now: the kept seat here (seatsHeldFor); "inactive" when the seat here is deactivated or the account ended (E4). Test: "someone B deactivated through their membership is refused as deactivated".
  - lineAbove (wouldLoopIn). Before: the account's line. Now: the line each seat here holds, the same graph managerMapFor walks (workspacePeopleLines), which closes the step 1 review's split. Tests: "B may make Max report to Pat, since in B Pat reports to Dana; A may not", "sees a loop through a membership's line in B", "holds after Pat switches into B"; src/lib/people/person-access-anchor.test.ts "is on the line a loop check walks" (lineAbove and managerMapFor agree).
  - staleLinesOf: untouched (step 4).
- **team.ts getTeamUserIds and reporting-line.ts solidTreeRows (the raw walks).** Before: `JOIN team t ON u."managerId" = t.id` with an EXISTS for a membership, so every account's line. Now: `team t CROSS JOIN LATERAL (anchored half UNION ALL membership half) r`, the anchored half `u."managerId" = t.id AND u."organizationId" = org AND u."deletedAt" IS NULL`, the membership half `m."managerId" = t.id AND m."organizationId" = org AND m."removedAt" IS NULL`, joined to its person anchored elsewhere and not removed. The root's live seat is unchanged. dottedRowsHere reads `organizationId` here. getReportingChain, which named no workspace and had no caller, is deleted. Tests: src/lib/report-tree-seat.test.ts, whose double now asserts the LATERAL clauses (and refuses step 1's statement) and walks the membership lines: "Dana's tree in B holds Pat by her membership's line; Max's in B does not, his in A does", "a manager whose seat here ended leads nobody here, and a report removed here leaves the tree", for team.ts, getSolidReportTree and getEffectiveReportTree; and on Postgres, below.
- **membership.ts**
  - reportCountOf (rule 6). Before: `user.findMany({ managerId })` with no workspace at all, and every workspace's dotted rows. Now: reportsHereOf (kept) and this workspace's dotted rows, a dotted report counted while their seat here is kept. Tests: "B may make Max an Agent: nobody reports to him in B", "still counts them after Pat switches into B".
  - unattendedRecipient. Before: the person's account line, then each manager's account line. Now: the person's seat here (personSeatIn, an ended seat keeps its line), then each manager's seat line. Tests: "give Pat's B work and B digest to Dana, and her A ones to Max", "walk past a manager whose seat here ended, by that manager's own line here".
- **digest-recipients.ts memberManagersOf.** Before: the account line of a membership person, managers walked by account lines. Now: the membership's line (seatsHeldFor) and managersPastAgents. Tests: the digest cases above; digest-recipients.test.ts and digest-recipients-seat.test.ts with the lines on the memberships and the accounts naming another workspace's manager, so reading the account would fail them.
- **person-access.server.ts.** No edit: the chain is getTeamUserIds plus the viewer's report tree (both walks above), and managerMapFor already read workspacePeopleLines.
- **teams-counts.ts hasReportsFor and calendar/events' Team pill.** Before: `user.count/findFirst({ managerId })` over every account line of anyone here, and every workspace's dotted rows. Now: reportsHereOf (kept) for the solid half, `organizationId` here for the dotted half. Tests: "the Teams badge and the goal rules see the reports here"; calendar/events/route.test.ts "the Team pill asks who reports to the viewer in this workspace".
- **app-floor-impact.server.ts and scripts/report-app-floors.ts.** Before: the anchored people's account lines and the anchored people's dotted rows of every workspace. Now: those account lines, the line and level each active membership here holds (an Agent's membership leads nobody), and this workspace's dotted rows (workspaceDottedLines in the app, the same rule written out in the script). Test: app-floor-impact-agent.test.ts "counts a manager here by the line a membership holds".
- **alignment-scope.ts goalRightsActor.** Before: a count of people anchored here by the account line. Now: reportsHereOf, live. Test: "the Teams badge and the goal rules see the reports here" (Eve, a Member, leads Zia through Zia's membership).
- **team-alignment.ts and team-rollup.ts.** Before: the dotted marks by manager over every workspace. Now: `organizationId` here. Their rows stay people anchored here (a membership person's alignment here is a known limit).
- **team/alignment page.** Before: the Sub-teams pill by anchored people, the account line and the cross-workspace directReports relation; the drill's manager anchored only. Now: workspacePeopleLines (org-wide) and reportsHereOf twice (a manager's own chain); the drill's manager by personHere at a kept seat. **team/rollup page**: the org-wide roots by workspacePeopleLines (live). Server pages, no route test; the helpers are tested.
- **weekly-review.ts managerQueueWhere and managerQueueWhereFor.** Before: `{ user: { managerId } }` (the subject's account line) and "no manager today" by the account. Now: the reports here by id (reportsHereOf) with the people under an Agent, and "no line here" per kind (anchored with none, or a membership here with none). Tests: "the weekly-review queue holds the people who report here"; weekly-review-agent.test.ts updated to the new shape.
- **weekly-queue.server.ts.** Before: the drawer's direct manager from `row.user.managerId`. Now: the subject's seat here (personSeatIn); the subject select no longer reads the account line.
- **review-cycle.server.ts reviewerFacts.** Before: "self stamped" needed no account line. Now: no line at the seat here (linesHereOf). The reviewer itself is effectiveManagersOf. Tests: "is Dana in B and Max in A", "lets someone with no line here write their own, whatever line their account holds elsewhere". The peer pool (peerCandidateWhere) is unchanged: people anchored here, by their own lines, the subject's line passed by its caller (reviews/[id]/peers, step 3).
- **reviews/[id] and reviews/[id]/manager-review.** Before: each selected the subject's account line (the cycle GET sent it to the client; the manager-review GET stripped it; the PUT never used it). Now: not read. The writer is reviewerFacts.
- **send-reminders, the monthly evaluation.** Before: people anchored here with an account line. Now: that half, then live memberships here with a line, each named to their digest manager. Test: send-reminders/route.test.ts "names a member in the monthly evaluation reminder of their manager here" (its double now holds members' lines on their memberships).
- **The parity job** (scripts/access-parity-job.mjs, scripts/lib/parity-node-section.mjs). Before: `hasReports` from `_count.directReports`, every workspace. Now: reportsHereOf over the sampled viewers (both halves), loaded through the job's own TypeScript hooks. Checked with node's syntax check and the contract pins; not run (it loads .env, which this session never reads).
- **Via the helpers, no edit:** kra-assignments, kpi-record.ts, kpi-review.server.ts, team-scope.server.ts, weekly-reviews/[id]/manager-review, weekly-reviews/reminders, reviews/[id]/launch (its department audience stays step 8's).

### The contract test (E16)

Every step 2 entry (31) is flipped with its new reason: 27 to (a), and four keep a later step for their other half (manager-lines.ts and manager-candidate.ts step 4, teams-counts.ts and reviews/[id]/launch step 8). tools.ts (step 4) now says its team alignment is step 2's, done. Three files now touch less: reviews/[id]/route.ts and reviews/[id]/manager-review/route.ts read no line (profile only), app-floor-impact.server.ts reads its dotted lines through workspaceDottedLines (line only). The named readers step 2 replaced are dropped from "holds the plan's named readers", and a new list holds each replacement in the code (the LATERAL halves, reportsHereOf in rule 6, the Team pill and the badge, factsHere's seat line, lineAbove's seat line, workspaceDottedLines in the preview, reportsHereOf in both parity files, no account join left in either walk). **MERGED is [2]**; the done gate holds: no (b) entry names step 2.

Other source pins brought to the new code, each asserting the equivalent or more: agent-manager-reads.contract.test.ts (the preview's line, the two walks' halves, the pill and the badge), workspace-status.test.ts (inWorkspaceWhere: the calendar and teams-counts now call it once each, for the dotted half), kept-seats.test.ts (the level helpers' callers: manager-candidate.ts live 1, kept 1, seats 2; manager-lines.ts live 5, kept 1, seats 3; digest-recipients.ts seats 1).

### Postgres: the raw walks (read only, the local database)

Run through ~/workwrk-launch-backup/tools/q.mjs, SELECT and EXPLAIN only, with `PGOPTIONS="-c default_transaction_read_only=on"` (and `-c enable_seqscan=off` for the plans: the local tables are a few hundred rows, so unforced the planner reads them whole).
- **The shape runs.** PostgreSQL accepts the one reference to the recursive name joined to a LATERAL subquery whose UNION ALL halves read `t.id`: both walks, as Prisma sends them (seven parameters each), plan and execute. No fallback was needed.
- **The indexes.** EXPLAIN (ANALYZE, BUFFERS) of both walks rooted at the local manager with the largest team: the root by "User_pkey"; each step a Nested Loop over the WorkTable, the anchored half by a Bitmap Index Scan on "User_managerId_idx" (Index Cond `"managerId" = t.id`, the workspace as a filter), the membership half by an Index Scan on "OrganizationMembership_managerId_organizationId_idx" with both columns in the Index Cond, each person then by "User_pkey". team.ts 2.6 ms, reporting-line.ts 0.4 ms, 42 shared buffers each. The membership half of reportsHereOf (as Prisma shapes its relation filter) uses the same membership index; the dotted reads by workspace plan on an index over both columns (on the empty local table, the unique key).
- **The right tree, real data.** For each of the 17 managers with a line in the local data, the new team walk and step 1's give the same set (no membership holds a line locally yet).
- **The right tree, Pat's case.** The same statements run over Pat, Dana and Max given as CTEs that shadow the two tables in one SELECT (nothing written): in B, Dana's tree is {Ann, Dana, Pat} and Max's {Max, Rae}; in A, Max's is {Max, Pat, Zoe}; Dana has none in A; Sol, removed in B, is in nobody's B tree. Step 1's walk over the same rows gives Dana {Ann, Dana} and Max {Max, Pat} in B.
- **Cost.** One more indexed read per round of a walk (the membership half), probing by both columns of its index; the round count is unchanged. The step 2 reviewer's measurement on a 5,000-person workspace (the Risks line) still stands.

### Decisions made here (worst case first)

- **Each reader keeps its seat rule and changes only its line's source.** Worst case of tightening rules on the way: a deactivated report anchored here drops out of a walk on the deploy. Worst case of this: none found; the rules were tested per reader in phase 1.
- **managerCandidateIn reads kept seats and answers "inactive" for a seat deactivated here (E4).** Worst case: a check without `live` (send-invitation, users POST before the lock, checkManagerCandidate) accepts Rita, deactivated here, and the locked live check or the acceptance (managerOnAccept) refuses her, as for a deactivated manager anchored here today.
- **The reviews' unused account lines are dropped rather than read at the seat.** Worst case of keeping them: the cycle GET sends Pat's A manager's id to B's client.
- **The team/alignment drill reads its manager at the seat here.** Worst case of leaving it: a drill into a manager here through a membership is a 404 while their team here is now read.

### Tests

- New: workspace-lines-reads.test.ts 18; report-tree-seat.test.ts 7 (the line here, three walks, plus the double's self-test); one each in calendar/events/route.test.ts, app-floor-impact-agent.test.ts and send-reminders/route.test.ts. **28 new tests, 27 fail on step 1's code** (22991ade in a scratch copy, this step's tests put in): all 18 of workspace-lines-reads, 6 of 7 in report-tree-seat (the double's self-test passes by design), and the three single ones. Of the 20 changed test files, 32 tests fail on step 1's code (agent-manager-reads 3, workspace-lines 1, manager-lines 6, digest-recipients-seat 2, digest-recipients 1, membership 3, workspace-status 1, kept-seats 5, weekly-review-agent 1, the contract 2, person-access-anchor 1, process-run-access 1, report-tree-seat's earlier 5) plus the reminders double's 2 membership cases and goal-rights 5 (their doubles now hold the lines here); handover.server, send-invitation and users route pass on both (their doubles only learned the new reads' shapes).
- Changed tests, no assertion weakened: the lines of membership people moved from their account onto their membership in every fixture that meant "their manager here" (and the account now names another workspace's manager, so a read of the account fails the test); dotted fixtures name their workspace; the doubles learned reportsHereOf's two halves; the source pins above.
- Every test related to a changed source (`vitest related` over the 24 changed sources): 273 files, 3,380 tests, all pass. The touched folders (src/lib, src/app/api/calendar, email, reviews, weekly-reviews, users, people, team, the team pages, scripts): 736 files, 11,104 tests, all pass.
- Type check clean, run twice at the end. ESLint on every touched file: no new problem; the 4 errors and 2 warnings left (calendar/events' accessLevel read, send-reminders' two `any` and two unused `subject`) are on 22991ade too, on no line this step wrote. `node scripts/check-schema-sql.mjs` passes.

### Left for later steps

- **Step 4 (must ship with this).** The handover plans from the lines here (lineFactsAround) but still writes the account's line (`tx.user.updateMany({ where: { managerId: id, id: { in } } })`): a membership report here is planned to move and nothing is written for them, and a report whose B line and A line both name the leaver would have A's line moved by B's handover. moveLinesHere replaces both writes. The same for moveAgentReports, the stale clears (staleLinesOf), handoverReportCount and pendingHandover's report count, which read account lines.
- **Step 3.** The surfaces: users/[id] GET, record-access, members-list, directory-list, my-team, users/export, /api/users, the dotted-lines GET, api/ai, team/members-work's Reports to filter, reviews/[id]/peers (which passes the subject's account line to peerCandidateWhere).
- **Not in this step's list, for the final sweep.** The Apps page preview lists people anchored here only (its lines are now this workspace's, its people are not); a Sub-teams row names a membership manager's job title only when the account's is this workspace's (the membership's own title is not read there).

### Deploy notes (step 2, in the one merge of steps 1 to 4)

No SQL to apply, no schema change, no environment flag. Nothing is written differently by this step's code. What customers notice comes with steps 1 to 4 together (the draft notes above), and from this step:
1. **Trees, reach and counts follow each workspace's own Reports to and dotted lines:** a manager's team, Teams counts and the Team calendar pill, the Sub-teams and Alignment pages, the weekly-review queue, the digests and the monthly evaluation reminder, the reviewer of a review, the approver of a timesheet, rule 6's count (who can be made an Agent), the unattended handover's recipient, the Apps page's manager floor and the nightly parity job.
2. **B can make Max an Agent when nobody reports to him in B**, whoever reports to him elsewhere.
3. **A manager deactivated here through their membership is refused as deactivated** ("That person is deactivated..."), no longer "isn't in this workspace".
4. **A Reports to edit is checked for a loop in this workspace only**, so B is never refused because of how A is organised.

## Step 2, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step2-review.md: no high and no medium findings. The lows are fixed or noted as the coordinator ruled. Same branch, still not committed. **No SQL.**

### L2: an invitation under a manager deactivated here is refused at send time

- sendInvitation (src/lib/people/send-invitation.server.ts) now asks `managerCandidateIn(orgId, managerId, { live: true })`. A manager this workspace deactivated is refused before anything is written: 400, `manager_inactive`, "That person is deactivated, and a deactivated person can't have reports. Reactivate them first, or pick someone else." This is the sentence PATCH Reports to and bulk update already use. It covers someone anchored here, and someone here through a membership (E4).
- Before: a membership manager deactivated here was "That manager isn't in this workspace" (step 1), or after step 2 was stored. A deactivated manager anchored here was stored too. Either way, the acceptance (managerOnAccept, live) then dropped the manager without telling anyone, and the new person joined under nobody.
- An HR label (On leave) is a live seat and passes, as at acceptance.
- Test: send-invitation.server.test.ts "refuses a manager deactivated here, in words, and makes no invitation": Rita (membership, deactivated here) and Dee (anchored here, deactivated) are each refused with no invitation made, and both pass once on leave. It fails on step 1's code.

### L3 and L6: the switch tests tell the rows apart

- workspace-lines-reads.test.ts has a new helper, `patSwitchesToB(stale)`. It runs the real swap, checks that the account now holds B's line (Dana) and A's membership holds A's (Max), then gives Pat's stale B membership row another manager.
- So a reader that took the stale row, or that took the account in A, answers wrong:
  - effectiveManagerOf, with stale Lee: B answers Dana, A answers Max.
  - reportCountOf, with stale Kai (who works in B): B counts 0 for Kai and 1 for Dana.
  - unattendedRecipient and digestManagersOf, with stale Lee: Dana in B and Max in A, the digest now checked in both workspaces after the switch (L6).
  - wouldLoopIn and lineAbove, with stale Lee: Lee reporting to Pat in B closes no loop, Dana does, and in A the walk is Pat then Max.

### L4: the report-tree double checks the bound values

- report-tree-seat.test.ts's double maps every placeholder to the text before it:
  - each `"organizationId" =` or `<>` must hold the walk's workspace, in both halves and the root;
  - each id or `"userId" =` must hold the root;
  - the depth cap must be a number;
  - any other placeholder is refused.
- New test: team.ts's statement with the membership half's workspace bound to the root, or `<>` bound to another workspace, is refused; the right bindings walk to Dana's B tree. It tests the double itself, so it passes on step 1's code as well, by design.

### L5: the Apps preview's mocks check their arguments

- app-floor-impact-agent.test.ts now answers each read only when it is asked what the preview must ask:
  - the anchored read: `{ organizationId, deletedAt: null, status: "ACTIVE" }`;
  - the memberships: exactly `membershipHereWhere("org", "active")`;
  - the dotted statement: as Postgres receives it (raw fragments inline), naming `d."organizationId"` in both halves, every bound value this workspace.
- New test, "asks for active seats here and this workspace's dotted lines, nothing wider", asserts each argument. It fails on step 1's code.

### L8: the handover double holds the two lines apart

- handover.server.test.ts's double now keeps the membership's line here (`st.memberLine`) apart from the account's (`st.managers`).
- Its `user.updateMany` writes only the rows whose account line still names the leaver, as Postgres would.
- Where a test's report works here through a membership, its line here is on the membership and its account names the client workspace's manager (Cleo). Where the test means "the same manager in both workspaces" (a1 under the Agent Sam), both name Sam.
- Four tests now hold step 4's pairings and are marked `it.fails`, each with a note naming step 4:
  - "moves a report who last switched to another workspace" (pairing 1a): the plan reads r1's membership line, and the account write lands nowhere;
  - "the handover still moves a report anchored elsewhere whose line no other workspace relies on" (1a);
  - "counts that report as pending before a deactivation" (pairing 2: handoverReportCount counts account lines);
  - new: "never moves the account's line of a report here through a membership, whose line in their own workspace names the leaver too" (1b: today B's handover rewrites the client workspace's line).
- Each was run once as a plain `it` (in a throwaway copy, since deleted) and fails for exactly that reason. Step 4 must turn each into `it`; vitest fails an `it.fails` that starts passing.
- None was deleted. The other 48 handover tests pass as before.

### Notes

- **L7.** memberManagersOf is kept, now commented as a guard only. No production path reaches it (effectiveManagersOf answers every live membership first). It is the one digest read that also refuses an account ended where it is anchored (D12), which effectiveManagersOf does not check. Deleting it means moving its tests onto the real effectiveManagersOf, which is left to the final review.
- **L1.** Noted under step 9: measure the walk through a manager anchored elsewhere at 5,000 people, and add "User"("managerId", "organizationId") in a later SQL file only if it is slow.
- The review's **"For step 4 (pairings)"** list is copied under step 4 above, with file:line, and with the `it.fails` tests that hold pairings 1 and 2. Its step 3 partners are copied under step 3, and the dotted-lines PUT's filter at 138 under step 5.

### Files

Changed in this pass: src/lib/people/send-invitation.server.ts, src/lib/access/digest-recipients.ts (the guard comment), docs/plans/workspace-status-2.md (steps 3, 4, 5 and 9, this section). Tests changed or added: send-invitation.server.test.ts (1 new), workspace-lines-reads.test.ts (the four switch cases), report-tree-seat.test.ts (1 new), app-floor-impact-agent.test.ts (1 new), handover.server.test.ts (the double, 3 marked `it.fails`, 1 new `it.fails`).

### Tests

- The touched files plus src/app/api/invitations and src/lib/agents (sendInvitation's callers): 74 files, 1,825 tests, all pass.
- Every test related to a changed source (`vitest related` over the 25 changed sources): 273 files, 3,384 tests, all pass.
- Against step 1's sources: the new L2 and L5 tests fail. workspace-lines-reads still fails 18 of 18. The L4 test of the double passes there by design.
- Type check clean, run twice with the 6 GB heap.
- ESLint on this pass's files: no new problem. The 5 errors in send-invitation.server.ts (accessLevel at 181, 184, 233, 256 and 273) are on 22991ade too, at 173, 176, 225, 248 and 265, on no line this pass wrote.

### Deploy notes, added to step 2's

5. **An invitation can no longer name a deactivated manager as Reports to.** Before, it was sent, and the person joined with no manager.

## Step 3, built

Branch `workspace-status-2` in ~/theywrk-launch, on 5a7e9c57 (steps 1 and 2 committed on main f16c2220), not committed. **No SQL, no schema change, no flag.** It ships only in the one merge of steps 1 to 4.

### The rule

Every surface that shows a manager line shows THIS workspace's, through the reads steps 1 and 2 built (acting-workspace.ts, profile-here.ts), never a rule of its own:
- **the manager** is the line the person's seat here holds: User.managerId for someone anchored here, the membership's own managerId for someone here through one (personSeatIn, seatsHeldFor, linesHereOf), never the anchored workspace's own stale row and never the account's line read for a membership person;
- **the dotted lines** are the rows whose organizationId is this workspace;
- **the reports** are reportsHereOf's (both halves, kept seats), never the cross-workspace `directReports` relation or its `_count`;
- a manager, dotted manager or report is **named only while they hold a kept seat here** (namedHere, managersWithSeatHere), as phase 1 does;
- who may see a name is unchanged: the card's names are every Member's, a Guest gets no reports and no Directory, people data stays with its readers.

named-here.ts keeps only its seat filter (E6): the record's `managerElsewhere` and `dottedElsewhere` are gone, and manager-lines.ts recordLinesOfOthers, their only source, is deleted.

### Each surface: before, now, test

Tests are in src/lib/people/workspace-lines-surfaces.test.ts (new, 21 tests) unless another file is named. The case: Pat anchored at A under Max, working at B through a membership under Dana; a dotted line to Kai in A and to Lee in B. Max contracts for B as a Manager under Dana, where Bea reports to him; in A, Max reports to Ada and Kai reports to Max. Kai works in B through a membership with no line there. Abe reports to Pat in A, Zoe in B; Lee reports to Dana in B. Every surface is read in B and in A, and most again after Pat switches into B (the real swap, her stale B row then naming Lee, which no reader may take).

- **The person record, GET /api/users/[id]** (users/[id]/route.ts).
  - Before: for someone anchored here, the account's line, every workspace's dotted rows (with batch 7's `dottedElsewhere` count and `managerElsewhere` flag) and the `directReports` relation filtered to seats here; for a membership person, the account's line (A's), no dotted lines, and the `directReports` relation. So Pat's B record named Max, and Dana's B record listed Lee only.
  - Now: the anchored card reads its manager relation (the account's line is this workspace's) and `dottedLineToManagers` with `where: { organizationId }`; membershipRecord reads the manager its membership's line names, this workspace's dotted rows and, for both kinds, the reports here (reportRowsHere: reportsHereOf, then the rows in name order). A membership person's record now lists their dotted-line managers here. No elsewhere field is answered.
  - Tests: "names Dana, Lee and Zoe on Pat's record in B, and Max, Kai and Abe in A"; "lists each manager's reports here" (Dana: Lee, Max, Pat in B; Max: Bea in B, Kai and Pat in A); "says nothing about another workspace's line (E6)"; "holds both workspaces' lines after Pat switches into B, never the stale row"; "a viewer who may not read people data reads the same card and no more; a Guest no reports". users/[id]/route.test.ts: the two batch 7 GET tests now hold the new rule ("names nobody of another workspace, and says nothing about a line there"; "reads this workspace's dotted lines", which asserts the card's `where` and no `directReports` in its select).
- **The dotted lines, GET /api/users/[id]/dotted-lines.**
  - Before: anchored subjects only (a 404 for Pat in B), every workspace's rows by person, othersDottedLines' filter and a `keptElsewhere` count. After the SQL a line held in both workspaces listed its manager twice, and a line held only in A whose manager has a seat in B was listed in B.
  - Now: a subject of either kind (personSeatIn), the rows `where: { userId, organizationId }`, each named while its manager holds a kept seat here, and no count. The PUT is unchanged (step 4).
  - Tests: "answers this workspace's rows, for someone here through a membership too, and counts none of another's"; "after Pat switches into B, B never lists A's line to Kai, who has a seat in B". dotted-lines/route.test.ts: its double now answers rows by workspace and the seat read; "GET reads this workspace's rows only, and counts none of another workspace's" replaces "GET answers the count too".
- **Who can see this record, GET /api/users/[id]/record-access.**
  - Before: the walk climbed the account's line and listed every workspace's dotted rows to people with a seat here. In B it named Max (to whom B's engine, viewer.ts reportTree, gives no reach), left out Dana, and listed A's Kai.
  - Now: the subject's line from personSeatIn, each manager up the line by linesHereOf (their seat here), and this workspace's dotted rows. The groups mirror the engine again.
  - Tests: "walks the line here and lists this workspace's dotted lines, as the engine reads them" (B: Dana, Lee; A: Max then Ada, Kai); "after Pat switches, each workspace still walks its own line". record-access/seat.test.ts: Pat's B line moved onto her membership in the fixture (her account names Ned, A's).
- **My team, GET /api/my-team.**
  - Before: each member's managerId, and so directReportIds, from the account's line, while teamIds came from the walk here. Dana's My team in B filed Pat under Max and listed only Lee as a direct report.
  - Now: seatsHeldFor gives each member's level and line here in one read; a manager id only while they hold a seat here.
  - Test: "files Pat and Max under Dana in B, and Pat and Kai under Max in A".
- **Members** (members-list.server.ts).
  - Before: the row's manager from the account's manager relation (a membership person's account line, A's), and No manager for a membership person by the account's line.
  - Now: the line each row's seat here holds (the membership's `managerId` for a membership person), named from one read of the shown managers; No manager reads the same lines.
  - Tests: "names each row's manager here, and No manager reads the same lines"; "after Pat switches, A names her A line and B her B line". members-list.test.ts: Pat's B line set on her membership in the two cases that meant "her manager here".
- **The Directory and the Org chart** (directory-list.server.ts).
  - Before: the row's managerId and manager from the account's line; Reports to by the account's line for both halves; No manager for a membership person by the account's line; report counts from `_count.directReports` (every account line naming them, in any workspace) for people anchored here and reportsHere (account lines) for membership people; the sort by reports in the database by that count; the chart's managerId from the account's line and its dotted ids from every workspace's rows.
  - Now: DirectorySeat carries the membership's line; each row and the chart name the line its seat here holds; Reports to is the account's line for the anchored half and the membership's for the membership half; reportsHere is reportsHereOf for every row; a sort by reports is always made in memory (orderedInMemory), since no database order can count the reports here; the chart's dotted ids are this workspace's rows. The Org chart's client loop check (org-tree.tsx) walks these lines, so it now walks this workspace's.
  - Tests: "each row names its manager here and counts its reports here"; "Reports to, No manager and the sort by reports read the lines here"; "the chart draws each person under their manager here, with this workspace's dotted lines"; "after Pat switches, each workspace still draws its own line". directory-seat.test.ts: its dotted rows name B, as every dotted row does since step 1.
- **The Directory's export, GET /api/users/export.** Before: Reports to from the account's manager relation. Now: the line each row's seat here holds, named with one read per batch. Test: "writes each row's Reports to here".
- **The people list, GET /api/users.** Before: managerId and manager from the account's line; `_count.directReports` from the relation for people anchored here, account lines for membership people; a sort by managerId read the account's line for membership people. Now: the line each seat here holds, names from one read, every row's reports here (reportsHere), and seatKey reads the membership's line. Test: "answers each person's manager and report count here" (with the sort by manager).
- **Peer suggestions, GET /api/reviews/[id]/peers.** Before: "Their manager", "Same manager", "Reports to them" and "Same department" from the subject's account line and department, so Pat's B review suggested Bea (Max's report) and never Dana or Lee. Now: the subject's line here (linesHereOf) and placement here (seatPlacementsHere); the pool is still people anchored here by their own lines (review-cycle.server.ts). Test: "suggests the people around Pat's line here".
- **The Owner snapshot, POST /api/ai.** Before: "Reports: N" from `_count.directReports`, every workspace. Now: reportsHereOf over the snapshot's people. Test: "counts each person's reports here" (the model double hands back its prompt).
- **My team's table, GET /api/team/members-work.** Before: Reports to by the account's line for both halves (step 6 said so). Now: the anchored half by the account's line, the membership half by the membership's. Test: "the Reports to filter reads each seat's line here".

### The contract test (E16)

Every step 3 entry is flipped with its new reason: ten to (a); users/[id]/route.ts stays (b) for step 4 (PATCH, the clears) and step 5 with "GET ... (step 3, done)"; users/[id]/dotted-lines/route.ts stays (b) step 4 for its PUT, its GET marked done. **MERGED is [2, 3]**; the done gate holds. "Holds the plan's named readers" drops the two step 3 reads it pinned (members-list's account line, the dotted-lines GET by person) and pins the PUT's keep list for step 4 instead. A new test, "holds step 3's surfaces at the line here", pins each replacing read in the code (reportsHereOf, the membership's line, the dotted rows by workspace, linesHereOf up the line, seatsHeldFor, reportsHere for every row, the in-memory Reports to, the export's and the list's lines, the peers' and the snapshot's reads, the members-work filter) and that the reads they replaced are gone (`directReports` selects, recordLinesOfOthers, the elsewhere fields, `next = m.managerId`, the account line on memberships).

Other source pins brought to the new code: kept-seats.test.ts (my-team now `seats: 1`, through seatsHeldFor; manager-lines.ts `live: 4`, recordLinesOfOthers gone). manager-lines.test.ts drops its two recordLinesOfOthers assertions (the function is deleted; managerLineIsOthers keeps its own, step 4's). named-here.test.ts holds the seat filter and that nothing about another workspace's line is answered; dottedElsewhereWords stays for the PUT's count until step 4.

No `it.fails` test is made to pass by this step: the four in handover.server.test.ts are step 4's and still fail as marked.

### Decisions made here (worst case first)

- **A record of someone here through a membership lists their dotted lines here.** Worst case of leaving them out: B's record shows no dotted manager while B's engine gives Lee reach over Pat. The card is every Member's, as for someone anchored here.
- **The Directory's sort by reports is always made in memory.** Worst case of the database order: Dana, with three reports here through memberships, sorts below someone with one account line in another workspace. Cost: every matching person's key and one reportsHereOf over their ids, as the other in-memory orders read.
- **A dotted line to an Agent here is listed on the record** (it is this workspace's own row now). Before, batch 7 left out such a line when another workspace relied on it, because the PUT kept it. Until step 4 retires the PUT's keep list, Edit details could offer to take off such a B row and the PUT keep it; step 4 ships in the same merge (pairing 10).
- **recordLinesOfOthers is deleted now, not in step 4**: its only caller was the record GET.

### Left for later steps

- **Step 4.** The dotted-lines PUT's keep list (othersDottedLines) and its `keptElsewhere`; dottedElsewhereWords (named-here.ts) and the client words fed by them: person-record.tsx's "Reports to someone in another workspace" and "N lines kept" branches (the GET no longer sends either field, so they never show) and edit-details-dialog.tsx's managerElsewhere and dottedKept; managerLineIsOthers and PATCH's 409.
- **Step 5.** A membership person's record still sends no weekly hours, working week or profile fields (E8), and access.dottedLines is false for them.
- **For the final sweep.** No manager for someone anchored here still filters `managerId: null` (Members, the Directory), so an anchored account whose line names someone with no seat here shows Nobody but is not listed; E11 (ii) clears such lines on the deploy. The peer pool is people anchored here, so a manager here through a membership is never suggested as "Their manager".

### Files

Changed sources (13): src/app/api/ai/route.ts, src/app/api/my-team/route.ts, src/app/api/reviews/[id]/peers/route.ts, src/app/api/team/members-work/route.ts, src/app/api/users/[id]/dotted-lines/route.ts, src/app/api/users/[id]/record-access/route.ts, src/app/api/users/[id]/route.ts, src/app/api/users/export/route.ts, src/app/api/users/route.ts, src/lib/access/manager-lines.ts, src/lib/access/members-list.server.ts, src/lib/people/directory-list.server.ts, src/lib/people/named-here.ts.
Test double: src/lib/access/seat-test-db.ts (a review's `subject`).
New test: src/lib/people/workspace-lines-surfaces.test.ts.
Tests changed (10, no assertion weakened: fixtures that meant "their manager here" now hold the line on the membership, with the account naming another workspace's manager, so a read of the account fails them; the batch 7 tests hold E6's rule): users/[id]/route.test.ts, users/[id]/seat.test.ts, users/[id]/dotted-lines/route.test.ts, users/[id]/record-access/seat.test.ts, kept-seats.test.ts, manager-lines.test.ts, members-list.test.ts, workspace-lines.contract.test.ts, directory-seat.test.ts, named-here.test.ts.

### Tests

- New: workspace-lines-surfaces.test.ts 21, and the contract test's "holds step 3's surfaces" 1. **Against 5a7e9c57's sources** (the 13 changed sources put back in place, this step's tests and test double kept, then restored and checked identical): **all 21 of workspace-lines-surfaces fail**, each on an assertion (Max named for Pat in B, Dana's reports Lee only, the 404 for a membership subject, the A row listed in B, Bea suggested as a peer, Reports: 1). Of the changed test files, **12 tests fail** there: named-here 2, record-access seat 1, members-list 2, users/[id] route 2, users/[id] seat 2, kept-seats 1, the contract 1, dotted-lines 1. directory-seat and manager-lines pass on both (a fixture's workspace; deleted assertions). 33 in all.
- Every test related to a changed source (`vitest related` over the 13 sources and the double): 265 files, 3,344 tests, all pass. The touched folders (src/lib/access, src/lib/people, src/app/api/users, my-team, reviews, team, ai): 151 files, 2,413 tests, all pass. Every test file that names a changed file (the source pins): 75 files, 986 tests, all pass.
- Type check clean, run twice on the final code (6 GB heap). ESLint on every touched file: no new problem; the 8 errors and 1 warning in src/app/api/ai/route.ts (`any`, an unused `req`) are on 5a7e9c57 too, 8 lines earlier, on no line this step wrote. `node scripts/check-schema-sql.mjs` passes.

### Deploy notes (step 3, in the one merge of steps 1 to 4)

No SQL to apply, no schema change, no environment flag. What customers notice, with steps 1 to 4 together:
1. **Every screen that shows who someone reports to shows this workspace's line**: the person's record, Members, the Directory and its export, the Org chart, My team and its table, Who can see this record, the people lists behind the pickers, the peer suggestions of a review and the Owner's Ask AI snapshot. Someone who works here through another workspace shows the manager, dotted-line managers and reports they have here, before and after they switch.
2. **Report counts count the people who report to someone here**, people here through a membership included, and never the people who report to them in another workspace. The Directory's sort by reports follows.
3. **The record no longer says "Reports to someone in another workspace" or "N lines kept for another workspace"**: no other workspace's line is read there.
4. **A record of someone here through a membership lists their dotted-line managers here**, and their dotted lines can be read here (Edit details offers them from step 5).
5. **Who can see this record names the managers this workspace's lines give reach**, the same people the access engine lets in.

## Step 3, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step3-review.md: no high and no medium findings. The lows are fixed or noted as the coordinator ruled. Same branch, still not committed. **No SQL.**

### L1: the anchored record's report exclusion is held by a behaviour test

- In workspace-lines-surfaces.test.ts, "lists each manager's reports here" now gives Bea (anchored in B, her account line naming Max, B's) an A membership with line Ada, and Zoe (anchored in B, her account line naming Pat) an A membership with no line there. Max's A record must stay Kai and Pat, and Pat's A record Abe.
- On 5a7e9c57 those two A assertions fail on their own (the test's B half removed for the check): Max's A record answers Bea, Kai and Pat, and Pat's Abe and Zoe. The old anchored record read the `directReports` relation and named everyone with a seat in A, so a B colleague whose own line names Max was listed as his A report.
- The comments are corrected: before, Max's reports in B were Bea, Kai and Pat (not "none"); Zoe was left out of Pat's A record only because she held no seat in A.

### L4: /api/users counts KRA assignments where it did before

`_count: { select: { kraAssignments: !directoryCard } }`, as before step 3: never for the directory card. No caller needs it now. (A scope=directory request is answered by directoryList before this select, so it is never left empty.)

### L5: the kept-seat rule on every surface that names a manager or counts reports

- New describe in workspace-lines-surfaces.test.ts, "the kept-seat rule on every surface that names a manager or counts reports". It reads Bea's manager, Pat's manager and Dana's reports in B on the record, Members, the Directory, the export and /api/users.
  - "names a manager deactivated here, and one on leave, and counts a deactivated report": B deactivates Max through his membership and Dana goes on leave. Max is still named as Bea's manager on all five, Dana as Pat's on all five, and Dana still counts Max among her three reports (the record, the Directory's count, /api/users's count).
  - "never names or counts a manager this workspace removed": Max's B membership removed. Bea has no manager on any of the five, and Dana counts two.
- A switch to live seats fails the first test. Each switch was made once in place and taken back (git checkout of the untouched file): managersWithSeatHere reading live seats (profile-here.ts), and reportsHereOf defaulting to "live" (acting-workspace.ts). A switch to active seats fails it on Dana's leave.

### Notes

- **L2, for the final sweep.** "Who can see this record" names a manager deactivated here, to whom the engine gives no reach: record-access/route.ts 57 (the chain) and 67 (the dotted lines) read `inWorkspaceWhere(..., { deactivatedToo: true })`. B deactivated Rita through her membership, and Pat's B line or a B dotted line names her: the panel lists Rita among those who can read Pat's people data, which her B seat cannot (D12; countedDottedManagerIds reads live levels). Nothing leaks, and it predates step 3 (batch 5). Smallest fix: still walk through a deactivated manager to the people above, but leave them out of `chain`, and read the dotted managers at live seats.
- **L3, under step 9.** The Directory's sort by reports at 5,000 people, now in memory for every query: added to step 9's list above.
- **The review's "For step 4"** (8 items, with file:line) is copied under step 4 above, after the step 2 pairings. Item 7 lists the client code no source feeds any more (person-record.tsx, edit-details-dialog.tsx, named-here.ts dottedElsewhereWords, `dottedKept`), since the contract test skips client files.

### Files

Changed in this pass: src/app/api/users/route.ts (L4), src/lib/people/workspace-lines-surfaces.test.ts (L1, L5), docs/plans/workspace-status-2.md (step 4's list, step 9's measure, this section).

### Tests

- workspace-lines-surfaces.test.ts: 23 tests (21 before, plus L5's 2), all pass. Against 5a7e9c57's sources (the 13 step 3 sources put back in place, the tests kept, then restored and checked identical): all 23 fail, and L1's A assertions fail on their own as above.
- Every test related to src/app/api/users/route.ts: 4 files, 64 tests, all pass. The touched folders (src/lib/people, src/lib/access, src/app/api/users): 135 files, 2,206 tests, all pass.
- Type check clean, run twice with the 6 GB heap. ESLint on this pass's files: no problem.

## Step 4, built

Branch `workspace-status-2` in ~/theywrk-launch, on b011482e (steps 1 to 3 committed on main f16c2220), not committed. **No SQL, no schema change, no flag.** With this step, steps 1 to 4 are whole and ship together, in one merge, never apart.

### The rule

Every write of a manager line writes THIS workspace's line, through src/lib/access/seat-writes.ts, under E4 and E5:
- **the solid line** on the row that holds the seat here (writeLineHere: the account for someone anchored here, the membership otherwise; moveLinesHere for the handover and the Agent move, each row conditioned on still naming the leaver here);
- **the dotted lines** of this workspace only (writeDottedHere replaces this workspace's rows with the body; removeDottedHere takes off this workspace's rows of given pairs);
- **a new or changed line** needs a manager with a live seat here, not on the Agent tier here, not the person, closing no loop here (managerCandidateIn with `live`, wouldLoopIn and lineAbove at the seat, peopleBelow over this workspace's lines);
- **another workspace's line is never read, kept, asked about, moved or cleared** here (E6): every line is one workspace's row since E1 and E2.

A deadlock Postgres breaks (40P01, Prisma's P2034) on any role-locked writer is the same 503 roles_busy "try again" as a busy lock, never a 500 (the step 1 review L5): `rolesBusyAnswer` (org-roles-busy.ts) answers it, so every route that answers OrgRolesBusy answers it too (users/[id] PATCH and DELETE, dotted-lines PUT, bulk-update, the handover POST, agent-reports POST, users POST, settings/ownership, settings/members/bulk, set-owner, scim-reactivate); SCIM's deprovision (`retryable`) and the join (accept-invite) answer it on their own paths.

### Each writer: before, now, test

Tests named here are in src/lib/people/workspace-lines-writes.test.ts (new, 15 tests, on the in-memory database through the real routes, the real handover and the real SCIM paths) unless another file is named. The case: Pat anchored at A under Max, at B through a membership under Dana; Max contracts for B under Dana; Kai anchored at A under Dana there (Dana holds a seat in A) and under Dana in B; Lee anchored at B under Dana, at A under Max; Rita anchored at A, live there, deactivated by B through her membership; Ada anchored at A (a Manager there) and an Agent in B, with Zoe (anchored B) and Cy (anchored A, under Ada there) still listed under her in B; Ari owns A, Bo owns B.

- **PATCH Reports to, users/[id]/route.ts.**
  - Before: `data.managerId = next`, written with the account's columns (`tx.user.update`), and the 409 `manager_elsewhere` when the account's line named an Agent here, or someone with no level here, who managed the person in another workspace (managerLineIsOthers), confirmed by `replaceOtherWorkspaceLine`.
  - Now: the line is held apart (`lineNext`), checked against the line the seat here holds (`target.seat.managerId`), and written by writeLineHere on the seat as read (seatRefOf), after the person's row lock and the sameSeat check, under the role lock with managerCandidateIn (live) and wouldLoopIn. False is the 409 seat_changed. No 409 manager_elsewhere; `replaceOtherWorkspaceLine` is taken out of the body and ignored for one release (an older tab still sends it). Anchored people only for now: a membership person's Reports to is still refused with PROFILE_ELSEWHERE (step 5 opens it).
  - Tests: "replaces Pat's A line off an Agent in A who manages her in B, with no question" (and B's edit of Lee's B line leaves her A line); "a deadlock Postgres breaks under the person's lock is the 503 roles_busy"; users/[id]/route.test.ts "PATCH writes the line here with no question, and nothing about another workspace", "ignores the confirmation an older tab still sends", "writes the new line at once" (an Agent here who manages elsewhere), "answers a deadlock Postgres broke as the same 503 roles_busy".
- **Bulk change manager, people/bulk-update/route.ts.**
  - Before: one `tx.user.updateMany({ where: { id: { in: go } }, data: { managerId } })`, no workspace and no person lock, so someone who switched between the read and the write had another workspace's line written (pairing 9).
  - Now: each person, in id order, through writeLineHere on the seat as read (anchored here), under the role lock after managerCandidateIn (live) and lineAbove; a row that no longer holds the seat writes nothing and the person is skipped. Department and office are unchanged (step 5).
  - Test: "skips Pat when she switched into B between the read and the write, and B's line stays" (the switch lands after the role lock, through the double's onCall).
- **The dotted-lines PUT, users/[id]/dotted-lines/route.ts.**
  - Before: the keep list (othersDottedLines, every workspace's rows by person), `checked` without the kept lines, a delete by `notIn` keep and upserts, and the `keptElsewhere` count. A B row to an Agent here, or to Rita (deactivated here, live in another workspace the person works in), could never be taken off in B.
  - Now: every named line is this workspace's and is checked (found with a kept seat here, no Agent, not below the person); under the role lock the Agent check again, and a NEW line (no row of this workspace yet) needs managerCandidateIn live (400 `manager_inactive`, the same sentence as PATCH); then writeDottedHere replaces this workspace's rows with the body on the seat as read (null is the 409 seat_changed). The answer is `{ managerIds }`, no count. The subject is still anchored here only, and the solid-line filter reads `subject.managerId` (step 5).
  - Tests: "takes Rita off Lee's B lines though she is live in A where Lee works, and Lee's A row stays"; "never makes a new line in B to Rita, whom B deactivated (E4)"; dotted-lines/route.test.ts "PUT replaces this workspace's dotted lines, and never another workspace's" (5: the rows replaced and the client's row kept, someone with no seat here refused, Rita taken off, a held row kept and a new one refused, a deadlock is the 503).
- **The handover, handover.server.ts.**
  - writeReportMoves. Before: `tx.user.updateMany({ where: { managerId: id, id: { in } } })` per move, so a report here through a membership was planned and never moved (pairing 1a), and a report whose account line (another workspace's) named the leaver too was rewritten (1b); then otherWorkspaceRows wrote the other workspace's Audit rows. Now: moveLinesHere (the reports locked in id order after the role lock; each half conditioned on still naming the leaver here), one audit row per report really moved, in this workspace only; `reportsRehomed` from what moved.
  - handoverReportCount and pendingHandover. Before: the account lines naming the leaver, kept with a seat here, minus those "relied on" elsewhere (pairing 2). Now: reportsHereOf (kept seats), every report here.
  - runHandover and previewReportHandover. Before: `leavesOnlyHere`, `keepRelied`, the leaver's ended state read under the lock, `stays`, `alsoElsewhere`, `accountEnded`, and the result's `reportsStaying`, `reportsAtAccountEnd`, `reportsAlsoElsewhere`. Now: one plan of this workspace's lines; the result is the tasks, the reports moved to the recipient, those rehomed and the containers.
  - Tests: handover.server.test.ts, its double now holding and writing each half (the account's line, `st.managers`; the membership's, `st.memberLine`; each written only as Postgres would; the person locks and this workspace's dotted rows apart from another's). The four `it.fails` of step 2 are plain `it` and pass ("moves a report who last switched to another workspace", "never moves the account's line of a report here through a membership...", "counts that report as pending before a deactivation", "the handover still moves a report anchored elsewhere whose line no other workspace relies on"); the two that asserted the account's write now assert the membership's write and that the account's line (the client workspace's) stays, which is stronger. New: "counts the reports whose line HERE names the leaver", "a handover moves every report here and writes nothing of another workspace" (3). Here: "the summary, the gate and the run count every report in B, and nobody's line in A", "moves Pat, Max, Kai and Lee in B to Bo, and Pat's, Kai's and Dana's lines in A stay", "a deadlock Postgres breaks in the move is the 503 roles_busy".
- **The handover route, users/[id]/handover/route.ts.** Before: the summary's reports from the account lines naming the leaver, then those with a seat here (pairing 3, the step 3 review item 1); POST and GET ?to= passed `leavesOnlyHere`; the log named reports "also elsewhere" and those waiting for the account's end. Now: the summary reads reportsHereOf (kept) then the names in name order; the run and the preview are this workspace's whatever the account does elsewhere; the log says what moved. `leavesOnlyHere` stays for the D17 note only ("Their other workspaces are not affected.", the summary's `alsoElsewhere` boolean). Tests: handover/route.test.ts "the summary's reports are the people whose line HERE names them", "answers the moves, and the user_handover row counts them in plain words", "runs the same handover for someone anchored here, whether or not their account keeps working elsewhere", "a deadlock Postgres broke is the same 503 roles_busy".
- **The Agent move, handover.server.ts agentPlanFor, previewAgentReports, moveAgentReports; users/[id]/agent-reports.** Before: the solid plan kept the reports another workspace relied on (`stays`), the dotted read was every workspace's rows to the Agent, the solid write the account's line and the dotted delete named no workspace (pairing 6, the step 3 review item 5). Now: every report here moves through moveLinesHere; the dotted read is this workspace's rows (the rows the Members drawer counts), taken off by removeDottedHere; no `stays`, and the log says what moved. Tests: "counts and moves Zoe and Cy in B and Pat's B dotted row, and leaves Cy's and Pat's lines in A"; handover.server.test.ts "an Agent's move here moves this workspace's lines only" (3); agent-reports/route.test.ts "logs what moved here, and says nothing about another workspace".
- **The stale-line check and its clears, manager-candidate.ts staleLinesOf; users/[id] restore and reactivation; scim-reactivate.ts.**
  - Before: the account's line and every workspace's dotted rows, a manager "relied on" elsewhere kept; the clears wrote the account (`managerId: null`) and deleted every workspace's rows of the pair (pairing 7, the step 3 review item 6). So B's restore of Pat could clear A's line and A's dotted copy, and never checked her B line.
  - Now: the line the seat here holds (personSeatIn, any state) and this workspace's dotted rows, each manager judged at their seat here: "removed" (their seat here removed, or their account), "inactive" (deactivated here or where anchored; solid only), "agent" (the tier here), "elsewhere" (no seat here; never named). The clears run once the seat is back: writeLineHere on the row that holds the seat NOW (a D6 restore may have moved the account here, E3 carrying the line) and removeDottedHere. The reactivation's clear moved after restoreSeat (before, it rode on the profile write before it).
  - Tests: B's restore, B's reactivation, B's identity provider reactivating Pat, and A's restore of Pat (A's stale dotted row goes, B's row of the same pair and B's line stay); users/[id]/seat-lines.test.ts (3 new: B's restore never clears A's line; a stale B line cleared on the membership with B's dotted row, A's line and row kept; a reactivation in B); person-access-anchor.test.ts "a restore or a reactivation checks this workspace's lines, each manager at their seat here" (5 new); users/[id]/route.test.ts, scim/v2/Users/seat.test.ts and scim/v2/Users/[id]/route.test.ts brought to the rule.
- **SCIM's deprovision, scim-deprovision.ts (E9 iii).** Before: moveReliedReportsAtEnd inside the end for D4, `leavesOnlyHere` passed to the handover, the row's "N of their reports also reported to them in another workspace" and "N direct reports stay". Now: the end writes the seat only; the handover after it is this workspace's (moveLinesHere). A pending row's `leavesOnlyHere` (old or new) is read for the words "in this workspace" only, never passed to the handover; a deadlock is a 503 the identity provider retries. Tests: "B's identity provider ends Dana in B: her B reports go to Bo, and Kai's A line to her stays"; "Max's D4 end in B, A suspended" (the handover and the removal, A's lines untouched); scim-deprovision.test.ts brought to the rule, with "a deadlock in the handover is the 503 the identity provider retries".
- **The deactivation and the removal, users/[id]/route.ts.** Before: moveReliedReportsAtEnd right before endSeat for D4, to `handoverTo`; the answer's `reportsAlsoElsewhere` and `reportsRehomed`; the log's "1 of their reports also reported to them in another workspace". Now: the gate under the lock counts every report here, the end writes the seat only, and `handoverTo` (body or query) is ignored for one release. Tests: users/[id]/route.test.ts "a deactivation and a removal move no line themselves" (5), "ignores a handoverTo from anyone"; users/[id]/seat.test.ts.
- **The signed-in join, auth/accept-invite (E10).** Before: no manager written on this path; GET named none to an existing account. Now: when the invitation names a manager, the role lock first, then managerOnAccept (live, never an Agent), never the person, never a loop here (wouldLoopIn); written onto the membership with the placement before the move (a revived seat takes it where the invitation names one that passed), so the swap hands it to the account and the membership left keeps its own workspace's line; GET names it to everyone. A deadlock is the busy answer. Tests: accept-invite/route.test.ts "POST signed in: the invitation's Reports to is their line here (E10)" (6: written under the role lock and handed to the account with Home Co keeping Max; named on /join; no line under an Agent or someone deactivated here; no line that closes a loop; a revived seat takes the invitation's manager).
- **The AI invitation card, agents/previews.ts (and tools.ts via it).** Before: a manager had to be anchored here with a live account; for an existing account none was stored or named. Now: managerCandidateIn at the seat here (live), for both; stored and named for an existing account too (its join writes it); INVITE_CARD.existingAccount no longer says the manager is not set. Test: previews.test.ts "checks the manager at the seat here, and stores and names it for someone who already uses WorkwrK".

### The step 2 review's pairings, each closed

1. writeReportMoves (handover.server.ts 345, 350): moveLinesHere. Held by the four former `it.fails` and "moves Pat, Max, Kai and Lee in B".
2. handoverReportCount and pendingHandover (819-852): reportsHereOf, every report here. Held by "counts that report as pending" and "the summary, the gate and the run".
3. The handover GET summary (handover/route.ts 236-244): reportsHereOf. Held by "the summary's reports are the people whose line HERE names them".
4. The relied-line machinery on pairs drawn from the lines here (reportsStayingWith, keepRelied, alsoElsewhere, lineStandingsElsewhere, otherWorkspaceRows): deleted. Held by "a handover moves every report here and writes nothing of another workspace" and the contract test's retired names.
5. moveReliedReportsAtEnd and SCIM's deprovision: deleted; SCIM's handover is this workspace's. Held by the SCIM tests and "Max's D4 end in B, A suspended".
6. agentPlanFor and moveAgentReports: this workspace's dotted read, moveLinesHere, removeDottedHere. Held by the Agent tests here and in handover.server.test.ts.
7. staleLinesOf and its clears (users/[id], scim-reactivate.ts): the seat's line and this workspace's rows, writeLineHere and removeDottedHere. Held by the restore and reactivation tests.
8. PATCH's 409 manager_elsewhere: deleted. Held by "replaces Pat's A line off an Agent in A" and users/[id]/route.test.ts.
9. bulk-update change_manager: writeLineHere per person. Held by "skips Pat when she switched into B".
10. The dotted-lines PUT's keep list: writeDottedHere, no keep list. The filter at 138 (`subject.managerId`) stays step 5's, as the plan says (the subject is anchored here only until then). Held by the dotted-line tests.
11. The signed-in join: the membership's line (E10). Held by the E10 tests.

### The step 3 review's items, each closed

1. The handover GET summary: pairing 3.
2. The deactivation and removal gate: pairing 2.
3. The dotted-lines PUT's keep list: pairing 10; othersDottedLines, `elsewhere`, `checked` and `keptElsewhere` gone; both "kept for another workspace" describes of dotted-lines/route.test.ts rewritten; Edit details' "N lines kept ... left as it is" removed with `dottedKept`; the org chart's picker (org-tree.tsx) needs nothing, since a save now does what it shows.
4. The 409 manager_elsewhere: pairing 8.
5. The Agent move's preview: pairing 6 (`stays` gone, this workspace's dotted rows counted).
6. The stale-line clears: pairing 7; seat-lines.test.ts "a line nobody relies on any more is cleared on a restore" rewritten to "a restore in B never clears A's line", with two new cases.
7. The client words with no source: person-record.tsx (`managerElsewhere`, `dottedElsewhere`, "Someone in another workspace"), edit-details-dialog.tsx (`managerElsewhere`, the "Change it anyway" ask, `dottedKept`, `keptElsewhere`, `replaceOtherWorkspaceLine`), named-here.ts dottedElsewhereWords and its named-here.test.ts case; and beyond the list, the same dead words in members-shared.tsx (the Transfer dialog's `alsoElsewhere`, `stays`, `accountEnded`, `handoverTo`), member-drawer.tsx (refusedSave's manager_elsewhere Retry, the Agent notice's `stays`) and remove-person-dialog.tsx (`handoverTo`, `reportsAlsoElsewhere`). named-here.test.ts now holds that none of those files names them.
8. The signed-in join: pairing 11.

### What E6 removed

- acting-workspace.ts: lineStandingsElsewhere, linesElsewhere, lineKey, StoredLine, LineThere.
- manager-lines.ts: othersDottedLines, dottedIsOthers, managerLineIsOthers, managerLineStanding, OthersManagerLine (recordLinesOfOthers went in step 3).
- handover.server.ts: keepRelied, reportsStayingWith, otherWorkspaceRows, MoveHow, moveReliedReportsAtEnd, followAccountEndLines, AccountEndLines, NOTHING_AT_END, the result's reportsStaying, reportsAtAccountEnd, reportsAlsoElsewhere, the preview's alsoElsewhere, stays and accountEnded, the Agent plan's stays; runHandover's `leavesOnlyHere`.
- users/[id]/route.ts: the 409 manager_elsewhere, NOTHING_MOVED, alsoElsewhereLogWords, endLines, the `handoverTo` read.
- handover/route.ts: alsoElsewhereSaid, atAccountEndSaid. agent-reports: the "N lines stay" words. scim-deprovision.ts: alsoElsewhereSaid, stayingSaid, endLines.
- reporting-lines.ts: planReportHandover's `stays`, linesStayNote, linesAlsoElsewhereNote, namesSaid, HandoverMoved's reportsAlsoElsewhere and reportsAtAccountEnd, refusedRemovalWords' `fullName` and its relied-line notes.
- named-here.ts dottedElsewhereWords; the client branches above.
- Tests of the deleted functions: acting-workspace.test.ts (the two linesElsewhere describes, 11 tests), seat-counts.test.ts (lineStandingsElsewhere at the seats, 3), manager-lines.test.ts (managerLineIsOthers, 2), reporting-lines.test.ts (linesStayNote, linesAlsoElsewhereNote and planReportHandover's stays, 5), handover.server.test.ts (moveReliedReportsAtEnd, 5; the batch 6 to 8 relied-line cases rewritten to the new rule), each replaced by a test that the function is gone.
- Kept, as E6 says: the D17 note "Their other workspaces are not affected." and the handover GET's `alsoElsewhere` boolean behind it (leaving-notes.ts), and leavesOnlyHere for it.

### The contract test (E16)

Every step 4 entry is flipped: ten to (a) (accept-invite, agent-reports, the handover route, acting-workspace.ts, manager-candidate.ts, manager-lines.ts, previews.ts, tools.ts, handover.server.ts, scim-reactivate.ts), and three keep step 5 for their other half (users/[id]/route.ts, users/[id]/dotted-lines/route.ts, people/bulk-update/route.ts). Writers: users/[id] is PATCH only, "step 5" (the profile's `update({ data: write })` and the profile fields' raw UPDATE; DELETE writes nothing itself any more); bulk-update "step 5"; the dotted-lines PUT and handover.server.ts write nothing themselves (they call seat-writes.ts); scim-reactivate.ts is "none" (its own write holds the push's names and address); accept-invite stays "made" (the membership made or revived with its line, E10). **MERGED is [2, 3, 4]**; the done gate holds. "Holds the plan's named readers" now pins step 5's named reads (the PUT's anchored subject and its `subject.managerId` filter, PATCH's PROFILE_ELSEWHERE). A new test, "holds step 4's writers on seat-writes.ts, and no relied-line machinery is left anywhere", pins each new write in the code with its count, that the writes they replaced are gone, and that none of the retired names (and no "manager_elsewhere" code) is left in any file of src/ or scripts/, client files included, comments aside.

Other source pins brought to the new code: agent-manager-reads.contract.test.ts (rewritten for the new rules: the line held apart and read at the seat, the join's role lock, the PUT's lock, the handover's plan and moves, "no end of a seat moves a line itself", the dialogs sending no `handoverTo`, the deadlock answer at rolesBusyAnswer, SCIM and the join), agent-tier.contract.test.ts (the preview's call), kept-seats.test.ts (manager-candidate.ts kept 1 seats 2; manager-lines.ts live 2; handover.server.ts asks no level helper).

### Decisions made here (worst case first)

- **A restore or a reactivation clears a line here to someone with no seat here ("elsewhere", never named), whoever they are elsewhere.** Worst case of keeping it: a line no reader here walks wakes up when that person joins this workspace, the E11 (ii) worst case. Since E1 the other workspace's line is its own row, so nothing of it is touched.
- **A new dotted line needs a live seat here; a line already held here is kept as it is** (E4; a deactivation keeps dotted lines). Worst case of checking every named line: a dotted line kept for a manager deactivated here blocks every save of the person's other lines. Worst case of checking none: B makes a new line to Rita, deactivated here.
- **The join writes no line that fails managerOnAccept or closes a loop, and joins anyway**, as the signed-out join drops a refused manager. A revived seat takes the invitation's manager where it names one that passed, and keeps its own line otherwise (as its placement does).
- **The AI invitation card checks the manager at the seat for both kinds of invitee, and stores it for an existing account**: its join writes it now (E10). Worst case of not storing it: the E10 worst case on the AI path.
- **`handoverTo` and `replaceOtherWorkspaceLine` are taken out of the body and ignored for one release**, not refused as unknown fields: a tab from before the deploy still sends them, and refusing would fail a deactivation or a Reports to edit with a 400.
- **A deadlock is answered as busy at rolesBusyAnswer, for every role-locked writer**, not only the line writes: each caller is one transaction (or one per person) that Postgres rolled back whole, so "nothing was written, try again" is true everywhere.
- **reportsRehomed is what moveLinesHere moved**, not what was planned: a report whose line here changed meanwhile is never named as moved.

### Tests

- New: workspace-lines-writes.test.ts 15. Added or renamed in existing files: 66, counted by title (users/[id] route 12; handover.server 11, the four turned green among them; accept-invite 6; person-access-anchor 6; handover route 5; dotted-lines route 5; scim-deprovision 4; agent-manager-reads 3; seat-lines 3; reporting-lines 2; and 1 each in named-here, previews, the contract, manager-lines, acting-workspace, users/[id] seat, agent-reports, scim Users/[id] and member-drawer-retry). 81 in all.
- **Against b011482e's sources** (a worktree of b011482e in the scratchpad, this step's 25 test files copied in, the test double unchanged): **129 of their 479 tests fail**, in 23 of the 25 files (record-write-queue.test.ts and seat-counts.test.ts pass: an example code changed, retired tests removed). Of the 81 tests this step added or renamed, **75 fail there**, each on an assertion or a removed export: all 15 of workspace-lines-writes, all 6 of the E10 join, the four former `it.fails`, every deadlock answer. The 6 that pass there are rewordings of earlier guards whose behaviour is unchanged ("a refused or busy deactivation writes nothing", "a removal refused under the lock writes nothing ...", "ignores the confirmation an older tab still sends", "clears a removed or deactivated manager who works here, by name", "when nothing moved, says only that they are still here and the reason", "hands over nothing for the last Owner, or when the lock is busy"). With the whole suite on b011482e's sources and these tests, every other file passes (951).
- Every test related to a changed source (`vitest related` over the 24 changed sources): 378 files, 5,499 tests, all pass. The touched folders (src/lib/access, people, agents, mcp; src/app/api/users, scim, auth, people; the Settings pages; src/components/people and settings; scim-deprovision): 245 files, 4,613 tests, all pass.
- The whole suite (`TZ=UTC npx vitest run`, as the gate runs it): 974 files, 13,840 tests, all pass on the second run (one test was removed after it, a duplicate GET guard in dotted-lines/route.test.ts). The first run had one wall-clock timeout, handover.server.test.ts's first test (its runHandover loads goal-source.server on first use: 1.7 s alone, on b011482e's code as on this step's), past its 5 seconds under the suite's load.
- Type check clean, run twice (6 GB heap). ESLint on every touched file: no problem. `node scripts/check-schema-sql.mjs` passes.

### Left for later steps and the final sweep

- **Step 5**: PATCH Reports to and the dotted-lines PUT for a subject here through a membership (writeLineHere's and writeDottedHere's membership branches; the PUT's filter by the seat's line, pairing 10); bulk-update's department, office and change manager for membership people.
- **For the final sweep**: the dotted-lines loop check (peopleBelow) runs before the role lock only, as before this step; two crossing dotted edits could still make a loop (the solid line's is re-run under the lock). The AI card's existing-account sentence still says department and office aren't set, which is true of what the card stores (D18 writes the invitation's placement on that join when it names one). handover.server.test.ts's first test leans on a 5-second timeout under load.

### Deploy notes (step 4, in the one merge of steps 1 to 4)

No SQL to apply, no schema change, no environment flag. What customers notice, with steps 1 to 4 together (the draft notes 1 to 7 above), and from this step:
1. **Changing who someone reports to, their dotted lines, a bulk change of managers, a handover, an Agent's "Move their reports" and SCIM's deprovision write this workspace's lines only.** A handover moves everyone who reports to the person here, people here through another workspace included, and nobody's line in another workspace.
2. **Deactivating or removing someone waits for every report here to be handed over**, and moves no line itself. Their team in another workspace stays with them there.
3. **"Changing who they report to here changes it there too", "N lines kept for another workspace", the Transfer and Remove dialogs' lines about reports who also report to them in another workspace, and the Members drawer's "stays listed under them" are gone.** An Agent's "Move their reports" moves every line here.
4. **A restore or a reactivation checks this workspace's lines**: a line to someone removed or deactivated here, on the Agent tier here, or with no seat here is cleared and logged (the last never named); another workspace's lines are never touched.
5. **A new dotted line needs someone active here.** A dotted line already held to someone deactivated here is kept.
6. **Someone who joins by invitation with an existing account lands under the invitation's Reports to** (when that manager may manage here), and /join names that manager. An AI teammate's invitation names and stores it too.
7. **A deadlock between two writers is "try again" (503), never "Something went wrong".**
8. A tab open from before the deploy still works: the two fields it may send (`handoverTo`, `replaceOtherWorkspaceLine`) are ignored.

## Step 4, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step4-review.md: no high finding, one medium, five lows, each fixed as the coordinator ruled. Same branch, still not committed. **No SQL.**

### M1: a seat that comes back by invitation keeps only the lines that still hold

- src/app/api/auth/accept-invite/route.ts, the signed-in join. The membership row here is read first; the role lock is taken when the invitation names a manager **or** such a row exists (a seat this workspace ended coming back, D13).
- After the upsert, on that revival, staleLinesOf (manager-candidate.ts) checks the line the seat holds now and this workspace's dotted rows, exactly as a restore and a reactivation do (E4). What fails is cleared on the membership: the solid line through writeLineHere on the row that holds the seat (read under the person's lock), the dotted rows through removeDottedHere. Then the swap (E3) hands the account what is left.
- Each clear writes the restore's reporting_line_changed row (clearedLineSentence, "Restored" for a removed seat, "Reactivated" for a deactivated one; actor the person; metadata `onJoin` and the reason), in the same transaction. After the commit, open reviews follow a cleared solid line to the first live Owner (followReportingLine), never failing the join.
- The check runs on every revival, not only when no invitation manager passed. A manager that passed is live by construction, so the solid answer is the same, and a stale dotted row is cleared either way.
- Tests: accept-invite/route.test.ts "POST signed in: a seat that comes back keeps only the lines that still hold (M1)" (3).
  - The worst case: B removed Pat under Dana, then removed Dana, then re-invited Pat with no Reports to. Pat comes back with no line, under the role lock, with both clear rows. Her stale B dotted row to an Agent goes; her home row and home line stay. Her reviews follow to the Owner.
  - The same with Dana deactivated (and Pat's seat deactivated, not removed: "Reactivated ... Dana Lee is deactivated").
  - An invitation manager that passes replaces the old line, and the stale dotted row still goes.

### The lows

- **L1** (handover.server.ts reportPlanFor; manager-lines.ts factsHere).
  - The comment now says what is true: lineFactsAround walks from the recipient, so every recipient with a kept seat here, of either kind, is in `people`.
  - A recipient absent from `people` takes no reports: the reports go up the line, as for an Agent or a deactivated recipient.
  - A recipient, or an up-line target, here through a membership whose account has ended where it is anchored (D12) is inactive. factsHere reads `inactive` as the seat deactivated or that account ended. reportPlanFor also reads the recipient's account, which covers a recipient who is also one of the reports.
  - Tests: handover.server.test.ts covers the race shape (a recipient with no seat here at the lock: the work still goes to them, the reports to boss) and the ended account (as the recipient, and as the leaver's manager on the walk up: the reports go past him to big).
- **L2.** accept-invite/route.test.ts "a seat here that comes back keeps its own line when the invitation names none, and it still holds". Pat comes back under Bo (live here) under the role lock, with no clear row and no `managerDropped`.
- **L3.** Nothing is dropped in silence now.
  - GET /join names no manager that the signed-in join would drop: the person themselves, or one who would close a loop here. This is the same pair of checks, for an existing account (`joinDropsManager`).
  - The POST answers `managerDropped: true` whenever the invitation named a manager the join did not write (an Agent or someone ended here, the person, a loop). Its user.joined Audit row says so in words, with the manager's id in `managerDropped`, so an Admin sets one in Members.
  - Tests: "says in the answer and the Audit log when the invitation's manager can't be written", and "/join never names a manager the join would drop".
- **L4** (users/[id]/dotted-lines/route.ts). Under the role lock every named manager's seat here is read again (liveHereAmong, kept seats, as the GET lists them). A held line's manager removed here between the first check and the lock is refused with "Someone in that list isn't in this workspace", and nothing is written. Test: dotted-lines/route.test.ts "refuses a held line whose manager was removed here between the first check and the lock" (the double now drops from a `deletedAt: null` read anyone removed after the first check).
- **L5** (person-access.server.ts). mayRemovePerson's doc loses its `handoverTo` clause. mayHandOverPerson's doc names what reads it now: the handover routes, and PATCH's and DELETE's handover_first words.

### Source pins

- agent-manager-reads.contract.test.ts: the signed-out join's `if (inv.managerId)` lock (one now), the signed-in join's `if (inv.managerId || held)` lock and its staleLinesOf; GET's `managerName: joinDropsManager ? null : placement.managerName`.
- workspace-lines.contract.test.ts: factsHere's `inactive: seat.deactivated || ended`, plus four new writes held by count (the join's writeLineHere and removeDottedHere, reportPlanFor's recipientInactive, the PUT's liveHereAmong under the lock).
- skills/return-paths.contract.test.ts: the join's answer line, now with `managerDropped`. The whole suite found it; `vitest related` does not pick it up.

### Tests

- New: 9 (accept-invite 6, handover.server 2, dotted-lines route 1).
- **Against the reviewed step 4** (a worktree of b011482e with step4.diff applied, this pass's five test files copied in, all five changed sources as reviewed): **all 9 new tests fail**, and so do the 4 changed source pins (13 of 129).
- Every test related to a changed source (`vitest related` over the 5 changed sources): 248 files, 3,194 tests, all pass.
- The touched folders (src/lib/access, people, agents, mcp; src/app/api/users, scim, auth, people, invitations; the Settings pages; src/components/people and settings; scim-deprovision): 246 files, 4,626 tests, all pass.
- The whole suite (`TZ=UTC npx vitest run`): 974 files, 13,849 tests, all pass.
- Type check clean, run twice on the final tree (6 GB heap). ESLint on every file of this pass: no problem. `node scripts/check-schema-sql.mjs` passes.

### Deploy notes, added to step 4's

9. **Someone who comes back to a seat here by invitation comes back only under lines that still hold.** A line to someone removed or deactivated here, on the Agent tier here, or with no seat here is cleared and logged, as on a restore.
10. **/join never promises a Reports to that the join will not write.** When the invitation's manager can't be written, the join says so in the Audit log, and an Admin sets one in Members.
11. **A handover never gives reports to someone who has no seat here at that moment, or whose account has ended**: they go up the line.
12. **A dotted-line save naming someone removed here a moment before is refused.** Reload, and the line is gone from the list.

## Step 5, built

Branch `workspace-status-2` in ~/theywrk-launch, on 1ee2f1a5 (steps 1 to 4 committed on main f16c2220), not committed. **No SQL, no schema change, no flag.** It ships in the one merge of steps 1 to 9.

### The rule

Someone who works here through a membership has their profile and lines here edited HERE, through the same doors and gates as someone anchored here, and every write lands on the row that holds their seat here (seat-writes.ts writeProfileHere, writeLineHere, writeDottedHere), never on the account and never on another workspace's row (E7):
- **The doors:** relationTo over this workspace's tree (Dana is Pat's chain in B through Pat's B line); canWritePersonGroup for "placement" and "reports-to", with chainWritesMembership; the role lock for any line; the person's row lock with the seat read again (sameSeat); staleTabRefusal.
- **Editable:** job title, department and office (this workspace's own rows), weekly hours, working week, profile fields (by this workspace's definitions, merged key by key on the membership), Reports to, dotted lines. Status and role as in phase 1.
- **Not editable here:** name, photo, phone and birthday, refused for everyone with SHARED_IDENTITY_REFUSAL (code identity_shared): the account's row, read by every workspace the person belongs to. Two step (account-wide), the join date (no write door for anyone), Admin scopes (read from the anchored row only, a known limit).
- **For someone anchored here** the profile goes through writeProfileHere too, on the account, so one function knows which row holds a seat's profile; the raw `UPDATE "User" SET "customFields"` merge is gone (writeProfileHere merges under the person's row lock).

### Each door: before, now, test

Tests are in src/lib/people/workspace-profile-writes.test.ts (new, 14 tests, on the in-memory database through the real routes) unless another file is named. The case: Pat anchored at A under Max, in A's Operations as an Analyst in A's London office on 40 hours, Monday to Friday, with A's badge, a dotted line to Ari in A; at B through a membership under Dana, in B's Delivery as a Developer in Leeds, with B's shirt size, a dotted line to Max in B (Max contracts for B). Her stale A membership row holds older A values. In B: Bo the Owner, Hana the People team, Dana and Kim Managers, Lee anchored in B under Dana with a dotted line to Max, Zed outside every chain. Every test of B's writes checks that Pat's account, her stale A row and her A dotted lines are exactly as before.

- **PATCH /api/users/[id], the profile.**
  - Before: for a membership person every field but status and role was a 403 `profile_elsewhere` (PROFILE_ELSEWHERE). For someone anchored here the placement and capacity columns rode in `data` (tx.user.update) and the profile fields in a raw UPDATE of "User".
  - Now: the profile is a ProfilePatch held apart from `data` (which holds the personal columns only) and written by writeProfileHere on the seat as read (seatRefOf(target)), after the person's row lock and sameSeat; false is the 409 seat_changed. A new job title seeds its KRAs and SOPs here (seedAlignmentForUser), compared with the job title the seat held (the membership's for a membership person). A removed seat is refused before anything, 409 `removed`, "They were removed from this workspace. Restore them first." (the status refusal's sentence). The answer for a membership person carries the placement and line their membership holds.
  - Tests: "job title, department and office: on her B membership, a new job title seeding B's KRAs and SOPs"; "weekly hours, working week and profile fields: on her B membership, the fields merged key by key"; "Bo and Dana edit her B profile and line through the same doors"; users/[id]/seat.test.ts "writes their department on their membership here, never the account" and "a deactivation writes only their membership here" (the answer names B's department, never A's).
- **PATCH, Reports to.** Before: refused for a membership person (PROFILE_ELSEWHERE, step 4's note). Now: writeLineHere on the seat as read for both kinds, under the role lock with managerCandidateIn (live) and wouldLoopIn, as step 4 built it. Test: "Reports to: her B line moves to Kim under the role lock, and A's line to Max stays" (the role lock before her row lock, the audit row in B, a loop refused).
- **PATCH, the shared identity.** Before: PROFILE_ELSEWHERE. Now: after the field whitelist (so a viewer who may not write a field gets the refusal anyone gets), any field outside SEAT_FIELDS (first and last name, phone, photo, birthday) is the 403 identity_shared with SHARED_IDENTITY_REFUSAL, nothing written, a mixed body refused whole. Tests: "name, photo, phone and birthday are refused with the shared-identity sentence, and nothing is written"; seat.test.ts "refuses their name, phone, photo and birthday with the shared-identity sentence, writing nothing".
- **The dotted-lines PUT** (the step 2 review, pairing 10). Before: the subject was anchored here only (a 404 for Pat in B), and the set left out `subject.managerId`, the account's line, so Max, Pat's A manager, was dropped from her B set. Now: the subject at their seat here (personSeatIn, not removed), the set leaving out the line that seat holds (`seat.managerId`), written by writeDottedHere on `seatRefOf(orgId, { id, organizationId: the account's })`. Test: "dotted lines: B's set is replaced, Max (her A manager) kept in it, her B manager left out, and A's row stays".
- **accessFor and the record (GET).** Before: for a membership person `editable: []`, `dottedLines: false`, and no weekly hours, working week or profile fields. Now: the same editable list as anyone's for this relation, without the shared identity (`SEAT_FIELDS`); `dottedLines` as anyone's; a new `profileData` flag, true for the readers of people data (the anchored record's equals `peopleData`). membershipRecord sends `weeklyCapacityHours`, `workSchedule`, `orgSchedule`, `defaultWeeklyHours` and `profileFields` from the membership to those readers only. `peopleData` stays false for a membership person: their phone, birthday, KPIs, reviews, skills and score are not this workspace's (a known limit). Tests: "the record sends B's weekly hours, working week and profile fields to readers, and Edit details and dotted lines to writers" (Hana writes; Max reads through a dotted line and writes nothing; Zed reads none of it); seat.test.ts "the record answers identity, role and status here, and nothing of A's profile".
- **person-fields.ts.** SEAT_FIELDS is every field but the personal and birthday groups; PROFILE_ELSEWHERE is deleted; bulkSkippedWords takes the skipped count only (its "their details here are read-only" words went with the cause). Tests: person-fields.test.ts "SEAT_FIELDS: what this workspace writes for someone here through a membership" (new) and "says how many a bulk change skipped, and why" (rewritten).
- **The screens, existing controls only (E8).**
  - The Members drawer: profileEditable is the People team's and Admins' right for everyone who works here; the PROFILE_ELSEWHERE line is now SHARED_IDENTITY_REFUSAL, under the email; Admin scopes stay hidden for a membership person. Test: member-drawer-retry.test.ts (the profileEditable describe, rewritten).
  - The record (person-record.tsx): the Weekly capacity, Work schedule and profile field rows show with `access.profileData` (falling back to `peopleData`); the PROFILE_ELSEWHERE line is SHARED_IDENTITY_REFUSAL (never to the person themselves); Edit details and its Dotted-line managers open from the server's `editable` and `dottedLines`; the "Ask your manager" caption for self no longer depends on the kind of seat.
  - The Directory (directory-list.server.ts): `canEdit` no longer excludes a membership person, so their row is editable and selectable for the bulk bar. Tests: "Members and the Directory show her B hours, and the Directory row is editable and selectable for HR"; directory-seat.test.ts and membership-profile.test.ts (canEdit true for an Admin).
  - Teams > Workload: `canEditCapacity` no longer requires a seat anchored here. Tests: "after Dana sets Pat's B hours, Workload shows them, Dana may edit them, and Max may not"; pickers-seat.test.ts "Teams > Workload shows Pat with B's hours" (canEditCapacity true for Dana).
- **Bulk update** (people/bulk-update, E10).
  - Before: the selection read anchored here only; department and office one `user.updateMany` with no workspace and no lock; membership people skipped and counted as `skippedElsewhere`.
  - Now: the selection at kept seats in two halves (people anchored here; memberships here, membershipHereWhere "kept"), each with the workspace its account was anchored in when read. Change department and change office: each allowed person in id order through writeProfileHere, in one transaction (LOCKED_TX; a deadlock is the busy 503); a seat that changed writes nothing and the person is skipped. Change manager: writeLineHere on each person's own seat. Add tag: both kinds (a tag assignment is this workspace's row). Assign KRA and assign SOP: people anchored here only (a membership person's KRAs and SOPs here are the plan's known limit, and the notice they send carries no workspace), the rest counted as skipped. `skippedElsewhere` is 0, kept in the answer for one release; the Directory's and Members' toasts no longer read it.
  - Tests: "bulk change department, office and manager write her B membership, and her A values and line stay" (and a manager's bulk reaches their chain only); "a bulk change skips Pat when she switches into B as her row lock is taken, and writes Lee"; people/bulk-update/skipped.test.ts (2: both kinds moved, a removed membership skipped).
- **SCIM Groups (E9 ii).** New leaf src/lib/scim-groups.ts: groupMembersHere, groupMemberCountHere, addToGroupHere, removeFromGroupHere, replaceGroupHere.
  - Before: a group's members were `department.members` (accounts anchored here, removed ones included); add, remove and replace wrote `user.updateMany({ organizationId })`, so a membership person was never placed, listed or counted.
  - Now: both halves at kept seats (the account's department where anchored here, the membership's otherwise), each write under the person's row lock through writeProfileHere, a remove only while the person is still in that department here (a remove from a group they left since leaves their new department as it is). A seat removed here is neither listed, written nor counted, so a group's DELETE is not blocked by a removed person (their account's key clears on the delete, as the Settings delete rule says), and an identity provider never sees as a member someone it cannot take out. The 409's words lost an em dash: "Group has members. Remove them first."
  - Test: "SCIM Groups place her in B's Engineering on her B membership, list her, count her, take her out, and never touch A" (PATCH add with someone who holds no seat in B, GET, PATCH remove by filter and by value list, DELETE refused, PUT replace, POST with members).
- **A teammate's working days** (connector-tools.ts find_free_time). Before: the account's working week. Now: capacityHereOf, the working week the person gives this workspace. No test of its own: connector-tools.test.ts's database double has no User model, so the read falls back to the workspace's week on both codes, as before; capacityHereOf is tested in seated-here.test.ts.
- **The AI invitation card** for an existing account (step 4's note): INVITE_CARD.existingAccount now says "They already use WorkwrK, so this invitation doesn't set their role, department, office, KRAs or SOPs. Once they join, set their role, department and office in Members: their role assigns its KRAs and SOPs." Before: "...aren't set when they join. Set them in Members afterwards.", whose second sentence was untrue for a membership person until this step. previews.test.ts and teammate-copy.test.ts pass unchanged (no manager named, no dashes).
- **Phase 1's live proof** (scripts/live-proof-workspace-status.ts, step 5 of that proof): Ada's write of Pat's weekly hours in A now lands on A's membership with the account (B's) unchanged, and Ada's write of Pat's name is the 403 identity_shared; before, the proof expected the 403 profile_elsewhere. Type checked, not run (it loads .env).

### The contract test (E16)

- Flipped to (a), each with its reason: users/[id]/route.ts, users/[id]/dotted-lines/route.ts, people/bulk-update/route.ts (now touches the line only: its profile writes are writeProfileHere's), team/workload/route.ts, person-fields.ts.
- No longer found (they touch nothing now, so they left the list): scim/v2/Groups/route.ts and Groups/[id]/route.ts (their reads and writes are scim-groups.ts's), connector-tools.ts (capacityHereOf). New: src/lib/scim-groups.ts, (a).
- WRITERS: bulk-update and the two Groups routes write nothing themselves; users/[id] PATCH is "none" (its `update({ data: write })` holds the personal columns only).
- **MERGED is [2, 3, 4, 5]**; the done gate holds: no (b) entry and no writer names step 2, 3, 4 or 5. "Holds the plan's named readers" drops its three step 5 pins (the reads they held are gone). Step 4's pins of the dotted-lines PUT and bulk change_manager follow their new arguments. New test, "holds step 5's doors at the seat here, and PROFILE_ELSEWHERE is gone everywhere": each new door by count (writeProfileHere in PATCH, bulk and SCIM; the identity refusal; the editable filter; the record's profile data; the PUT's seat and filter; the bulk halves; the Workload door; capacityHereOf in connector-tools; SEAT_FIELDS' rule), the replaced reads and writes gone, and no PROFILE_ELSEWHERE, "profile_elsewhere" or "read-only while they are working in another workspace" in any file of src/, client files included.
- **The list now: 152 files** (138 in src/, 13 in scripts/, 1 in prisma/): 79 touch the line, 17 the dotted lines, 100 the profile. (a) 95, (b) 35 (all step 8), (c) 22. **21 writers**: none 8, proof 6, made 4, key 1, seat 1, moved 1.

### Decisions made here (worst case first)

- **The shared identity is refused on a membership seat for everyone, the person included.** Worst case of letting the person through: a write from this workspace lands on the account, which the brief forbids, and their session here is the rare stale one (they act where they are anchored). Worst case of refusing: they change their name in their own workspace's profile.
- **The check comes after the field whitelist.** Worst case of before: Max (chain-view) asking for Pat's name gets "shared with another workspace" while for Lee he gets "You can't change: first name"; the brief wants the same refusals.
- **A removed seat's profile and line are refused in words (409 `removed`).** Worst case of writing: B's department lands on an ended seat and comes back with a restore nobody chose; for someone anchored here, the old code did exactly that. Worst case of the old seat_changed: "Their status here changed a moment ago" for someone removed a year ago.
- **`peopleData` stays false for a membership person, with a new `profileData` flag.** Worst case of `peopleData: true`: the record opens the KRAs, Goals, Reviews and Assets tabs, Working on and the score for data this workspace does not hold of them (the known limit), each empty or wrong.
- **SCIM Groups read and write kept seats only.** Worst case of listing removed people as before: they cannot be written now (seat-writes.ts writes no removed seat), so an identity provider's remove never takes effect and it loops. Worst case of this: a removed person keeps their department on the ended seat and is listed again after a restore.
- **Bulk department and office: one transaction, people in id order.** Worst case of one transaction per person: 2,000 commits for one click, and a failure halfway answers an error after half the people moved. Worst case of one: it holds up to 2,000 row locks for the length of the writes (inside LOCKED_TX's 10 seconds).
- **Bulk Assign KRA and Assign SOP stay with people anchored here.** Worst case of widening: a KRA notice, which carries no workspace, reaches Pat in A naming B's KRA, and her B KRAs are a known limit on her record. Neither action has a client today (the Directory and Members offer department and tags).
- **Add tag reaches both kinds.** Worst case of not: the Directory's bulk Add tag, now offered on Pat's row, skips her as "not yours to change".

### Tests

- New: workspace-profile-writes.test.ts 14; person-fields.test.ts 1; the contract's "holds step 5's doors" 1; users/[id]/seat.test.ts 1; people/bulk-update/skipped.test.ts 1. **18 new tests; 17 fail on step 4's code** (a worktree of 1ee2f1a5 in the scratchpad, this step's 10 test files and the test double copied in): all 14 of workspace-profile-writes and the other new four but one. The one that passes there is skipped.test.ts "skips someone this workspace removed through their membership", a guard (step 4 skipped every membership person).
- Changed (15 tests in 9 files, no assertion weakened: each that pinned the old refusal now pins the new rule, and each "nothing of A's" check is kept or made stronger): users/[id]/seat.test.ts 3, the contract 4, member-drawer-retry 3, skipped.test.ts 1, person-fields 1, directory-seat 1, membership-profile 1, pickers-seat 1. **12 of them fail on step 4's code**; the three that pass there are rewordings of guards ("says how many a bulk change skipped", the drawer's "says what is true now") and the contract's "holds the plan's named readers", whose step 5 pins were taken out.
- In all, **29 of the 33 new and changed tests fail on 1ee2f1a5**, each on an assertion (a 403 profile_elsewhere, a 404 for a membership subject, Pat skipped by bulk and SCIM, canEdit and canEditCapacity false, an editable list of nothing).
- The test double (seat-test-db.ts): a department's createdAt and updatedAt on a create, as Postgres and Prisma fill them (a SCIM Group answers both).
- Every test related to a changed source (`vitest related` over the 19 changed sources): 272 files, 4,656 tests, all pass. The touched folders and every test file that pins a changed file by path (src/lib/access, people, agents, automation, browser, connectors, mcp, oauth, skills; src/app/api/users, people, scim, team, auth, agents, conversations, sidekick, teammate-skills; the People and Settings pages; src/components; scripts): 424 files, 7,022 tests, all pass. The whole suite (`TZ=UTC npx vitest run`, as the gate runs it): 975 files, 13,867 tests, all pass.
- Type check clean, run twice (6 GB heap). ESLint on every touched file: no problem. `node scripts/check-schema-sql.mjs` passes.

### Left for later steps and the final sweep

- A membership person's raw employment status (Probation, Notice period) on their record is shown to Admins, the People team and themselves only (phase 1's rule), while a chain manager who reads people data sees it for someone anchored here. Their KPI history, reviews, skills, KRAs, tags on the record and Admin scopes stay out (known limits).
- Bulk Assign KRA and Assign SOP skip membership people (above); their toast words, if a client ever offers them, would say "not yours to change".
- The SCIM Users manager attribute is step 7's (scim/v2/Users/[id] "none" until then).

### Deploy notes (step 5, in the one merge)

No SQL to apply, no schema change, no environment flag. What customers notice, from the deploy on:
1. **People who work here through another workspace are edited here by the same people as anyone** (Owners, Admins, the People team, the org-wide levels and their managers here): job title, department, office, weekly hours, working week, profile fields, Reports to and dotted lines, in the Members drawer, Edit details on their record, the Directory and its bulk bar, the Org chart and Teams > Workload. Every change is this workspace's only. "Their job title, department and other details here are read-only while they are working in another workspace" is gone; their record and the Members drawer say once that their name, sign-in address, phone, photo and birthday are theirs.
2. **A new job title assigns its KRAs and published SOPs here**, for them as for anyone.
3. **Their record shows the weekly hours, working week and profile fields this workspace holds of them** to the people who read people data here.
4. **Bulk Change department, Change office, Change manager and Add tag reach them**, and the toast no longer says anyone was skipped for working in another workspace.
5. **SCIM Groups place them in this workspace's department**, list them as members and count them before a delete. Someone removed here is no longer listed as a group member and no longer blocks a group's delete.
6. **An edit of the profile or Reports to of someone removed here is refused**: "They were removed from this workspace. Restore them first." Before, for someone anchored here, it was written onto the ended seat.
7. **An AI teammate's invitation card for someone who already uses WorkwrK** says the invitation doesn't set their role, department, office, KRAs or SOPs, and where to set them once they join.
8. **An AI teammate's free-time search** uses the working week the person gives this workspace.

## Step 5, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step5-review.md: no high finding, two medium, five low, each fixed as the coordinator ruled. Same branch, still not committed. **No SQL, no schema change, no flag.**

### M1, ruling (b): no KRA or SOP is assigned here to someone who works here from another workspace's account

- **PATCH /api/users/[id].** A new job title seeds its KRAs and SOPs (seedAlignmentForUser) for a seat anchored here only, as the bulk update already did. For a membership person the job title, department and office are written and nothing is seeded; the answer carries `alignmentNote`, ALIGNMENT_NOT_HERE (person-fields.ts): "KRAs and SOPs are not assigned to people who work here from another workspace's account." The Members drawer and Edit details show that note as a toast when the save answers it (no new surface).
- **Why** (the review's worst case): a KRA or SOP assignment names no workspace, and its readers (users/[id]/kpis, me/kras, kpi-records/self-report, reviews/[id]/self-assessment, the kra-assignments weight total, me/sops' open count) read every row of the person's. A row B made for Pat showed and counted in A (Max's KPI recorder, her My KRAs, her self-reports, her A weight total, her A self-assessment) while B's own record of her showed none.
- **Every other door that can make a KRA or SOP assignment, checked:**
  - POST /api/sop-assignments: **could make one for a membership person** (its ids go through employedAmong, which accepts a live membership here), with its notice and email reaching the account. Now any membership person named by id refuses the whole request, 400 `alignment_elsewhere` with the sentence and the ids, nothing written (the process assign dialog shows the sentence). By department or "everyone" it reads people anchored here only (step 8's).
  - POST /api/kra-assignments and POST /api/users/[id]/seed-alignment: read people anchored here only, so they never made one; a membership person was "User not found" while B's pickers offer them. Now the same sentence, 400; someone with no seat here is still a 404.
  - The bulk update's assign_kra and assign_sop: anchored only since step 5, the rest counted as skipped (no client offers them).
  - seedKraToRoleHolders (POST and PUT /api/kras, Ask AI's create_kra, the Tuesday template): a job title's holders anchored here only (step 8's E15 widening meets the same readers and must keep membership people out until the next step).
  - accept-invite's seedRoleDefinition (a brand new account only), users POST (an account made here), role-defaults.ts's backfill (people anchored here): none reaches a membership person.
  - The AI and MCP tools and the automations: none writes a KRA or SOP assignment (their only reads are the person's own).
- **A known limit**, in the Risks list and E7: a membership person's KRAs, SOP assignments, KPI history, reviews and skills here. **The next step: KRAs, KPIs, reviews and skills per workspace, with those readers filtered by the workspace they are read in.**
- E7's text and step 5's list now say this. The AI invitation card no longer promises KRAs (L4 below).
- Tests (src/lib/people/workspace-profile-writes.test.ts, on the real seed): "B gives Pat a new job title: it is saved, nothing is assigned, the answer says so, and A's My KRAs shows nothing of B's" (and Lee, anchored here, gets the KRA and the SOP); "the SOP, KRA and seed doors refuse Pat with the same sentence, writing nothing, and still serve Lee". member-drawer-retry.test.ts "shows the server's note when a job title assigns no KRAs or SOPs".

### M2: the Settings deletes count the people placed there through a membership

- New `membershipsPlacedHere(organizationId, { departmentId } | { roleId } | { officeId })` in profile-here.ts: the kept memberships here of people anchored elsewhere that hold it. SCIM's groupMemberCountHere uses it for its membership half.
- DELETE /api/departments/[id] adds it to its count of current people anchored here, so "Move 1 person out of this department first." names Pat. Before, the department was deleted under her, leaving her membership a dead id.
- **The same miss elsewhere, found and fixed:** the office DELETE (DELETE /api/offices, "Cannot delete office with assigned members") and the job title DELETE (DELETE /api/roles/[id], "1 person holds this job title...") had it too; both now count membership holders.
- **Marks:** departments/[id] stays (a), with the reason it now has. offices/route.ts and roles/[id] stay (b) step 8, their listed counts still anchored only, their deletes noted as both halves. **lib/export/workspace-export.server.ts flips to (b) step 8**: its departments.csv member count is anchored only (the people.csv rows stay anchored, phase 1's decision). The listed counts of departments/route.ts, offices/route.ts and roles (b, step 8) are unchanged, so the Departments page can still offer Delete on a department only Pat holds, and the delete then refuses it in words.
- Tests: "the Settings deletes count her, as the SCIM Group delete does" (all three refused while she holds them, each goes through once B removes her); departments/[id]/route.test.ts "counts the people here through a membership placed in it as current people" (the mock checks the count's where).

### The lows

- **L1.** The person on their own membership seat (a stale session) asking for their name, phone, photo or birthday gets 409 `session_out_of_date`, "Your session is out of date, so nothing was saved. Refresh the page and try again.", never "only they can change them". Test: "L1: Pat changing her own name...".
- **L2.** Tests for PATCH's 409 `removed` (a department, a Reports to and weekly hours, on a removed anchored seat and on a removed membership, nothing written) and for SCIM Groups and a removed seat (not listed; an add is a no-op; the group deletes).
- **L3.** The record's Tags row shows with the profile data (`profileData`), and `access.tags` for a membership seat is anyone's rule (`relation !== "self" && writes`), so a tag the bulk bar put on Pat can be taken off on her record. The tag assignments API already served both kinds. Test: "L3: the record offers B's tags of Pat...".
- **L4.** The AI invitation card says "job title" (the Members row) and promises no KRAs: "They already use WorkwrK, so this invitation doesn't set their job title, department, office, KRAs or SOPs. Once they join, set their job title, department and office in Members."
- **L5.**
  - The bulk update's two batch transactions (placement, and change manager, which ran on Prisma's default 5 seconds) take BATCH_TX (org-roles-busy.ts: 20 seconds, as reanchorUser's, and 10 to start).
  - A busy lock, a deadlock or a transaction past its time (Prisma P2028, isTransactionTimeout) is the 503 roles_busy with Retry-After (retryAnswer, retryOrThrow). A timeout says "That took too long, so nothing was saved. Try again in a moment.". Before, a P2028 was a 500.
  - SCIM Groups' member writes, one small transaction per member, answer a busy lock, a deadlock or a timeout with the 503 an identity provider retries (groupWriteRetry), never a 500.
  - Step 9 now measures a bulk change of 2,000 at 5,000 people and a Group PUT of 5,000 members.
  - Test: "L5: a bulk batch past its time, and a deadlock in a SCIM Group write, are the 503 try again, writing nothing". agent-manager-reads.contract.test.ts pins the bulk route's two `BATCH_TX).catch(retryOrThrow)` and retryAnswer over rolesBusyAnswer.

### The contract test (E16)

Reasons updated for departments/[id], kra-assignments, sop-assignments, seed-alignment, profile-here, offices and roles/[id]. workspace-export.server.ts flipped to (b) step 8. The step 5 pin of scim-groups' membership reads follows membershipsPlacedHere. New test "holds the step 5 review's fixes in the code", which pins:
- PATCH's one seeding call, inside the anchored branch;
- the self words;
- the three doors' sentence;
- the three deletes' counts;
- the bulk and SCIM retry answers.

The list: **152 files**, (a) 94, (b) 36 (all step 8), (c) 22; 21 writers. MERGED stays [2, 3, 4, 5]; the done gate holds.

### Files

- Changed: src/app/api/users/[id]/route.ts, sop-assignments/route.ts, kra-assignments/route.ts, users/[id]/seed-alignment/route.ts, departments/[id]/route.ts, offices/route.ts, roles/[id]/route.ts, people/bulk-update/route.ts, scim/v2/Groups/route.ts and Groups/[id]/route.ts; src/lib/people/person-fields.ts, src/lib/access/profile-here.ts, org-roles-busy.ts, roles-busy.ts, src/lib/scim-groups.ts, src/lib/agents/teammate-copy.ts; src/components/people/person-record.tsx, edit-details-dialog.tsx; src/app/(dashboard)/settings/members/member-drawer.tsx; docs/plans/workspace-status-2.md (E7, step 5's list, step 9, the Risks list, this section).
- The test double (seat-test-db.ts): a department's, an office's and a job title's people (and sub-departments, KRAs) as list relations, `_count` in an `include`, and the batch form of $transaction.
- Tests: workspace-profile-writes.test.ts (the first test no longer expects a seed for Pat; 8 new), departments/[id]/route.test.ts (1 new, a membership count in its mock), member-drawer-retry.test.ts (1 new), the contract (1 new, reasons), agent-manager-reads.contract.test.ts (the bulk route's retry pin), users/[id]/route.test.ts (ALIGNMENT_NOT_HERE in its person-fields mock).

### Tests

- **New: 11.** workspace-profile-writes 8, departments/[id] route 1, member-drawer-retry 1, the contract 1.
- **On step 4's code** (a worktree of 1ee2f1a5, these test files and the double copied in): 10 of 11 fail. The one that passes is "L2: SCIM Groups neither list, write nor count a seat removed here", whose behaviour step 4 had too.
- **On the reviewed step 5 code:** the two L2 tests pass by design (they close test gaps, L2), and the other 9 fail on the behaviour each fix changes. This is read from the code: no copy of the reviewed tree was kept to run.
- Every test related to a changed source (`vitest related` over this pass's 20 sources): 376 files, 5,474 tests, all pass. The touched folders and every test that pins a changed file: 427 files, 7,048 tests, all pass.
- Type check clean, run twice (6 GB heap). ESLint on every touched file: no new problem. The 5 `no-explicit-any` errors in sop-assignments/route.ts are on 1ee2f1a5 too (the same 5, on lines this pass did not write). `node scripts/check-schema-sql.mjs` passes.

### Deploy notes, changed and added to step 5's

Note 2 of step 5's now reads: **A new job title assigns its KRAs and published SOPs here for people anchored here.** For someone who works here from another workspace's account, their job title is saved, and the Members drawer and Edit details say "KRAs and SOPs are not assigned to people who work here from another workspace's account."

And:

9. **An SOP can't be assigned by name to someone who works here from another workspace's account**, and a KRA, or "Seed from job title", answers the same sentence instead of "User not found". Before, the SOP was assigned (with its notice and email) and showed and counted in the workspace their account is in.
10. **A department, an office or a job title held by someone here through a membership can't be deleted** until they are moved; the delete says how many people hold it.
11. **Someone acting here from an out of date session** who changes their own name, phone, photo or birthday is told to refresh.
12. **Their record shows this workspace's tags of them**, and the people who may tag them can take a tag off.
13. **A large bulk change has 20 seconds**, and a bulk change or a SCIM Group write that runs out of time or meets a deadlock says "try again" (503), never "Something went wrong".

## Step 7, built

Branch `workspace-status-2` in ~/theywrk-launch, on 5213106a (steps 1 to 5 committed on main f16c2220), not committed. **No SQL, no schema change, no flag.** It ships in the one merge of steps 1 to 9.

### The rule

The enterprise extension's `manager` (`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`) on POST, PUT and PATCH of /api/scim/v2/Users is **this workspace's line** for the person, for someone anchored here and for someone here through a membership alike, and every resource SCIM answers names that line back. New leaf src/lib/scim-manager.ts holds the one write; the shapes are read in src/lib/scim-mappers.ts.

- **What the value is (decided here).** RFC 7643 4.3: `manager.value` is the `id` of the manager's SCIM resource. This service's SCIM ids are WorkwrK user ids (every resource it answers carries the account's id as `id`, and the identity provider links people by it), so the value is read as **the manager's WorkwrK id**. That is what Azure sends (it resolves the manager to the id this service returned when it provisioned them) and what Okta sends when its managerId holds that id. This service keeps no externalId: its list filter already answers `externalId` by the address, so **a value that is an address** (Okta's managerId often holds the manager's login) is read the same way, as the address of someone with a seat here (seated-here.ts personHereByEmail: any case; a live seat first, then one deactivated here, the step 7 review L7; within each, the account anchored here first). Anything else (an employee number) names nobody here and is refused in words.
- **Resolved at the manager's seat here**, under E4 and E5: a live seat here (managerCandidateIn with `live`: someone B deactivated through their membership is "deactivated", never "not here"), not on the Agent tier here, not the person, no loop in this workspace's lines (wouldLoopIn, lineAbove at each seat here).
- **The write.** Under this workspace's role lock, taken first, then the person's row lock, then the seat read under that lock (personSeatIn), then seat-writes.ts writeLineHere on the row that holds it: the account for someone anchored here, the membership for anyone else. Another workspace's line is never read or written: B's provider setting Pat's manager to Dana writes her B membership, and her A line to Max stays. A written line is logged as reporting_line_changed (actor "Identity provider", the old and new manager), and her open reviews follow it in the same transaction, to the first live Owner when no person acted (as SCIM's reactivation does).
- **A refused manager** writes nothing of the line, the rest of the request goes on (the names, a reactivation, a deprovision, the account POST makes), and one `reporting_line_refused` row in the Audit log says why in plain words: "The identity provider's manager for Pat Ng was not set: Ada Ng is an Agent here, and an Agent can't be anyone's manager. Their manager here is unchanged." Someone with no seat here is never named ("that manager isn't anyone who works in this workspace"). The reasons: not here, Agent, deactivated, the person themself, a loop, the person's own seat removed here. The row keeps the provider's value (up to 200 characters) and the reason in metadata, for its admin to fix the mapping. The type is filed under the Access tab, beside the line changes.
- **A `remove`, or a null.** A PATCH `remove` of the manager (any of its paths, whatever value it carries: a single-valued attribute is removed whole, RFC 7644 3.5.2.2), a replace with null or an empty value, or a PUT or POST whose extension says `manager: null`, clears this workspace's line under the same lock and logs it ("Cleared who Pat Ng reports to"). A line already empty is left alone.
- **GET answers** the line the seat here holds as the enterprise manager, `{ value: <the manager's SCIM id>, displayName }`, with the extension's URI in `schemas`, for GET by id, the address filter (both halves) and the unfiltered list, and in the answer of every PUT, PATCH and POST. The manager is named only while they hold a kept seat here (step 3's rule: a deactivated manager is named, a removed one or one with no seat here never); with none, the extension is left out.
- **The identity rule from phase 1 is unchanged** (shared-identity.ts): SCIM still never writes the name or address of an account another workspace shares, and a membership person's names and address are never written. Their manager here is written: it is this workspace's own.
- **Busy and deadlocks.** A busy role or seat lock, a deadlock Postgres broke (40P01) or a transaction past its time wrote nothing: the 503 an identity provider retries (scimManagerRetry over retryAnswer), never a 500.

### Each door: before, now, test

Tests are in src/app/api/scim/v2/Users/manager.test.ts (new, 26 tests, through the real routes on the in-memory database, with the real seat reads, manager checks and writes) unless another file is named. The case: Pat anchored at A under Max, at B through a membership (her B line set by B's provider to Dana); Max a Manager in B too, under Dana; Lee anchored in B under Dana; Ada anchored in A and an Agent in B; Rita anchored in A, live there, deactivated by B through her membership; Zed in A only; Ari owns A, Bo owns B.

- **PATCH /Users/[id].** Before: only `active`, `name.givenName`, `name.familyName` and `userName` were read, and `remove` was skipped. Now each operation is also read for the manager (managerAskOfOperation): `add` and `replace` by `urn:...:User:manager`, `urn:...:User:manager.value`, the bare `manager` and `manager.value`, the extension's own URI, or a value with no path (Okta's shape, read as a resource); `remove` clears it; the last operation that touches it decides. A manager alone is a write, so the "nothing to change" answer no longer swallows it.
  - Tests: "an Okta-shaped PATCH ... writes her B membership, under the role lock first" (A's line stays, the audit row in B only, her reviews follow to Bo, the role lock before her row lock in the log); "an Azure-shaped PATCH (the extension's path, a bare id) does the same, and so does the manager.value path"; "a manager named by address ... is found at their seat in B"; "A's identity provider sets Pat's A line, and B's line to Dana stays"; "a loop only across workspaces is no loop (E5): Max under Pat in B, though Pat reports to Max in A"; "the manager she already has, sent again, is no change: nothing written, nothing logged, and the answer names her".
- **PUT /Users/[id].** Before: name, userName, emails and active only. Now the extension's `manager` too (managerAskOfResource), in the same transaction as the fields for someone anchored here (the role lock taken first, then the person's lock as before), so a refused manager leaves the name change written and a deadlock writes neither. A PUT that leaves the manager out leaves the line as it is. A manager alone is no longer "No fields to update".
  - Tests: "an Azure-shaped PUT of the full resource writes her B line and never her names, which A shares"; "for someone anchored in B too: Lee's account line, with her name change in the same push"; "a replace with an empty manager.value, and a PUT with a null manager, clear it; a PUT that leaves the manager out keeps it".
- **Someone here through a membership (forMember).** Before: every field but `active` was answered as stored. Now their manager here is written (scimSetManager, its own transaction under the role lock): on its own, after a deprovision of their seat (never on an erased account), and inside a reactivation's transaction. Their names and address are still never written.
- **The reactivation (scim-reactivate.ts scimReactivateSeat)**, both doors and POST's revive: the push's manager is applied in the reactivation's transaction, after the stale-line clears (so a refused manager never leaves a stale line standing), on the row that holds the seat then (a D6 restore may have moved the account here). Test: "someone with no seat in B (Zed): never named, and the reactivation in the same push lands" (her line to Dana kept, one refusal row naming nobody).
- **POST /Users.** Before: the extension was ignored. Now a manager to set is written in the create's own transaction: the role lock first, then the seat lock bounded (so the role lock is never held through an unbounded wait, as SCIM's reactivation already does), the create, then the line through writeLineHere. A refused manager still makes the account, with its row; a busy lock or a deadlock makes nothing (503), so the provider's retry is a clean create, never a 409 for a half-made person. A clear on a new account asks nothing (it has no line). A revive of an ended seat takes whatever the push asks, in the reactivation's transaction. Tests: "makes the account under Dana here, with the role lock first and the seat lock bounded"; "still makes the account when the manager is refused, with its row"; "a revive of Pat's deactivated B seat takes the manager in the reactivation's transaction"; "a deadlock in POST makes no account".
- **GET /Users/[id] and the list.** Before: no manager in any resource. Now the line the seat here holds (the account's for someone anchored here, the membership's line for a membership person, read from `organizationMemberships` here in the filter's member half, never the account's line), named through managersShownHere (peopleHereAmong, kept seats, two reads at most per page). Tests: "shows Dana for Pat in B's SCIM and Max in A's, by id and by the address filter" (and A's unfiltered list); "names a manager only while they hold a seat here (never one with no seat, or a removed one), and leaves the extension out for someone with no manager".
- **Refusals.** Tests: "Rita, whom B deactivated through her membership: refused as deactivated, and Lee's name change lands"; "Ada, an Agent in B (a Manager in A): refused"; "a loop in B's lines: Dana under Pat while Pat is under Dana in B, and Dana's name change lands"; "the person themself, and a value that names nobody (an employee number)"; "the same refusal pushed again makes one row; after anyone changes the line, the next push logs again"; "a seat B removed takes no line, logged, and A's line stays".
- **A remove.** Test: "a PATCH remove of the extension's manager clears her B membership's line, and A's line to Max stays".
- **Busy, deadlocks, closed workspaces.** Tests: "a deadlock Postgres breaks under Pat's lock is the 503 the provider retries, with nothing written"; "a deadlock in an anchored person's push rolls back its fields too, so the retry writes them all"; "a suspended or cancelled workspace takes no manager (403), and a deprovision there drops it". An erased account's deprovision drops the manager with every other field.
- **The shapes** (src/lib/scim-mappers.test.ts, new, 8 tests): the complex attribute, a bare id, a list of one (older Azure), a number; null, empty and an empty list clear; a displayName alone asks nothing; the extension in any case and its flat forms; a PUT that leaves the manager out asks nothing; every PATCH path and verb, and every other operation left alone; the resource adds the extension and its schema only when there is a manager to name.
- **The Audit log tab** (src/lib/audit-families.ts): `reporting_line_refused` is in Access. Test: audit-families.test.ts "files a refused manager from the identity provider under Access, beside the line changes" (and its words, "Reporting line refused").

### The contract test (E16)

- New entries, both (a): src/app/api/scim/v2/Users/route.ts (the list names each person's line here; POST's manager through scim-manager.ts) and src/lib/scim-manager.ts (the line the seat here holds, written through writeLineHere under the role lock). scim-reactivate.ts's reason names the push's manager. The [id] route touches no line column itself (its manager is scim-manager.ts's), so it stays a writer of "none" only, its reason updated: its data holds the name, the address and the status only.
- **MERGED is [2, 3, 4, 5, 7]**; the done gate holds (step 7 had no (b) entry and no "step 7" writer left). MERGE_NEEDS still needs 8.
- New test, "holds step 7's manager attribute at the seat here, under the role lock": the one write (writeLineHere on the row read under the person's lock), the seat read, managerCandidateIn live, wouldLoopIn, scimSetManager's role lock, the kept-seat naming, the role lock before the person's lock in PUT and PATCH and in POST (with the seat lock bounded), the reactivation's call, the list's membership line, that no SCIM file writes a line itself, and that the shared identity is still dropped by both doors.
- The list: **154 files**, (a) 96, (b) 36 (all step 8), (c) 22; 21 writers.

### Decisions made here (worst case first)

- **The value is the manager's SCIM id (their WorkwrK id), or as a fallback their address.** Worst case of the id only: an Okta customer whose managerId holds logins gets every manager refused, and B's admins retype what their provider knows (E9's worst case of ignoring it). Worst case of the address fallback: two accounts share an address across workspaces and the one anchored here is taken, which is the rule every lookup by address here follows. Worst case of storing an externalId instead: a schema change and a migration for a value no provider is required to send.
- **A PUT that leaves the manager out keeps the line; a displayName with no value asks nothing.** Worst case of clearing: a provider that maps no manager, or only its name, takes every line here off at every push, the Admins' edits included. Worst case of keeping: a provider that drops a manager by leaving it out of a PUT leaves the old line; Azure sends a remove, any provider can send null, and an Admin can clear it.
- **The manager they already have, sent again, is no change**: nothing checked, written or logged, as PATCH /api/users/[id] keeps it. Worst case of re-checking: a manager deactivated since, or made an Agent from before rule 6, is refused and logged at every periodic push while the line stays anyway (the restore's and reactivation's stale checks own that line).
- **A refusal identical to the newest refusal logged for the person (the same value, the same reason and the same line here when it was logged, the step 7 review L1) is not logged again.** Worst case of a row per push: a provider with a scheduled full sync writes thousands of identical rows and buries the log. Worst case of this: two pushes in the same instant both log (harmless).
- **A refused manager never fails the request.** Worst case of failing it: the provider retries for ever and the names, the deactivation or the new account never land (an Okta push errors and the person is never provisioned).
- **POST writes the manager in the create's transaction, and the role lock is held only when a manager is asked.** Worst case of a second transaction after the create: a busy lock answers 503 after the account was made, the retry meets the 409 "already exists", and the manager never lands. Worst case of this: a create with a manager waits for the role lock (bounded, 3 seconds, then 503).
- **For a membership person the manager is its own transaction after the rest** (the deprovision, which has its own transactions); a 503 there is retried, and the retry finds the rest already done (a deprovision of an ended seat is a no-op). Worst case of folding it into the deprovision: the most intricate path in SCIM gains a second lock order.
- **The manager is written on a deactivated seat (a push with active:false and a manager), never on a removed one** (refused, logged), never in a suspended or cancelled workspace (403, a deprovision only) and never on an erased account. Same as PATCH /api/users/[id]: a deactivated person's line is kept and editable, a removed seat's is not.
- **A reactivation runs the stale-line clears first, then the provider's manager.** Worst case of skipping the clear when the push names a manager (as PATCH does): the provider's manager is refused and the stale line stays.
- **The resource carries `value` and `displayName`, no `$ref`**: RFC 7643 calls `$ref` recommended; Azure and Okta read `value`, and the mapper knows no base URL. A deactivated manager is named (the record names them, step 3), a removed one is not.

### Tests

- **New: 36.** manager.test.ts 26, scim-mappers.test.ts 8, the contract's step 7 test 1, audit-families.test.ts 1. **All 36 fail on 5213106a** (step 5's code exported to the scratchpad with `git archive`, these test files and the test double copied in), each on an assertion (a line not written, no audit row, no manager in a resource, 200 where 503 or 403 is due), and the mappers' on the missing exports; the anchored deadlock test meets the deadlock thrown as an error there (a 500). Changed: the contract's "lists each file" (its two new entries) fails there too; its other changes (reasons, MERGED) pass on both.
- The test double (seat-test-db.ts): an Audit log row's createdAt on a create (`@default(now())`), and a User's updatedAt on a create only (`@updatedAt`; never on a seed), as Prisma fills them.
- The SCIM tests (src/app/api/scim, scim-auth, scim-deprovision, scim-mappers): 9 files, 109 tests, all pass. With their neighbours (audit-families, src/lib/access, src/lib/people, src/app/api/users, auth, people, settings, src/lib/skills, src/lib/browser, and src/components/settings/settings-phase7.test.ts, which reads the audit words): 185 files, 3,057 tests, all pass. Every test related to a changed source (`vitest related` over the 7 changed sources, the test double included): 58 files, 625 tests, all pass.
- Type check clean, run twice (6 GB heap). ESLint on every touched file: no problem. `node scripts/check-schema-sql.mjs` passes.

### Files

- New: src/lib/scim-manager.ts. Tests: src/app/api/scim/v2/Users/manager.test.ts, src/lib/scim-mappers.test.ts.
- Changed: src/app/api/scim/v2/Users/route.ts, src/app/api/scim/v2/Users/[id]/route.ts, src/lib/scim-mappers.ts, src/lib/scim-reactivate.ts, src/lib/audit-families.ts; the test double src/lib/access/seat-test-db.ts; tests src/lib/access/workspace-lines.contract.test.ts, src/lib/audit-families.test.ts; this section.

### Left for later steps and the final sweep

- Step 9's live proof ("SCIM sets a manager in B") runs these routes on Postgres: a PATCH and a PUT of Pat in B, a refusal, a remove, and both workspaces' GET.
- No /Schemas or /ResourceTypes endpoint advertises the enterprise extension (none did before; Okta and Azure do not ask for them).
- The extension's other attributes (department, employeeNumber, organization, costCenter, division) are not read; department placement is SCIM Groups' (step 5). Dotted lines have no SCIM attribute and stay WorkwrK's to set.

### Deploy notes (step 7, in the one merge), for identity providers

No SQL to apply, no schema change, no environment flag. Rollback is the revert; the lines written meanwhile are ordinary lines, edited in WorkwrK as any.

What customers will notice, from the deploy on:
1. **An identity provider's manager attribute sets this workspace's Reports to**, for everyone it provisions here, people who work here from another workspace's account included. It never changes who they report to in another workspace, and never their name or sign-in address when another workspace shares the account.
2. **The provider's manager replaces an Admin's edit at its next push for that person**, as a provider does with the fields it owns (E9). A workspace that wants Reports to kept in WorkwrK unmaps the attribute in its provider.
3. **A manager that can't be set is left as it was and logged**: Settings, Audit log, Access tab, "Reporting line refused", with the reason in words (not in this workspace, deactivated here, an Agent, the person themself, a reporting loop, the person removed here). The rest of the push lands. Fix the person in WorkwrK or the mapping in the provider, then have the provider send the manager again: Entra does not resend an attribute that has not changed, so use Provision on demand for that person (or change their manager in Entra, or set it in WorkwrK); Okta sends it with the person's next profile push, or push the person from the app's Assignments. The same refusal pushed again is logged once, and again after anyone changes the line.
4. **Removing the manager in the provider clears this workspace's Reports to** (a PATCH remove, or a null). A PUT that leaves the manager out leaves it as it is.
5. **SCIM resources now carry the manager** in the enterprise extension (`manager.value` is the manager's SCIM id, with `displayName`), so a provider that compares before it pushes sees this workspace's line.

For each provider's admin:
- **Microsoft Entra ID (Azure AD).** The default mapping, manager to `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager`, works as it is for every change from the deploy on: Entra sends the id this service returned when it provisioned the manager, so the manager must be in the app's scope and provisioned here first (until then Entra sends no manager for the person, and sends it on a later cycle). Removing someone's manager in Entra sends a remove, which clears the line here. **After the deploy, restart provisioning once** (the app's Provisioning page, "Restart provisioning"): Entra has sent its manager updates all along, this service answered them 200 and ignored them, and Entra counts them as delivered, so without a restart the managers it already sent arrive only when someone's manager next changes in Entra. The restart's full cycle sends every person's manager again; expect one Audit log row per manager this workspace cannot take.
- **Okta.** In the app's attribute mappings (To App), map the enterprise extension's `manager.value` from an Okta attribute that holds either the manager's sign-in address in this workspace (their userName here) or their WorkwrK SCIM id (the `id` this service answers for them). A managerId that holds an employee number names nobody here and is refused, in words, in the Audit log. **Emptying someone's manager in Okta does not clear it here**: Okta's PUT leaves out an attribute with no value, and a PUT that leaves the manager out keeps the line (so a provider that does not map the manager never wipes the lines Admins set). To take someone's manager off, an Admin clears Reports to on their record in WorkwrK (or the Members drawer); Okta's next push leaves it empty. To be checked against a real Okta tenant in step 9's live proof.
- **Any other provider**: send `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` with `manager: { value }` on POST or PUT, or a PATCH on `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager` (or `...:manager.value`), the value being the manager's `id` from this service's SCIM resources or their address; `remove`, or null, to clear it.

## Step 7, review fixes

The review is ~/workwrk-launch-backup/agents/workspace-status-2/step7-review.md: no high finding, no medium, eight lows, each fixed as the coordinator ruled. Same branch, still not committed. **No SQL, no schema change, no flag.**

### L1: a repeat refusal is held back only while the line is the one it was logged against

- logRefusal (src/lib/scim-manager.ts) now compares the newest refusal row's value, reason **and line** (its `oldValue.managerId`, the line here when it was logged) with this push's. The second query (the newest reporting_line_changed row after it) is gone.
- So a line changed by any door logs the next refusal again, including the doors that write no row per person (the bulk Change manager logs one bulk_update row naming no one; the Agent move logs one row on the Agent).
- Test: "a line changed outside SCIM, by a door that logs no row for the person (a bulk change, the Agent move), logs the next refusal again". The repeat test no longer back-dates a row to get its order: it steps the clock a second between pushes, as a real sync's rows are spaced, since the in-memory double reads rows stamped in the same millisecond in the order they were made.

### L2: the reactivation answers a transaction past its time as the 503

scimReactivateSeat's catch reads retryAnswer (busy, a deadlock, P2028) in place of rolesBusyAnswer. So the PUT and PATCH reactivation, and POST's revive, answer the 503 an identity provider retries, never a 500, now that the manager's checks run in that transaction too. Test: "a reactivation that runs out of its time is the 503 the provider retries, never a 500, with nothing written".

### L3: no change, no role lock

- New `scimManagerChanges(organizationId, userId, ask)`, read before any lock: the seat's line here (personSeatIn) and the value resolved. False when it names the manager the seat already holds, clears a line already empty, or the person holds no seat here.
- Where it is read: writeScimUser (PUT and PATCH for someone anchored here) and scimSetManager (a membership person's push, after a deprovision, after a D3 move). With a false answer they pass no manager, so a push carrying an unchanged manager takes only the person's row lock, as before step 7, or no lock at all with no other field.
- A true answer is checked again, in full, under the role lock (scimManagerHere, unchanged).
- Not used where the role lock is taken anyway: POST's create (a new account has no line, so a manager is always a change) and the reactivation.
- Tests: "the manager she already has, sent again ... and the answer names her" now also holds that no role lock was taken; "an unchanged manager riding on a name change takes no role lock, and a clear of an empty line takes none either"; "a change seen before the lock is checked again under it: Dana made an Agent meanwhile is refused".

### L4: the provider deploy notes

Corrected in place in step 7's deploy notes:
- **Okta:** emptying a manager in Okta does not clear it here (Okta's PUT leaves the empty attribute out, and a PUT without the manager keeps the line). An Admin clears Reports to in WorkwrK, and Okta's next push leaves it empty. To be checked in step 9's live proof.
- **Entra:** restart provisioning once after the deploy. The manager updates Entra sent before were answered 200, ignored, and counted as delivered.
- **Note 3:** after fixing a refused manager, have the provider send it again. Entra does not resend an unchanged attribute: use Provision on demand, change it in Entra, or set it in WorkwrK. Okta sends it with the person's next push.

### L5: the two rollback tests throw after the writes they roll back

- "a deadlock in an anchored person's push, after her names were written, rolls them back too": the deadlock is thrown at Lee's second row lock (the manager's write), after her names' updateMany.
- "a deadlock in POST, after the account was made, makes no account": the deadlock is thrown at the new account's own lock (the manager's write), after the create.
- Each also holds that the write went through the transaction's client, before the deadlock, and nothing outside it. The in-memory double's rollback restores the whole store, so the `tx.` log entry is what tells the two apart. With the names' write or the create moved outside the transaction (a scratch mutation), both tests fail.

### L6: the claims with no test, tested

- A line changed outside SCIM before a repeat refusal (L1's test above).
- "a reactivation clears a stale B line first, then logs the refused manager, and A's line stays": Pat back in B under Rita, deactivated there, with the push naming Ada (an Agent). Her B line is cleared ("Reactivated Pat Ng with no manager: Rita Ng is deactivated"), then the refusal is logged against the cleared line; her A line stays.
- "an address: a live seat before a deactivated twin, the account anchored here before one through a membership, a removed seat never": Max's old deactivated account anchored in B and his live account from A share an address, and the live one is taken (L7). Two live accounts at one address: the one anchored here. A lone deactivated match (Rita's address) is refused as deactivated, by name. A removed seat's address names nobody.

### L7: an address resolves among live seats first

managerNamed tries personHereByEmail at `live`, then at `kept`. An old deactivated account never hides the live one, and a lone deactivated match is still refused as "deactivated". A removed seat still never answers. Test: L6's address test.

### L8: a refused clear says it was not cleared

The refusal's sentence reads "was not cleared" for a remove or a null ("The identity provider's manager for Pat Ng was not cleared: Pat Ng was removed from this workspace. Their manager here is unchanged."), and "was not set" otherwise. Test: "a seat B removed takes no line, logged, and A's line stays; a refused clear says it was not cleared".

### The contract test (E16)

"holds step 7's manager attribute" follows the [id] route's `line` local and adds pins:
- the pre-check in writeScimUser and scimSetManager (L3);
- live then kept for an address (L7);
- the repeat rule's line comparison (L1);
- retryAnswer in the reactivation, with no rolesBusyAnswer left there (L2).

The list is unchanged: 154 files, (a) 96, (b) 36, (c) 22; 21 writers. MERGED stays [2, 3, 4, 5, 7].

### Files

- Changed: src/lib/scim-manager.ts, src/lib/scim-reactivate.ts, src/app/api/scim/v2/Users/[id]/route.ts, docs/plans/workspace-status-2.md (step 7's deploy notes and two of its sentences, this section).
- Tests: src/app/api/scim/v2/Users/manager.test.ts (6 new, 5 changed), src/lib/access/workspace-lines.contract.test.ts (the step 7 test's pins).

### Tests

- **New: 6**, all in manager.test.ts, which now has 32.
- **Changed: 6.** In manager.test.ts: the "already has" test (no role lock), the repeat test (the clock in place of the back-dating), the removed seat test (the refused clear), and the two deadlock tests. Plus the contract's step 7 test.
- **On the reviewed step 7 code**, 7 fail. The scratchpad tree was 5213106a with today's files and this pass's source edits taken back.
  - New tests: the L1, L2, L3 (no lock) and L6/L7 address tests.
  - Changed tests: the "already has" test (L3) and the refused clear (L8).
  - The contract's step 7 test.
- Passing there by design:
  - The L3 re-check under the lock: a guard, since the reviewed code always checked under the lock.
  - The L6 stale-line test and the two L5 tests: the code was right, and they close test gaps. The L5 tests fail under the outside-the-transaction mutation.
  - The repeat test: passes on both codes.
- The SCIM tests (src/app/api/scim, scim-auth, scim-deprovision, scim-mappers): 9 files, 115 tests, all pass.
- With their neighbours (audit-families, src/lib/access, src/lib/people, src/app/api/users, auth, people, settings, src/lib/skills, src/lib/browser, settings-phase7): 185 files, 3,063 tests, all pass.
- Every test related to a changed source: 58 files, 631 tests, all pass.
- Type check clean, run twice (6 GB heap). ESLint on every touched file: no problem. `node scripts/check-schema-sql.mjs` passes.

### Deploy notes, added to step 7's

1. **A push naming the manager someone already has waits for no lock**, so a provider's large profile sync never queues behind, or holds up, an Admin changing a level or a Reports to.
2. **After the deploy, Entra ID workspaces restart provisioning once**, so the managers Entra sent before the deploy arrive (step 7's Entra note).
3. **Okta workspaces clear a manager in WorkwrK**, since emptying it in Okta does not reach here (step 7's Okta note).
4. **A manager the provider names by address** is the person with a live seat here under that address before one deactivated here.
5. **The same refused manager is logged again after any change of the person's line here**, whoever made it.
