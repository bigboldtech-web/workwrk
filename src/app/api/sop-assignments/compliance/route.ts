import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// GET: SOP Compliance Dashboard data
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);

  // Get all assignments for this org
  const assignments = await prisma.sOPAssignment.findMany({
    where: { sop: { organizationId: orgId } },
    include: {
      sop: { select: { id: true, title: true, category: true } },
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
  const deptMap: Record<string, { name: string; total: number; completed: number; overdue: number }> = {};
  assignments.forEach((a) => {
    const dept = a.user.department;
    const deptId = dept?.id || "unassigned";
    const deptName = dept?.name || "Unassigned";
    if (!deptMap[deptId]) deptMap[deptId] = { name: deptName, total: 0, completed: 0, overdue: 0 };
    deptMap[deptId].total++;
    if (a.status === "COMPLETED") deptMap[deptId].completed++;
    if (a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()) deptMap[deptId].overdue++;
  });
  const departmentCompliance = Object.entries(deptMap).map(([id, d]) => ({
    departmentId: id,
    name: d.name,
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
        deptName: a.user.department?.name || "—",
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
  const sopMap: Record<string, { title: string; category: string | null; total: number; completed: number }> = {};
  assignments.forEach((a) => {
    const sid = a.sop.id;
    if (!sopMap[sid]) sopMap[sid] = { title: a.sop.title, category: a.sop.category, total: 0, completed: 0 };
    sopMap[sid].total++;
    if (a.status === "COMPLETED") sopMap[sid].completed++;
  });
  const sopCompliance = Object.entries(sopMap).map(([id, s]) => ({
    sopId: id,
    title: s.title,
    category: s.category,
    total: s.total,
    completed: s.completed,
    rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
  })).sort((a, b) => a.rate - b.rate);

  // Overdue assignments list
  const overdueList = assignments
    .filter((a) => a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date())
    .map((a) => ({
      id: a.id,
      sopTitle: a.sop.title,
      userName: `${a.user.firstName} ${a.user.lastName}`,
      department: a.user.department?.name || "—",
      dueDate: a.dueDate,
      stepsCompleted: a.stepsCompleted,
      stepsTotal: a.stepsTotal,
    }))
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return jsonSuccess({
    overview: { total, completed, inProgress, overdue, overallRate },
    departmentCompliance,
    personScores,
    sopCompliance,
    overdueList,
  });
}
