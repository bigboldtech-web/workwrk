// Single CSV export endpoint that switches on `type`. Each type:
//   - re-runs the same filter logic the list page uses
//   - shapes the rows for human-readable column headers
//   - logs the export to the audit trail (who exported what, when)
//
// Authorization is per-type: comp-decisions is org-admin only;
// most others are manager+; expenses falls back to "mine" if the
// caller isn't a manager.

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
import { logActivity } from "@/lib/activity";

const SUPPORTED = new Set([
  "expenses",
  "time-off",
  "timesheets",
  "comp-decisions",
  "purchase-orders",
  "invoices",
  "candidates",
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

  if (type === "expenses") {
    const scope = sp.get("scope") ?? (isManager(session) ? "all" : "mine");
    if (scope === "approve" && !isManager(session)) return jsonError("Forbidden", 403);
    if (scope === "all" && !isManager(session)) return jsonError("Forbidden", 403);

    const where: Record<string, unknown> = { organizationId: orgId };
    if (scope === "mine") where.reporterId = userId;
    else if (scope === "approve") {
      where.status = "SUBMITTED";
      where.OR = [{ approverId: userId }, { approverId: null }];
    }
    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      take: 5000,
      include: {
        reporter: { select: { firstName: true, lastName: true, email: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
    });
    columns = ["Date", "Description", "Category", "Amount", "Currency", "Reporter", "Reporter Email", "Status", "Approver", "Submitted At", "Decided At"];
    rows = expenses.map((e) => ({
      "Date": e.expenseDate.toISOString().slice(0, 10),
      "Description": e.description,
      "Category": e.category,
      "Amount": Number(e.amount),
      "Currency": e.currency,
      "Reporter": e.reporter ? `${e.reporter.firstName} ${e.reporter.lastName}` : "",
      "Reporter Email": e.reporter?.email ?? "",
      "Status": e.status,
      "Approver": e.approver ? `${e.approver.firstName} ${e.approver.lastName}` : "",
      "Submitted At": e.submittedAt?.toISOString() ?? "",
      "Decided At": e.decisionAt?.toISOString() ?? "",
    }));
  } else if (type === "time-off") {
    const scope = sp.get("scope") ?? (isManager(session) ? "all" : "mine");
    if (scope !== "mine" && !isManager(session)) return jsonError("Forbidden", 403);

    const where: Record<string, unknown> = { organizationId: orgId };
    if (scope === "mine") where.userId = userId;

    const requests = await prisma.timeOffRequest.findMany({
      where,
      orderBy: { startDate: "desc" },
      take: 5000,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        approver: { select: { firstName: true, lastName: true } },
        policy: { select: { name: true, type: true } },
      },
    });
    columns = ["Start", "End", "Hours", "Policy", "Type", "Employee", "Email", "Status", "Approver", "Decision At", "Reason"];
    rows = requests.map((r) => ({
      "Start": r.startDate.toISOString().slice(0, 10),
      "End": r.endDate.toISOString().slice(0, 10),
      "Hours": Number(r.hours),
      "Policy": r.policy.name,
      "Type": r.policy.type,
      "Employee": r.user ? `${r.user.firstName} ${r.user.lastName}` : "",
      "Email": r.user?.email ?? "",
      "Status": r.status,
      "Approver": r.approver ? `${r.approver.firstName} ${r.approver.lastName}` : "",
      "Decision At": r.decisionAt?.toISOString() ?? "",
      "Reason": r.reason ?? "",
    }));
  } else if (type === "timesheets") {
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
  } else if (type === "comp-decisions") {
    if (!isOrgAdmin(session)) return jsonError("Forbidden — admin only", 403);
    const cycleId = sp.get("cycleId");
    const where: Record<string, unknown> = { organizationId: orgId };
    if (cycleId) where.cycleId = cycleId;

    const decisions = await prisma.compensationDecision.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 5000,
      include: {
        subject: { select: { firstName: true, lastName: true, email: true } },
        proposedBy: { select: { firstName: true, lastName: true } },
        cycle: { select: { name: true } },
      },
    });
    columns = ["Cycle", "Employee", "Email", "Currency", "Current", "Proposed", "Δ%", "Bonus", "Status", "Proposed by", "Reasoning"];
    rows = decisions.map((d) => ({
      "Cycle": d.cycle.name,
      "Employee": d.subject ? `${d.subject.firstName} ${d.subject.lastName}` : "",
      "Email": d.subject?.email ?? "",
      "Currency": d.currency,
      "Current": d.currentSalary === null ? "" : Number(d.currentSalary),
      "Proposed": d.proposedSalary === null ? "" : Number(d.proposedSalary),
      "Δ%": d.changePct === null ? "" : Number(d.changePct),
      "Bonus": d.bonusAmount === null ? "" : Number(d.bonusAmount),
      "Status": d.status,
      "Proposed by": d.proposedBy ? `${d.proposedBy.firstName} ${d.proposedBy.lastName}` : "",
      "Reasoning": d.reasoning ?? "",
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
  } else if (type === "candidates") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    const candidates = await prisma.candidate.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 5000,
      include: { _count: { select: { applications: true } } },
    });
    columns = ["First name", "Last name", "Email", "Phone", "Source", "Resume URL", "Applications", "Created"];
    rows = candidates.map((c) => ({
      "First name": c.firstName,
      "Last name": c.lastName,
      "Email": c.email,
      "Phone": c.phone ?? "",
      "Source": c.source ?? "",
      "Resume URL": c.resumeUrl ?? "",
      "Applications": c._count.applications,
      "Created": c.createdAt.toISOString(),
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
