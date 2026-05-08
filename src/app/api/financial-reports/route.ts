// Financial reports — Trial Balance, P&L (Income Statement), Balance
// Sheet. All three are reads over the same JournalLine table; the
// shape changes by which account types are selected and how the
// debit/credit sides aggregate.
//
// Conventions (Workday / GAAP-aligned):
//   ASSET   debit-natural  → balance = debits - credits
//   EXPENSE debit-natural  → balance = debits - credits
//   LIABILITY  credit-natural → balance = credits - debits
//   EQUITY     credit-natural → balance = credits - debits
//   REVENUE    credit-natural → balance = credits - debits
//
// Only POSTED entries count. DRAFT/PENDING/APPROVED/VOIDED are
// excluded — reports must reconcile to the audit trail.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

type AccountSums = {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  debit: number;
  credit: number;
  balance: number; // signed by natural side
};

const DEBIT_NATURAL = new Set(["ASSET", "EXPENSE"]);

function signedBalance(type: AccountSums["type"], debit: number, credit: number): number {
  return DEBIT_NATURAL.has(type) ? debit - credit : credit - debit;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const report = sp.get("report") ?? "trial-balance";
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");

  // Default range: current calendar year. Reports without a range
  // return everything (useful for trial-balance opening view).
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  if (fromRaw && from && Number.isNaN(from.getTime())) return jsonError("invalid 'from' date");
  if (toRaw && to && Number.isNaN(to.getTime())) return jsonError("invalid 'to' date");

  // Pull every POSTED line in range and aggregate in memory. For an
  // org with thousands of lines per period this is fine; we'll move
  // to a SQL aggregation when reports get heavy.
  const entryWhere: Record<string, unknown> = { organizationId: orgId, status: "POSTED" };
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    entryWhere.postedAt = range;
  }

  const lines = await prisma.journalLine.findMany({
    where: { entry: entryWhere },
    select: {
      amount: true,
      debitAccountId: true,
      creditAccountId: true,
      debitAccount: { select: { id: true, code: true, name: true, type: true } },
      creditAccount: { select: { id: true, code: true, name: true, type: true } },
    },
  });

  const sums = new Map<string, AccountSums>();
  function ensure(id: string, code: string, name: string, type: AccountSums["type"]) {
    let row = sums.get(id);
    if (!row) {
      row = { id, code, name, type, debit: 0, credit: 0, balance: 0 };
      sums.set(id, row);
    }
    return row;
  }
  for (const line of lines) {
    const amount = Number(line.amount);
    if (line.debitAccount) {
      const r = ensure(line.debitAccount.id, line.debitAccount.code, line.debitAccount.name, line.debitAccount.type);
      r.debit += amount;
    }
    if (line.creditAccount) {
      const r = ensure(line.creditAccount.id, line.creditAccount.code, line.creditAccount.name, line.creditAccount.type);
      r.credit += amount;
    }
  }
  for (const r of sums.values()) {
    r.balance = signedBalance(r.type, r.debit, r.credit);
  }

  const all = Array.from(sums.values()).sort((a, b) => a.code.localeCompare(b.code));

  if (report === "trial-balance") {
    const totalDebits = all.reduce((acc, r) => acc + r.debit, 0);
    const totalCredits = all.reduce((acc, r) => acc + r.credit, 0);
    return jsonSuccess({
      report: "trial-balance",
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      rows: all,
      totalDebits,
      totalCredits,
      // Should be zero for a clean ledger; non-zero indicates an
      // imbalance worth investigating before period close.
      delta: totalDebits - totalCredits,
    });
  }

  if (report === "income-statement") {
    const revenue = all.filter((r) => r.type === "REVENUE");
    const expense = all.filter((r) => r.type === "EXPENSE");
    const totalRevenue = revenue.reduce((acc, r) => acc + r.balance, 0);
    const totalExpense = expense.reduce((acc, r) => acc + r.balance, 0);
    return jsonSuccess({
      report: "income-statement",
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      revenue,
      expense,
      totalRevenue,
      totalExpense,
      netIncome: totalRevenue - totalExpense,
    });
  }

  if (report === "balance-sheet") {
    const assets = all.filter((r) => r.type === "ASSET");
    const liabilities = all.filter((r) => r.type === "LIABILITY");
    const equity = all.filter((r) => r.type === "EQUITY");
    // Net income flows into retained earnings on the balance sheet.
    // Surface it as a derived value so reports tie out without
    // requiring a closing entry on every refresh.
    const totalRevenue = all.filter((r) => r.type === "REVENUE").reduce((a, r) => a + r.balance, 0);
    const totalExpense = all.filter((r) => r.type === "EXPENSE").reduce((a, r) => a + r.balance, 0);
    const netIncome = totalRevenue - totalExpense;
    const totalAssets = assets.reduce((a, r) => a + r.balance, 0);
    const totalLiabilities = liabilities.reduce((a, r) => a + r.balance, 0);
    const totalEquityBooked = equity.reduce((a, r) => a + r.balance, 0);
    const totalEquity = totalEquityBooked + netIncome;
    return jsonSuccess({
      report: "balance-sheet",
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquityBooked,
      netIncome,
      totalEquity,
      delta: totalAssets - (totalLiabilities + totalEquity),
    });
  }

  return jsonError("Unknown report. Try trial-balance | income-statement | balance-sheet");
}
