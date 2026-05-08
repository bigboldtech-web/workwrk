// Journal entry — get + state transitions (post / void / reverse).
// Org-admin only.
//
// Transitions:
//   DRAFT  → POSTED  (post)
//   DRAFT  → VOIDED  (void)
//   POSTED → REVERSED + new offsetting entry created  (reverse)
//
// Posted entries are immutable. Reversal creates a new entry with
// flipped debit/credit lines so the audit trail keeps both halves.

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const entry = await prisma.journalEntry.findFirst({
    where: { id, organizationId: orgId },
    include: {
      period: { select: { id: true, label: true, status: true } },
      lines: {
        include: {
          debitAccount: { select: { id: true, code: true, name: true } },
          creditAccount: { select: { id: true, code: true, name: true } },
          costCenter: { select: { id: true, code: true, name: true } },
        },
      },
      postedBy: { select: { id: true, firstName: true, lastName: true } },
      approvedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!entry) return jsonError("Not found", 404);
  return jsonSuccess(entry);
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
  const userId = getUserId(session);

  const entry = await prisma.journalEntry.findFirst({
    where: { id, organizationId: orgId },
    include: {
      period: { select: { status: true, id: true, label: true } },
      lines: true,
    },
  });
  if (!entry) return jsonError("Not found", 404);

  if (action === "post") {
    if (entry.status !== "DRAFT" && entry.status !== "APPROVED") {
      return jsonError(`Can't post — current status is ${entry.status}`);
    }
    if (entry.period.status === "CLOSED") {
      return jsonError("Period is closed; can't post into it", 400);
    }
    const updated = await prisma.journalEntry.update({
      where: { id },
      data: {
        status: "POSTED",
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    return jsonSuccess(updated);
  }

  if (action === "void") {
    if (entry.status !== "DRAFT" && entry.status !== "PENDING") {
      return jsonError(`Can't void — only DRAFT/PENDING entries can be voided (current: ${entry.status})`);
    }
    const updated = await prisma.journalEntry.update({
      where: { id },
      data: { status: "VOIDED" },
    });
    return jsonSuccess(updated);
  }

  if (action === "reverse") {
    if (entry.status !== "POSTED") {
      return jsonError("Only POSTED entries can be reversed");
    }
    if (entry.period.status === "CLOSED") {
      return jsonError("Period is closed; can't post a reversal into it", 400);
    }
    const note = typeof body.note === "string" ? body.note.trim() : null;

    // Build the reversal — same period, today's postedAt, every
    // line's debit/credit swapped. Status posted immediately so the
    // ledger reconciles.
    const last = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId },
      orderBy: { reference: "desc" },
      select: { reference: true },
    });
    const lastNum = last?.reference?.match(/JE-(\d+)/)?.[1];
    const nextNum = (lastNum ? Number(lastNum) : 0) + 1;
    const reference = `JE-${String(nextNum).padStart(6, "0")}`;

    const result = await prisma.$transaction([
      prisma.journalEntry.create({
        data: {
          organizationId: orgId,
          periodId: entry.periodId,
          reference,
          description: `Reversal of ${entry.reference}${note ? `: ${note}` : ""}`,
          postedAt: new Date(),
          source: "REVERSAL",
          sourceType: "journal-entry",
          sourceId: entry.id,
          status: "POSTED",
          postedById: userId,
          approvedById: userId,
          approvedAt: new Date(),
          lines: {
            create: entry.lines.map((l) => ({
              // Swap debit and credit columns.
              debitAccountId: l.creditAccountId,
              creditAccountId: l.debitAccountId,
              amount: l.amount,
              costCenterId: l.costCenterId,
              description: l.description,
              txnCurrency: l.txnCurrency,
              txnAmount: l.txnAmount,
              txnFxRate: l.txnFxRate,
            })),
          },
        },
      }),
      prisma.journalEntry.update({
        where: { id },
        data: { status: "REVERSED" },
      }),
    ]);
    return jsonSuccess({ reversal: result[0], original: result[1] });
  }

  return jsonError("Unknown action. Use post | void | reverse");
}
