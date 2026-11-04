// E16: one test lists every reader and writer of a person's line and
// profile (docs/plans/workspace-status-2.md E16, step 1). After E1 and E2 a
// person's manager in a workspace is held by the row that holds their seat
// there (User.managerId where they are anchored, the membership's own
// managerId everywhere else), every dotted line names its workspace, and
// since D18 the profile (department, job title, office, join date, weekly
// hours, working week, profile fields) is the seat's too. A reader that
// takes the account's line or profile in another workspace is wrong there,
// silently. The plan's map was built by reading, not by search (its first
// section says why), so this test is the net: it scans src/ and scripts/ the
// way the step 1 search did, and fails on any file it finds that is not
// listed below, or any listed file it no longer finds, until the list is
// brought up to date with a reason.
//
// WHERE IT LOOKS: every .ts, .tsx, .mjs, .js and .cjs file of src/,
// scripts/, prisma/ (seed.ts included) and services/ (the step 1 review M2:
// the nightly access parity job is .mjs). Tests, test doubles, generated code,
// node_modules and "use client" components are left out: they read no
// database.
//
// WHAT IT FINDS, per file:
//   line     User.managerId, the manager, directReports and membershipReports
//            relations, or a membership's managerId: any `managerId`,
//            `directReports` or `membershipReports` in the code; a `manager`
//            relation read (`manager: { select`, `manager: { include` or
//            `manager: true`, in a query or a select held in a constant); and
//            a filter on it (`manager: null`, `manager: { is` or `isNot`).
//            Broad on purpose: WeeklyReview.managerId (a stamp) and
//            parameters named so are listed too, each with its reason.
//   dotted   UserDottedLine: the model, its raw table, the dotted relations on
//            User, or `dottedLines` (Organization's back relation, and the
//            people routes' field of that name).
//   profile  the placement and capacity columns: `joinDate` and
//            `weeklyCapacityHours` anywhere; `departmentId`, `roleId`,
//            `officeId`, `workSchedule`, `customFields` or the `department`,
//            `role` and `office` relations inside a read or write of User
//            or of a membership, or inside a nested block of any query under
//            a relation that names a User (a review's `subject`, an asset's
//            `assignedTo`: harvested from schema.prisma), or in a raw
//            statement of "User" or "OrganizationMembership"; a job title's,
//            department's or office's people through their back relation
//            (Role.users, Department.members, Office.members); a person's
//            select held in a constant (a name beside a placement relation,
//            on one line). A membership's `role` is its access level, and a
//            member table's row (one that names `userId`) is no User, so
//            neither counts.
//
// EACH ENTRY IS MARKED:
//   a   reads or writes the seat here, or is right as it is (a value that is
//       one workspace's by construction: an invitation, an account made
//       here, a row shown only when it belongs here, a pure function).
//   b   must change in a step of this program, named: 2 (every walk and
//       reach), 3 (every surface that shows a line), 4 (every write of a
//       line, the relied-line machinery retired), 5 (a membership person's
//       profile and lines edited here), 7 (SCIM's manager attribute) or 8
//       (audiences and counts by placement, E15). "via X" means the file
//       follows when helper X changes and needs no edit of its own.
//   c   account-level on purpose, or anchored-only on purpose for now: the
//       person's own account, a stamp written once (WeeklyReview.managerId),
//       a known limit the plan names (a membership person's KPI history,
//       reviews, skills and alignment here; HRSegment), or a module behind a
//       flag that is off.
//
// AND THE WRITES (E16), listed by file and by top-level function, whatever
// the shape (the step 1 review M2): a write of User or of a membership whose
// data names a line or profile column, or whose data is held elsewhere (a
// variable, a spread: users/[id] PATCH's own `data.managerId = next` then
// `update({ data: write })`); any write of a dotted line; a raw UPDATE of
// those columns; an assignment to `.managerId`; a relation write on the
// line (`manager: { connect`, `directReports: { set`, ...). Allowed outside
// src/lib/access/seat-writes.ts ("seat") only where an account or a seat is
// made here ("made": users POST, the joins, a seed), where an account moves
// ("moved": the swap), for a key's sake ("key": a deleted department cleared
// from removed accounts anchored here), in a local-only proof ("proof"), or
// where the data held elsewhere names none of these columns ("none", saying
// what it holds). Every other writer names the step that moves it into
// seat-writes.ts ("step 4", "step 5", "step 7"). A write in a function not
// listed, or in a file not listed, fails.
//
// THE DONE GATE (the step 1 review M1): MERGED lists the steps of this
// program whose builder has finished. No (b) entry and no "step N" writer
// of a step in it may remain: each builder flips its entries to (a) (or
// moves its writers into seat-writes.ts) with the new reason, then adds its
// step. The merge of steps 1 to 4 (with 5, 7 and 8) needs MERGED to hold
// every step of MERGE_NEEDS, so no forgotten reader ships.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Kind = "line" | "dotted" | "profile";
type Mark = "a" | "b" | "c";
type Step = 2 | 3 | 4 | 5 | 7 | 8;
type Writes = "made" | "moved" | "seat" | "key" | "proof" | "none" | "step 4" | "step 5" | "step 7";
interface Entry {
  kinds: Kind[];
  mark: Mark;
  step?: Step;
  why: string;
}
interface Writer {
  writes: Writes;
  /** The top-level functions (or constants) of the file the writes sit in. */
  functions: string[];
  why: string;
}

/** The steps of this program whose builder has finished: none of their (b) entries or writers may remain. */
const MERGED: readonly Step[] = [2, 3, 4, 5, 7, 8];
/** What the one merge of steps 1 to 4 (with 5, 7 and 8) needs MERGED to hold. */
const MERGE_NEEDS: readonly Step[] = [2, 3, 4, 5, 7, 8];

