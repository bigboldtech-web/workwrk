import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { zipFiles, zipTextFile } from "@/lib/zip";

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
      date: t.date ? t.date.toISOString().split("T")[0] : "",
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

  // Manifest first — gives the recipient a top-level inventory + the
  // export timestamp + the org id so they can join exports across runs.
  const manifest = {
    organizationId: orgId,
    exportedAt: new Date().toISOString(),
    files: Object.entries(csvFiles).map(([name, content]) => ({
      name,
      bytes: new TextEncoder().encode(content).length,
    })),
    counts: {
      people: users.length,
      departments: departments.length,
      tasks: tasks.length,
      sops: sops.length,
      reviewCycles: reviews.length,
      meetings: meetings.length,
      kras: kras.length,
      activity: activity.length,
    },
    notes: "WorkwrK tenant export. Activity is capped at 500 most-recent rows; tasks at 1000.",
  };

  const archive = zipFiles([
    zipTextFile("manifest.json", JSON.stringify(manifest, null, 2)),
    ...Object.entries(csvFiles).map(([name, content]) => zipTextFile(name, content)),
  ]);

  // Tenant exports are sensitive — record who pulled what + when.
  const totalRows = users.length + departments.length + tasks.length + sops.length + reviews.length + meetings.length + kras.length + activity.length;
  logAuditEvent({
    type: "tenant_export",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Exported tenant data (${totalRows} rows across ${Object.keys(csvFiles).length} files)`,
    targetType: "organization",
    metadata: manifest.counts,
    severity: "warning",
  });

  const dateStr = new Date().toISOString().split("T")[0];
  // Use a fresh ArrayBuffer slice so the Response sees a typed BodyInit.
  const body = new Uint8Array(archive);
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="workwrk-export-${dateStr}.zip"`,
      "Content-Length": String(archive.length),
    },
  });
}
