// "An Agent can't be anyone's manager" (AGENT_TIER_BLURB) for the lines
// already stored (docs-found fixes batch 3). Rule 6 only stops a manager
// becoming an Agent while anyone reports to them; Agents made before it kept
// their reports and dotted lines. Every reader of User.managerId or
// UserDottedLine that grants reach now reads them through
// src/lib/access/manager-lines.ts (an Agent manages nobody; the people listed
// under one report to the next manager up; an Agent's dotted line counts for
// nobody), and every write of a line takes the role lock rule 6 counts under.
//
// The walkers, the helpers and the main routes are tested for behaviour
// beside each module (manager-lines.test.ts, person-access-agent.test.ts,
// review-cycle-agent.test.ts, weekly-review-agent.test.ts,
// app-floor-impact-agent.test.ts, handover.server.test.ts, the users routes).
// This file holds the rest of the wiring, one reader at a time, so a reader
// that slips back to the stored line fails here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** The code without its comments (block comments, and lines that are a comment). */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const between = (src: string, start: string, end?: string) => {
  const i = src.indexOf(start);
  expect(i, start).toBeGreaterThanOrEqual(0);
  const j = end ? src.indexOf(end, i + start.length) : -1;
  return src.slice(i, j > i ? j : undefined);
};

describe("the report trees and the facts read from them", () => {
  it("an Agent root finds nobody below in every walker", () => {
    expect(read("src/lib/team.ts")).toContain("return rows.map((r) => r.id).filter((id) => !agent || id === rootUserId);");
    const rl = read("src/lib/reporting-line.ts");
    expect(rl).toContain("return agent ? ids.filter((id) => id === rootUserId) : ids;");
    expect(rl).toContain("if (agent) return solidRows.filter((id) => id === rootUserId);");
    expect(rl).toContain("return effectiveDirectReportIds(organizationId, managerId);");
    expect(between(rl, "export async function getDottedReports(")).toContain("if (await managesNobody(managerId, organizationId)) return [];");
  });

  it("hasReports and peopleCtx never give an Agent a chain", () => {
    expect(read("src/lib/access/resolve.ts")).toContain("return !viewer.isAgent && !!viewer.reportTree && viewer.reportTree.size > 0;");
    const pa = read("src/lib/people/person-access.server.ts");
    expect(pa).toContain("const chain = new Set<string>(viewer.isAgent ? [] : viewer.reportTree ?? []);");
    expect(pa).toContain("if (!viewer.isAgent && (managerTier || chain.size > 0)) {");
  });

  it("the shell's has-reports, the goal rules and the app-floor preview say the same", () => {
    expect(between(read("src/lib/people/teams-counts.ts"), "export async function hasReportsFor(")).toContain("if (await managesNobody(userId, organizationId)) return false;");
    expect(read("src/lib/alignment-scope.ts")).toContain("manager || isAgentOf(level)\n      ? Promise.resolve(0)");
    // workspace-status-2 step 2: the lines here, of both halves, at the tier held here.
    expect(read("src/lib/access/app-floor-impact.server.ts")).toContain("for (const line of [...users, ...members]) if (line.managerId && !agents.has(line.managerId)) managers.add(line.managerId);");
  });
});

describe("direct reports and dotted lines read past an Agent", () => {
  it("every direct-report read goes through effectiveDirectReportIds, every dotted one through the counted reads", () => {
    expect(read("src/app/api/kra-assignments/route.ts")).toContain("const reportIds = await effectiveDirectReportIds(orgId, managerId);");
    const okrs = read("src/app/api/okrs/route.ts");
    expect(okrs).toContain("effectiveDirectReportIds(orgId, callerId),\n      countedDottedReportIds(orgId, callerId),");
    const scope = read("src/lib/people/team-scope.server.ts");
    expect(scope).toContain("effectiveDirectReportIds(ctx.organizationId, ctx.userId),\n    countedDottedReportIds(ctx.organizationId, ctx.userId),");
    expect(read("src/lib/process-run-access.ts")).toContain("countedDottedReportIds(orgId, callerId),");
    expect(read("src/lib/team-rollup.ts")).toContain("const own = reports.filter((r) => !directSet.has(r));");
    expect(read("src/app/api/calendar/events/route.ts")).toContain("hasTeam = !agent && Boolean(direct || dotted);");
  });

  it("Who can see this record lists no Agent on the line or the dotted lines", () => {
    const ra = read("src/app/api/users/[id]/record-access/route.ts");
    // And no manager deactivated here (the final review of workspace-status-2, security L2).
    expect(ra).toContain("const managers = chain.filter((p) => !agents.has(p.id) && liveHere.has(p.id));");
    expect(ra).toContain("const dotted = dottedRows.filter((d) => !agents.has(d.manager.id));");
    expect(ra).toContain('people: managers, total: managers.length },');
  });
});

