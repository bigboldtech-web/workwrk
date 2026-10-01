import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { zipFiles, zipTextFile } from "@/lib/zip";
import { settingsWriteGate } from "@/lib/access/settings-write";

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (val: unknown) => {
    let s = val === null || val === undefined ? "" : String(val);
    // A cell a spreadsheet would run as a formula stays text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return s.includes(",") || s.includes('"') || s.includes("\n") || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
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

  // The whole organization in one ZIP (every person's email and access
  // level, tasks, reviews, activity) is an Admin export, as the Data page
  // says it is. This route used to answer any signed-in person, Agents and
  // Guests included.
  const writeGate = await settingsWriteGate(session, "data", { read: true });
  if (!writeGate.ok) return writeGate.response;

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

  // The whole workspace's WORK (decided addition f, the enterprise target):
  // Spaces, Folders, Lists, every task on them, Docs, Tables and Goals, so an
  // export is a real copy of the workspace, not a people-and-HR slice. Tasks
  // are read in pages of 5000 by id, so a large workspace is exported whole
  // up to ITEM_CAP (and the manifest says so if it ever stops early).
  const ITEM_CAP = 200_000;
  const [spaces, folders, lists, docs, tables, goals] = await Promise.all([
    prisma.space.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, slug: true, visibility: true, ownerId: true, archivedAt: true, createdAt: true } }),
    prisma.folder.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, spaceId: true, visibility: true, archivedAt: true, createdAt: true } }),
    prisma.board.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, spaceId: true, folderId: true, visibility: true, archivedAt: true, createdAt: true } }),
    prisma.doc.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, entityType: true, entityId: true, parentId: true, createdById: true, archivedAt: true, createdAt: true, updatedAt: true } }),
    prisma.dataTable.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, spaceId: true, createdById: true, createdAt: true, updatedAt: true } }),
    prisma.oKR.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, level: true, status: true, progress: true, ownerId: true, parentId: true, startDate: true, createdAt: true } }),
  ]);
  const items: { id: string; boardId: string; title: string; status: string | null; priority: string | null; ownerId: string | null; assigneeIds: string[]; startAt: Date | null; dueAt: Date | null; archivedAt: Date | null; createdAt: Date }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.item.findMany({
      where: { organizationId: orgId },
      select: { id: true, boardId: true, title: true, status: true, priority: true, ownerId: true, assigneeIds: true, startAt: true, dueAt: true, archivedAt: true, createdAt: true },
      orderBy: { id: "asc" },
      take: 5000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    items.push(...page);
    if (page.length < 5000 || items.length >= ITEM_CAP) break;
    cursor = page[page.length - 1].id;
  }
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

  // Build CSV files
  const csvFiles: Record<string, string> = {};

  csvFiles["spaces.csv"] = toCsv(["id", "name", "slug", "visibility", "ownerId", "archivedAt", "createdAt"], spaces.map((x) => ({ ...x, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })));
  csvFiles["folders.csv"] = toCsv(["id", "name", "spaceId", "visibility", "archivedAt", "createdAt"], folders.map((x) => ({ ...x, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })));
  csvFiles["lists.csv"] = toCsv(["id", "name", "spaceId", "folderId", "visibility", "archivedAt", "createdAt"], lists.map((x) => ({ ...x, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })));
  csvFiles["list-tasks.csv"] = toCsv(
    ["id", "listId", "title", "status", "priority", "ownerId", "assigneeIds", "startAt", "dueAt", "archivedAt", "createdAt"],
    items.map((x) => ({ ...x, listId: x.boardId, assigneeIds: x.assigneeIds.join(" "), startAt: iso(x.startAt), dueAt: iso(x.dueAt), archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })),
  );
  csvFiles["docs.csv"] = toCsv(["id", "title", "entityType", "entityId", "parentId", "createdById", "archivedAt", "createdAt", "updatedAt"], docs.map((x) => ({ ...x, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt) })));
  csvFiles["tables.csv"] = toCsv(["id", "name", "spaceId", "createdById", "createdAt", "updatedAt"], tables.map((x) => ({ ...x, createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt) })));
  csvFiles["goals.csv"] = toCsv(["id", "title", "level", "status", "progress", "ownerId", "parentId", "startDate", "createdAt"], goals.map((x) => ({ ...x, startDate: iso(x.startDate), createdAt: iso(x.createdAt) })));

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
      spaces: spaces.length,
      folders: folders.length,
      lists: lists.length,
      listTasks: items.length,
      docs: docs.length,
      tables: tables.length,
      goals: goals.length,
    },
    notes: `WorkwrK workspace export. list-tasks.csv holds every task on every List${items.length >= ITEM_CAP ? ` up to ${ITEM_CAP} (this workspace has more; export again after archiving, or ask support)` : ""}. tasks.csv is the older task table. Activity is the 500 most recent rows; the full audit log is its own export.`,
  };

  const archive = zipFiles([
    zipTextFile("manifest.json", JSON.stringify(manifest, null, 2)),
    ...Object.entries(csvFiles).map(([name, content]) => zipTextFile(name, content)),
  ]);

  // Tenant exports are sensitive — record who pulled what + when.
  const totalRows = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
  logAuditEvent({
    type: "data.exported",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Exported tenant data (${totalRows} rows across ${Object.keys(csvFiles).length} files)`,
    targetType: "organization",
    metadata: { kind: "workspace", ...manifest.counts },
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
