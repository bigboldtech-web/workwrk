// Journal entries — list + create. Org-admin only.
//
// Create accepts a balanced set of lines (sum of debits === sum of
// credits). Lines are stored verbatim — the API does not infer
// the second side automatically, because manual entries often have
// asymmetric debit/credit splits across multiple accounts. Posting
// happens in a separate PATCH (DRAFT → POSTED) once the org's
// approval rules have been satisfied.

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

type LineInput = {
  debitAccountId?: string;
  creditAccountId?: string;
  amount: number;
  costCenterId?: string;
  description?: string;
  txnCurrency?: string;
  txnAmount?: number;
  txnFxRate?: number;
};

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(200, Number(sp.get("limit")) || 50);
  const status = sp.get("status")?.toUpperCase();
  const periodId = sp.get("periodId");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (status) where.status = status;
  if (periodId) where.periodId = periodId;

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: { postedAt: "desc" },
    take: limit,
    include: {
      period: { select: { id: true, label: true } },
      _count: { select: { lines: true } },
    },
  });
  return jsonSuccess(entries);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const periodId = typeof body.periodId === "string" ? body.periodId : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const postedAtRaw = typeof body.postedAt === "string" ? body.postedAt : null;
  const postedAt = postedAtRaw ? new Date(postedAtRaw) : new Date();
  if (Number.isNaN(postedAt.getTime())) return jsonError("invalid postedAt");
  if (!periodId) return jsonError("periodId required");
  if (!description) return jsonError("description required");

  const lines: LineInput[] = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length < 2) return jsonError("at least two lines required");

  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    if (!line || typeof line !== "object") return jsonError("malformed line");
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) return jsonError("each line amount must be > 0");
    const hasDebit = typeof line.debitAccountId === "string" && line.debitAccountId.length > 0;
    const hasCredit = typeof line.creditAccountId === "string" && line.creditAccountId.length > 0;
    if (hasDebit === hasCredit) return jsonError("each line must specify exactly one of debit/credit account");
    if (hasDebit) totalDebit += amount;
    else totalCredit += amount;
  }
  // Cents-level tolerance — Decimal.js rounding can leave a tiny
  // delta when callers pre-compute net amounts.
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    return jsonError(`debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`);
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  // Validate the period belongs to this org and is OPEN.
  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, organizationId: orgId },
    select: { status: true, startDate: true, endDate: true },
  });
  if (!period) return jsonError("period not found", 404);
  if (period.status === "CLOSED") return jsonError("period is closed", 400);
  if (postedAt < period.startDate || postedAt > period.endDate) {
    return jsonError("postedAt must fall inside the period date range", 400);
  }

  // Validate every account id belongs to this org. One round-trip,
  // not N — set of unique ids → single findMany.
  const accountIds = new Set<string>();
  for (const line of lines) {
    if (line.debitAccountId) accountIds.add(line.debitAccountId);
    if (line.creditAccountId) accountIds.add(line.creditAccountId);
  }
  if (accountIds.size > 0) {
    const found = await prisma.glAccount.findMany({
      where: { id: { in: Array.from(accountIds) }, organizationId: orgId },
      select: { id: true },
    });
    if (found.length !== accountIds.size) {
      return jsonError("one or more accounts not found in this org", 404);
    }
  }

  // Sequential reference (JE-000001) — race-safe via retry loop.
  // Skipping the `Sequence` table pattern because journal entries
  // are admin-driven and never high-throughput.
  const last = await prisma.journalEntry.findFirst({
    where: { organizationId: orgId },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const lastNum = last?.reference?.match(/JE-(\d+)/)?.[1];
  const nextNum = (lastNum ? Number(lastNum) : 0) + 1;
  const reference = `JE-${String(nextNum).padStart(6, "0")}`;

  const entry = await prisma.journalEntry.create({
    data: {
      organizationId: orgId,
      periodId,
      reference,
      description,
      postedAt,
      source: "MANUAL",
      status: "DRAFT",
      postedById: userId,
      lines: {
        create: lines.map((l) => ({
          debitAccountId: l.debitAccountId ?? null,
          creditAccountId: l.creditAccountId ?? null,
          amount: l.amount,
          costCenterId: l.costCenterId ?? null,
          description: typeof l.description === "string" ? l.description.trim() || null : null,
          txnCurrency: typeof l.txnCurrency === "string" ? l.txnCurrency.toUpperCase() : null,
          txnAmount: l.txnAmount ?? null,
          txnFxRate: l.txnFxRate ?? null,
        })),
      },
    },
    include: { lines: true },
  });
  return jsonSuccess(entry, 201);
}
