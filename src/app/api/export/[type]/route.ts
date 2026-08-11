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
} from "@/lib/api-helpers";
import { csvFilename, toCsv, type CsvCell } from "@/lib/csv";
import { logActivity } from "@/lib/activity";

const SUPPORTED = new Set([
  "timesheets",
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
    if (!isManager(session)) return jsonError("Forbidden", 403);
    const status = sp.get("status");
    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status;

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
        "Approver": t.approver ? `${t.approver.firstName} ${t.approver.lastName}` : "",
      };
    });
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
