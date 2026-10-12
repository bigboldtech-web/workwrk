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
    expect(read("src/lib/access/app-floor-impact.server.ts")).toContain("if (u.managerId && !agents.has(u.managerId)) managers.add(u.managerId);");
  });
});

describe("direct reports and dotted lines read past an Agent", () => {
  it("every direct-report read goes through effectiveDirectReportIds, every dotted one through the counted reads", () => {
    expect(read("src/app/api/kra-assignments/route.ts")).toContain("const reportIds = await effectiveDirectReportIds(orgId, managerId);");
    const okrs = read("src/app/api/okrs/route.ts");
    expect(okrs).toContain("effectiveDirectReportIds(orgId, callerId),\n      countedDottedReportIds(orgId, callerId),");
    expect(read("src/app/api/dashboard/team-dashboard/route.ts")).toContain("const directIds = await effectiveDirectReportIds(orgId, userId);");
    const scope = read("src/lib/people/team-scope.server.ts");
    expect(scope).toContain("effectiveDirectReportIds(ctx.organizationId, ctx.userId),\n    countedDottedReportIds(ctx.organizationId, ctx.userId),");
    expect(read("src/lib/process-run-access.ts")).toContain("countedDottedReportIds(orgId, callerId),");
    expect(read("src/lib/team-rollup.ts")).toContain("const own = reports.filter((r) => !directSet.has(r));");
    expect(read("src/app/api/calendar/events/route.ts")).toContain("hasTeam = !agent && Boolean(direct || dotted);");
  });

  it("Who can see this record lists no Agent on the line or the dotted lines", () => {
    const ra = read("src/app/api/users/[id]/record-access/route.ts");
    expect(ra).toContain("const managers = chain.filter((p) => !agents.has(p.id));");
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
    expect(between(read("src/lib/performance/review-cycle.server.ts"), "export async function followReportingLine(")).toContain("effectiveManagersOf(organizationId, ids),");
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
    expect(patch).toContain("const lineWrite = data.managerId !== undefined;");
    expect(patch).toContain("if (roleNext || deactivating || lineWrite || reactivating) await lockOrgRoles(tx, ctx.organizationId);");
    expect(patch).toContain("const again = await managerCandidateIn(ctx.organizationId, newManager, { db: tx, live: changing });");
    expect(patch).toContain("if (changing && (await wouldLoopIn(ctx.organizationId, id, newManager, tx))) {");
    const bulk = read("src/app/api/people/bulk-update/route.ts");
    expect(bulk).toContain("await lockOrgRoles(tx, orgId);\n          const again = await managerCandidateIn(orgId, managerId, { db: tx, live: true });");
    const create = read("src/app/api/users/route.ts");
    expect(create).toContain("await lockOrgRoles(tx, getOrgId(session));");
    expect(create).toContain("const again = await managerCandidateIn(getOrgId(session), reportsTo, { db: tx, live: true });");
  });

  it("dotted lines, the handover, an Agent's move and a restore", () => {
    const dotted = read("src/app/api/users/[id]/dotted-lines/route.ts");
    expect(dotted).toContain("await lockOrgRoles(tx, ctx.organizationId);\n    if (ids.length && (await agentIdsIn(ctx.organizationId, ids, tx)).size > 0) return true;");
    const handover = read("src/lib/people/handover.server.ts");
    expect(between(handover, "export async function runHandover(", "export async function previewReportHandover(")).toContain("await lockOrgRoles(tx, orgId);\n    const plan = await reportPlanFor(orgId, id, reassignToId, tx);");
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
    const tree = between(rl, "async function solidTreeRows(", "SELECT DISTINCT");
    expect(tree.split(`OR EXISTS (SELECT 1 FROM "OrganizationMembership" m`).length).toBe(3);
    const teamWalk = between(read("src/lib/team.ts"), "UNION", "SELECT id FROM team");
    expect(teamWalk).toContain(`OR EXISTS (SELECT 1 FROM "OrganizationMembership" m`);
    expect(teamWalk).not.toContain(`WHERE u."organizationId" = \${organizationId}`);
    const team = read("src/lib/team.ts");
    expect(team).toContain('OR EXISTS (SELECT 1 FROM "OrganizationMembership" m');
    expect(team).toContain(": managesNobody(rootUserId, organizationId);");
    expect(read("src/lib/access/manager-lines.ts")).toContain("return isAgentOf(await levelHeldIn(userId, organizationId, undefined, db));");
    expect(read("src/lib/access/manager-candidate.ts")).toContain("const held = await levelsHeldIn(organizationId, ids, db);");
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
      ["src/app/api/calendar/route.ts", "getEffectiveReportTree(c.userId, { organizationId: c.organizationId })"],
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
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain("managerName: account && account.organizationId !== inv.organizationId ? null : placement.managerName,");
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
    expect(read("src/app/api/users/[id]/route.ts").match(/\.catch\(rolesBusyOrThrow\)/g)?.length).toBe(3);
    for (const p of ["src/app/api/users/route.ts", "src/app/api/users/[id]/dotted-lines/route.ts", "src/app/api/people/bulk-update/route.ts", "src/app/api/settings/ownership/route.ts"]) {
      expect(read(p), p).toContain(".catch(rolesBusyOrThrow)");
    }
    expect(read("src/app/api/users/[id]/handover/route.ts")).toContain("const busy = rolesBusyResponse(e);");
    expect(read("src/app/api/users/[id]/agent-reports/route.ts")).toContain("const busy = rolesBusyResponse(e);");
    // Batch 5: both branches, and the seat lock's busy too (one answer).
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain('return fail("roles_busy", 503,');
    expect(read("src/app/api/auth/accept-invite/route.ts").split("if (isOrgRolesBusy(e)) return busyAnswer(orgName);").length).toBe(3);
    expect(read("src/lib/scim-deprovision.ts")).toContain("if (isOrgRolesBusy(e)) return { ok: false, status: 503, error: ORG_ROLES_BUSY };");
    expect(read("src/app/api/settings/members/bulk/route.ts")).toContain("const busy = rolesBusyAnswer(e);");
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
    // Before: every workspace's lines, and removed dotted reports.
    expect(counts).toContain("prisma.user.count({ where: { managerId: userId, id: { not: userId }, deletedAt: null, ...inWorkspaceWhere(organizationId) } })");
    expect(counts).toContain("prisma.userDottedLine.count({ where: { managerId: userId, userId: { not: userId }, user: { deletedAt: null, ...inWorkspaceWhere(organizationId) } } })");
    const cal = read("src/app/api/calendar/events/route.ts");
    // Before: a removed report answered the Team pill, and a dotted line from any workspace.
    expect(cal).toContain("prisma.user.findFirst({ where: { managerId: viewerId, id: { not: viewerId }, deletedAt: null, ...inWorkspaceWhere(orgId) }, select: { id: true } })");
    expect(cal).toContain("prisma.userDottedLine.findFirst({ where: { managerId: viewerId, userId: { not: viewerId }, user: { deletedAt: null, ...inWorkspaceWhere(orgId) } }, select: { userId: true } })");
  });

  it("My team, Who can see this record, the dotted-line loop walk and the import read people who work here", () => {
    expect(read("src/lib/people/team-scope.server.ts")).toContain("...inWorkspaceWhere(ctx.organizationId),");
    const access = read("src/app/api/users/[id]/record-access/route.ts");
    expect(access).toContain("prisma.user.findFirst({ where: { id: next, ...inWorkspaceWhere(ctx.organizationId) }");
    expect(access).toContain("manager: { deletedAt: null, ...inWorkspaceWhere(ctx.organizationId) }");
    expect(read("src/app/api/users/[id]/dotted-lines/route.ts")).toContain("where: { user: { deletedAt: null, ...inWorkspaceWhere(organizationId) } },");
    const imp = read("src/app/api/people/bulk-import/route.ts");
    expect(imp).toContain("select: { role: true, user: { select: { id: true, email: true } } }");
    expect(imp).toContain("const m = managerByEmail.get(reportsTo);");
    expect(imp).toContain('if (m.level === "AGENT") return fail("reportsTo", "An Agent can\'t be anyone\'s manager");');
  });

  it("every transaction that holds the role lock bounds its seat wait, and the acceptance's too", () => {
    const route = read("src/app/api/users/[id]/route.ts");
    expect(route.split("await lockWorkspaceSeats(tx, ctx.organizationId, { bounded: true });").length).toBe(3);
    expect(route).not.toContain("await lockWorkspaceSeats(tx, ctx.organizationId);");
    expect(read("src/app/api/users/route.ts")).toContain("await lockWorkspaceSeats(tx, getOrgId(session), { bounded: true });");
    expect(read("src/app/api/auth/accept-invite/route.ts")).toContain("await lockWorkspaceSeats(tx, organizationId, { bounded: true });");
    expect(read("src/app/api/scim/v2/Users/[id]/route.ts")).toContain("await lockOrgRoles(tx, organizationId);\n        await lockWorkspaceSeats(tx, organizationId, { bounded: true });");
    expect(read("src/lib/admin/set-owner.ts")).toContain("await lockOrgRoles(tx, companyId);\n      await lockWorkspaceSeats(tx, companyId, { bounded: true });");
  });

  it("the drawer says who writes a review nobody's manager writes", () => {
    const drawer = read("src/app/(dashboard)/reviews/[id]/manager-review-drawer.tsx");
    expect(drawer).toContain("No manager writes this review yet, so the People team and Admins write it.");
    expect(drawer).toContain("data.writesUnclaimed ? (");
  });
});
