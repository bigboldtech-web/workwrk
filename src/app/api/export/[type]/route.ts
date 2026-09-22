// Single CSV export endpoint that switches on `type`. Each type:
//   - re-runs the same filter logic the list page uses
//   - shapes the rows for human-readable column headers
//   - logs the export to the audit trail (who exported what, when)
//
// Authorization is per-type: manager+ across the board.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { csvFilename, toCsv, type CsvCell } from "@/lib/csv";
import { utcDayFromKey } from "@/lib/time-format";
import { weekStartUTC } from "@/lib/timesheet-week";
import { isOrgWideTimesheetReader } from "@/lib/timesheet-scope";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { logActivity } from "@/lib/activity";

const SUPPORTED = new Set([
  "timesheets",
  "meetings",
  "purchase-orders",
  "invoices",
  "audit",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { type } = await params;
  if (!SUPPORTED.has(type)) return jsonError("Unsupported export type", 400);

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;

  let rows: Record<string, CsvCell>[] = [];
  let columns: string[] | undefined;

  if (type === "timesheets") {
    // scope=mine exports the caller's own weeks and needs no manager level:
    // your own hours are yours (spec-planner section 2 /timesheets, the
    // "Export this week (CSV)" row of the Display menu). Every other scope
    // reads other people's rows and keeps the manager gate.
    const scope = sp.get("scope") ?? "all";
    if (scope !== "mine" && !isManager(session)) return jsonError("Forbidden", 403);

    const status = sp.get("status");
    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;
    if (scope === "mine") {
      where.userId = userId;
    } else if (!isOrgWideTimesheetReader(session.user?.accessLevel)) {
      // The same fold GET /api/timesheets?scope=all does (src/lib/
      // timesheet-scope.ts). Without it a Team Lead or an HR-adjacent tier
      // downloaded every employee's hours in the organization as a CSV with
      // no narrowing at all, which is the widest read in this unit and the
      // one that leaves the product.
      const tree = await getEffectiveReportTree(userId);
      where.userId = { in: [...tree.filter((id) => id !== userId), userId] };
    }

    // ?week=YYYY-MM-DD exports one week. A malformed value is a 400, never
    // an Invalid Date that matches nothing and downloads an empty CSV that
    // reads as "there were no hours".
    const weekRaw = sp.get("week");
    if (weekRaw) {
      const day = utcDayFromKey(weekRaw);
      if (!day) return jsonError("week must be YYYY-MM-DD", 400);
      where.weekStartDate = weekStartUTC(day);
    }

    const sheets = await prisma.timesheet.findMany({
      where,
      orderBy: { weekStartDate: "desc" },
      take: 2000,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        approver: { select: { firstName: true, lastName: true } },
        entries: { select: { hours: true } },
      },
    });
    columns = ["Week start", "Employee", "Email", "Status", "Total hours", "Submitted at", "Decided at", "Approver"];
    rows = sheets.map((t) => {
      const totalHours = t.entries.reduce((acc, e) => acc + (e.hours === null ? 0 : Number(e.hours)), 0);
      return {
        "Week start": t.weekStartDate.toISOString().slice(0, 10),
        "Employee": t.user ? `${t.user.firstName} ${t.user.lastName}` : "",
        "Email": t.user?.email ?? "",
        "Status": t.status,
        "Total hours": totalHours,
        "Submitted at": t.submittedAt?.toISOString() ?? "",
        "Decided at": t.decisionAt?.toISOString() ?? "",
        // Next to "Decided at", so this column means WHO DECIDED. Timesheet.
        // approverId is also set at creation to the person's manager, so
        // printing it unconditionally captioned an undecided week with a
        // named approver.
        "Approver": t.decisionAt && t.approver ? `${t.approver.firstName} ${t.approver.lastName}` : "",
      };
    });
  } else if (type === "meetings") {
    // The toolbar's Export (CSV) row on /meetings. The one rule that matters
    // here is that the CSV cannot be a wider read than the page: it is the
    // artifact that leaves the product. So it repeats the LIST route's scope
    // exactly (src/app/api/meetings/route.ts): meetings you attend or
    // created, and every meeting in the organization only for an Owner or an
    // Admin. There is no manager gate, because a Member exporting their own
    // meetings is exporting their own calendar.
    const where: Record<string, unknown> = { organizationId: orgId, deletedAt: null };
    if (!isOrgAdmin(session)) {
      where.OR = [
        { attendees: { some: { userId } } },
        { createdById: userId },
      ];
    }
    const typeFilter = sp.get("type");
    if (typeFilter) where.type = { in: typeFilter.split(",").filter(Boolean) };
    const search = sp.get("search");
    if (search) where.title = { contains: search, mode: "insensitive" };
    const now = new Date();
    const view = sp.get("view");
    if (view === "past") where.scheduledAt = { lt: now };
    else if (view === "upcoming") where.scheduledAt = { gte: now };

    const meetings = await prisma.meeting.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      take: 5000,
      include: {
        attendees: { include: { user: { select: { firstName: true, lastName: true } } } },
        actionItems: { select: { status: true } },
      },
    });
    columns = ["When", "Title", "Type", "Length (minutes)", "People", "Has notes", "Action items", "Action items done"];
    rows = meetings.map((m) => ({
      "When": m.scheduledAt.toISOString(),
      "Title": m.title,
      "Type": m.type,
      "Length (minutes)": m.duration,
      "People": m.attendees
        .map((a) => [a.user?.firstName, a.user?.lastName].filter(Boolean).join(" ").trim())
        .filter(Boolean)
        .join("; "),
      "Has notes": m.notes && m.notes.trim() ? "yes" : "no",
      "Action items": m.actionItems.length,
      "Action items done": m.actionItems.filter((a) => a.status === "COMPLETED").length,
    }));
  } else if (type === "purchase-orders") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    const status = sp.get("status");
    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5000,
      include: {
        vendor: { select: { name: true } },
        requester: { select: { firstName: true, lastName: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
    });
    columns = ["PO #", "Vendor", "Description", "Amount", "Currency", "Status", "Requester", "Approver", "Created", "Submitted", "Decided"];
    rows = pos.map((p) => ({
      "PO #": p.number,
      "Vendor": p.vendor.name,
      "Description": p.description,
      "Amount": Number(p.amount),
      "Currency": p.currency,
      "Status": p.status,
      "Requester": p.requester ? `${p.requester.firstName} ${p.requester.lastName}` : "",
      "Approver": p.approver ? `${p.approver.firstName} ${p.approver.lastName}` : "",
      "Created": p.createdAt.toISOString(),
      "Submitted": p.submittedAt?.toISOString() ?? "",
      "Decided": p.decisionAt?.toISOString() ?? "",
    }));
  } else if (type === "invoices") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    const status = sp.get("status");
    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { dueDate: "asc" },
      take: 5000,
      include: {
        vendor: { select: { name: true } },
        purchaseOrder: { select: { number: true } },
      },
    });
    columns = ["Invoice #", "Vendor", "PO", "Issue date", "Due date", "Amount", "Currency", "Status", "Paid at"];
    rows = invoices.map((inv) => ({
      "Invoice #": inv.invoiceNumber,
      "Vendor": inv.vendor.name,
      "PO": inv.purchaseOrder?.number ?? "",
      "Issue date": inv.issueDate.toISOString().slice(0, 10),
      "Due date": inv.dueDate.toISOString().slice(0, 10),
      "Amount": Number(inv.amount),
      "Currency": inv.currency,
      "Status": inv.status,
      "Paid at": inv.paidAt?.toISOString() ?? "",
    }));
  } else if (type === "audit") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    const startDate = sp.get("startDate");
    const endDate = sp.get("endDate");
    const where: Record<string, unknown> = { organizationId: orgId };
    if (startDate || endDate) {
      const created: Record<string, Date> = {};
      if (startDate) created.gte = new Date(startDate);
      if (endDate) created.lte = new Date(endDate);
      where.createdAt = created;
    }
    const events = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10_000,
      include: {
        actor: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    columns = ["When", "Type", "Severity", "Actor", "Email", "Description", "Target type", "Target ID", "IP"];
    rows = events.map((e) => ({
      "When": e.createdAt.toISOString(),
      "Type": e.type,
      "Severity": e.severity,
      "Actor": e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : "",
      "Email": e.actor?.email ?? "",
      "Description": e.description,
      "Target type": e.targetType ?? "",
      "Target ID": e.targetId ?? "",
      "IP": e.ipAddress ?? "",
    }));
  }

  // Audit-log the export itself.
  logActivity({
    type: "csv_exported",
    actorId: userId,
    organizationId: orgId,
    description: `Exported ${type} CSV (${rows.length} rows)`,
    targetType: "export",
    severity: rows.length > 1000 ? "warning" : "info",
  });

  const body = toCsv(rows, columns);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(type)}"`,
      "Cache-Control": "no-store",
    },
  });
}
