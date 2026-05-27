"use client";

/* Finance · Statements — P&L · Balance Sheet · Cash Flow generator.
 *
 * Toolbar: pick a period (from accounting-periods list) + a statement
 * kind. Body renders the rollup from /api/financials/statements.
 *
 * P&L: revenue table + expense table + net income headline.
 * BS:  assets + liabilities + equity columns, with balance check.
 * CF:  v1 shell (operating/investing/financing buckets) — the API
 *      flags this as "wire when accounts are CF-tagged".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, FileBarChart, ChevronRight, AlertTriangle } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type AcctRow = { id: string; code: string; name: string; balance: number };
type Period = { id: string; label: string; status?: string };

type Pnl = { period: Period; kind: "pnl"; revenue: AcctRow[]; expense: AcctRow[]; totals: { revenue: number; expense: number; netIncome: number } };
type Bs  = { period: Period; kind: "bs"; assets: AcctRow[]; liabilities: AcctRow[]; equity: AcctRow[]; totals: { assets: number; liabilities: number; equity: number } };
type Cf  = { period: Period; kind: "cf"; operating: AcctRow[]; investing: AcctRow[]; financing: AcctRow[]; totals: { operating: number; investing: number; financing: number; netChange: number }; note?: string };
type Statement = Pnl | Bs | Cf;

type Kind = "pnl" | "bs" | "cf";
const KIND_LABEL: Record<Kind, string> = { pnl: "Profit & Loss", bs: "Balance Sheet", cf: "Cash Flow" };

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(0)}`;
}

export default function StatementsPage() {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [periodId, setPeriodId] = useState<string>("");
  const [kind, setKind] = useState<Kind>("pnl");
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { rowVersion } = useOsShell();

  const loadPeriods = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting-periods");
      if (res.status === 403) { setLoadError("Org-admin access required."); return; }
      if (!res.ok) throw new Error(`periods ${res.status}`);
      const d = await res.json();
      const list: Period[] = d.data ?? (Array.isArray(d) ? d : []);
      setPeriods(list);
      if (list.length > 0 && !periodId) setPeriodId(list[list.length - 1].id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [periodId]);
  useEffect(() => { void loadPeriods(); }, [loadPeriods]);
  const v = rowVersion("financials");
  useEffect(() => { if (v > 0) void loadPeriods(); }, [v, loadPeriods]);

  const generate = useCallback(async () => {
    if (!periodId) return;
    setBusy(true); setStmt(null);
    try {
      const res = await fetch(`/api/financials/statements?period=${encodeURIComponent(periodId)}&kind=${kind}`);
      if (!res.ok) throw new Error(`statement ${res.status}`);
      const d = await res.json();
      setStmt(d.data ?? d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
    setBusy(false);
  }, [periodId, kind]);

  // Auto-generate when period+kind change
  useEffect(() => { if (periodId) void generate(); }, [periodId, kind, generate]);

  return (
    <div className="stmt">
      <header className="stmt__head">
        <div className="stmt__head-l">
          <div className="stmt__icon"><FileBarChart /></div>
          <div>
            <h1 className="stmt__title">Financial statements</h1>
            <div className="stmt__sub">Generate P&L, Balance Sheet, and Cash Flow for any accounting period.</div>
          </div>
        </div>
      </header>

      <section className="stmt__toolbar">
        <label className="stmt__field">
          <span>Period</span>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods === null ? <option>Loading…</option> : periods.length === 0 ? <option>No periods</option> :
              periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <div className="stmt__kinds">
          {(["pnl", "bs", "cf"] as Kind[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "is-active" : ""} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      {loadError ? (
        <div className="stmt__error">{loadError}</div>
      ) : busy ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Computing…</div>
      ) : !stmt ? (
        <div className="stmt__empty">Pick a period to generate the statement.</div>
      ) : stmt.kind === "pnl" ? (
        <PnlView s={stmt} />
      ) : stmt.kind === "bs" ? (
        <BsView s={stmt} />
      ) : (
        <CfView s={stmt} />
      )}
    </div>
  );
}

function PnlView({ s }: { s: Pnl }) {
  return (
    <div className="stmt__doc">
      <header className="stmt-doc__head">
        <h2>{KIND_LABEL.pnl}</h2>
        <span>Period · {s.period.label}</span>
      </header>
      <div className="stmt-pnl">
        <section>
          <h3>Revenue</h3>
          <Table rows={s.revenue} positive total={s.totals.revenue} totalLabel="Total revenue" />
        </section>
        <section>
          <h3>Expenses</h3>
          <Table rows={s.expense} total={s.totals.expense} totalLabel="Total expense" />
        </section>
        <section className="stmt-pnl__net">
          <div className="stmt-pnl__net-label">Net income</div>
          <div className={`stmt-pnl__net-val ${s.totals.netIncome >= 0 ? "is-pos" : "is-neg"}`}>{money(s.totals.netIncome)}</div>
        </section>
      </div>
    </div>
  );
}

function BsView({ s }: { s: Bs }) {
  const liabPlusEquity = s.totals.liabilities + s.totals.equity;
  const balanced = Math.abs(s.totals.assets - liabPlusEquity) < 0.01;
  return (
    <div className="stmt__doc">
      <header className="stmt-doc__head">
        <h2>{KIND_LABEL.bs}</h2>
        <span>As of · {s.period.label}</span>
        <span className={balanced ? "stmt-bs__chip stmt-bs__chip--ok" : "stmt-bs__chip stmt-bs__chip--bad"}>
          {balanced ? "✓ Balanced" : "⚠ Unbalanced"}
        </span>
      </header>
      <div className="stmt-bs">
        <section>
          <h3>Assets</h3>
          <Table rows={s.assets} total={s.totals.assets} totalLabel="Total assets" positive />
        </section>
        <section>
          <h3>Liabilities</h3>
          <Table rows={s.liabilities} total={s.totals.liabilities} totalLabel="Total liabilities" />
          <h3 style={{ marginTop: 18 }}>Equity</h3>
          <Table rows={s.equity} total={s.totals.equity} totalLabel="Total equity" />
          <div className="stmt-bs__sum">
            <span>Liabilities + equity</span>
            <strong>{money(liabPlusEquity)}</strong>
          </div>
        </section>
      </div>
    </div>
  );
}

function CfView({ s }: { s: Cf }) {
  return (
    <div className="stmt__doc">
      <header className="stmt-doc__head">
        <h2>{KIND_LABEL.cf}</h2>
        <span>Period · {s.period.label}</span>
      </header>
      {s.note && (
        <div className="stmt__note"><AlertTriangle /> {s.note}</div>
      )}
      <div className="stmt-cf">
        {([
          { label: "Operating activities", rows: s.operating, total: s.totals.operating },
          { label: "Investing activities", rows: s.investing, total: s.totals.investing },
          { label: "Financing activities", rows: s.financing, total: s.totals.financing },
        ]).map((sec) => (
          <section key={sec.label}>
            <h3>{sec.label}</h3>
            {sec.rows.length === 0
              ? <div className="stmt-cf__empty">No flows captured.</div>
              : <Table rows={sec.rows} total={sec.total} totalLabel={`Net ${sec.label.toLowerCase()}`} />}
          </section>
        ))}
        <div className="stmt-cf__net">
          <span>Net change in cash</span>
          <strong className={s.totals.netChange >= 0 ? "is-pos" : "is-neg"}>{money(s.totals.netChange)}</strong>
        </div>
      </div>
    </div>
  );
}

function Table({ rows, total, totalLabel, positive }: { rows: AcctRow[]; total: number; totalLabel: string; positive?: boolean }) {
  if (rows.length === 0) return <div className="stmt__table-empty">No activity in this section.</div>;
  return (
    <table className="stmt-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><code>{r.code}</code></td>
            <td>{r.name}</td>
            <td className={`stmt-table__num ${positive && r.balance < 0 ? "is-neg" : ""}`}>{money(r.balance)}</td>
            <td className="stmt-table__chev"><ChevronRight /></td>
          </tr>
        ))}
        <tr className="stmt-table__total">
          <td colSpan={2}>{totalLabel}</td>
          <td className="stmt-table__num">{money(total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  );
}
