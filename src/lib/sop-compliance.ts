// The SOP compliance dashboard's data (spec-process section 2
// `/sops/compliance`), shared by GET /api/sop-assignments/compliance and its
// CSV export so the page and the file are the same rows. Server-only.
//
// Scope: the person rule (spec section 1). A manager sees their report tree,
// the org-wide roles everyone; a viewer with nobody in scope gets null and
// the route answers 403 (the page never reaches it: the sidebar row and the
// layout 404 gate on the same tier). Filters narrow the assignments BEFORE
// aggregation, so every figure on the page agrees: `q` matches the person's
// name and the SOP title, `departmentId` one department, `mandatory=1`
// mandatory assignments only.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrgId } from "@/lib/api-helpers";
import { personScope } from "@/lib/process-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildSopCompliance(session: any, req: NextRequest) {
  const scope = await personScope(session);
  if (!scope.canView) return null;
  const orgId = getOrgId(session);

  // The Filter panel's rows (spec-process section 2 `/sops/compliance`):
  // `q` matches the person's name and the SOP title, `departmentId` one
  // department, `mandatory=1` mandatory assignments only. Filters narrow the
  // assignments BEFORE aggregation, so every figure on the page agrees.
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const departmentId = sp.get("departmentId");
  const mandatoryOnly = sp.get("mandatory") === "1";
  const where: Record<string, unknown> = { sop: { organizationId: orgId } };
  if (!scope.orgWide && scope.userIds) where.userId = { in: Array.from(scope.userIds) };
  if (departmentId) where.user = { departmentId };
  if (mandatoryOnly) where.mandatory = true;
  if (q) {
    where.OR = [
      { sop: { title: { contains: q, mode: "insensitive" } } },
      { user: { firstName: { contains: q, mode: "insensitive" } } },
      { user: { lastName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const assignments = await prisma.sOPAssignment.findMany({
    where: where as never,
    include: {
      sop: { select: { id: true, title: true, category: true, sopType: true } },
      user: {
        select: {
          id: true, firstName: true, lastName: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Overall stats
  const total = assignments.length;
  const completed = assignments.filter((a) => a.status === "COMPLETED").length;
  const inProgress = assignments.filter((a) => a.status === "IN_PROGRESS").length;
  const overdue = assignments.filter(
    (a) => a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()
  ).length;
  const overallRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Per-department compliance
  const deptMap: Record<string, { name: string; total: number; completed: number; overdue: number; people: Set<string> }> = {};
  assignments.forEach((a) => {
    const dept = a.user.department;
    const deptId = dept?.id || "unassigned";
    const deptName = dept?.name || "No department";
    if (!deptMap[deptId]) deptMap[deptId] = { name: deptName, total: 0, completed: 0, overdue: 0, people: new Set() };
    deptMap[deptId].people.add(a.user.id);
    deptMap[deptId].total++;
    if (a.status === "COMPLETED") deptMap[deptId].completed++;
    if (a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()) deptMap[deptId].overdue++;
  });
  const departmentCompliance = Object.entries(deptMap).map(([id, d]) => ({
    departmentId: id,
    name: d.name,
    people: d.people.size,
    total: d.total,
    completed: d.completed,
    overdue: d.overdue,
    rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
  })).sort((a, b) => b.rate - a.rate);

  // Per-person scores
  const userMap: Record<string, { name: string; deptName: string; total: number; completed: number; avgScore: number; scores: number[]; overdue: number }> = {};
  assignments.forEach((a) => {
    const uid = a.user.id;
    if (!userMap[uid]) {
      userMap[uid] = {
        name: `${a.user.firstName} ${a.user.lastName}`,
        deptName: a.user.department?.name || "None",
        total: 0, completed: 0, avgScore: 0, scores: [], overdue: 0,
      };
    }
    userMap[uid].total++;
    if (a.status === "COMPLETED") {
      userMap[uid].completed++;
      if (a.score != null) userMap[uid].scores.push(a.score);
    }
    if (a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()) userMap[uid].overdue++;
  });
  const personScores = Object.entries(userMap).map(([id, u]) => ({
    userId: id,
    name: u.name,
    department: u.deptName,
    total: u.total,
    completed: u.completed,
    overdue: u.overdue,
    rate: u.total > 0 ? Math.round((u.completed / u.total) * 100) : 0,
    avgScore: u.scores.length > 0 ? Math.round(u.scores.reduce((a, b) => a + b, 0) / u.scores.length) : null,
  })).sort((a, b) => b.rate - a.rate);

  // Per-SOP compliance
  const sopMap: Record<string, { title: string; category: string | null; sopType: string; total: number; completed: number; overdue: number }> = {};
  assignments.forEach((a) => {
    const sid = a.sop.id;
    if (!sopMap[sid]) sopMap[sid] = { title: a.sop.title, category: a.sop.category, sopType: a.sop.sopType, total: 0, completed: 0, overdue: 0 };
    sopMap[sid].total++;
    if (a.status === "COMPLETED") sopMap[sid].completed++;
    if (a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()) sopMap[sid].overdue++;
  });
  const sopCompliance = Object.entries(sopMap).map(([id, s]) => ({
    sopId: id,
    title: s.title,
    category: s.category,
    sopType: s.sopType,
    total: s.total,
    completed: s.completed,
    overdue: s.overdue,
    rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
  })).sort((a, b) => a.rate - b.rate);

  // Overdue assignments list
  const overdueList = assignments
    .filter((a) => a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date())
    .map((a) => ({
      id: a.id,
      sopId: a.sop.id,
      sopTitle: a.sop.title,
      userId: a.user.id,
      userName: `${a.user.firstName} ${a.user.lastName}`,
      department: a.user.department?.name || "None",
      dueDate: a.dueDate,
      mandatory: a.mandatory,
      stepsCompleted: a.stepsCompleted,
      stepsTotal: a.stepsTotal,
    }))
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return {
    overview: { total, completed, inProgress, overdue, overallRate },
    departmentCompliance,
    personScores,
    sopCompliance,
    overdueList,
  };
}