/** Every file the search finds, at step 1 (main f16c2220 plus step 1). */
const ENTRIES: Record<string, Entry> = {
  "src/app/(dashboard)/people/roles/[id]/page.tsx": { kinds: ["profile"], mark: "a", why: "a job title's holders: the people anchored here (Role.users) and the people here through a membership whose membership holds it, kept seats, as DELETE refuses by (membershipsPlacedHere's half, peoplePlacedHere, E15, step 8); a membership holder's row shows no KRA drift, since none is assigned to them here (the step 5 review M1)" },
  "src/app/(dashboard)/reviews/[id]/appraisal-letter.ts": { kinds: ["profile"], mark: "a", why: "renders the join date its route reads; reads no column" },
  "src/app/(dashboard)/reviews/[id]/cycle-types.ts": { kinds: ["profile"], mark: "a", why: "a type only" },
  "src/app/(dashboard)/settings/structure/page.tsx": { kinds: ["line"], mark: "a", why: "No manager: the people live here with no line here, two halves: the account's line for people anchored here, the membership's own line otherwise (E1, E15, step 8)" },
  "src/app/(dashboard)/team/alignment/page.tsx": { kinds: ["line"], mark: "a", why: "the Sub-teams pill by this workspace's lines (workspacePeopleLines, reportsHereOf, both halves), the drill's manager read at their seat here; the rows via getTeamAlignment (step 2)" },
  "src/app/(dashboard)/team/rollup/page.tsx": { kinds: ["line", "profile"], mark: "a", why: "the org-wide roots by this workspace's lines (workspacePeopleLines, both halves, step 2); a sub-team manager's job title shown only when it is this workspace's" },
  "src/app/api/ai/route.ts": { kinds: ["line", "profile"], mark: "a", why: "the Owner snapshot's people anchored here, each with their reports HERE (reportsHereOf, both halves), never the cross-workspace directReports count (step 3); its headcount and each department's members count both halves, as Settings does (countPeopleHere, membershipPlacedCounts, the step 8 review L4)" },
  "src/app/api/assets/[id]/route.ts": { kinds: ["profile"], mark: "a", why: "shows the holder's department only when it belongs here" },
  "src/app/api/assets/route.ts": { kinds: ["profile"], mark: "a", why: "shows the holder's department only when it belongs here" },
  "src/app/api/auth/accept-invite/route.ts": { kinds: ["line", "profile"], mark: "a", why: "the signed-out join makes the account here with its line; the signed-in join writes the invitation's manager onto the membership under the role lock (managerOnAccept, no loop here), which the swap hands to the account (E10, step 4)" },
  "src/app/api/calendar/events/route.ts": { kinds: ["line", "dotted"], mark: "a", why: "the Team pill: the solid reports by the line here (reportsHereOf, both halves), the dotted ones this workspace's rows (step 2)" },
  "src/app/api/conversations/[id]/route.ts": { kinds: ["profile"], mark: "a", why: "shows a member's job title and department only when they belong here" },
  "src/app/api/departments/[id]/route.ts": { kinds: ["profile"], mark: "a", why: "the delete counts everyone here placed in it, both halves (membershipsPlacedHere, the step 5 review M2), and clears it from removed accounts anchored here (the key); a removed membership's copy has no key and is never shown" },
  "src/app/api/departments/route.ts": { kinds: ["profile"], mark: "a", why: "the listed member count adds the people here through a membership placed in it, kept seats, as the delete counts (membershipPlacedCounts, E15, step 8); removed people's counts are the people anchored here, whose account's key the delete clears" },
  "src/app/api/email/send-reminders/route.ts": { kinds: ["line"], mark: "a", why: "the monthly evaluation's people with a line here, both halves (the account's line for people anchored here, a live membership's line), each named to their digest manager (step 2)" },
  "src/app/api/export/people/route.ts": { kinds: ["line", "profile"], mark: "a", why: "anchored rows, whose line and profile are this workspace's (phase 1's decision)" },
  "src/app/api/export/reviews/[cycleId]/route.ts": { kinds: ["profile"], mark: "a", why: "shows a subject's department only when it belongs here" },
  "src/app/api/invitations/route.ts": { kinds: ["line"], mark: "a", why: "an invitation's own manager and placement (one workspace's row, applied at acceptance)" },
  "src/app/api/kpi-records/route.ts": { kinds: ["profile"], mark: "a", why: "a holder's department read at the seat here (seatPlacementsHere)" },
  "src/app/api/kpi-records/summary/route.ts": { kinds: ["profile"], mark: "c", why: "a membership person's KPI history here is a known limit (the plan); anchored people's job title and department" },
  "src/app/api/kra-assignments/route.ts": { kinds: ["line"], mark: "a", why: "via effectiveDirectReportIds, which reads the reports here (reportsHereOf, step 2); POST refuses a membership person in words (ALIGNMENT_NOT_HERE, the step 5 review M1)" },
  "src/app/api/kras/orphans/route.ts": { kinds: ["profile"], mark: "a", why: "a KRA's own job role; a holder's job title shown only when it belongs here" },
  "src/app/api/kudos/leaderboard/route.ts": { kinds: ["profile"], mark: "a", why: "shows job title and department only when they belong here" },
  "src/app/api/kudos/route.ts": { kinds: ["profile"], mark: "a", why: "the wall's department filter: the people anchored here by their account's department (a relation filter) and the people here through a membership by their membership's, read on their own (idsPlacedHere, the membership half, E15, step 8); the feed shows title and department only when they belong here" },
  "src/app/api/me/alignment/route.ts": { kinds: ["line", "profile"], mark: "c", why: "the viewer's own alignment, their manager and placement: a membership person's people data here is a known limit" },
  "src/app/api/me/export/route.ts": { kinds: ["profile"], mark: "c", why: "the person's own data export, account-wide" },
  "src/app/api/me/route.ts": { kinds: ["line", "profile"], mark: "c", why: "the person's own place card, their manager included, by design (phase 1)" },
  "src/app/api/my-team/route.ts": { kinds: ["line", "profile"], mark: "a", why: "each member's managerId and so directReportIds from the line their seat here holds (seatsHeldFor), the lines the walk climbed, named only with a seat here (step 3)" },
  "src/app/api/offices/route.ts": { kinds: ["profile"], mark: "a", why: "an office's listed member count adds the people here through a membership whose membership holds it, kept seats, as its delete counts (membershipPlacedCounts, E15, step 8)" },
  "src/app/api/people/[id]/alignment/route.ts": { kinds: ["line", "profile"], mark: "c", why: "a person's alignment, their manager and placement: a membership person's people data here is a known limit" },
  "src/app/api/people/bulk-import/route.ts": { kinds: ["line"], mark: "a", why: "makes invitations, each with its manager and placement (E10: unchanged)" },
  "src/app/api/people/bulk-update/route.ts": { kinds: ["line"], mark: "a", why: "the selection read at the seat each person holds here, both halves (step 5); change_manager through writeLineHere, change department and office through writeProfileHere, each under the person's row lock on the row that holds their seat (steps 4 and 5)" },
  "src/app/api/reviews/[id]/appraisal-letter/route.ts": { kinds: ["profile"], mark: "c", why: "a membership person's reviews here are a known limit; shows title and department only when they belong here" },
  "src/app/api/reviews/[id]/calibration/route.ts": { kinds: ["profile"], mark: "a", why: "shows title and department only when they belong here" },
  "src/app/api/reviews/[id]/launch/route.ts": { kinds: ["line", "profile"], mark: "c", why: "a membership person's reviews here are a known limit (the plan, E8 and the Risks list): a launch reviews the people anchored here only, by their account's department, whatever the audience (step 8 leaves it anchored, as KRA and SOP seeding, the step 5 review M1); the reviewer via effectiveManagersOf reads the line here (step 2)" },
  "src/app/api/reviews/[id]/manager-review/route.ts": { kinds: ["profile"], mark: "a", why: "the writer via reviewerFacts, which reads the line here (step 2: the subject's unused account line is no longer read); title and department shown only when they belong here" },
  "src/app/api/reviews/[id]/peers/route.ts": { kinds: ["line", "profile"], mark: "a", why: "peer suggestions (\"Their manager\", \"Reports to them\", \"Same manager\", \"Same department\") from the line and the placement the subject's seat here holds (linesHereOf, seatPlacementsHere), the pool's people anchored here by their own line (step 3)" },
  "src/app/api/reviews/[id]/route.ts": { kinds: ["profile"], mark: "a", why: "the writer via reviewerFacts, which reads the line here (step 2: the subject's account line is no longer read or sent); title and department shown only when they belong here" },
  "src/app/api/roles/[id]/alignment/route.ts": { kinds: ["profile"], mark: "a", why: "a job title's holder count adds the people here through a membership whose membership holds it, kept seats (membershipsPlacedHere, E15, step 8); the template's KRAs reach the people anchored here only (the step 5 review M1)" },
  "src/app/api/roles/[id]/route.ts": { kinds: ["profile"], mark: "a", why: "GET lists the holders here through a membership with the people anchored here (Role.users), kept seats (peoplePlacedHere, E15, step 8); its delete counts both halves (the step 5 review M2); a Role's own department is the Role's" },
  "src/app/api/roles/route.ts": { kinds: ["profile"], mark: "a", why: "a job title's listed holder count adds the people here through a membership whose membership holds it, kept seats, as its delete counts (membershipPlacedCounts, E15, step 8); removed holders are the people anchored here" },
  "src/app/api/scim/v2/Users/route.ts": { kinds: ["line"], mark: "a", why: "the list names each person's line here (the account's for someone anchored here, the membership's for anyone else), only while that manager holds a seat here; POST's manager goes through scim-manager.ts, writeLineHere under the role lock (E9 i, step 7)" },
  "src/app/api/skills/export/route.ts": { kinds: ["profile"], mark: "c", why: "a membership person's skills here are a known limit; the department shown only when it belongs here" },
  "src/app/api/skills/route.ts": { kinds: ["profile"], mark: "c", why: "a membership person's skills here are a known limit; the department shown only when it belongs here" },
  "src/app/api/sop-assignments/route.ts": { kinds: ["profile"], mark: "c", why: "SOP assignment by department or for everyone reads the people anchored here only, on purpose: a membership person's SOP assignments here are a known limit (the step 5 review M1, kept by step 8), and one named by id is refused in words (ALIGNMENT_NOT_HERE)" },
  "src/app/api/sop-folders/[id]/access/route.ts": { kinds: ["profile"], mark: "a", why: "shows title and department only when they belong here" },
  "src/app/api/sops/[id]/people/route.ts": { kinds: ["profile"], mark: "a", why: "shows the department only when it belongs here" },
  "src/app/api/spaces/[id]/workload/route.ts": { kinds: ["profile"], mark: "a", why: "capacity at the seat here (capacityHereOf, step 6)" },
  "src/app/api/talent-assessment/people/route.ts": { kinds: ["line", "profile"], mark: "c", why: "a membership person's talent data here is a known limit; anchored people's own line and placement" },
  "src/app/api/talent-assessment/route.ts": { kinds: ["line", "profile"], mark: "c", why: "a membership person's talent data here is a known limit; anchored people's own line and placement" },
  "src/app/api/team/members-work/route.ts": { kinds: ["line", "profile"], mark: "a", why: "the Reports to filter by the line each seat here holds: the account's for the anchored half, the membership's own for the membership half (step 3)" },
  "src/app/api/team/workload/route.ts": { kinds: ["profile"], mark: "a", why: "capacity at the seat here (step 6); canEditCapacity by PATCH's door for both kinds (E7, step 5)" },
  "src/app/api/users/[id]/agent-reports/route.ts": { kinds: ["line"], mark: "a", why: "via moveAgentReports and previewAgentReports, which read and move this workspace's lines only (reportsHereOf, moveLinesHere, removeDottedHere, step 4)" },
  "src/app/api/users/[id]/dotted-lines/route.ts": { kinds: ["line", "dotted"], mark: "a", why: "GET reads this workspace's rows (step 3); PUT replaces this workspace's rows through writeDottedHere, a new line live here (step 4), for a subject of either kind at the seat here, the solid line left out the one that seat holds (step 5)" },
  "src/app/api/users/[id]/handover/route.ts": { kinds: ["line"], mark: "a", why: "the summary's reports through reportsHereOf, the preview and the run the same plan over this workspace's lines (step 4)" },
  "src/app/api/users/[id]/record-access/route.ts": { kinds: ["line", "dotted"], mark: "a", why: "the walk up the line each seat here holds (personSeatIn for the subject, linesHereOf up the line) and this workspace's dotted rows, as viewer.ts walks them (step 3)" },
  "src/app/api/users/[id]/route.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "GET names the line the seat here holds, this workspace's dotted rows and the reports here, and the profile a membership holds to readers of people data (steps 3 and 5); PATCH writes the profile through writeProfileHere and Reports to through writeLineHere on the row that holds the seat, for both kinds, the shared identity refused for a membership person, and the clears through writeLineHere and removeDottedHere (steps 4 and 5)" },
  "src/app/api/users/[id]/seed-alignment/route.ts": { kinds: ["profile"], mark: "c", why: "a membership person's KRAs here are a known limit, refused in words (ALIGNMENT_NOT_HERE, the step 5 review M1); seeds from the job title of someone anchored here" },
  "src/app/api/users/export/route.ts": { kinds: ["line", "profile"], mark: "a", why: "Reports to from the line each row's seat here holds (the membership's for a membership person), named only with a seat here (step 3); the placement read at the seat (D18)" },
  "src/app/api/users/route.ts": { kinds: ["line", "profile"], mark: "a", why: "POST makes an account here with its line (right); GET's manager columns from the line each seat here holds and every row's reports here (reportsHere), a sort by managerId at the seat too (step 3)" },
  "src/app/api/v1/openapi.json/route.ts": { kinds: ["profile"], mark: "a", why: "the public API's documentation text" },
  "src/app/api/v1/people/route.ts": { kinds: ["line", "profile"], mark: "a", why: "anchored rows, each with this workspace's own placement and line (phase 1's decision for the public API)" },
  "src/app/api/weekly-reviews/[id]/manager-review/route.ts": { kinds: ["line"], mark: "a", why: "via isInReportTree and effectiveManagerOf, which read the lines here (step 2); WeeklyReview.managerId is a stamp" },
  "src/app/api/weekly-reviews/reminders/route.ts": { kinds: ["line"], mark: "a", why: "via effectiveManagersOf, which reads the lines here (step 2)" },
  "src/lib/access/acting-workspace.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "reads the seat's line (seatsHeldFor, personSeatIn, reportsHereOf, linesHereOf, the two workspace reads); lineStandingsElsewhere and linesElsewhere retired (E6, step 4)" },
  "src/lib/access/app-floor-impact.server.ts": { kinds: ["line"], mark: "a", why: "the preview's managers from this workspace's lines: the account's of people anchored here, a membership's of people here through one, and workspaceDottedLines (step 2)" },
  "src/lib/access/backfill-plan.ts": { kinds: ["line"], mark: "c", why: "the access backfill's plan (scripts/access-backfill.ts): anchored rows, a one-off migration behind ACCESS_V2_TABLES" },
  "src/lib/access/digest-recipients.ts": { kinds: ["line"], mark: "a", why: "the digest manager by the line here: effectiveManagersOf, and memberManagersOf from the membership's line (seatsHeldFor) walked by managersPastAgents (step 2)" },
  "src/lib/access/guards.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "a pure field map (managerId, dottedLines and the placement fields in their groups) and a pure rule; the caller passes the line" },
  "src/lib/access/job-title-holders.ts": { kinds: ["profile"], mark: "a", why: "a job title's holders at their seat here, two halves: the account's job title for people anchored here, the membership's otherwise, each with that seat's status, removal and level (E15, step 8); the SOP step owner rule gives them a task, never a KRA or SOP assignment" },
  "src/lib/access/legacy-resolve.ts": { kinds: ["line"], mark: "c", why: "WeeklyReview.managerId, a stamp written once from the line of the moment" },
  "src/lib/access/manager-candidate.ts": { kinds: ["line", "dotted"], mark: "a", why: "lineAbove walks the line each seat here holds and \"inactive\" is the seat's (step 2); staleLinesOf reads the line the seat here holds and this workspace's dotted rows, each manager at their seat here (step 4)" },
  "src/lib/access/manager-lines.ts": { kinds: ["line", "dotted"], mark: "a", why: "factsHere, the walks and effectiveManagersOf read the line each seat here holds, reportsHereOf who reports here, the dotted reads this workspace's rows (step 2); othersDottedLines and managerLineIsOthers retired (E6, step 4)" },
  "src/lib/access/members-list.server.ts": { kinds: ["line", "profile"], mark: "a", why: "the row's manager and No manager from the line each seat here holds: the account's where anchored here, the membership's own otherwise (step 3)" },
  "src/lib/access/membership.ts": { kinds: ["line", "dotted"], mark: "a", why: "rule 6 (reportCountOf) counts the reports here (reportsHereOf) and this workspace's dotted lines; unattendedRecipient walks the line each seat here holds (step 2)" },
  "src/lib/access/node-access.ts": { kinds: ["line"], mark: "a", why: "reads the line with the session's row so personSeatIn answers the seat in one read; decides nothing by it" },
  "src/lib/access/object-share/goal.ts": { kinds: ["profile"], mark: "c", why: "behind ACCESS_V2_TABLES (off): the object share module reads people anchored here throughout and moves as one when the flag is turned on" },
  "src/lib/access/profile-here.ts": { kinds: ["profile"], mark: "a", why: "a membership's placement read at the seat; a manager named only while they hold a seat here; the membership half of a placement count for the Settings deletes (membershipsPlacedHere, the step 5 review M2); E15's helpers (step 8): placementHereOf, peoplePlacedHere, idsPlacedHere and membershipPlacedCounts, two halves at the seat's state" },
  "src/lib/access/seat-writes.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "the one place a line or a profile is written for a seat (E16)" },
  "src/lib/access/seated-here.ts": { kinds: ["profile"], mark: "a", why: "reads the membership's placement and capacity columns, and the account's, at the seat here (step 6)" },
  "src/lib/access/viewer.ts": { kinds: ["profile"], mark: "a", why: "the viewer's placement read at the seat here (phase 1's final review, L5)" },
  "src/lib/access/workspace-anchor.ts": { kinds: ["line", "profile"], mark: "a", why: "the swap (E3, D18): a move writes the line and the profile of the workspace left and the one arrived in" },
  "src/lib/access/workspace-status.ts": { kinds: ["line"], mark: "a", why: "clearLinesBackWithAccount: each workspace whose seat came back with the account has its lines checked there (staleLinesOf) and cleared on that membership through writeLineHere and removeDottedHere, each with its Audit row there (the final review, integrity M1)" },
  "src/lib/agents/previews.ts": { kinds: ["line"], mark: "a", why: "an AI invitation's manager at the seat here (managerCandidateIn, live), stored for an existing account too, since its signed-in join writes it (E10, step 4)" },
  "src/lib/agents/tools.ts": { kinds: ["line"], mark: "a", why: "the invite tool's manager via previews.ts and sendInvitation, both at the seat here (E10, step 4); team alignment via getTeamAlignment reads the lines here (step 2); searchEmployeeRows reads the seat (step 6)" },
  "src/lib/alignment-assign.ts": { kinds: ["profile"], mark: "c", why: "KRA seeding to a job title's holders reads the people anchored here only, on purpose: a membership person's KRAs here are a known limit (the step 5 review M1, kept by step 8)" },
  "src/lib/alignment-scope.ts": { kinds: ["line"], mark: "a", why: "a live direct report here, both halves (reportsHereOf, step 2)" },
  "src/lib/analytics.ts": { kinds: ["profile"], mark: "c", why: "a membership person's people data here is a known limit (analytics by department, anchored only)" },
  "src/lib/auth/invite-facts.server.ts": { kinds: ["line"], mark: "a", why: "an invitation's manager and placement (managerOnAccept checks the seat under the role lock)" },
  "src/lib/dashboards/widget-data.ts": { kinds: ["profile"], mark: "a", why: "capacity at the seat here (capacityHereOf, step 6)" },
  "src/lib/export/workspace-export.server.ts": { kinds: ["profile"], mark: "a", why: "anchored rows, each shown only with this workspace's own placement (phase 1); departments.csv's member count adds the people here through a membership placed in it, kept seats (membershipPlacedCounts, E15, step 8)" },
  "src/lib/hr-segment.ts": { kinds: ["profile"], mark: "c", why: "HRSegment's department and office scope is out of this program (the plan's known limits)" },
  "src/lib/kpi-record.ts": { kinds: ["line"], mark: "a", why: "via getEffectiveReportTree, which walks the lines here (step 2)" },
  "src/lib/kpi-review.server.ts": { kinds: ["line"], mark: "a", why: "via effectiveManagerOf and countedDottedManagerIds, which read the line and the dotted rows here (step 2)" },
  "src/lib/people/directory-list.server.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "rows, the Reports to filter, No manager and the chart's managerId from the line each seat here holds, every report count and its sort from the reports here (reportsHere, in memory), the chart's dotted ids from this workspace's rows (step 3)" },
  "src/lib/people/directory-query.ts": { kinds: ["line"], mark: "a", why: "parses the Directory's filters; directory-list.server.ts applies them" },
  "src/lib/people/escalation-report.ts": { kinds: ["line"], mark: "a", why: "a pure count over the rows its caller reads" },
  "src/lib/people/handover.server.ts": { kinds: ["line", "dotted"], mark: "a", why: "every report here (reportsHereOf, lineFactsAround) counted and moved through moveLinesHere, an Agent's dotted rows here through removeDottedHere, the relied-line machinery retired (E4 to E6, step 4)" },
  "src/lib/people/named-here.ts": { kinds: ["line"], mark: "a", why: "a pure seat filter over the lines here its caller reads; the elsewhere fields are gone (E6, step 3)" },
  "src/lib/people/person-access.server.ts": { kinds: ["line"], mark: "a", why: "the chain via getTeamUserIds and the report tree, which walk the lines here; managerMapFor reads the lines here (workspacePeopleLines), the graph lineAbove walks too (step 2)" },
  "src/lib/people/person-fields.ts": { kinds: ["line", "profile"], mark: "a", why: "a pure field table: SEAT_FIELDS is everything but the shared identity, what this workspace writes for someone here through a membership; PROFILE_ELSEWHERE gone (E7, step 5)" },
  "src/lib/people/reporting-lines.ts": { kinds: ["line"], mark: "a", why: "pure: the callers pass this workspace's lines" },
  "src/lib/people/send-invitation.server.ts": { kinds: ["line"], mark: "a", why: "an invitation's manager and placement, checked against this workspace" },
  "src/lib/people/team-scope.server.ts": { kinds: ["line"], mark: "a", why: "via effectiveDirectReportIds and countedDottedReportIds, which read the lines here (step 2); the chain read keeps the ids only" },
  "src/lib/people/teams-counts.ts": { kinds: ["line", "dotted"], mark: "a", why: "hasReportsFor's solid half by reportsHereOf and its dotted half by this workspace's rows (step 2); the Candor and survey facts by the office and department its callers pass, the viewer's seat here (the boot's placementHereOf, the page gates' viewer, E15, step 8)" },
  "src/lib/people/weekly-queue.server.ts": { kinds: ["line"], mark: "a", why: "the drawer's direct manager is the line the subject's seat here holds (personSeatIn, step 2); WeeklyReview.managerId stamps" },
  "src/lib/people/workload-count.ts": { kinds: ["profile"], mark: "a", why: "pure capacity arithmetic over the values its caller reads at the seat" },
  "src/lib/performance/review-cycle.server.ts": { kinds: ["line"], mark: "a", why: "reviewerFacts reads the line here (effectiveManagersOf, and who has none at the seat, step 2); the peer pool is people anchored here, by their own line, with the subject's line passed by its caller" },
  "src/lib/performance/review-cycle.ts": { kinds: ["line"], mark: "a", why: "pure: the caller passes the manager" },
  "src/lib/person-alignment.ts": { kinds: ["profile"], mark: "c", why: "a person's alignment page: a membership person's people data here is a known limit" },
  "src/lib/reporting-line.ts": { kinds: ["line", "dotted"], mark: "a", why: "the solid walk joins each step to the two halves of the lines here (a LATERAL subquery), dottedRowsHere reads this workspace's rows; getReportingChain, which named no workspace and had no caller, is gone (step 2)" },
  "src/lib/scim-groups.ts": { kinds: ["profile"], mark: "a", why: "SCIM Groups' members read at the seat here, both halves (the account's department where anchored here, the membership's otherwise), and written through seat-writes.ts placeDepartmentHere on the rows that hold the seats, one transaction per request (E9 ii, step 5; step 9)" },
  "src/lib/scim-manager.ts": { kinds: ["line"], mark: "a", why: "SCIM's manager attribute: the line the seat here holds (personSeatIn), written through writeLineHere on the row that holds it under the role lock, E4 and E5; a resource names the manager only while they hold a seat here (E9 i, step 7)" },
  "src/lib/scim-reactivate.ts": { kinds: ["line"], mark: "a", why: "the stale-line clears through writeLineHere on the row that holds the seat now and removeDottedHere for this workspace's rows (step 4); the push's manager through scim-manager.ts in the same transaction (step 7)" },
  "src/lib/sop-compliance.ts": { kinds: ["profile"], mark: "a", why: "compliance grouped and filtered by the department each person's seat here holds (seatPlacementsHere, idsPlacedHere, E15, step 8); no SOP is assigned to a membership person since the step 5 review M1" },
  "src/lib/team-alignment.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "the tree via getEffectiveReportTree and the dotted marks by this workspace's rows (step 2); the rows are people anchored here, by their own line and job title" },
  "src/lib/team-rollup.ts": { kinds: ["line", "dotted"], mark: "a", why: "the directs via getAllDirectReports and effectiveReportsOfMany (the lines here), the dotted marks by this workspace's rows (step 2)" },
  "src/lib/team.ts": { kinds: ["line"], mark: "a", why: "getTeamUserIds' walk joins each step to the two halves of the lines here (a LATERAL subquery, step 2)" },
  "src/lib/weekly-review.ts": { kinds: ["line"], mark: "a", why: "the queue by the line here (reportsHereOf, and no line here for the recorded manager's rows), the recorded manager via effectiveManagerOf (step 2); WeeklyReview.managerId stamps" },
  "src/lib/work/idea-submitter.ts": { kinds: ["profile"], mark: "a", why: "shows a submitter's department only when it belongs here" },
  "scripts/access-backfill.ts": { kinds: ["line"], mark: "c", why: "the access backfill (behind ACCESS_V2_TABLES): anchored rows, a one-off migration" },
  "scripts/access-parity-job.mjs": { kinds: ["line"], mark: "a", why: "hasReports from the reports here (acting-workspace.ts reportsHereOf), never the cross-workspace directReports count (step 2)" },
  "scripts/backfill-kra-roles.mjs": { kinds: ["profile"], mark: "c", why: "a one-off backfill of orphan KRAs, run by hand, reading the job titles of people anchored here" },
  "scripts/lib/parity-node-section.mjs": { kinds: ["line"], mark: "a", why: "the parity job's hasReports from the reports here (reportsHereOf), never the cross-workspace directReports count (step 2)" },
  "scripts/live-proof-ai-teammates-phase3.ts": { kinds: ["profile"], mark: "a", why: "a local-only proof: makes accounts in its own workspace" },
  "scripts/live-proof-ai-teammates-phase5.ts": { kinds: ["line"], mark: "a", why: "a local-only proof: sets the lines of accounts anchored in its own workspace" },
  "scripts/live-proof-mcp.ts": { kinds: ["line"], mark: "a", why: "a local-only proof: sets the lines of accounts anchored in its own workspace" },
  "scripts/live-proof-workspace-status.ts": { kinds: ["profile"], mark: "a", why: "phase 1's local-only proof: reads placements at each seat" },
  "scripts/live-proof-workspace-lines.ts": { kinds: ["line", "dotted", "profile"], mark: "a", why: "step 9's local-only proof: reads each workspace's lines, dotted lines and placements at each seat, and plants its throwaway scale workspaces' people by raw inserts" },
  "scripts/reconcile-role-kras.mjs": { kinds: ["profile"], mark: "c", why: "a job title's holders (Role.users), anchored only on purpose, as alignment-assign.ts: no KRA is assigned to a membership person (the step 5 review M1, kept by step 8)" },
  "scripts/report-app-floors.ts": { kinds: ["line", "dotted"], mark: "a", why: "the same preview as app-floor-impact.server.ts, from this workspace's lines: the account's, a live membership's, and this workspace's dotted rows (step 2)" },
  "scripts/report-escalation-thresholds.ts": { kinds: ["line", "profile"], mark: "a", why: "a job title's holders here, two halves (the account's job title and line for people anchored here, the membership's for anyone else), and the named person at their seat here (E15, step 8)" },
  "scripts/reset-alignment.mjs": { kinds: ["profile"], mark: "c", why: "a destructive one-off reset of a workspace's job titles and KRAs, run by hand, over the people anchored there" },
  "scripts/seed-demo-org.ts": { kinds: ["line", "profile"], mark: "a", why: "makes a demo workspace's accounts with their lines and placement (accounts made here)" },
  "prisma/seed.ts": { kinds: ["line"], mark: "a", why: "the local seed: makes a demo workspace's accounts with their lines (accounts made here)" },
};

