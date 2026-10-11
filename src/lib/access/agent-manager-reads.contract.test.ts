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
    expect(rl).toContain("return effectiveDirectReportIds(head.organizationId, managerId);");
    expect(between(rl, "export async function getDottedReports(")).toContain("if (await managesNobody(managerId)) return [];");
  });

  it("hasReports and peopleCtx never give an Agent a chain", () => {
    expect(read("src/lib/access/resolve.ts")).toContain("return !viewer.isAgent && !!viewer.reportTree && viewer.reportTree.size > 0;");
    const pa = read("src/lib/people/person-access.server.ts");
    expect(pa).toContain("const chain = new Set<string>(viewer.isAgent ? [] : viewer.reportTree ?? []);");
    expect(pa).toContain("if (!viewer.isAgent && (managerTier || chain.size > 0)) {");
  });

  it("the shell's has-reports, the goal rules and the app-floor preview say the same", () => {
    expect(between(read("src/lib/people/teams-counts.ts"), "export async function hasReportsFor(")).toContain("if (await managesNobody(userId)) return false;");
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
    expect(read("src/lib/team-rollup.ts")).toContain("if (directSet.has(r.id)) continue;");
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
    expect(read("src/app/(dashboard)/reviews/[id]/page.tsx")).toContain("viewer.isAgent ? Promise.resolve(0) : prisma.review.count(");
  });

  it("weekly reviews: the recorded manager, the queues, the decision gate and the reminders", () => {
    const wr = read("src/lib/weekly-review.ts");
    expect(wr).toContain("const managerId = await effectiveManagerOf(args.organizationId, args.userId);");
    expect(wr).toContain("const managerId = row ? await effectiveManagerOf(row.organizationId, row.userId) : null;");
    expect(wr.match(/await managerQueueWhereFor\(managerId\)/g)?.length).toBe(3);
    expect(between(wr, "export async function chainQueueWhere(")).toContain("managerQueueWhereFor(managerId),");
    expect(read("src/lib/people/weekly-queue.server.ts")).toContain('if (scope === "direct") return { AND: [base, await managerQueueWhereFor(ctx.userId)] };');
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
    expect(read("src/app/api/timesheets/route.ts")).toContain("{ approver: AGENT_APPROVER, userId: { in: reports } }");
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
    expect(patch).toContain("if (roleNext || deactivating || newManager) await lockOrgRoles(tx, ctx.organizationId);");
    expect(patch).toContain("const again = await managerCandidateIn(ctx.organizationId, newManager, { db: tx });");
    const bulk = read("src/app/api/people/bulk-update/route.ts");
    expect(bulk).toContain("await lockOrgRoles(tx, orgId);\n          const again = await managerCandidateIn(orgId, managerId, { db: tx });");
    const create = read("src/app/api/users/route.ts");
    expect(create).toContain("await lockOrgRoles(tx, getOrgId(session));\n      const again = await managerCandidateIn(getOrgId(session), reportsTo, { db: tx });");
  });

  it("dotted lines, the handover, an Agent's move and a restore", () => {
    const dotted = read("src/app/api/users/[id]/dotted-lines/route.ts");
    expect(dotted).toContain("await lockOrgRoles(tx, ctx.organizationId);\n    if (ids.length && (await agentIdsIn(ctx.organizationId, ids, tx)).size > 0) return true;");
    const handover = read("src/lib/people/handover.server.ts");
    expect(between(handover, "export async function runHandover(", "export async function previewReportHandover(")).toContain("await lockOrgRoles(tx, orgId);\n    const plan = await reportPlanFor(orgId, id, reassignToId, tx);");
    expect(between(handover, "export async function moveAgentReports(")).toContain("await lockOrgRoles(tx, orgId);\n    const found = await agentPlanFor(orgId, agentId, tx);");
    const restore = between(read("src/app/api/users/[id]/route.ts"), "  if (restore) {", "// Removing someone who holds Admin");
    expect(restore).toContain("await lockOrgRoles(tx, ctx.organizationId);\n      await lockWorkspaceSeats(tx, ctx.organizationId);");
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
    expect(route).toContain("await moveAgentReports({ organizationId: g.ctx.organizationId, agentId: id, actorId: g.ctx.userId });");
    expect(route).toContain("if (!isPeopleAdmin(ctx))");
  });
});
