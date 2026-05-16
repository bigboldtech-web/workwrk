import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  isOrgAdmin,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

/**
 * Financial statement generator — Phase 5 v1.
 *
 * GET /api/financials/statements?period=<id>&kind=<pnl|bs|cf>
 *
 * Aggregates posted JournalLines for the given period and rolls them
 * into the requested statement. Org-admin only.
 *
 * v1 scope:
 *   • P&L   — Revenue accounts minus Expense accounts → net income
 *   • BS    — Asset / Liability / Equity totals at period end (point-in-time)
 *   • CF    — Stub: returns the indirect-method shell so the UI can render
 *
 * Multi-currency, multi-entity, eliminations and FX rev are explicit
 * v2 follow-ups (the schema supports them; the rollup logic doesn't yet).
 *
 * Sign convention:
 *   debits = positive on Asset / Expense
 *   credits = positive on Liability / Equity / Revenue
 * Period balances are computed as (debits − credits) for Asset/Expense
 * and (credits − debits) for the other three so every row reads as a
 * "natural" positive number.
 */

type Kind = "pnl" | "bs" | "cf";

interface AccountTotals {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  debit: number;
  credit: number;
  balance: number;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const periodId = sp.get("period");
  const kind = (sp.get("kind") ?? "pnl") as Kind;
  if (!periodId) return jsonError("period is required");
  if (!["pnl", "bs", "cf"].includes(kind)) return jsonError("kind must be pnl, bs, or cf");

  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, organizationId: orgId },
    select: { id: true, label: true, startDate: true, endDate: true, status: true },
  });
  if (!period) return jsonError("period not found", 404);

  // Pull every posted line that hit this period. Posted-only — DRAFT
  // and PENDING entries are conceptually unposted and shouldn't appear
  // in the statement view. REVERSED entries net out via their reversal
  // sibling, so they're correctly included.
  const lines = await prisma.journalLine.findMany({
    where: {
      entry: {
        organizationId: orgId,
        periodId,
        status: "POSTED",
      },
    },
    select: {
      amount: true,
      debitAccountId: true,
      creditAccountId: true,
      debitAccount: { select: { id: true, code: true, name: true, type: true } },
      creditAccount: { select: { id: true, code: true, name: true, type: true } },
    },
  });

  // Roll up into per-account totals. We track both sides separately
  // so the trial balance can read the raw numbers; the natural
  // balance is computed last per the sign convention.
  const totals = new Map<string, AccountTotals>();
  function bump(id: string, acct: { code: string; name: string; type: string } | null, side: "debit" | "credit", amount: number) {
    if (!acct) return;
    const t = (acct.type as AccountTotals["type"]);
    const row = totals.get(id) ?? {
      id,
      code: acct.code,
      name: acct.name,
      type: t,
      debit: 0,
      credit: 0,
      balance: 0,
    };
    row[side] += amount;
    totals.set(id, row);
  }

  for (const ln of lines) {
    const amt = Number(ln.amount);
    if (ln.debitAccountId && ln.debitAccount) bump(ln.debitAccountId, ln.debitAccount, "debit", amt);
    if (ln.creditAccountId && ln.creditAccount) bump(ln.creditAccountId, ln.creditAccount, "credit", amt);
  }

  // Natural-balance pass.
  for (const row of totals.values()) {
    if (row.type === "ASSET" || row.type === "EXPENSE") {
      row.balance = row.debit - row.credit;
    } else {
      row.balance = row.credit - row.debit;
    }
  }
  const all = Array.from(totals.values()).sort((a, b) => a.code.localeCompare(b.code));

  if (kind === "pnl") {
    const revenue = all.filter((r) => r.type === "REVENUE");
    const expense = all.filter((r) => r.type === "EXPENSE");
    const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0);
    const totalExpense = expense.reduce((s, r) => s + r.balance, 0);
    return jsonSuccess({
      period,
      kind,
      revenue,
      expense,
      totals: {
        revenue: totalRevenue,
        expense: totalExpense,
        netIncome: totalRevenue - totalExpense,
      },
    });
  }

  if (kind === "bs") {
    // Balance sheet is point-in-time at period end. v1 limitation:
    // we use the same posted-in-period query, which is correct only
    // when the period is the entire history. A future v2 pulls all
    // periods <= the target's endDate.
    const assets = all.filter((r) => r.type === "ASSET");
    const liabilities = all.filter((r) => r.type === "LIABILITY");
    const equity = all.filter((r) => r.type === "EQUITY");
    const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
    const totalEquity = equity.reduce((s, r) => s + r.balance, 0);
    return jsonSuccess({
      period,
      kind,
      assets,
      liabilities,
      equity,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        // Plug = (A − L − E). Non-zero means an out-of-balance ledger,
        // a multi-period roll (v1 limitation), or untaken P&L close.
        plug: totalAssets - totalLiabilities - totalEquity,
      },
    });
  }

  // Cash flow — v1 stub. We return the shell so the UI can render;
  // populating Operating / Investing / Financing requires either an
  // explicit CF mapping per account (preferred long-term) or an
  // indirect-method reconciliation off the BS deltas (v2).
  return jsonSuccess({
    period,
    kind,
    operating: [],
    investing: [],
    financing: [],
    totals: { operating: 0, investing: 0, financing: 0, netChange: 0 },
    note: "Cash Flow v1 returns the shell. Wire it once each GL account is tagged with a CF category or v2 indirect-method reconciliation lands.",
  });
}