/** Every file that writes a line or a profile column, by its top-level functions (see the header). */
const WRITERS: Record<string, Writer> = {
  "src/app/api/auth/accept-invite/route.ts": { writes: "made", functions: ["POST"], why: "the signed-out join makes the account here with its line and placement; the signed-in join makes or revives the membership with its placement and the invitation's manager before the move (D18, E10)" },
  "src/app/api/departments/[id]/route.ts": { writes: "key", functions: ["DELETE"], why: "a deleted department cleared from removed accounts anchored here (the account's key); a membership's copy has no key" },
  "src/app/api/scim/v2/Users/[id]/route.ts": { writes: "none", functions: ["writeScimUser"], why: "its data holds the name, the address and the status only; the manager goes through scim-manager.ts, writeLineHere under the role lock (step 7)" },
  "src/app/api/users/[id]/route.ts": { writes: "none", functions: ["PATCH"], why: "its data object, written with update({ data: write }), holds the personal columns only (names, phone, photo, birthday) of someone anchored here; the profile goes through writeProfileHere and every line through writeLineHere and removeDottedHere (steps 4 and 5)" },
  "src/app/api/users/route.ts": { writes: "made", functions: ["POST"], why: "makes an account here, with its line and placement" },
  "src/lib/access/membership.ts": { writes: "none", functions: ["applyRoleChangeIn", "transferOwnership"], why: "its data holds the level, the org role, the Admin scopes and the token version only" },
  "src/lib/access/seat-writes.ts": { writes: "seat", functions: ["moveLinesHere", "placeDepartmentHere", "removeDottedHere", "writeDottedHere", "writeLineHere", "writeProfileHere"], why: "the one place a line or a profile is written for a seat (E16)" },
  "src/lib/access/workspace-anchor.ts": { writes: "moved", functions: ["reanchorUser"], why: "the swap (E3, D18): the membership left keeps the account's line and profile, the account takes the target's" },
  "src/lib/access/workspace-status.ts": { writes: "none", functions: ["endSeat", "restoreSeat", "restoreSeatsEndedWithAccount"], why: "its data holds the seat's status, removal, mark and the token version only; a move goes through reanchorUser" },
  "src/lib/agents/previews.ts": { writes: "none", functions: ["prepareOne"], why: "sets an invitation's manager (the Invitation row, applied at acceptance), never a person's line" },
  "src/lib/people/directory-list.server.ts": { writes: "none", functions: ["prismaWhere"], why: "builds the Directory's Reports to filter, a where, never a write" },
  "src/lib/people/directory-query.ts": { writes: "none", functions: ["directoryWhere"], why: "builds the Directory's filters, a where, never a write" },
    "src/lib/scim-reactivate.ts": { writes: "none", functions: ["scimReactivateSeat"], why: "its own write holds the push's names and address only; the stale-line clears go through writeLineHere and removeDottedHere (step 4), the push's manager through scim-manager.ts (step 7)" },
  "scripts/live-proof-ai-teammates-phase2.ts": { writes: "proof", functions: ["makeWorkspace"], why: "a local-only proof: makes accounts in its own workspace" },
  "scripts/live-proof-ai-teammates-phase3.ts": { writes: "proof", functions: ["makeWorkspace"], why: "a local-only proof: makes accounts in its own workspace" },
  "scripts/live-proof-ai-teammates-phase4.ts": { writes: "proof", functions: ["makeWorkspaces"], why: "a local-only proof: makes accounts in its own workspaces" },
  "scripts/live-proof-ai-teammates-phase5.ts": { writes: "proof", functions: ["makeWorkspaces"], why: "a local-only proof: sets the lines of accounts anchored in its own workspace" },
  "scripts/live-proof-mcp.ts": { writes: "proof", functions: ["main"], why: "a local-only proof: sets the lines of accounts anchored in its own workspace" },
  "scripts/recurring-goals/final-review.dbtest.ts": { writes: "proof", functions: ["person"], why: "a database test run on the local database only: makes accounts" },
  "scripts/seed-demo-org.ts": { writes: "made", functions: ["main"], why: "makes a demo workspace's accounts with their lines and placement" },
  "prisma/seed.ts": { writes: "made", functions: ["main"], why: "the local seed: makes a demo workspace's accounts with their lines" },
};
const ROOT = process.cwd();
const KIND_ORDER: Kind[] = ["line", "dotted", "profile"];

/** The relation names that point at a User, from the schema (a review's `subject`, an asset's `assignedTo`, a department's `members`...). */
function userRelationNames(): string[] {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const names = new Set<string>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const line of m[2].split("\n")) {
      const f = /^\s+(\w+)\s+User(\[\])?\??\s/.exec(line);
      if (f) names.add(f[1]);
    }
  }
  return [...names].sort();
}