describe("the manager a row names is never an Agent", () => {
  it("review cycles: launch, the cycle page, the manager review, and the reporting-line follow", () => {
    const launch = read("src/app/api/reviews/[id]/launch/route.ts");
    expect(launch).toContain("const managerOf = await effectiveManagersOf(orgId, employees.map((emp) => emp.id));");
    expect(launch).toContain("reviewerId: managerOf.get(emp.id) || launcherId,");
    expect(launch).not.toContain("emp.managerId || launcherId");
    const cycle = read("src/app/api/reviews/[id]/route.ts");
    expect(cycle).toContain("const facts = await reviewerFacts(orgId, cycle.reviews);");
    expect(cycle).not.toContain("subjectManagerId: review.subject.managerId");
    const mr = read("src/app/api/reviews/[id]/manager-review/route.ts");
    expect(mr.match(/await reviewerFacts\(/g)?.length).toBe(2);
    expect(mr).not.toMatch(/subjectManagerId: (review|found)\.subject\.managerId/);
    // Step 4's review (L1): it may run in the caller's transaction, so it reads through `db`.
    expect(between(read("src/lib/performance/review-cycle.server.ts"), "export async function followReportingLine(")).toContain("effectiveManagersOf(organizationId, ids, db),");
    expect(read("src/app/(dashboard)/reviews/[id]/page.tsx")).toContain("viewer.isAgent ? Promise.resolve(0) : reviewsWrittenBy(viewer.organizationId, viewer.userId, { cycleId: id, subjectId: { not: viewer.userId } })");
  });

  it("weekly reviews: the recorded manager, the queues, the decision gate and the reminders", () => {
    const wr = read("src/lib/weekly-review.ts");
    expect(wr).toContain("const managerId = await effectiveManagerOf(args.organizationId, args.userId);");
    expect(wr).toContain("const managerId = row ? await effectiveManagerOf(row.organizationId, row.userId) : null;");
    expect(wr.match(/await managerQueueWhereFor\(managerId, organizationId\)/g)?.length).toBe(3);
    expect(between(wr, "export async function chainQueueWhere(")).toContain("managerQueueWhereFor(managerId, organizationId),");
    expect(read("src/lib/people/weekly-queue.server.ts")).toContain('if (scope === "direct") return { AND: [base, await managerQueueWhereFor(ctx.userId, ctx.organizationId)] };');
    const gate = read("src/app/api/weekly-reviews/[id]/manager-review/route.ts");
    expect(gate).toContain("if (!allowed && row.managerId === u.id && !isAgentOf(u.accessLevel)) {");
    expect(gate).toContain("allowed = !(await effectiveManagerOf(row.organizationId, row.userId));");
    expect(read("src/lib/access/legacy-resolve.ts")).toContain("if (review.managerId === viewer.userId && !isAgentOf(viewer.accessLevel)) {");
    expect(read("src/app/api/weekly-reviews/reminders/route.ts")).toContain("await effectiveManagersOf(ctx.organizationId, waiting.map((w) => w.userId))");
  });

  it("timesheets and purchase orders: the approver at creation, and the approver's own gates", () => {
    for (const p of ["src/app/api/timesheets/route.ts", "src/app/api/time-entries/route.ts", "src/app/api/time-entries/punch/route.ts", "src/app/api/purchase-orders/route.ts", "src/app/api/purchase-orders/[id]/route.ts"]) {
      const src = read(p);
      expect(src, p).toContain("effectiveManagerOf(orgId, userId");
      expect(src, p).not.toContain("me?.managerId");
    }
    const ts = read("src/app/api/timesheets/[id]/route.ts");
    expect(ts.match(/approvesAs\(timesheet, userId, session\.user\??\.accessLevel\)/g)?.length).toBe(3);
    expect(ts).not.toContain("timesheet.approverId === userId ||");
    expect(read("src/app/api/timesheets/route.ts")).toContain("[{ approverId: { in: agentStamps }, userId: { in: reports } }]");
  });

  it("KPI numbers tell the manager above an Agent, and no Agent's dotted line", () => {
    const kr = between(read("src/lib/kpi-review.server.ts"), "export async function notifyKpiSubmitted(");
    expect(kr).toContain("effectiveManagerOf(args.organizationId, args.userId),\n    countedDottedManagerIds(args.organizationId, args.userId),");
    expect(kr).not.toContain("me.managerId");
  });
});

describe("every write of a reporting line takes the role lock rule 6 counts under", () => {
  it("Reports to on a person, in bulk, on a new account and on an accepted invitation", () => {
    const patch = read("src/app/api/users/[id]/route.ts");
    // Batch 5: a reactivation takes it too, to re-check the person's lines,
    // and so does clearing Reports to (every write of a line, not only a new one).
    // workspace-status-2 step 4: the line is held apart from the account's
    // columns (lineNext), and read at the seat here (target.seat.managerId).
    expect(patch).toContain("const lineWrite = lineNext !== undefined;");
    expect(patch).toContain("if (roleNext || deactivating || lineWrite || reactivating) await lockOrgRoles(tx, ctx.organizationId);");
    // Batch 6: the manager they already have is no new manager, so a new one
    // is always checked live, and the loop always walked.
    expect(patch).toContain("const newManager = typeof lineNext === \"string\" && lineNext !== target.seat.managerId ? lineNext : null;");
    expect(patch).toContain("const again = await managerCandidateIn(ctx.organizationId, newManager, { db: tx, live: true });");
    expect(patch).toContain("if (await wouldLoopIn(ctx.organizationId, id, newManager, tx)) {");
    const bulk = read("src/app/api/people/bulk-update/route.ts");
    expect(bulk).toContain("await lockOrgRoles(tx, orgId);\n          const again = await managerCandidateIn(orgId, managerId, { db: tx, live: true });");
    const create = read("src/app/api/users/route.ts");
    expect(create).toContain("await lockOrgRoles(tx, getOrgId(session));");
    expect(create).toContain("const again = await managerCandidateIn(getOrgId(session), reportsTo, { db: tx, live: true });");
    // workspace-status-2 E10 (step 4): both joins read the invitation's
    // manager under the role lock, the signed-in one too.
    const accept = read("src/app/api/auth/accept-invite/route.ts");
    expect(accept.split("if (inv.managerId) await lockOrgRoles(tx, inv.organizationId);").length).toBe(2);
    // The step 4 review M1: the signed-in join also takes it when a seat here
    // comes back, to check that seat's old lines under it (staleLinesOf).
    expect(accept).toContain("if (inv.managerId || held) await lockOrgRoles(tx, inv.organizationId);");
    expect(accept).toContain("stale = await staleLinesOf(inv.organizationId, me.id, tx);");
    expect(accept).toContain("const asked = await managerOnAccept(inv, tx);");
  });

  it("dotted lines, the handover, an Agent's move and a restore", () => {
    const dotted = read("src/app/api/users/[id]/dotted-lines/route.ts");
    // Batch 6: only this workspace's lines are checked and replaced (since
    // workspace-status-2 step 4 every named line, through writeDottedHere).
    expect(dotted).toContain("await lockOrgRoles(tx, ctx.organizationId);\n    if (ids.length && (await agentIdsIn(ctx.organizationId, ids, tx)).size > 0) return { refused: \"agent\" as const };");
    const handover = read("src/lib/people/handover.server.ts");
    // The plan and its moves under the lock; since workspace-status-2 step 4
    // every report here moves (no line kept for another workspace, E6).
    const lines = between(handover, "export async function runHandover(", "export async function previewReportHandover(");
    expect(lines).toContain("await lockOrgRoles(tx, orgId);\n    const plan = await reportPlanFor(orgId, id, reassignToId, tx);\n    const done = await writeReportMoves(tx, input, plan, reassignToId);");
    expect(between(handover, "export async function moveAgentReports(")).toContain("await lockOrgRoles(tx, orgId);\n    const found = await agentPlanFor(orgId, agentId, tx);");
    const restore = between(read("src/app/api/users/[id]/route.ts"), "  if (restore) {", "// Removing someone who holds Admin");
    // Batch 5: the seat wait after the role lock is bounded.
    expect(restore).toContain("await lockOrgRoles(tx, ctx.organizationId);");
    expect(restore.indexOf("await lockWorkspaceSeats(tx, ctx.organizationId, { bounded: true });")).toBeGreaterThan(restore.indexOf("await lockOrgRoles(tx, ctx.organizationId);"));
    expect(restore).toContain("const stale = await staleLinesOf(ctx.organizationId, id, tx);");
  });
});

describe("an Admin sees an Agent's stored reports and can move them", () => {
  it("the Members list carries them, and the drawer shows the notice with Move their reports", () => {
    expect(read("src/lib/access/members-list.server.ts")).toContain("agentReports: agentLines.get(u.id) ?? null,");
    const drawer = read("src/app/(dashboard)/settings/members/member-drawer.tsx");
    expect(drawer).toContain("{m.isAgent && canEditPeople && m.agentReports && m.agentReports.solid + m.agentReports.dotted > 0 ? (");
    expect(drawer).toContain("apiFetch<AgentReportsPlan>(`/api/users/${memberId}/agent-reports`, { cache: \"no-store\" })");
    expect(drawer).toContain("disabled={!note || busy} onClick={() => { void move(); }}>Move their reports</button>");
    expect(drawer).toContain("onClick={() => setAttempt((n) => n + 1)}>Retry</button>");
    const route = read("src/app/api/users/[id]/agent-reports/route.ts");
    expect(route).toContain("done = await moveAgentReports({ organizationId: g.ctx.organizationId, agentId: id, actorId: g.ctx.userId, expect });");
    expect(route).toContain("if (!isPeopleAdmin(ctx))");
  });
});

// Docs-found fixes batch 4: the rule holds on every path. The walkers and
// the routes are tested for behaviour beside each module (manager-lines,
// viewer-agent-tree, weekly-queue-agent, review-writer.route,
// team-rollup-agent, handover.server, org-roles-lock, the users routes);
// this holds the rest of the wiring, one reader at a time.
describe("batch 4: the tier held in the workspace whose lines are walked", () => {
  it("every walker names its workspace, and the team walk keeps a root who works here by membership", () => {
    const rl = read("src/lib/reporting-line.ts");
    expect(rl).toContain("return scope.rootIsAgent ?? (await managesNobody(rootUserId, scope.organizationId));");
    // Batch 5: the solid walk keeps to the people who hold a level in that
    // workspace (it named none), root and reports, and so does the team walk
    // below its root (anchored here only, before).
    expect(rl).toContain("const [agent, ids] = await Promise.all([rootManagesNobody(rootUserId, scope), solidTreeRows(rootUserId, scope.organizationId, opts)]);");
    // workspace-status-2 step 2: the root by its seat here, and each step
    // down by the line HERE, both halves joined to the recursive name by a
    // LATERAL subquery (the anchored by their account's line, the
    // memberships by theirs), never the account line of everyone.
    const tree = between(rl, "async function solidTreeRows(", "SELECT DISTINCT");
    expect(tree.split(`OR EXISTS (SELECT 1 FROM "OrganizationMembership" m`).length).toBe(2);
    expect(tree).toContain("CROSS JOIN LATERAL (");
    expect(tree).toContain(`WHERE u."managerId" = t."id" AND u."organizationId" = \${organizationId} AND u."deletedAt" IS NULL`);
    expect(tree).toContain(`WHERE m."managerId" = t."id" AND m."organizationId" = \${organizationId} AND \${keptSeatSql("m")}`);
    expect(tree).not.toContain(`JOIN tree t ON u."managerId"`);
    const teamWalk = between(read("src/lib/team.ts"), "UNION", "SELECT id FROM team");
    expect(teamWalk).toContain("CROSS JOIN LATERAL (");
    expect(teamWalk).toContain(`WHERE u."managerId" = t.id AND u."organizationId" = \${organizationId} AND u."deletedAt" IS NULL`);
    expect(teamWalk).toContain(`WHERE m."managerId" = t.id AND m."organizationId" = \${organizationId} AND \${keptSeatSql("m")}`);
    expect(teamWalk).toContain(`AND u."organizationId" <> \${organizationId} AND u."deletedAt" IS NULL`);
    expect(teamWalk).not.toContain(`INNER JOIN team t ON u."managerId"`);
    const team = read("src/lib/team.ts");
    expect(team).toContain('OR EXISTS (SELECT 1 FROM "OrganizationMembership" m');
    expect(team).toContain(": managesNobody(rootUserId, organizationId);");
    expect(read("src/lib/access/manager-lines.ts")).toContain("return isAgentOf(await levelHeldIn(userId, organizationId, undefined, db));");
    // Kept seats (workspace status, step 1 review M2): an Agent deactivated here through a membership keeps the tier, as one anchored here does.
    expect(read("src/lib/access/manager-candidate.ts")).toContain("const held = await levelsHeldIn(organizationId, ids, db, { keptSeats: true });");
  });

  it("the engine's viewer empties the tree for an Agent here, and facts never read a tree for an Agent", () => {
    const v = read("src/lib/access/viewer.ts");
    expect(v).toContain("const agentHere = viewer.isAgent || isAgentOf(storedLevel);");
    expect(v).toContain("reportTree: agentHere ? new Set<string>() : reports,");
    expect(v).toContain("reportTreeFor(viewer.userId, viewer.organizationId),");
    const f = read("src/lib/access/facts.ts");
    expect(f).toContain("const managed: ReadonlySet<string> | undefined = viewer.isAgent ? undefined : viewer.reportTree;");
    expect(f).not.toContain("viewer.reportTree?.has(");
  });

  it("every walk rooted at a person names the workspace", () => {
    const sites: Array<[string, string]> = [
      ["src/app/api/bulk-decide/route.ts", "getEffectiveReportTree(userId, { organizationId: orgId })"],
      ["src/app/api/calendar/events/route.ts", "managesNobody(viewerId, orgId),"],
      ["src/app/api/export/[type]/route.ts", "getEffectiveReportTree(userId, { organizationId: orgId })"],
      ["src/app/api/reviews/history/route.ts", "isInReportTree(callerId, userId, { organizationId: orgId })"],
      ["src/app/api/timesheets/route.ts", "getEffectiveReportTree(userId, { organizationId: orgId })"],
      ["src/app/api/timesheets/[id]/route.ts", "getEffectiveReportTree(userId, { organizationId: orgId, rootIsAgent: isAgentOf(session.user?.accessLevel) })"],
      ["src/app/api/weekly-reviews/[id]/manager-review/route.ts", "isInReportTree(u.id, row.userId, { organizationId: u.organizationId, rootIsAgent: isAgentOf(u.accessLevel) })"],
      ["src/lib/access/legacy-resolve.ts", "return { organizationId: viewer.organizationId, rootIsAgent: isAgentOf(viewer.accessLevel) };"],
      ["src/lib/kpi-record.ts", "getEffectiveReportTree(managerId, { organizationId })"],
      ["src/lib/team-alignment.ts", "getEffectiveReportTree(managerId, { organizationId }, { maxDepth: 6 })"],
      ["src/lib/team-rollup.ts", "getAllDirectReports(directorId, organizationId)"],
      ["src/lib/people/review-cycle-access.ts", "chainOf(v.userId, { organizationId: v.organizationId, rootIsAgent: v.isAgent })"],
      ["src/lib/people/weekly-queue.server.ts", "getEffectiveReportTree(v.userId, { organizationId: v.organizationId, rootIsAgent: v.isAgent })"],
      ["src/lib/performance/review-cycle.server.ts", "getEffectiveReportTree(v.userId, { organizationId: v.organizationId, rootIsAgent: v.isAgent })"],
      ["src/app/api/team/attention/route.ts", "countReviewsAwaitingManager(ctx.userId, ctx.organizationId)"],
      ["src/app/api/team/weekly-reviews/route.ts", "listReviewsForManager(ctx.userId, ctx.organizationId, {"],
    ];
    for (const [p, wiring] of sites) expect(read(p), p).toContain(wiring);
  });
});

describe("batch 4: a stamp naming an Agent grants that Agent nothing", () => {
  it("every review route reads the writer, never the stamp", () => {
    expect(read("src/app/api/reviews/[id]/manager-review/route.ts")).toContain("const written = await reviewsWrittenBy(orgId, userId, { cycleId });");
    // Batch 5: with nobody writing it, the People team and Admins may.
    expect(read("src/app/api/reviews/[id]/manager-review/route.ts")).toContain("const review = found && facts && (writer === userId || unclaimed) ? found : null;");
    expect(read("src/lib/performance/review-cycle.server.ts")).toContain("if (w === r.subjectId && !facts.selfStamped.has(r.subjectId)) return null;");
    expect(read("src/app/api/reviews/[id]/peer-feedback/route.ts").match(/reviewWritersIn\(orgId, \[/g)?.length).toBe(2);
    expect(read("src/app/api/reviews/[id]/peer-feedback/route.ts")).not.toContain("review.reviewerId === userId");
    expect(read("src/app/api/reviews/[id]/peers/route.ts")).not.toContain("review.reviewerId === ctx.userId");
    const rem = read("src/app/api/reviews/[id]/reminders/route.ts");
    expect(rem).toContain("const writers = await reviewWritersIn(orgId, rows.map((r) => ({ ...r, cycleStatus: cycle.status })));");
    expect(rem).not.toContain("owed.set(r.reviewerId");
    expect(read("src/app/api/cron/review-closing/route.ts")).toContain("const writers = await reviewWritersIn(c.organizationId,");
    expect(read("src/app/api/cron/review-closing/route.ts")).not.toContain("owed.set(r.reviewerId");
    expect(read("src/app/api/reviews/[id]/self-assessment/route.ts")).toContain("userId: writer,");
    const cycle = read("src/app/api/reviews/[id]/route.ts");
    expect(cycle).toContain("...(agentHere ? [] : [{ reviewerId: callerId }])");
    expect(cycle).toContain("isReviewer: cycle.reviews.some((r) => r.subjectId !== callerId && writerOf(r) === callerId),");
    expect(cycle).toContain('const review = lens === "subject" ? stored : asWritten(stored);');
    expect(read("src/app/api/reviews/route.ts")).toContain("...(ctx.isAgent ? [] : [{ reviewerId: ctx.userId }])");
    expect(read("src/app/api/reviews/[id]/launch/route.ts")).toContain("(r.reviewerId === launcherId && launcherWritesNothing)");
    expect(read("src/lib/people/teams-counts.ts")).toContain('reviewsWrittenBy(orgId, userId, { cycle: { status: "ACTIVE" }, subjectId: { not: userId }, status: { in: ["PENDING", "SELF_ASSESSMENT"] } })');
    expect(read("src/app/api/me/export/route.ts")).toContain("() => reviewsStampedTo(userId),");
  });

  it("weekly reviews, timesheets and purchase orders", () => {
    const decide = read("src/app/api/weekly-reviews/[id]/manager-review/route.ts");
    expect(decide).toContain("const recorded = row.managerId && !(await managesNobody(row.managerId, row.organizationId)) ? row.managerId : null;");
    expect(read("src/app/api/purchase-orders/[id]/route.ts")).toContain("(po.approverId === userId && !isAgentOf(session.user?.accessLevel))");
    expect(read("src/app/api/purchase-orders/route.ts")).toContain("...(agentStamps.length ? [{ approverId: { in: agentStamps } }] : [])");
    expect(read("src/app/api/time-entries/punch/route.ts")).toContain("!(await managesNobody(sheet.approverId, orgId))");
    // workspace-status-2 E10 (step 4): the signed-in join writes the manager too, so /join names it to an existing account as well.
    // And never one that join drops (themselves, or a loop: the step 4 review L3).
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain("      managerName: joinDropsManager ? null : placement.managerName,");
  });

  it("a handover never goes to a deactivated person, and a new manager is live", () => {
    const route = read("src/app/api/users/[id]/handover/route.ts");
    expect(route.match(/if \(recipient\.status === "INACTIVE"\) return jsonError\(inactiveRecipientWords\(/g)?.length).toBe(2);
    expect(route).toContain("where: { organizationId: orgId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS },");
    expect(read("src/app/api/people/bulk-update/route.ts")).toContain("const above = await lineAbove(orgId, managerId, tx);");
  });
});

describe("batch 4: every writer that waits on the role lock answers busy, never a 500", () => {
  it("each route turns OrgRolesBusy into its 503", () => {
    // Batch 7: PATCH's refusals are thrown (one outcome), and its catch maps them before the busy answer.
    // Batch 8: DELETE's removal throws when it finds the person removed meanwhile, so its moves roll back.
    // Step 3 (workspace-status): the restore throws restoreSeat's refusal, so it rolls back, and maps it before the busy answer.
    expect(read("src/app/api/users/[id]/route.ts").match(/\.catch\(rolesBusyOrThrow\)/g)?.length).toBeUndefined();
    expect(read("src/app/api/users/[id]/route.ts")).toContain(".catch((e: unknown) => (e instanceof RestoreRefused ? { no: e.no } : rolesBusyOrThrow(e)));");
    expect(read("src/app/api/users/[id]/route.ts")).toContain(".catch((e: unknown) => (e instanceof PatchRefused ? e.refusal : rolesBusyOrThrow(e)));");
    // Step 3 review L1: a seat plan that changed under the lock rolls back too.
    expect(read("src/app/api/users/[id]/route.ts")).toContain('.catch((e: unknown) => (e instanceof AlreadyRemoved ? ("already" as const) : e instanceof SeatPlanChanged ? ("changed" as const) : rolesBusyOrThrow(e)));');
    for (const p of ["src/app/api/users/route.ts", "src/app/api/users/[id]/dotted-lines/route.ts", "src/app/api/settings/ownership/route.ts"]) {
      expect(read(p), p).toContain(".catch(rolesBusyOrThrow)");
    }
    // workspace-status-2 step 5 review L5: the bulk update's two batch
    // transactions answer the same busy and deadlock 503, and a batch past
    // its 20 seconds too (retryOrThrow, over rolesBusyAnswer). The final
    // review L6: the placement batch's deadlock says "someone else is
    // changing people" (placementRetryOrThrow, over retryAnswer).
    expect(read("src/app/api/people/bulk-update/route.ts").match(/BATCH_TX\)\s*\.catch\(retryOrThrow\)/g)?.length).toBe(1);
    expect(read("src/app/api/people/bulk-update/route.ts").match(/BATCH_TX\)\s*\.catch\(placementRetryOrThrow\)/g)?.length).toBe(1);
    expect(read("src/lib/access/org-roles-busy.ts")).toContain("return retryAnswer(e);\n}");
    expect(read("src/lib/access/org-roles-busy.ts")).toContain("return rolesBusyAnswer(e) ?? (isTransactionTimeout(e) ?");
    expect(read("src/app/api/users/[id]/handover/route.ts")).toContain("const busy = rolesBusyResponse(e);");
    expect(read("src/app/api/users/[id]/agent-reports/route.ts")).toContain("const busy = rolesBusyResponse(e);");
    // Batch 5: both branches, and the seat lock's busy too (one answer).
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain('return fail("roles_busy", 503,');
    expect(read("src/app/api/auth/accept-invite/route.ts").split("if (isOrgRolesBusy(e)) return busyAnswer(orgName);").length).toBe(3);
    expect(read("src/lib/scim-deprovision.ts")).toContain("if (isOrgRolesBusy(e)) return { ok: false, status: 503, error: ORG_ROLES_BUSY };");
    expect(read("src/app/api/settings/members/bulk/route.ts")).toContain("const busy = rolesBusyAnswer(e);");
    // workspace-status-2 step 4 (the step 1 review L5): a deadlock Postgres
    // broke is the same busy answer, at every one of those routes, and at
    // SCIM's and the join's own answers.
    expect(read("src/lib/access/org-roles-busy.ts")).toContain("if (!isOrgRolesBusy(e)) return isDeadlock(e) ? { status: 503, error: ORG_ROLES_BUSY, code: \"roles_busy\", retryAfterSeconds: 2 } : null;");
    expect(read("src/lib/scim-deprovision.ts")).toContain("if (isDeadlock(e)) return { ok: false, status: 503, error: ORG_ROLES_BUSY };");
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain("if (isDeadlock(e)) return busyAnswer(orgName);");
  });

  it("every transaction that takes the role lock is one of those, and nothing else takes it", () => {
    const takers = [
      "src/app/api/auth/accept-invite/route.ts",
      "src/app/api/users/route.ts",
      "src/app/api/users/[id]/route.ts",
      "src/app/api/users/[id]/dotted-lines/route.ts",
      "src/app/api/people/bulk-update/route.ts",
      "src/lib/scim-deprovision.ts",
      "src/lib/people/handover.server.ts",
      "src/lib/access/membership.ts",
    ];
    for (const p of takers) expect(read(p), p).toMatch(/await lockOrgRoles\(/);
  });
});

// Docs-found fixes batch 5: "in this workspace" is the level held here
// (anchored here OR a membership here, acting-workspace.ts inWorkspaceWhere),
// and the seat lock after the role lock is bounded. Held to the wiring where
// a route's harness would be most of the test.
describe("batch 5: the people a line counts, and the bounded seat lock", () => {
  it("the Team pill and the Teams badge count live reports of this workspace only", () => {
    const counts = between(read("src/lib/people/teams-counts.ts"), "export async function hasReportsFor(", "/** Candor sessions");
    // Before: every workspace's lines, and removed dotted reports. Since
    // workspace-status-2 step 2: the solid reports by the line HERE
    // (reportsHereOf, both halves), the dotted ones this workspace's rows.
    expect(counts).toContain("reportsHereOf(organizationId, [userId]),");
    expect(counts).toContain("return solid.some((r) => r.id !== userId) || dotted > 0;");
    expect(counts).toContain("prisma.userDottedLine.count({ where: { organizationId, managerId: userId, userId: { not: userId }, user: { deletedAt: null, ...inWorkspaceWhere(organizationId, { deactivatedToo: true }) } } })");
    const cal = read("src/app/api/calendar/events/route.ts");
    // Before: a removed report answered the Team pill, and a dotted line from any workspace.
    expect(cal).toContain("reportsHereOf(orgId, [viewerId]).then((rows) => rows.some((r) => r.id !== viewerId)),");
    expect(cal).toContain("prisma.userDottedLine.findFirst({ where: { organizationId: orgId, managerId: viewerId, userId: { not: viewerId }, user: { deletedAt: null, ...inWorkspaceWhere(orgId, { deactivatedToo: true }) } }, select: { userId: true } })");
  });

  it("My team, Who can see this record, the dotted-line loop walk and the import read people who work here", () => {
    expect(read("src/lib/people/team-scope.server.ts")).toContain("...inWorkspaceWhere(ctx.organizationId, { deactivatedToo: !!opts.includeDeactivated }),");
    const access = read("src/app/api/users/[id]/record-access/route.ts");
    expect(access).toContain("prisma.user.findFirst({ where: { id: next, ...inWorkspaceWhere(ctx.organizationId, { deactivatedToo: true }) }");
    // The dotted managers at live seats here (the final review of workspace-status-2, security L2): a deactivated seat reads nothing.
    expect(access).toContain('manager: { deletedAt: null, status: { not: "INACTIVE" }, ...inWorkspaceWhere(ctx.organizationId) }');
    expect(access).toContain('where: { id: { in: chain.map((p) => p.id) }, deletedAt: null, status: { not: "INACTIVE" }, ...inWorkspaceWhere(ctx.organizationId) }');
    // Batch 6: the whole workspace's dotted lines through the indexed
    // statement, and My team's org-wide read too (acting-workspace.ts).
    expect(read("src/app/api/users/[id]/dotted-lines/route.ts")).toContain("    workspaceDottedLines(organizationId),\n");
    expect(read("src/lib/people/team-scope.server.ts")).toContain("? workspacePeopleLines(ctx.organizationId, { activeOnly: !opts.includeDeactivated })");
    const imp = read("src/app/api/people/bulk-import/route.ts");
    // Step 3: with the seat here (an ended one is someone to invite back, D13).
    expect(imp).toContain("select: { role: true, status: true, removedAt: true, user: { select: { id: true, email: true, organizationId: true } } }");
    expect(imp).toContain("const m = managerByEmail.get(reportsTo);");
    expect(imp).toContain('if (m.level === "AGENT") return fail("reportsTo", "An Agent can\'t be anyone\'s manager");');
  });

  it("every transaction that holds the role lock bounds its seat wait, and the acceptance's too", () => {
    const route = read("src/app/api/users/[id]/route.ts");
    expect(route.split("await lockWorkspaceSeats(tx, ctx.organizationId, { bounded: true });").length).toBe(3);
    expect(route).not.toContain("await lockWorkspaceSeats(tx, ctx.organizationId);");
    expect(read("src/app/api/users/route.ts")).toContain("await lockWorkspaceSeats(tx, getOrgId(session), { bounded: true });");
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain("await lockWorkspaceSeats(tx, organizationId, { bounded: true });");
    // Step 4's review (M1): SCIM's reactivation, from either door, is one path.
    expect(read("src/lib/scim-reactivate.ts")).toContain("await lockOrgRoles(tx, organizationId);\n      await lockWorkspaceSeats(tx, organizationId, { bounded: true });");
    // Set Owner: the role lock first, the seat wait bounded; between them the
    // people's row locks, in id order (the fixes review L1: never the
    // workspace row while it waits for a person a move holds).
    const owner = read("src/lib/admin/set-owner.ts");
    const roles = owner.indexOf("await lockOrgRoles(tx, companyId);");
    const people = owner.indexOf("for (const id of [...new Set([userId, ...owners])].sort()) await lockPerson(tx, id);");
    const seats = owner.indexOf("await lockWorkspaceSeats(tx, companyId, { bounded: true });");
    expect(roles).toBeGreaterThan(-1);
    expect(people).toBeGreaterThan(roles);
    expect(seats).toBeGreaterThan(people);
    expect(owner.split("await lockPerson(").length).toBe(2);
    expect(owner).not.toContain("await lockWorkspaceSeats(tx, companyId);");
  });

  it("the drawer says who writes a review nobody's manager writes", () => {
    const drawer = read("src/app/(dashboard)/reviews/[id]/manager-review-drawer.tsx");
    expect(drawer).toContain("No manager writes this review yet, so the People team and Admins write it.");
    expect(drawer).toContain("data.writesUnclaimed ? (");
  });
});

// Docs-found fixes batch 6, from the batch 5 review's lows: the acceptance's
// wiring, where a route harness would be most of the test.
describe("batch 6: the invitation acceptance", () => {
  const accept = read("src/app/api/auth/accept-invite/route.ts");

  it("writes only the invited workspace's own department, job title and office", () => {
    expect(accept).toContain("const placed = await placementOnAccept(inv, tx);");
    expect(accept).toContain("departmentId: placed.departmentId,");
    expect(accept).toContain("roleId: placed.roleId,");
    expect(accept).toContain("officeId: placed.officeId,");
    // Before: the invitation's stored ids, unchecked.
    expect(accept).not.toMatch(/^\s+(departmentId|roleId|officeId): inv\.(departmentId|roleId|officeId),$/m);
  });

  it("waits a bounded time for the invited Space, and a busy Space is the busy answer, never a 500", () => {
    const hold = between(accept, "async function holdInvitedSpace(", "/** The invitation's Space grant");
    expect(hold).toContain("SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)");
    expect(hold).toContain('SELECT id FROM "Space" WHERE id = ${spaceId} AND "organizationId" = ${inv.organizationId} FOR KEY SHARE');
    expect(hold).toContain("SET LOCAL lock_timeout TO DEFAULT");
    expect(hold).toContain("if (isLockTimeout(e)) throw new OrgRolesBusy(");
    const grant = between(accept, "async function grantInvitedSpace(", "/**\n * Role-definition fan-out");
    // Before: tx.space.findFirst, and the upsert's key lock waited unbounded.
    expect(grant).toContain("if (!(await holdInvitedSpace(tx, inv, inv.spaceId))) return;");
    expect(grant).not.toContain("tx.space.findFirst");
  });
});

// Docs-found fixes batch 8 moved the lines another workspace relied on inside
// the step that ended the account. workspace-status-2 step 4 (E4, E6): there
// is no such line, so no end moves one: the gate counts every report here
// under the lock, and the end writes the seat only.
describe("no end of a seat moves a line itself (workspace-status-2 E6)", () => {
  it("PATCH's deactivation, DELETE and SCIM end the seat after the gate, under the lock, with no line moved", () => {
    const route = read("src/app/api/users/[id]/route.ts");
    const patch = between(route, "export async function PATCH(", "export async function DELETE(");
    const tx = between(patch, "const outcome: Outcome | NextResponse = await prisma.$transaction(", "}, LOCKED_TX)");
    expect(tx.indexOf("await lockOrgRoles(tx, ctx.organizationId);")).toBeGreaterThan(-1);
    expect(tx.indexOf("holdsWork(await pendingHandover(ctx.organizationId, id, tx))")).toBeGreaterThan(tx.indexOf("await lockOrgRoles(tx, ctx.organizationId);"));
    expect(tx.indexOf("ended = await endSeat(tx, {")).toBeGreaterThan(tx.indexOf('const will = await endSeatWould(tx, { userId: id, organizationId: ctx.organizationId, kind: "deactivated" });'));
    const del = between(route, "// Removing someone who holds Admin changes who runs the workspace");
    expect(del.indexOf("const ended = await endSeat(tx, {")).toBeGreaterThan(del.indexOf("if (holdsWork(await pendingHandover(ctx.organizationId, id, tx))) {"));
    const scim = between(read("src/lib/scim-deprovision.ts"), "async function deprovisionSeat(", "async function resumePendingHandover(");
    expect(scim.indexOf('await endSeat(tx, { userId, organizationId, kind: "deactivated", actor: SCIM_ACTOR, expect: will });')).toBeGreaterThan(scim.indexOf("await lockOrgRoles(tx, organizationId);"));
    for (const [f, src] of [["users/[id]", route], ["scim", scim]] as const) {
      expect(codeOnly(src), f).not.toMatch(/moveReliedReportsAtEnd|followAccountEndLines|endLines/);
    }
  });

  it("the dialogs send no one with the step, and WORK's container locks never block a foreign-key check", () => {
    const shared = read("src/app/(dashboard)/settings/members/members-shared.tsx");
    // Before (batch 8): ?handoverTo= on the removal and { handoverTo } on the deactivation.
    expect(codeOnly(shared)).not.toContain("handoverTo");
    expect(shared).toContain("await apiFetch(`/api/users/${member.id}`, { method: \"DELETE\" })");
    expect(shared).toContain('json: { status: "INACTIVE" }');
    expect(codeOnly(read("src/components/people/remove-person-dialog.tsx"))).not.toContain("handoverTo");
    const work = read("src/lib/people/handover.server.ts");
    expect(work.match(/ORDER BY id FOR NO KEY UPDATE`/g)?.length).toBe(3);
    expect(work).not.toMatch(/"ownerId" = \$\{id\} ORDER BY id FOR UPDATE`/);
  });
});

// Docs-found fixes batch 9, from the batch 8 review: the handover's gate and
// the recipient a removal reads go by the viewer's own solid tree, and the
// dialogs say what really moved and when a line moves.
describe("batch 9: the handover goes by the chain, and the dialogs say what moved", () => {
  it("the handover route and the users route read mayHandOverPerson, never the relation's label", () => {
    const handover = read("src/app/api/users/[id]/handover/route.ts");
    const gate = between(handover, "async function gateHandover(", "export async function GET(");
    expect(gate).toContain("if (!(await mayHandOverPersonHere(ctx, id))) {");
    // Before: DELETE's rule over relationTo's label, which says "org-wide" first.
    expect(handover).not.toContain("mayRemovePersonHere");
    expect(gate).not.toContain("relationTo(");
    const route = read("src/app/api/users/[id]/route.ts");
    // For the handover_first refusal's words (step 4: no `handoverTo` is read any more, E6).
    expect(route).toContain("const canHandOver = mayHandOverPerson(ctx, id, target);");
    expect(route).toContain("const canHandOver = mayHandOverPerson(ctx, id, user);");
    expect(route).not.toMatch(/const handoverTo =/);
    expect(route).toContain("handover: !subject.deletedAt && mayHandOverPerson(ctx, subject.id, subject),");
    // The whole gate under the lock, in PATCH and DELETE.
    expect(route.match(/holdsWork\(await pendingHandover\(ctx\.organizationId, id, tx\)\)/g)?.length).toBe(2);
  });

  it("the Remove dialog builds a refused removal's words from what the handover answered, and asks nothing it may not", () => {
    const dialog = read("src/components/people/remove-person-dialog.tsx");
    expect(dialog).toContain("refusedRemovalWords({ firstName, recipientName: to.firstName || \"the new owner\", moved, error: d.error })");
    // Before: "Their open work moved to X" whenever a handover had run.
    expect(dialog).not.toContain("`Their open work${");
    // A viewer who may not hand the work over never reads the summary; since
    // the final review (product L6) they read the two notes alone, a boolean
    // and a count (GET ?notes=1, under DELETE's own rule).
    expect(dialog).toContain("if (!canHandOver) {");
    expect(dialog).toContain("`/api/users/${userId}/handover?notes=1`");
    expect(dialog.slice(dialog.indexOf("if (!canHandOver) {"), dialog.indexOf("let live = true;\n    void apiFetch<Handover>"))).not.toContain("apiFetch<Handover>");
    expect(read("src/components/people/person-record.tsx")).toContain("canHandOver={person.access.handover === true}");
  });

  // Batch 9 said when a line another workspace relied on moved; since
  // workspace-status-2 step 4 (E6) no such line exists, and the dialogs say
  // nothing of another workspace's lines.
  it("the transfer and Remove dialogs say nothing of another workspace's lines", () => {
    for (const f of ["src/app/(dashboard)/settings/members/members-shared.tsx", "src/components/people/remove-person-dialog.tsx", "src/app/(dashboard)/settings/members/member-drawer.tsx"]) {
      expect(codeOnly(read(f)), f).not.toMatch(/linesAlsoElsewhereNote|linesStayNote|reportsAlsoElsewhere|reportsAtAccountEnd|accountEnded/);
    }
  });
});
