import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId } from "@/lib/api-helpers";

function toCsv(headers: string[], rows: Record<string, any>[]): string {
  const escape = (val: any) => {
    const s = val === null || val === undefined ? "" : String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  // Fetch all data in parallel
  const [users, departments, tasks, sops, reviews, meetings, kras, activity] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, firstName: true, lastName: true, email: true, status: true, accessLevel: true,
        department: { select: { name: true } }, role: { select: { title: true } },
        createdAt: true, deletedAt: true,
      },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, title: true, status: true, date: true,
        assignee: { select: { firstName: true, lastName: true } },
        kra: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.sOP.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, category: true, status: true, version: true, createdAt: true },
    }),
    prisma.reviewCycle.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, type: true, status: true, startDate: true, endDate: true,
        _count: { select: { reviews: true } },
      },
    }),
    prisma.meeting.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, title: true, type: true, scheduledAt: true, duration: true,
        _count: { select: { attendees: true } },
      },
    }),
    prisma.kRA.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, category: true, _count: { select: { assignments: true } } },
    }),
    prisma.activityLog.findMany({
      where: { organizationId: orgId },
      select: { id: true, type: true, description: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  // Build CSV files
  const csvFiles: Record<string, string> = {};

  csvFiles["people.csv"] = toCsv(
    ["id", "firstName", "lastName", "email", "status", "accessLevel", "department", "role", "createdAt", "deletedAt"],
    users.map((u) => ({ ...u, department: u.department?.name || "", role: u.role?.title || "", createdAt: u.createdAt.toISOString(), deletedAt: u.deletedAt?.toISOString() || "" }))
  );

  csvFiles["departments.csv"] = toCsv(
    ["id", "name", "memberCount"],
    departments.map((d) => ({ id: d.id, name: d.name, memberCount: d._count.members }))
  );

  csvFiles["tasks.csv"] = toCsv(
    ["id", "title", "status", "date", "assignee", "kra", "createdAt"],
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      date: t.date.toISOString().split("T")[0],
      assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : "",
      kra: t.kra?.name || "",
      createdAt: t.createdAt.toISOString(),
    }))
  );

  csvFiles["sops.csv"] = toCsv(
    ["id", "title", "category", "status", "version", "createdAt"],
    sops.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))
  );

  csvFiles["reviews.csv"] = toCsv(
    ["id", "name", "type", "status", "startDate", "endDate", "reviewCount"],
    reviews.map((r) => ({
      ...r,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      reviewCount: r._count.reviews,
    }))
  );

  csvFiles["meetings.csv"] = toCsv(
    ["id", "title", "type", "scheduledAt", "duration", "attendeeCount"],
    meetings.map((m) => ({
      ...m,
      scheduledAt: m.scheduledAt.toISOString(),
      attendeeCount: m._count.attendees,
    }))
  );

  csvFiles["kras.csv"] = toCsv(
    ["id", "name", "category", "assignmentCount"],
    kras.map((k) => ({ ...k, assignmentCount: k._count.assignments }))
  );

  csvFiles["activity.csv"] = toCsv(
    ["id", "type", "description", "createdAt"],
    activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))
  );

  // Build a simple combined text file (no ZIP dependency needed for MVP)
  const sections = Object.entries(csvFiles)
    .map(([name, content]) => `=== ${name} ===\n${content}`)
    .join("\n\n");

  return new Response(sections, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="workwrk-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