const OPS = "findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|update|updateMany|updateManyAndReturn|create|createMany|createManyAndReturn|upsert|delete|deleteMany|count|groupBy|aggregate";
const WRITE_OPS = "update|updateMany|updateManyAndReturn|create|createMany|createManyAndReturn|upsert|delete|deleteMany";
const PLACE = /\b(departmentId|roleId|officeId|workSchedule|customFields)\b|\b(department|role|office)\s*:\s*(\{|true)/;
const PLACE_COLUMNS = /\b(departmentId|roleId|officeId|workSchedule|customFields)\b/;
const WRITTEN = /\b(managerId|departmentId|roleId|officeId|joinDate|weeklyCapacityHours|workSchedule|customFields)\b/;
const LINE_RELATIONS = "manager|directReports|membershipReports|dottedLineToManagers|dottedLineFromReports|dottedLines";

/** From an opening "(" or "{" to its match. */
function balanced(code: string, open: number): string {
  const o = code[open];
  const c = o === "(" ? ")" : "}";
  let depth = 0;
  let i = open;
  for (; i < code.length; i += 1) {
    if (code[i] === o) depth += 1;
    else if (code[i] === c && (depth -= 1) === 0) break;
  }
  return code.slice(open, i + 1);
}

/** Every Prisma call of these ops, with its model, its arguments and where it starts. */
function callsIn(code: string, ops: string): Array<{ model: string; op: string; args: string; at: number }> {
  const out: Array<{ model: string; op: string; args: string; at: number }> = [];
  // A chain broken over lines (`prisma.user\n  .findUnique(`) is one call
  // too (the step 8 review M1: the boot route's old placement read).
  for (const m of code.matchAll(new RegExp(`\\.(\\w+)\\s*\\.(${ops})\\(`, "g"))) out.push({ model: m[1], op: m[2], args: balanced(code, m.index! + m[0].length - 1), at: m.index! });
  return out;
}

/** A read's arguments without its nested membership blocks (a membership's `role` is its access level, not a job title). */
function withoutMemberships(args: string): string {
  let out = args;
  for (;;) {
    const m = /\b(organizationMemberships|memberships)\s*:\s*\{/.exec(out);
    if (!m) return out;
    const block = balanced(out, m.index + m[0].length - 1);
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length - 1 + block.length);
  }
}

/** The code without comments (block comments, and lines that are a comment). */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** What a file touches (see the header). */
function touchesOf(src: string, relations: readonly string[]): Kind[] {
  const code = codeOf(src);
  const found = new Set<Kind>();
  if (/\buserDottedLine\b|"UserDottedLine"|\bdottedLineToManagers\b|\bdottedLineFromReports\b|\bdottedLines\b/.test(code)) found.add("dotted");
  if (/\bmanagerId\b|\bdirectReports\b|\bmembershipReports\b/.test(code)) found.add("line");
  // The manager relation read (User's, or a dotted line's), in a query or a select held in a constant, and a filter on it.
  if (/\bmanager\s*:\s*(\{\s*(select|include)\b|true\b)/.test(code)) found.add("line");
  if (/\bmanager\s*:\s*(null\b|\{\s*(is|isNot)\b)/.test(code)) found.add("line");
  if (/\b(joinDate|weeklyCapacityHours)\b/.test(code)) found.add("profile");
  const nested = new RegExp(`\\b(${relations.join("|")})\\s*:\\s*\\{`, "g");
  for (const call of callsIn(code, OPS)) {
    if (call.model === "user") {
      if (PLACE.test(withoutMemberships(call.args))) found.add("profile");
      continue;
    }
    if (call.model === "organizationMembership" && PLACE_COLUMNS.test(call.args)) found.add("profile");
    // A job title's, department's or office's people (Role.users, Department.members, Office.members): read by the placement column.
    if ((call.model === "role" || call.model === "department" || call.model === "office") && /\b(users|members)\s*:\s*(\{|true)/.test(call.args)) found.add("profile");
    for (const m of call.args.matchAll(nested)) {
      const block = balanced(call.args, m.index! + m[0].length - 1);
      if (!/\buserId\b/.test(block) && PLACE.test(block)) found.add("profile");
    }
  }
  // A read of User or of a membership whose `where` is held in a variable
  // (`where` shorthand, or `where: name`), the placement keys set on that
  // variable elsewhere in the file (`where.departmentId = ...`) or in its
  // initializer (the step 8 review M1: cron/surveys-rotate's
  // `const where: Prisma.UserWhereInput = {...}; where.officeId = ...`).
  for (const call of callsIn(code, OPS)) {
    if (call.model !== "user" && call.model !== "organizationMembership") continue;
    const place = call.model === "user" ? PLACE : PLACE_COLUMNS;
    for (const m of call.args.matchAll(/\bwhere\s*(?::\s*(\w+)\s*)?(?=[,}])/g)) {
      const name = m[1] ?? "where";
      if (new RegExp(`\\b${name}\\.(departmentId|roleId|officeId|workSchedule|customFields)\\s*=(?!=)`).test(code)) found.add("profile");
      for (const d of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^=;]*=\\s*\\{`, "g"))) {
        if (place.test(withoutMemberships(balanced(code, d.index! + d[0].length - 1)))) found.add("profile");
      }
    }
  }
  if (/"(departmentId|roleId|officeId|workSchedule|customFields)"/.test(code) && /"User"|"OrganizationMembership"/.test(code)) found.add("profile");
  // A person's select held in a constant: a name beside a placement relation.
  if (code.split("\n").some((line) => /\bfirstName\b/.test(line) && /\b(department|role|office)\s*:\s*\{\s*select\b/.test(line))) found.add("profile");
  return KIND_ORDER.filter((k) => found.has(k));
}

/** The top-level function or constant a position sits in: the last declaration at the start of a line before it. */
function topLevelAt(code: string, at: number): string {
  let name = "(file)";
  for (const m of code.slice(0, at).matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|(?:const|let|var)\s+(\w+)\b)/gm)) name = m[1] ?? m[2];
  return name;
}

/** Whether a write's data (or an upsert's create or update) is held elsewhere: a variable, a shorthand, or an object with a spread. */
function dataHeldElsewhere(args: string): boolean {
  for (const k of args.matchAll(/\b(data|create|update)\s*(:|,|\})/g)) {
    if (k[2] !== ":") return true;
    const rest = args.slice(k.index! + k[0].length).trimStart();
    if (!rest.startsWith("{")) return true;
    if (/\.\.\./.test(balanced(rest, 0))) return true;
  }
  return false;
}

/** Every write of a line or a profile column a file makes, with the top-level function each sits in (see the header). */
function writesIn(src: string): Array<{ how: string; fn: string }> {
  const code = codeOf(src);
  const found: Array<{ how: string; fn: string }> = [];
  for (const call of callsIn(code, WRITE_OPS)) {
    const fn = topLevelAt(code, call.at);
    if (call.model === "userDottedLine") found.push({ how: `userDottedLine.${call.op}`, fn });
    else if (call.model === "user" || call.model === "organizationMembership") {
      if (WRITTEN.test(call.args.replace(/where\s*:\s*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ""))) found.push({ how: `${call.model}.${call.op}`, fn });
      else if (dataHeldElsewhere(call.args)) found.push({ how: `${call.model}.${call.op} (data held elsewhere)`, fn });
    }
  }
  for (const m of code.matchAll(/UPDATE\s+"(User|OrganizationMembership)"[^`]*?SET[^`]*?"(managerId|departmentId|roleId|officeId|joinDate|weeklyCapacityHours|workSchedule|customFields)"/g)) found.push({ how: "raw UPDATE", fn: topLevelAt(code, m.index!) });
  for (const m of code.matchAll(/\.managerId\s*=(?!=)/g)) found.push({ how: ".managerId =", fn: topLevelAt(code, m.index!) });
  for (const m of code.matchAll(new RegExp(`\\b(${LINE_RELATIONS})\\s*:\\s*\\{\\s*(connect|disconnect|set|create|createMany|connectOrCreate|upsert|update|updateMany|delete|deleteMany)\\b`, "g"))) found.push({ how: `${m[1]}.${m[2]}`, fn: topLevelAt(code, m.index!) });
  return found;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "generated" || name === "node_modules" || name.startsWith(".") || name === "__tests__") continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(name) && !/\.test\.(ts|tsx|mjs|js|cjs)$/.test(name) && !name.endsWith("-test-db.ts")) out.push(p);
  }
  return out;
}

/** Every server file of src/, scripts/, prisma/ and services/, by its path from the root. */
function serverFiles(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  for (const dir of ["src", "scripts", "prisma", "services"]) {
    for (const file of sources(path.join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      if (/^\s*["']use client["']/.test(src)) continue;
      out.push({ rel: path.relative(ROOT, file).split(path.sep).join("/"), src });
    }
  }
  return out;
}

describe("the scanner finds what it is meant to find (so the list below is never vacuous)", () => {
  const rel = userRelationNames();
  it("harvests the relations that name a User from the schema", () => {
    for (const name of ["user", "subject", "assignedTo", "manager", "members", "directReports"]) expect(rel).toContain(name);
  });

  it("finds the line, a nested read of it, a filter on it, the dotted lines and the profile, and leaves comments out", () => {
    expect(touchesOf(`await prisma.review.findMany({ include: { subject: { select: { managerId: true } } } });`, rel)).toEqual(["line"]);
    expect(touchesOf(`await prisma.user.findMany({ select: { manager: { select: { firstName: true } } } });`, rel)).toEqual(["line"]);
    expect(touchesOf(`const SELECT = { id: true, manager: { select: { id: true } } } as const;`, rel)).toEqual(["line"]);
    // The step 1 review M2: a "No manager" filter and a relation filter, with no select.
    expect(touchesOf(`await prisma.user.count({ where: { manager: null } });`, rel)).toEqual(["line"]);
    expect(touchesOf(`await prisma.user.findMany({ where: { manager: { is: { deletedAt: null } } } });`, rel)).toEqual(["line"]);
    expect(touchesOf(`await prisma.user.findMany({ where: { manager: { isNot: null } } });`, rel)).toEqual(["line"]);
    expect(touchesOf(`const shown = { manager: { id: m.id } };`, rel)).toEqual([]);
    expect(touchesOf(`await db.$queryRaw\`SELECT d."userId" FROM "UserDottedLine" d\`;`, rel)).toEqual(["dotted"]);
    // Organization's back relation (the step 1 review M2).
    expect(touchesOf(`await prisma.organization.findUnique({ include: { dottedLines: true } });`, rel)).toEqual(["dotted"]);
    expect(touchesOf(`await prisma.user.findMany({ select: { role: { select: { title: true } } } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`await prisma.asset.findMany({ include: { assignedTo: { select: { department: { select: { name: true } } } } } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`await tx.organizationMembership.findMany({ select: { departmentId: true } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`const w = { weeklyCapacityHours: 10 };`, rel)).toEqual(["profile"]);
    expect(touchesOf(`await prisma.role.findFirst({ include: { users: { select: { id: true } } } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`await prisma.office.findMany({ include: { _count: { select: { members: true } } } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`export const CARD = { id: true, firstName: true, department: { select: { name: true } } } as const;`, rel)).toEqual(["profile"]);
    // A KRA's own job role is no person's placement.
    expect(touchesOf(`await prisma.kRA.findMany({ include: { role: { select: { id: true, title: true } } } });`, rel)).toEqual([]);
    expect(touchesOf(`// managerId\n/* userDottedLine */ const x = 1;`, rel)).toEqual([]);
    // The step 8 review M1: a where held in a variable, its placement set on it later or in its initializer.
    expect(touchesOf(`const where: Prisma.UserWhereInput = { organizationId, deletedAt: null };\nif (x) where.officeId = { in: ids };\nawait prisma.user.findMany({ where, select: { id: true } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`const userFilter: Prisma.UserWhereInput = { organizationId };\nuserFilter.departmentId = d;\nawait prisma.user.findMany({ where: userFilter, select: { id: true } });`, rel)).toEqual(["profile"]);
    expect(touchesOf(`const where = { organizationId, departmentId: { in: ids } };\nawait prisma.user.count({ where });`, rel)).toEqual(["profile"]);
    // A where held elsewhere that names no placement, or a membership's access level, is nothing.
    expect(touchesOf(`const where = { organizationId, deletedAt: null };\nawait prisma.user.findMany({ where, select: { id: true } });`, rel)).toEqual([]);
    expect(touchesOf(`const where = { organizationId, role: { in: ["HR"] } };\nawait prisma.organizationMembership.findMany({ where, select: { userId: true } });`, rel)).toEqual([]);
    // A chain broken over lines is one call (the boot route's old placement read).
    expect(touchesOf(`const me = await prisma.user\n  .findUnique({ where: { id }, select: { officeId: true, departmentId: true } });`, rel)).toEqual(["profile"]);
  });

  it("never counts a membership's access level, or a member table's role, as a job title", () => {
    expect(touchesOf(`await prisma.organizationMembership.findMany({ select: { role: true } });`, rel)).toEqual([]);
    expect(touchesOf(`await prisma.user.findMany({ select: { id: true, organizationMemberships: { select: { role: true } } } });`, rel)).toEqual([]);
    expect(touchesOf(`await prisma.space.findFirst({ select: { members: { select: { userId: true, role: true } } } });`, rel)).toEqual([]);
  });

  it("finds the writes whatever their shape, each in its top-level function, and not a condition on the line", () => {
    expect(writesIn(`export async function PATCH() {\n  await tx.user.updateMany({ where: { id }, data: { managerId: next } });\n}`)).toEqual([{ how: "user.updateMany", fn: "PATCH" }]);
    expect(writesIn(`async function x() {\n  await tx.user.updateMany({ where: { managerId: id }, data: { status: "INACTIVE" } });\n}`)).toEqual([]);
    expect(writesIn(`function x() {\n  return tx.userDottedLine.deleteMany({ where: { userId } });\n}`)).toEqual([{ how: "userDottedLine.deleteMany", fn: "x" }]);
    expect(writesIn('const clear = async () => {\n  await tx.$executeRaw`UPDATE "User" SET "customFields" = x WHERE "id" = ${id}`;\n};')).toEqual([{ how: "raw UPDATE", fn: "clear" }]);
    // The step 1 review M2: users/[id] PATCH's own pattern, a data object held in a variable.
    expect(writesIn(`export async function PATCH() {\n  data.managerId = next;\n  await prisma.$transaction(async (tx) => {\n    const local = 1;\n    await tx.user.update({ where: { id }, data: write });\n  });\n}`)).toEqual([
      { how: "user.update (data held elsewhere)", fn: "PATCH" },
      { how: ".managerId =", fn: "PATCH" },
    ]);
    expect(writesIn(`export async function POST() {\n  await prisma.user.create({ data: { ...base, email } });\n}`)).toEqual([{ how: "user.create (data held elsewhere)", fn: "POST" }]);
    expect(writesIn(`async function link() {\n  await prisma.user.update({ where: { id }, data: { manager: { connect: { id: m } } } });\n}`)).toEqual([{ how: "manager.connect", fn: "link" }]);
    expect(writesIn(`function f() {\n  return prisma.user.update({ where: { id }, data: { lastSignInAt: new Date() } });\n}`)).toEqual([]);
  });
});

describe("every reader and writer of a person's line and profile is listed (E16)", () => {
  const files = serverFiles();
  const rel = userRelationNames();

  it("lists each file the search finds, with what it touches, and no file it no longer finds", () => {
    const found: Record<string, Kind[]> = {};
    for (const f of files) {
      const kinds = touchesOf(f.src, rel);
      if (kinds.length > 0) found[f.rel] = kinds;
    }
    const listed = Object.fromEntries(Object.entries(ENTRIES).map(([file, e]) => [file, e.kinds]));
    // A new file here: read it, mark it a, b (with its step) or c, and say why.
    expect(found).toEqual(listed);
  });

  it("marks each one: a (b) names its step of this program, an (a) or a (c) names none, and each says why", () => {
    for (const [file, e] of Object.entries(ENTRIES)) {
      expect(["a", "b", "c"], file).toContain(e.mark);
      if (e.mark === "b") expect([2, 3, 4, 5, 7, 8], file).toContain(e.step);
      else expect(e.step, file).toBeUndefined();
      expect(e.why.length, file).toBeGreaterThan(8);
      expect(e.why, file).not.toMatch(/—|–|--/);
    }
  });

  it("lists every writer by file and top-level function, each allowed or named for the step that moves it into seat-writes.ts", () => {
    const writers: Record<string, string[]> = {};
    for (const f of files) {
      const w = writesIn(f.src);
      if (w.length > 0) writers[f.rel] = [...new Set(w.map((x) => x.fn))].sort();
    }
    // A new writer, or a write in another function: read it, and say why it may write.
    expect(writers).toEqual(Object.fromEntries(Object.entries(WRITERS).map(([file, w]) => [file, [...w.functions].sort()])));
    for (const [file, w] of Object.entries(WRITERS)) {
      expect(["made", "moved", "seat", "key", "proof", "none", "step 4", "step 5", "step 7"], file).toContain(w.writes);
      expect(w.why.length, file).toBeGreaterThan(8);
      expect(w.why, file).not.toMatch(/—|–|--/);
      // Still to move into seat-writes.ts: a reader of its step too.
      if (w.writes.startsWith("step ")) expect(ENTRIES[file], file).toMatchObject({ mark: "b" });
    }
    expect(WRITERS["src/lib/access/seat-writes.ts"].writes).toBe("seat");
    expect(WRITERS["src/lib/access/workspace-anchor.ts"].writes).toBe("moved");
  });

  it("keeps no (b) entry and no step writer of a step marked merged (the done gate)", () => {
    for (const step of MERGED) expect(MERGE_NEEDS).toContain(step);
    for (const [file, e] of Object.entries(ENTRIES)) if (e.mark === "b") expect(MERGED, `${file} is still (b) for step ${e.step}`).not.toContain(e.step);
    for (const [file, w] of Object.entries(WRITERS)) if (w.writes.startsWith("step ")) expect(MERGED, `${file} still writes outside seat-writes.ts (${w.writes})`).not.toContain(Number(w.writes.slice(5)) as Step);
  });

  // The step 1 review L7: each mark below is true of the code, not of the list.
  // When a step changes one of these reads, it flips the entry to (a) and
  // drops its line here.
  it("holds the plan's named readers at their marks, by the account-line reads they still make", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    // Steps 2 to 5 merged: none of the account-line reads this test named
    // for them is left (step 5's are held at the seat by "holds step 5's
    // doors" below).
    // Step 2 (merged): each reader it flipped reads THIS workspace's line,
    // held in the code (the reads above that it replaced are gone).
    const readsHere: Array<[string, RegExp]> = [
      ["src/lib/team.ts", /CROSS JOIN LATERAL \(\s+SELECT u\.id FROM "User" u\s+WHERE u\."managerId" = t\.id AND u\."organizationId" = \$\{organizationId\}/],
      ["src/lib/reporting-line.ts", /CROSS JOIN LATERAL \(\s+SELECT u\."id" FROM "User" u\s+WHERE u\."managerId" = t\."id" AND u\."organizationId" = \$\{organizationId\}/],
      ["src/lib/access/membership.ts", /reportsHereOf\(organizationId, \[managerId\], db\)/],
      ["src/lib/access/manager-lines.ts", /\{ managerId: seat\.managerId, agent: isAgentOf\(seat\.level\), inactive: seat\.deactivated \|\| ended \}/],
      ["src/lib/people/teams-counts.ts", /reportsHereOf\(organizationId, \[userId\]\)/],
      ["src/app/api/calendar/events/route.ts", /reportsHereOf\(orgId, \[viewerId\]\)/],
      ["src/lib/access/app-floor-impact.server.ts", /workspaceDottedLines\(organizationId\)/],
      ["src/lib/access/manager-candidate.ts", /cursor = seat \? seat\.managerId : null;/],
      ["scripts/access-parity-job.mjs", /lines\.reportsHereOf\(organizationId, picked\.map/],
      ["scripts/lib/parity-node-section.mjs", /lines\.reportsHereOf\(organizationId, viewers\.map/],
    ];
    for (const [file, read] of readsHere) {
      expect(ENTRIES[file], file).toBeDefined();
      expect(code(file), file).toMatch(read);
    }
    for (const file of ["src/lib/team.ts", "src/lib/reporting-line.ts"]) expect(code(file), file).not.toMatch(/JOIN (team|tree) t ON u\."managerId"/);
    expect(code("src/app/api/reviews/[id]/manager-review/route.ts")).not.toMatch(/managerId/);
    expect(code("scripts/access-parity-job.mjs")).not.toMatch(/directReports/);
    // Step 6 (live): the membership's placement and capacity, read at the seat.
    expect(ENTRIES["src/lib/access/seated-here.ts"]).toMatchObject({ kinds: ["profile"], mark: "a" });
    expect(code("src/lib/access/seated-here.ts")).toMatch(/MEMBERSHIP_SELECT = \{[^}]*departmentId: true, roleId: true, officeId: true, joinDate: true/);
  });

  // Step 3 (merged): every surface that shows a line shows THIS workspace's,
  // held in the code. Each pattern is the read that replaced the account's
  // line, the cross-workspace directReports relation or every workspace's
  // dotted rows, and the old read is gone.
  it("holds step 3's surfaces at the line here, by the reads that replaced the account's", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const readsHere: Array<[string, RegExp]> = [
      ["src/app/api/users/[id]/route.ts", /reportsHereOf\(organizationId, \[managerId\]\)/],
      ["src/app/api/users/[id]/route.ts", /seat\.managerId \? prisma\.user\.findUnique\(\{ where: \{ id: seat\.managerId \}/],
      ["src/app/api/users/[id]/route.ts", /prisma\.userDottedLine\.findMany\(\{ where: \{ userId: id, organizationId: ctx\.organizationId \}/],
      ["src/app/api/users/[id]/route.ts", /dottedLineToManagers: \{\s+where: \{ organizationId: ctx\.organizationId \}/],
      ["src/app/api/users/[id]/dotted-lines/route.ts", /where: \{ userId: id, organizationId: ctx\.organizationId \}/],
      ["src/app/api/users/[id]/record-access/route.ts", /let next = seat\.managerId;/],
      ["src/app/api/users/[id]/record-access/route.ts", /next = \(await linesHereOf\(ctx\.organizationId, \[m\.id\]\)\)\.get\(m\.id\) \?\? null;/],
      ["src/app/api/users/[id]/record-access/route.ts", /where: \{ organizationId: ctx\.organizationId, userId: subject\.id,/],
      ["src/app/api/my-team/route.ts", /seatsHeldFor\(orgId, teamMembers\)/],
      ["src/lib/access/members-list.server.ts", /managerId: r\.managerId \?\? null,/],
      ["src/lib/people/directory-list.server.ts", /reportsHereOf\(organizationId, managerIds\)/],
      ["src/lib/people/directory-list.server.ts", /seats = seats\.filter\(\(m\) => m\.seat\.managerId === w\.managerId\)/],
      ["src/lib/people/directory-list.server.ts", /dottedLineToManagers: \{ where: \{ organizationId: ctx\.organizationId \}, select: \{ managerId: true \} \}/],
      ["src/app/api/users/export/route.ts", /seatOfRow\(u\)\?\.managerId \?\? null/],
      ["src/app/api/users/route.ts", /seatOf\.get\(u\.id\)!\.managerId \?\? null : u\.managerId/],
      ["src/app/api/users/route.ts", /reportsHere\(orgId, users\.map\(\(u\) => u\.id\)\)/],
      ["src/app/api/reviews/[id]/peers/route.ts", /linesHereOf\(organizationId, \[id\]\), seatPlacementsHere\(organizationId, \[row\]\)/],
      ["src/app/api/ai/route.ts", /reportsHereOf\(orgId, users\.map\(\(u\) => u\.id\)\)/],
      ["src/app/api/team/members-work/route.ts", /\.\.\.placement, \.\.\.line \}/],
    ];
    for (const [file, read] of readsHere) {
      expect(ENTRIES[file], file).toBeDefined();
      expect(code(file), file).toMatch(read);
    }
    // The reads they replaced are gone.
    expect(code("src/app/api/users/[id]/route.ts")).not.toMatch(/directReports: \{|recordLinesOfOthers|managerElsewhere|dottedElsewhere/);
    expect(code("src/app/api/users/[id]/dotted-lines/route.ts")).not.toMatch(/keptElsewhere: others\.size/);
    expect(code("src/app/api/users/[id]/record-access/route.ts")).not.toMatch(/next = m\.managerId;|select: \{ \.\.\.PERSON, managerId: true \}/);
    expect(code("src/lib/access/members-list.server.ts")).not.toMatch(/user: \{ select: \{ managerId: true/);
    expect(code("src/lib/people/directory-list.server.ts")).not.toMatch(/directReports: \{|_count\.directReports|r\.user\?\.managerId|and\.push\(\{ managerId: w\.managerId \}\)/);
    for (const file of ["src/app/api/users/route.ts", "src/app/api/ai/route.ts"]) expect(code(file), file).not.toMatch(/directReports: (true|\{)/);
    expect(code("src/app/api/reviews/[id]/peers/route.ts")).not.toMatch(/subject: \{ select: \{ id: true, managerId: true/);
    expect(code("src/lib/people/named-here.ts")).not.toMatch(/managerElsewhere|dottedElsewhere:|dottedKept/);
    expect(code("src/lib/access/manager-lines.ts")).not.toMatch(/export async function recordLinesOfOthers/);
  });

  // Step 4 (merged): every write of a line writes THIS workspace's, through
  // seat-writes.ts, and the relied-line machinery is gone (E4 to E6, E10).
  it("holds step 4's writers on seat-writes.ts, and no relied-line machinery is left anywhere", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const writesHere: Array<[string, RegExp, number]> = [
      ["src/lib/people/handover.server.ts", /moveLinesHere\(tx, \{ organizationId: input\.organizationId, fromId: id, moves \}\)/, 1],
      ["src/lib/people/handover.server.ts", /moveLinesHere\(tx, \{ organizationId: orgId, fromId: agentId, moves:/, 1],
      ["src/lib/people/handover.server.ts", /removeDottedHere\(tx, orgId, found\.dottedIds\.map/, 1],
      ["src/lib/people/handover.server.ts", /return \(await reportsHereOf\(organizationId, \[id\], db\)\)\.filter\(\(r\) => r\.id !== id\)\.length;/, 1],
      ["src/lib/people/handover.server.ts", /where: \{ organizationId, managerId: agentId, userId: \{ not: agentId \}/, 1],
      ["src/app/api/users/[id]/handover/route.ts", /reportsHereOf\(orgId, \[id\]\)/, 1],
      ["src/app/api/users/[id]/route.ts", /writeLineHere\(tx, seatRefOf\(ctx\.organizationId, target\), lineNext\)/, 1],
      ["src/app/api/users/[id]/route.ts", /writeLineHere\(tx, await seatNowRef\(tx, ctx\.organizationId, id\), null\)/, 2],
      ["src/app/api/users/[id]/route.ts", /removeDottedHere\(tx, ctx\.organizationId, stale\.dotted\.map/, 2],
      // Step 5 opened both for the people here through a membership: the
      // seat as read, the account's workspace with it.
      ["src/app/api/users/[id]/dotted-lines/route.ts", /writeDottedHere\(tx, seatRefOf\(ctx\.organizationId, \{ id, organizationId: subject\.organizationId \}\)/, 1],
      ["src/app/api/people/bulk-update/route.ts", /writeLineHere\(tx, seatOf\.get\(id\)!, managerId\)/, 1],
      ["src/lib/scim-reactivate.ts", /removeDottedHere\(tx, organizationId, stale\.dotted\.map/, 1],
      ["src/lib/scim-reactivate.ts", /writeLineHere\(tx, seatRefOf\(organizationId, now\), null\)/, 1],
      ["src/lib/access/manager-candidate.ts", /personSeatIn\(organizationId, userId, db\)/, 1],
      ["src/lib/access/manager-candidate.ts", /db\.userDottedLine\.findMany\(\{ where: \{ userId, organizationId \}/, 1],
      ["src/app/api/auth/accept-invite/route.ts", /const asked = await managerOnAccept\(inv, tx\);/, 1],
      ["src/app/api/auth/accept-invite/route.ts", /isPrimary: false, \.\.\.placed, managerId \}/, 1],
      ["src/lib/agents/previews.ts", /managerCandidateIn\(org, managerId, \{ live: true \}\)/, 1],
      // The step 4 review fixes: a seat that comes back by invitation keeps
      // only the lines that hold (M1); a recipient with no seat here takes no
      // reports (L1); a held dotted line's manager is read again under the lock (L4).
      ["src/app/api/auth/accept-invite/route.ts", /writeLineHere\(tx, seatRefOf\(inv\.organizationId, now\), null\)/, 1],
      ["src/app/api/auth/accept-invite/route.ts", /removeDottedHere\(tx, inv\.organizationId, stale\.dotted\.map/, 1],
      ["src/lib/people/handover.server.ts", /const recipientInactive = !people\.has\(toId\) \|\| people\.get\(toId\)!\.inactive \|\| accountEnded;/, 1],
      ["src/app/api/users/[id]/dotted-lines/route.ts", /const seated = await liveHereAmong\(ctx\.organizationId, ids, tx\);/, 1],
    ];
    for (const [file, re, n] of writesHere) {
      expect(ENTRIES[file], file).toBeDefined();
      expect(count(file, re), `${file} ${re}`).toBe(n);
    }
    // The writes they replaced are gone: no account write of a line in the
    // handover or the bulk change, no unscoped dotted delete.
    expect(code("src/lib/people/handover.server.ts")).not.toMatch(/tx\.user\.updateMany|userDottedLine\.deleteMany/);
    expect(code("src/app/api/people/bulk-update/route.ts")).not.toMatch(/data: \{ managerId \}/);
    for (const f of ["src/app/api/users/[id]/route.ts", "src/lib/scim-reactivate.ts", "src/app/api/users/[id]/dotted-lines/route.ts"]) {
      expect(code(f), f).not.toMatch(/userDottedLine\.deleteMany|data: \{ managerId: null \}/);
    }
    // E6: the relied-line machinery, its words and its fields, nowhere in
    // the code (server and client files alike), comments aside.
    const retired = /\b(lineStandingsElsewhere|linesElsewhere|othersDottedLines|managerLineIsOthers|moveReliedReportsAtEnd|followAccountEndLines|otherWorkspaceRows|reportsStayingWith|keepRelied|dottedIsOthers|dottedElsewhereWords|linesAlsoElsewhereNote|linesStayNote|alsoElsewhereLogWords|reportsAtAccountEnd|reportsAlsoElsewhere|reportsStaying|keptElsewhere|managerElsewhere|dottedElsewhere|dottedKept|AccountEndLines|LineThere)\b|"manager_elsewhere"/;
    const all: string[] = [];
    for (const dir of ["src", "scripts"]) all.push(...sources(path.join(ROOT, dir)));
    const hits = all.filter((f) => retired.test(codeOf(readFileSync(f, "utf8")))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  // Step 5 (merged): a membership person's profile and lines are edited
  // HERE, through the same doors as anyone's, on the row that holds the seat
  // (E7 to E9 ii), held in the code; the reads and writes they replaced are
  // gone, and "read-only while they are working in another workspace" is
  // said nowhere.
  it("holds step 5's doors at the seat here, and PROFILE_ELSEWHERE is gone everywhere", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const doors: Array<[string, RegExp, number]> = [
      // PATCH: the profile through writeProfileHere on the seat as read, for both kinds.
      ["src/app/api/users/[id]/route.ts", /writeProfileHere\(tx, seatRefOf\(ctx\.organizationId, target\), profile\)/, 1],
      ["src/app/api/users/[id]/route.ts", /if \(identity\.length\) return err\(403, SHARED_IDENTITY_REFUSAL, \{ code: "identity_shared", fields: identity \}\);/, 1],
      ["src/app/api/users/[id]/route.ts", /editable: editable\.filter\(\(f\) => SEAT_FIELDS\.has\(f\)\)/, 1],
      ["src/app/api/users/[id]/route.ts", /if \(access\.profileData\) \{/, 1],
      // The dotted-lines PUT: a subject of either kind, the solid line the seat here holds left out.
      ["src/app/api/users/[id]/dotted-lines/route.ts", /personSeatIn\(ctx\.organizationId, id\),\n\s+\]\);/, 1],
      ["src/app/api/users/[id]/dotted-lines/route.ts", /\.filter\(\(m\) => m !== seat\.managerId\)/, 1],
      // Bulk: both halves, each written on the row that holds the seat.
      ["src/app/api/people/bulk-update/route.ts", /membershipHereWhere\(orgId, "kept", \{ id: \{ in: userIds \} \}\)/, 1],
      ["src/app/api/people/bulk-update/route.ts", /writeProfileHere\(tx, seatOf\.get\(id\)!, patch\)/, 1],
      // SCIM Groups: both halves, written through placeDepartmentHere in one
      // transaction per request (step 9; before, writeProfileHere per member).
      ["src/lib/scim-groups.ts", /placeDepartmentHere\(tx, \{ organizationId, userIds(: out|: keep)?, departmentId(: null, onlyFrom: departmentId)? \}\)/, 4],
      ["src/lib/scim-groups.ts", /prisma\.\$transaction\(/, 3],
      ["src/lib/scim-groups.ts", /await lockPeople\(tx, \[\.\.\.out, \.\.\.keep\]\);/, 1],
      ["src/lib/scim-groups.ts", /membershipHereWhere\(organizationId, "kept"\)/, 1],
      ["src/lib/scim-groups.ts", /writeProfileHere|lockPerson\(/, 0],
      // The batch write's guards: writeProfileHere's on each seat.
      ["src/lib/access/seat-writes.ts", /await lockPeople\(tx, ids\);/, 1],
      ["src/lib/access/seat-writes.ts", /where: \{ id: \{ in: ids \}, organizationId, deletedAt: null, \.\.\.placed \}/, 1],
      ["src/lib/access/seat-writes.ts", /where: \{ userId: \{ in: ids \}, organizationId, removedAt: null, user: \{ organizationId: \{ not: organizationId \}, deletedAt: null \}, \.\.\.placed \}/, 1],
      ["src/lib/access/workspace-anchor.ts", /ORDER BY "id" COLLATE "C" FOR NO KEY UPDATE/, 1],
      ["src/lib/scim-groups.ts", /membershipsPlacedHere\(organizationId, \{ departmentId \}\)/, 1],
      // Workload's capacity edit by PATCH's door, and a teammate's working days at the seat.
      ["src/app/api/team/workload/route.ts", /canEditCapacity: canWritePersonField\("weeklyCapacityHours"/, 1],
      ["src/lib/agents/connector-tools.ts", /capacityHereOf\(person\.organizationId, \[person\.userId\], prisma\)/, 1],
      // What this workspace writes for a membership person: everything but the shared identity.
      ["src/lib/people/person-fields.ts", /\.filter\(\(\[, group\]\) => group !== "personal" && group !== "dob"\)/, 1],
    ];
    for (const [file, re, n] of doors) expect(count(file, re), `${file} ${re}`).toBe(n);
    // The reads and writes they replaced are gone: the account's department
    // written by SCIM and bulk, the raw profile-field merge on User, the
    // PUT's anchored-only subject and its account-line filter, Workload's
    // anchored-only edit.
    for (const f of ["src/app/api/scim/v2/Groups/route.ts", "src/app/api/scim/v2/Groups/[id]/route.ts", "src/app/api/people/bulk-update/route.ts"]) {
      expect(code(f), f).not.toMatch(/prisma\.user\.updateMany|members: \{ select|_count: \{ select: \{ members/);
    }
    expect(code("src/app/api/users/[id]/route.ts")).not.toMatch(/UPDATE "User"|SET "customFields"/);
    expect(code("src/app/api/users/[id]/dotted-lines/route.ts")).not.toMatch(/subject\.managerId|deletedAt: null \}/);
    expect(code("src/app/api/team/workload/route.ts")).not.toMatch(/seat\.kind === "anchor" && canWritePersonField/);
    // PROFILE_ELSEWHERE and its sentence, nowhere in src/ (client files included), comments aside.
    const gone = /\bPROFILE_ELSEWHERE\b|"profile_elsewhere"|read-only while they are working in another workspace/;
    const hits = sources(path.join(ROOT, "src")).filter((f) => gone.test(codeOf(readFileSync(f, "utf8")))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  // The step 5 review fixes: no KRA or SOP is assigned to a membership
  // person here (M1), the Settings deletes count both halves (M2), and the
  // batch writers answer a timeout or a deadlock as "try again" (L5).
  it("holds the step 5 review's fixes in the code", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const fixes: Array<[string, RegExp, number]> = [
      // The final review L8: said only for a job title that carries KRAs, in one sentence.
      ["src/app/api/users/[id]/route.ts", /if \(carries > 0\) alignmentNote = \{ alignmentNote: JOB_TITLE_SAVED_NOT_ASSIGNED \};/, 1],
      ["src/app/api/users/[id]/route.ts", /seedAlignmentForUser\(/, 1],
      ["src/app/api/users/[id]/route.ts", /if \(identity\.length && relation === "self"\) return err\(409, OWN_SESSION_STALE_WORDS/, 1],
      // The final review M2: the refusal names the people it could not assign.
      ["src/app/api/sop-assignments/route.ts", /error: sopNotAssignedNamedWords\(names\), code: "alignment_elsewhere"/, 1],
      ["src/app/api/kra-assignments/route.ts", /return jsonError\(ALIGNMENT_NOT_HERE, 400\)/, 1],
      ["src/app/api/users/[id]/seed-alignment/route.ts", /return jsonError\(ALIGNMENT_NOT_HERE, 400\)/, 1],
      ["src/app/api/departments/[id]/route.ts", /dept\._count\.members \+ \(await membershipsPlacedHere\(orgId, \{ departmentId: id \}\)\)/, 1],
      ["src/app/api/offices/route.ts", /membershipsPlacedHere\(orgId, \{ officeId: id \}\)/, 1],
      ["src/app/api/roles/[id]/route.ts", /membershipsPlacedHere\(orgId, \{ roleId: id \}\)/, 1],
      // The final review L6: the placement batch's deadlock says "changing people", the manager batch's stays the role lock's.
      ["src/app/api/people/bulk-update/route.ts", /BATCH_TX\)\s*\.catch\(retryOrThrow\)/, 1],
      ["src/app/api/people/bulk-update/route.ts", /BATCH_TX\)\s*\.catch\(placementRetryOrThrow\)/, 1],
      ["src/app/api/scim/v2/Groups/[id]/route.ts", /await groupWriteRetry\(/, 3],
      ["src/app/api/scim/v2/Groups/route.ts", /await groupWriteRetry\(/, 1],
    ];
    for (const [file, re, n] of fixes) expect(count(file, re), `${file} ${re}`).toBe(n);
    // The only seeding left in PATCH is the anchored seat's, inside the else of the membership note.
    expect(code("src/app/api/users/[id]/route.ts")).toMatch(/alignmentNote = \{ alignmentNote: JOB_TITLE_SAVED_NOT_ASSIGNED \};\n\s+\} else \{\n\s+try \{\n\s+await seedAlignmentForUser\(/);
    expect(code("src/app/api/people/bulk-update/route.ts")).not.toMatch(/rolesBusyOrThrow|LOCKED_TX/);
  });

  // Step 7 (merged): SCIM's manager attribute (E9 i) is THIS workspace's
  // line for both kinds, read at the seat here and written through
  // writeLineHere under the role lock (taken before the person's row lock),
  // held in the code; a resource names it from the seat's line only.
  it("holds step 7's manager attribute at the seat here, under the role lock", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const held: Array<[string, RegExp, number]> = [
      // The one write: the row that holds the seat here, read under the person's lock.
      ["src/lib/scim-manager.ts", /writeLineHere\(tx, seatRefOf\(organizationId, account\), next\)/, 1],
      ["src/lib/scim-manager.ts", /await lockPerson\(tx, userId\);\n\s+const account = await tx\.user\.findUnique/, 1],
      ["src/lib/scim-manager.ts", /personSeatIn\(organizationId, userId, tx\)/, 1],
      // E4 and E5: a live seat here, no Agent, no loop in this workspace's lines.
      ["src/lib/scim-manager.ts", /managerCandidateIn\(organizationId, managerId, \{ db: tx, live: true \}\)/, 1],
      ["src/lib/scim-manager.ts", /wouldLoopIn\(organizationId, userId, managerId, tx\)/, 1],
      ["src/lib/scim-manager.ts", /await lockOrgRoles\(tx, organizationId\);\n\s+return scimManagerHere\(tx, organizationId, userId, ask\);/, 1],
      // A resource names the manager only while they hold a seat here.
      ["src/lib/scim-manager.ts", /peopleHereAmong\(organizationId, ids, "kept", db\)/, 1],
      ["src/lib/scim-manager.ts", /const line = seat\?\.managerId \?\? null;/, 1],
      // The doors: the role lock before the person's, in the same transaction as the fields.
      ["src/app/api/scim/v2/Users/[id]/route.ts", /if \(line\) await lockOrgRoles\(tx, organizationId\);\n\s+await lockPerson\(tx, id\);/, 1],
      ["src/app/api/scim/v2/Users/[id]/route.ts", /if \(line\) await scimManagerHere\(tx, organizationId, id, line\);/, 1],
      // The step 7 review L3: no change, no role lock (read before it; a change is checked again under it).
      ["src/app/api/scim/v2/Users/[id]/route.ts", /const line = manager && \(await scimManagerChanges\(organizationId, id, manager\)\) \? manager : undefined;/, 1],
      ["src/lib/scim-manager.ts", /if \(!\(await scimManagerChanges\(organizationId, userId, ask\)\)\) return \{ ok: true, outcome: \{ outcome: "unchanged" \} \};\n\s+try \{/, 1],
      // L7: an address resolves among live seats first, then deactivated ones; L1: the repeat rule compares the line too.
      ["src/lib/scim-manager.ts", /const live = await personHereByEmail\(organizationId, value, "live", db\);\n\s+return \(live \?\? \(await personHereByEmail\(organizationId, value, "kept", db\)\)\)\?\.id \?\? null;/, 1],
      ["src/lib/scim-manager.ts", /\(line\.managerId \?\? null\) === r\.before\) return;/, 1],
      // L2: the reactivation answers a transaction past its time as the 503 too.
      ["src/lib/scim-reactivate.ts", /const busy = retryAnswer\(e\);/, 1],
      ["src/app/api/scim/v2/Users/[id]/route.ts", /scimReactivateSeat\(organizationId, id, fields, manager\)/, 1],
      // A membership person's reactivation still carries none of the push's fields, only the manager.
      ["src/app/api/scim/v2/Users/[id]/route.ts", /writeScimUser\(organizationId, id, \{\}, true, manager\)/, 1],
      ["src/app/api/scim/v2/Users/[id]/route.ts", /const asked = managerAskOfOperation\(op\);/, 1],
      // The final review H1: read through the workspace's switch, off by default.
      ["src/app/api/scim/v2/Users/[id]/route.ts", /let manager = await scimManagerAsked\(auth\.organizationId, managerAskOfResource\(body\)\);/, 1],
      ["src/app/api/scim/v2/Users/route.ts", /if \(manager\) await lockOrgRoles\(tx, auth\.organizationId\);\n\s+if \(active\) \{\n\s+await lockWorkspaceSeats\(tx, auth\.organizationId, \{ bounded: !!manager \}\);/, 1],
      ["src/app/api/scim/v2/Users/route.ts", /if \(manager\) await scimManagerHere\(tx, auth\.organizationId, made\.id, manager\);/, 1],
      ["src/app/api/scim/v2/Users/route.ts", /scimReactivateSeat\(auth\.organizationId, ended\.userId, \{\}, asked\)/, 1],
      ["src/app/api/scim/v2/Users/route.ts", /managersShownHere\(auth\.organizationId, /, 2],
      ["src/lib/scim-reactivate.ts", /if \(manager\) await scimManagerHere\(tx, organizationId, userId, manager\);/, 1],
    ];
    for (const [file, re, n] of held) expect(count(file, re), `${file} ${re}`).toBe(n);
    // The list's members are named from the membership's line, never the account's (the anchored workspace's).
    expect(code("src/app/api/scim/v2/Users/route.ts")).toMatch(/organizationMemberships: \{ where: \{ organizationId: auth\.organizationId \}, select: \{ status: true, removedAt: true, managerId: true \} \}/);
    // No SCIM file writes a line itself, and the shared identity is still dropped for an account another workspace shares.
    for (const f of ["src/app/api/scim/v2/Users/route.ts", "src/app/api/scim/v2/Users/[id]/route.ts", "src/lib/scim-manager.ts"]) {
      expect(code(f), f).not.toMatch(/data:\s*\{\s*managerId|\.managerId\s*=(?!=)|organizationMembership\.update/);
    }
    expect(count("src/app/api/scim/v2/Users/[id]/route.ts", /await dropSharedIdentity\(data, id, auth\.organizationId\);/)).toBe(2);
    expect(code("src/lib/scim-reactivate.ts")).not.toMatch(/rolesBusyAnswer/);
  });

  // Step 8 (merged): every audience and count built from the people placed
  // in a department, a job title, an office or the whole workspace reads
  // them at the seat here, through profile-here.ts's two halves (E15), held
  // in the code. The files that read the account's placement for this and
  // now read it only through the helpers left the list above (the scanner no
  // longer finds them, and would find any read of the account's placement
  // that came back). KRA and SOP assignment and a review's launch stay with
  // the people anchored here, on purpose (the step 5 review M1).
  it("holds step 8's audiences and counts at the seat here, two halves, and KRA and SOP seeding anchored", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const held: Array<[string, RegExp, number]> = [
      // The helpers: two halves, the membership half never someone anchored here.
      ["src/lib/access/profile-here.ts", /anchored: opts\.only === "membership" \? null : \{ \.\.\.anchoredHereWhere\(organizationId, r\.anchored\), \.\.\.placed, \.\.\.\(among \? \{ id: \{ in: among \} \} : \{\}\) \}/, 1],
      ["src/lib/access/profile-here.ts", /membership: opts\.only === "anchor" \? null : \{ \.\.\.membershipHereWhere\(organizationId, r\.membership\), \.\.\.placed, \.\.\.\(among \? \{ userId: \{ in: among \} \} : \{\}\) \}/, 1],
      ["src/lib/access/profile-here.ts", /const where = \{ \.\.\.membershipHereWhere\(organizationId, reach\), \[column\]: \{ not: null \} \};/, 1],
      ["src/lib/access/profile-here.ts", /export const AUDIENCE_REACH = \{ anchored: "kept", membership: "live" \} as const satisfies Reach;/, 1],
      // Announcements: the audience, the viewer at their seat (feed, page, search), the roster.
      ["src/lib/announcement-audience.ts", /return idsPlacedHere\(orgId, by, AUDIENCE_REACH\);/, 1],
      ["src/app/api/announcements/route.ts", /const placed = await placementHereOf\(orgId, userId\);/, 1],
      ["src/app/api/announcements/[id]/route.ts", /const placed = await placementHereOf\(orgId, userId\);/, 1],
      ["src/app/api/search/route.ts", /placementHereOf\(orgId, me\)/, 1],
      ["src/app/api/announcements/[id]/acknowledge/route.ts", /peopleHereAmong\(orgId, expectedIds, \{ anchored: "kept", membership: "live" \}\)/, 1],
      // Goals: members by department and job title, the viewer, the team.
      ["src/lib/goal-audience.ts", /peoplePlacedHere\(orgId, \{ departmentIds: \[\.\.\.deptIds\], roleIds: \[\.\.\.roleIds\] \}, "active"\)/, 1],
      ["src/lib/goal-audience.ts", /placementHereOf\(getOrgId\(session\), callerId\)/, 1],
      ["src/lib/goal-audience.ts", /: await placementHereOf\(orgId, callerId\);/, 1],
      ["src/lib/goal-audience.ts", /peopleHereAmong\(organizationId, teamIds, "active"\)/, 1],
      ["src/app/api/okrs/route.ts", /await placementHereOf\(orgId, callerId\)/, 1],
      ["src/app/api/okrs/route.ts", /teamAudienceVisibilityOr\(orgId, reports\)/, 1],
      ["src/app/api/okrs/my-okrs/route.ts", /const me = await placementHereOf\(orgId, userId\);/, 1],
      ["src/lib/goals/goal-contributor.ts", /const me = await placementHereOf\(orgId, userId, "kept"\);/, 1],
      // Candor and surveys: the viewer at their seat, the people asked.
      ["src/lib/performance/candor.server.ts", /departmentId: v\.departmentId \?\? null,/, 1],
      ["src/lib/performance/candor.server.ts", /peoplePlacedHere\(ctx\.organizationId, "everyone", AUDIENCE_REACH\)/, 1],
      ["src/lib/performance/candor.server.ts", /idsPlacedHere\(orgId, session\.departmentId \? \{ departmentIds: \[session\.departmentId\] \} : "everyone", AUDIENCE_REACH\)/, 1],
      ["src/app/api/candor/[id]/respond/route.ts", /const me = await placementHereOf\(orgId, userId\);/, 1],
      ["src/lib/performance/survey.server.ts", /officeId: v\.officeId \?\? null,/, 1],
      ["src/lib/performance/survey.server.ts", /return idsPlacedHere\(organizationId, spec\.placed, AUDIENCE_REACH, among \? \{ among \} : \{\}\);/, 1],
      ["src/lib/performance/survey.server.ts", /return countPlacedHere\(organizationId, spec\.placed, AUDIENCE_REACH\);/, 1],
      ["src/lib/performance/survey.server.ts", /if \(s\.audienceType === "(OFFICES|DEPARTMENTS|ALL)"\) return \{ placed: /, 3],
      ["src/app/api/pulse-surveys/[id]/respond/route.ts", /const viewer = await placementHereOf\(orgId, userId\);/, 1],
      ["src/lib/people/culture-gate.ts", /officeId: viewer\.officeId \?\? null,/, 1],
      ["src/app/api/boot/route.ts", /const teamsPass = placementHereOf\(orgId, userId\)/, 1],
      // Policies: by department and everyone, the figures, the panel, compliance and the ledger.
      ["src/app/api/policies/[id]/assignments/route.ts", /idsPlacedHere\(orgId, \{ departmentIds: \[departmentId\] \}, "live"\)/, 1],
      ["src/app/api/policies/[id]/assignments/route.ts", /idsPlacedHere\(orgId, "everyone", "live"\)/, 1],
      ["src/app/api/policies/[id]/route.ts", /countPeopleHere\(\{ organizationId: orgId, reach: AUDIENCE_REACH \}\)/, 1],
      ["src/app/api/policies/[id]/route.ts", /everyoneHereIds\(orgId, AUDIENCE_REACH\)/, 1],
      ["src/app/api/policies/route.ts", /countPeopleHere\(\{ organizationId: orgId, reach: AUDIENCE_REACH \}\)/, 1],
      ["src/app/api/policies/route.ts", /everyoneHereIds\(orgId, AUDIENCE_REACH\)/, 2],
      ["src/lib/policy-compliance.ts", /peoplePlacedHere\(orgId, query\.departmentId \? \{ departmentIds: \[query\.departmentId\] \} : "everyone", AUDIENCE_REACH,/, 1],
      ["src/lib/policy-ledger.ts", /peoplePlacedHere\(orgId, "everyone", AUDIENCE_REACH,/, 1],
      // A job title's holders: the boundary request, the SOP step owner, the approver, the role pages.
      ["src/app/api/role-boundaries/request/route.ts", /peoplePlacedHere\(orgId, \{ roleIds: \[area\.ownerRole\.id\] \}, "active"\)/, 1],
      ["src/lib/access/job-title-holders.ts", /where: \{ \.\.\.membershipHereWhere\(organizationId, "any"\), roleId: \{ in: ids \} \}/, 1],
      ["src/lib/workflow/engine.ts", /personHere\(args\.organizationId, args\.actorId, \{ anchored: "any", membership: "live" \}\)/, 1],
      ["src/app/(dashboard)/people/roles/[id]/page.tsx", /peoplePlacedHere\(orgId, \{ roleIds: \[id\] \}, "kept", \{ only: "membership" \}\)/, 1],
      ["src/app/api/roles/[id]/route.ts", /peoplePlacedHere\(orgId, \{ roleIds: \[id\] \}, "kept", \{ only: "membership" \}\)/, 1],
      ["src/app/api/roles/[id]/alignment/route.ts", /membershipsPlacedHere\(orgId, \{ roleId: id \}\)/, 1],
      // The Settings counts, the kept seats their deletes refuse by, and the export.
      ["src/app/api/departments/route.ts", /membershipPlacedCounts\(orgId, "departmentId", "kept"\)/, 1],
      ["src/app/api/offices/route.ts", /membershipPlacedCounts\(orgId, "officeId", "kept"\)/, 1],
      ["src/app/api/roles/route.ts", /membershipPlacedCounts\(orgId, "roleId", "kept"\)/, 1],
      ["src/lib/export/workspace-export.server.ts", /membershipPlacedCounts\(orgId, "departmentId", "kept"\)/, 1],
      // The final review L5: the membership half counted as Members' No manager lists it.
      ["src/app/(dashboard)/settings/structure/page.tsx", /membershipsListedWithNoManager\(orgId\)/, 1],
      // The kudos filter's membership half, read on its own.
      ["src/app/api/kudos/route.ts", /idsPlacedHere\(orgId, \{ departmentIds: \[dept\] \}, "any", \{ only: "membership" \}\)/, 1],
      ["src/lib/sop-compliance.ts", /seatPlacementsHere\(orgId, read\.map\(\(a\) => a\.user\)\)/, 1],
      // Anchored on purpose (the step 5 review M1): KRA seeding, SOP assignment by department or everyone.
      ["src/lib/alignment-assign.ts", /where: \{ roleId, organizationId, status: "ACTIVE" \},/, 1],
      ["src/app/api/sop-assignments/route.ts", /where: \{ departmentId, organizationId: orgId, status: \{ not: "INACTIVE" \}, deletedAt: null \},/, 1],
    ];
    for (const [file, re, n] of held) expect(count(file, re), `${file} ${re}`).toBe(n);
    // The account-placement reads they replaced are gone.
    expect(code("src/app/api/boot/route.ts")).not.toMatch(/select: \{ officeId: true, departmentId: true \}/);
    expect(code("src/lib/goal-audience.ts")).not.toMatch(/ACTIVE_USER|prisma\.user\.find/);
    expect(code("src/lib/alignment-assign.ts")).not.toMatch(/peoplePlacedHere|idsPlacedHere|countPlacedHere|membershipPlacedCounts/);
    // The review launch reads the membership half once, only to say how many it leaves out (the final review, product L4), never to review them.
    expect(code("src/app/api/reviews/[id]/launch/route.ts")).not.toMatch(/idsPlacedHere|countPlacedHere|membershipPlacedCounts/);
    expect(count("src/app/api/reviews/[id]/launch/route.ts", /peoplePlacedHere\(/)).toBe(1);
    expect(code("src/app/api/reviews/[id]/launch/route.ts")).toMatch(/const notReviewedElsewhere = launchAudience\(\{ \.\.\.audience, people: elsewhere \}\)\.length;/);
    // The SOP route reads the membership half only to say who it left out (the step 8 review L5), never to assign.
    expect(code("src/app/api/sop-assignments/route.ts")).not.toMatch(/peoplePlacedHere|countPlacedHere|membershipPlacedCounts/);
    expect(count("src/app/api/sop-assignments/route.ts", /idsPlacedHere\(/)).toBe(1);
    expect(count("src/app/api/sop-assignments/route.ts", /idsPlacedHere\(orgId, all === true \? "everyone" : \{ departmentIds: \[departmentId\] \}, "live", \{ only: "membership" \}\)\)\.filter\(\(uid\) => !teamIds \|\| teamIds\.has\(uid\)\)\.length/)).toBe(1);
    for (const f of ["src/lib/alignment-assign.ts", "src/app/api/sop-assignments/route.ts", "src/app/api/reviews/[id]/launch/route.ts", "scripts/reconcile-role-kras.mjs"]) {
      expect(ENTRIES[f], f).toMatchObject({ mark: "c" });
    }
  });

  // The step 8 review fixes: the doors the step left out, each reading the
  // audience at the seat here, held in the code. Some read no placement
  // themselves (they call the helpers), so the scanner does not list them;
  // these pins are what holds them.
  it("holds the step 8 review's fixes: the survey cron, the policy notices, tag audiences and the counts", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const held: Array<[string, RegExp, number]> = [
      // M1: the recurring survey cron reads the one survey audience, both rounds.
      ["src/app/api/cron/surveys-rotate/route.ts", /await surveyAudienceIds\(survey\.organizationId, survey\)/, 2],
      // M2: every policy notice from assignment rows, through the seat here.
      ["src/app/api/policies/[id]/route.ts", /seatedHereAmong\(getOrgId\(session\), assignees\.map\(\(a\) => a\.userId\), AUDIENCE_REACH\)/, 1],
      ["src/app/api/policies/[id]/route.ts", /seatedHereAmong\(orgId, assignees\.map\(\(a\) => a\.userId\), AUDIENCE_REACH\)/, 1],
      ["src/lib/policy-remind.ts", /seatedHereAmong\(orgId, opts\.targets\.map\(\(t\) => t\.userId\), AUDIENCE_REACH\)/, 1],
      // M3: a tag's holders at the seat here.
      ["src/lib/announcement-audience.ts", /seatedHereAmong\(orgId, await resolveUserIdsByTags\(orgId, aud\.ids\), AUDIENCE_REACH\)/, 1],
      // L1: the weekly policy reminder, the policy's audience in both halves.
      ["src/app/api/email/send-reminders/route.ts", /seatedHereAmong\(p\.organizationId, assigned\.map\(\(a\) => a\.userId\), "live"\)/, 1],
      ["src/app/api/email/send-reminders/route.ts", /everyoneHereIds\(p\.organizationId, "live"\)/, 1],
      // L2: a survey's audience counted, the respondents read by id.
      ["src/lib/performance/survey.server.ts", /surveyAudienceCount\(organizationId, s\)/, 1],
      ["src/lib/performance/survey.server.ts", /surveyAudienceIds\(organizationId, s, responderIds\)/, 1],
      // L3: the membership half of a listed count is grouped.
      ["src/lib/access/profile-here.ts", /db\.organizationMembership\.groupBy\(\{ by: \["(departmentId|roleId|officeId)"\], where, _count: \{ _all: true \} \}\)/, 3],
      // L4: Ask AI's Owner snapshot counts both halves.
      ["src/app/api/ai/route.ts", /countPeopleHere\(\{ organizationId: orgId, reach: "kept" \}\)/, 1],
      ["src/app/api/ai/route.ts", /membershipPlacedCounts\(orgId, "departmentId", "kept"\)/, 1],
      // L5: SOP assignment by department or everyone says who it left out.
      ["src/app/api/sop-assignments/route.ts", /\.\.\.elsewhereNote \}/, 3],
      // L6: a named survey's segment and respondents at the seat here.
      ["src/app/api/pulse-surveys/[id]/responses/route.ts", /surveySegmentIds\(orgId, \{ officeId, departmentId \}\)/, 1],
      ["src/app/api/pulse-surveys/[id]/responses/route.ts", /surveyRespondentsHere\(orgId, /, 1],
      ["src/app/api/pulse-surveys/[id]/responses/export/route.ts", /surveySegmentIds\(orgId, \{ officeId, departmentId \}\)/, 1],
      ["src/app/api/pulse-surveys/[id]/responses/export/route.ts", /surveyRespondentsHere\(orgId, /, 1],
      // L7: a holder's address only to a reader of their people data.
      ["src/app/api/roles/[id]/route.ts", /ctx && readsPeopleDataOf\(ctx, p\.id\) \? p : \{ \.\.\.p, email: "" \}/, 1],
    ];
    for (const [file, re, n] of held) expect(count(file, re), `${file} ${re}`).toBe(n);
    // The readers they replaced are gone.
    expect(code("src/app/api/cron/surveys-rotate/route.ts")).not.toMatch(/resolveAudienceUserIds|resolveUserIdsByTags|prisma\.user\.findMany\(\{ where, /);
    for (const f of ["src/app/api/pulse-surveys/[id]/responses/route.ts", "src/app/api/pulse-surveys/[id]/responses/export/route.ts"]) {
      expect(code(f), f).not.toMatch(/userFilter|prisma\.user\.findMany/);
    }
    expect(code("src/lib/access/profile-here.ts")).not.toMatch(/organizationMembership\.findMany\(\{\s*where: \{ \.\.\.membershipHereWhere\(organizationId, reach\)/);
    // No tag audience tells a tag's holders without the seat here (surveys and goals already read them at the seat).
    expect(count("src/lib/performance/survey.server.ts", /seatedHereAmong\(organizationId, ids, AUDIENCE_REACH\)/)).toBe(1);
  });

  it("holds the final review's fixes, part A: the lines of seats back with the account, ended managers, the clears' rows, the week rows", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const held: Array<[string, RegExp, number]> = [
      // Integrity M1: every restore and reactivation checks the seats that came back with the account.
      ["src/app/api/users/[id]/route.ts", /clearLinesBackWithAccount\(tx, id, (restored|r), "(Reactivated|Restored)"\)/, 2],
      ["src/lib/scim-reactivate.ts", /clearLinesBackWithAccount\(tx, userId, restored, "Reactivated"\)/, 1],
      ["src/lib/access/workspace-status.ts", /const stale = await staleLinesOf\(organizationId, userId, tx\);/, 1],
      ["src/lib/access/workspace-status.ts", /writeLineHere\(tx, seatRefOf\(organizationId, account\), null\)/, 1],
      // Integrity M2: an ended account is never walked as a manager.
      ["src/lib/access/manager-lines.ts", /const live = got\.filter\(\(g\) => g\.deletedAt == null && g\.status !== ENDED_STATUS\);/, 1],
      // Integrity L2: the clears' rows and the dotted save's row in their transactions.
      ["src/app/api/users/[id]/route.ts", /await logClearedLines\(tx, /, 2],
      ["src/app/api/users/[id]/dotted-lines/route.ts", /await tx\.activityLog\.create\(/, 1],
      // Security M1: every week lookup names the workspace.
      ["src/lib/weekly-review.ts", /userId_organizationId_periodStart: \{ userId: args\.userId, organizationId: args\.organizationId, periodStart \}/, 3],
      ["src/lib/timesheet.ts", /userId_organizationId_weekStartDate: \{ userId, organizationId: orgId, weekStartDate \}/, 1],
      ["src/app/api/time-entries/route.ts", /userId_organizationId_weekStartDate: \{ userId, organizationId: orgId, weekStartDate: weekStart \}/, 2],
      ["src/app/api/time-entries/punch/route.ts", /userId_organizationId_weekStartDate: \{ userId, organizationId: orgId, weekStartDate: weekStart \}/, 2],
      ["src/app/api/timesheets/[id]/route.ts", /where: \{ organizationId: orgId \},\n\s+orderBy: \{ day: "asc" \}/, 1],
      // Security L1 and L2.
      ["src/app/api/users/route.ts", /if \(pagination\.sortBy && !USERS_SORTS\.has\(pagination\.sortBy\)\)/, 1],
      ["src/app/api/users/[id]/record-access/route.ts", /const managers = chain\.filter\(\(p\) => !agents\.has\(p\.id\) && liveHere\.has\(p\.id\)\);/, 1],
    ];
    for (const [file, re, n] of held) expect(count(file, re), `${file} ${re}`).toBe(n);
    // What they replaced is gone: the clears' rows after the commit, a week found by person and week alone.
    expect(code("src/app/api/users/[id]/route.ts")).not.toMatch(/metadata: \{ on(Restore|Reactivate): true, reason: line\.why \},\n\s+\}\);\n\s+\}\n\s+if \((stale\?|done\.stale)\.manager\)/);
    for (const f of ["src/lib/weekly-review.ts", "src/lib/timesheet.ts", "src/app/api/timesheets/route.ts", "src/app/api/time-entries/route.ts", "src/app/api/time-entries/punch/route.ts", "src/app/api/time/active/route.ts", "src/app/api/me/weekly-review/route.ts", "src/app/(dashboard)/me/weekly-review/page.tsx"]) {
      expect(code(f), f).not.toMatch(/userId_periodStart|userId_weekStartDate/);
    }
    expect(code("src/lib/access/manager-lines.ts")).not.toMatch(/where: \{ id: \{ in: frontier \}, deletedAt: null \}/);
  });

  it("holds the final review's fixes, part B: the identity provider's switch, KRAs and SOPs read here only, the counts and the words", () => {
    const code = (file: string) => codeOf(readFileSync(path.join(ROOT, file), "utf8"));
    const count = (file: string, re: RegExp) => code(file).match(new RegExp(re.source, "g"))?.length ?? 0;
    const held: Array<[string, RegExp, number]> = [
      // H1: every SCIM door reads the manager through the workspace's switch, off by default.
      ["src/lib/scim-manager.ts", /return idpSetsReportsToOf\(org\?\.settings\) \? ask : undefined;/, 1],
      ["src/app/api/scim/v2/Users/[id]/route.ts", /scimManagerAsked\(auth\.organizationId, /, 2],
      ["src/app/api/scim/v2/Users/[id]/route.ts", /manager = await scimManagerAsked\(auth\.organizationId, manager\);/, 1],
      ["src/app/api/scim/v2/Users/route.ts", /const asked = await scimManagerAsked\(auth\.organizationId, managerAskOfResource\(body\)\);/, 1],
      ["src/lib/settings/org-policy.ts", /return rec\(rec\(settings\)\.security\)\[IDP_SETS_REPORTS_TO\] === true;/, 1],
      ["src/lib/settings/org-settings-sections.ts", /identityProviderSetsReportsTo: z\.boolean\(\)\.optional\(\),/, 1],
      ["src/app/api/settings/route.ts", /type: "security\.provisioning\.updated",/, 1],
      ["src/app/(dashboard)/settings/security/page.tsx", /idp\.save\(\{ \[IDP_SETS_REPORTS_TO\]: v \}\)/, 1],
      // M4: the refused manager's row carries what was sent.
      ["src/lib/scim-manager.ts", /newValue: \{ managerAsked: r\.asked \},/, 1],
      // M5: every reader of a person's KRAs, KPI numbers and SOPs reads this workspace's only.
      ["src/app/api/me/kras/route.ts", /where: \{ userId: u\.id, status: "ACTIVE", kra: \{ organizationId: u\.organizationId \} \}/, 1],
      ["src/app/api/users/[id]/kpis/route.ts", /where: \{ userId, status: "ACTIVE", kra: \{ organizationId: orgId \} \}/, 1],
      ["src/app/api/kpi-records/self-report/route.ts", /where: \{ userId, status: "ACTIVE", kra: \{ organizationId: getOrgId\(session\) \} \}/, 1],
      ["src/app/api/reviews/[id]/self-assessment/route.ts", /status: "ACTIVE", kra: \{ organizationId: (orgId|getOrgId\(session\)) \}/, 2],
      ["src/app/api/reviews/[id]/self-assessment/route.ts", /sop: \{ organizationId: orgId \}, createdAt/, 1],
      ["src/app/api/kra-assignments/route.ts", /status: \{ not: "ARCHIVED" \}(, id: \{ not: existing\.id \})?, kra: \{ organizationId: orgId \}/, 2],
      ["src/app/api/kra-assignments/[id]/route.ts", /status: \{ not: "ARCHIVED" \},\n\s+kra: \{ organizationId: orgId \},/, 1],
      ["src/app/api/me/sops/route.ts", /status: \{ not: "COMPLETED" \}, sop: \{ organizationId: u\.organizationId \}/, 1],
      ["src/app/(dashboard)/me/weekly-review/page.tsx", /kra: \{ organizationId: viewer\.organizationId \}/, 1],
      ["src/app/api/me/home/route.ts", /kra: \{ organizationId \} \} \}\)|kpi: \{ organizationId \} \} \}\)/, 2],
      ["src/lib/team-alignment.ts", /status: "ACTIVE", kra: \{ organizationId \} \}|sop: \{ organizationId \} \}/, 2],
      ["src/lib/role-defaults.ts", /kra: \{ organizationId: user\.organizationId \}|none: \{ kra: \{ organizationId \} \}/, 2],
      ["src/app/api/people/backfill-role-defs/route.ts", /kraAssignments: \{ none: \{ kra: \{ organizationId: orgId \} \} \}/, 1],
      ["src/app/api/ai/route.ts", /kraAssignments: \{ where: \{ kra: \{ organizationId: orgId \} \} \}/, 1],
      ["src/app/api/team/attention/route.ts", /none: \{ status: "ACTIVE", kra: \{ organizationId: ctx\.organizationId \} \}/, 1],
      ["src/lib/kpi-review.server.ts", /status: "ACTIVE", kra: \{ organizationId: ctx\.organizationId \}/, 1],
      ["src/services/performanceScoreService.ts", /kpi: \{ organizationId \},|sop: \{ organizationId \} \}/, 2],
      ["src/lib/analytics.ts", /sop: \{ organizationId: orgId \}/, 3],
      ["src/lib/performance/review-cycle.server.ts", /sop: \{ organizationId \}/, 2],
      ["src/app/api/email/send-reminders/route.ts", /a\.kra\.organizationId === a\.user\.organizationId/, 1],
      ["src/app/api/cron/kpi-reminders/route.ts", /r\.kpi\.organizationId === r\.user\.organizationId/, 1],
      // Lows: Working on and the shared-identity line, the counts, the words.
      ["src/components/people/person-record.tsx", /\{workingOnShown\(person\) \? <WorkingOnSection/, 1],
      ["src/components/people/person-record.tsx", /\{sharedIdentityShown\(person\) \?/, 1],
      ["src/app/api/reviews/[id]/launch/route.ts", /peoplePlacedHere\(orgId, "everyone", "active", \{ only: "membership" \}\)/, 1],
      ["src/lib/scim-groups.ts", /const busy = placementRetryAnswer\(e\);/, 1],
      ["src/app/api/auth/accept-invite/route.ts", /clearedLineSentence\("Rejoined", name, line, solid\)/, 1],
      ["src/lib/access/workspace-status.ts", /clearedLineSentence\(verb === "Restored" \? "RestoredWithAccount" : "ReactivatedWithAccount", name, line, solid\)/, 1],
    ];
    for (const [file, re, n] of held) expect(count(file, re), `${file} ${re}`).toBe(n);
    // No reader of a person's KRAs, KPI numbers or SOPs by person alone is left in these files.
    const byPerson: Array<[string, RegExp]> = [
      ["src/app/api/me/kras/route.ts", /where: \{ userId: u\.id, status: "ACTIVE" \}/],
      ["src/app/api/users/[id]/kpis/route.ts", /where: \{ userId, status: "ACTIVE" \},/],
      ["src/app/api/kpi-records/self-report/route.ts", /where: \{ userId, status: "ACTIVE" \},/],
      ["src/app/api/reviews/[id]/self-assessment/route.ts", /where: \{ userId, status: "ACTIVE" \}/],
      ["src/app/api/me/home/route.ts", /count\(\{ where: \{ userId, status: "(ACTIVE|PENDING)" \} \}\)/],
      ["src/app/api/team/attention/route.ts", /none: \{ status: "ACTIVE" \} \}/],
    ];
    for (const [file, re] of byPerson) expect(code(file), `${file} ${re}`).not.toMatch(re);
  });
});
