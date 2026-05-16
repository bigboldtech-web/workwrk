// Pay run — get + state transitions (calculate / post / cancel).
// Org-admin only.
//
// calculate → calls the configured payroll provider, which writes
//             Payslip + PayslipLine rows and updates totals.
// post      → marks the run immutable + releases funds.
// cancel    → only valid in DRAFT/CALCULATED; POSTED runs need a
//             manual reversal entry instead.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { getPayrollProvider } from "@/lib/payroll/provider";
import { logActivity, logAuditEvent } from "@/lib/activity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const run = await prisma.payRun.findFirst({
    where: { id, organizationId: orgId },
    include: {
      payGroup: { select: { id: true, name: true, frequency: true, currency: true } },
      payslips: {
        orderBy: { createdAt: "asc" },
        include: {
          subject: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!run) return jsonError("Not found", 404);
  return jsonSuccess(run);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : "";
  const orgId = getOrgId(session);

  const run = await prisma.payRun.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!run) return jsonError("Not found", 404);

  const provider = getPayrollProvider();

  if (action === "calculate") {
    if (run.status !== "DRAFT" && run.status !== "CALCULATED") {
      return jsonError(`Can't calculate from status ${run.status}`);
    }
    await prisma.payRun.update({ where: { id }, data: { status: "CALCULATING" } });
    try {
      const result = await provider.calculatePayRun(id);
      await prisma.payRun.update({
        where: { id },
        data: {
          status: "CALCULATED",
          totalGross: result.totalGross,
          totalNet: result.totalNet,
          totalTax: result.totalTax,
          totalDeductions: result.totalDeductions,
          providerRef: result.providerRunRef,
          calculatedAt: new Date(),
        },
      });
      return jsonSuccess({ ok: true, ...result });
    } catch (e: unknown) {
      // Roll status back so the admin can retry.
      await prisma.payRun.update({ where: { id }, data: { status: "DRAFT" } });
      const message = e instanceof Error ? e.message : "Calculation failed";
      return jsonError(message, 500);
    }
  }

  if (action === "post") {
    if (run.status !== "CALCULATED") {
      return jsonError(`Can only post a CALCULATED run (current: ${run.status})`);
    }
    if (!(await provider.isReady())) {
      return jsonError("Payroll provider not configured. Wire CheckHQ before posting.", 400);
    }
    const result = await provider.postPayRun(id);
    const updated = await prisma.payRun.update({
      where: { id },
      data: { status: "POSTED", postedAt: result.postedAt },
    });

    // Posting a pay run releases funds — the highest-stakes financial
    // action in the system. Always critical.
    logAuditEvent({
      type: "pay_run_posted",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Posted pay run (totals: ${updated.totalGross ? `gross ${Number(updated.totalGross).toFixed(2)}` : "n/a"})`,
      targetId: id,
      targetType: "pay_run",
      metadata: {
        totalGross: updated.totalGross ? Number(updated.totalGross) : null,
        totalNet: updated.totalNet ? Number(updated.totalNet) : null,
      },
      severity: "critical",
    });

    return jsonSuccess(updated);
  }

  if (action === "cancel") {
    if (run.status === "POSTED") return jsonError("POSTED runs require a manual reversal — can't cancel", 400);
    if (run.status === "CANCELLED") return jsonError("Already cancelled");
    const reason = typeof body.reason === "string" ? body.reason : "";
    await provider.cancelPayRun(id, reason);
    const updated = await prisma.payRun.update({
      where: { id },
      data: { status: "CANCELLED", notes: reason || null },
    });

    logActivity({
      type: "pay_run_cancelled",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Cancelled pay run${reason ? ` — ${reason}` : ""}`,
      targetId: id,
      targetType: "pay_run",
      metadata: { reason: reason || null },
    });

    return jsonSuccess(updated);
  }

  return jsonError("Unknown action. Use calculate | post | cancel");
}
