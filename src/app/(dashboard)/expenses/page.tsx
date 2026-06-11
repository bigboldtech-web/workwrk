"use client";

/* Expenses — submitter & approver workspace.
 *
 *  GET   /api/expenses?scope=all|mine
 *  POST  /api/expenses                       { description, amount, category, ... }
 *  PATCH /api/expenses/[id]                  { description?, amount?, submit? }
 *  POST  /api/expenses/[id]/decision         { decision: APPROVE | REJECT | REIMBURSE }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Receipt, Plus, Search, Hash, ChevronRight, Clock, CheckCircle2, XCircle, Banknote,
  FileText, Activity, Layers, Calendar as CalendarIcon, AlertTriangle,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ExpStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "REIMBURSED";

type ApiExpense = {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  status: ExpStatus;
  expenseDate?: string | null;
  submittedAt?: string | null;
  decisionAt?: string | null;
  receiptUrl?: string | null;
  reporter?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  approver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STATUS_LABEL: Record<ExpStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved",
  REJECTED: "Rejected", REIMBURSED: "Reimbursed",
};
const STATUS_COLOR: Record<ExpStatus, string> = {
  DRAFT: "var(--os-c-indigo)", SUBMITTED: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", REJECTED: "var(--os-c-red)",
  REIMBURSED: "var(--os-c-green)",
};
const STATUS_ICON: Record<ExpStatus, typeof Clock> = {
  DRAFT: FileText, SUBMITTED: Clock, APPROVED: CheckCircle2,
  REJECTED: XCircle, REIMBURSED: Banknote,
};
const GROUP_ORDER: ExpStatus[] = ["SUBMITTED", "DRAFT", "APPROVED", "REJECTED", "REIMBURSED"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

function fmtCurrency(n: number, cur: string): string {
  const sym = cur === "INR" ? "₹" : cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : "";
  return `${sym}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}`;
}

export default function ExpensesPage() {
  const [exps, setExps] = useState<ApiExpense[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | ExpStatus>("ALL");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      let res = await fetch("/api/expenses?scope=all&limit=200");
      if (res.status === 403) res = await fetch("/api/expenses?scope=mine&limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiExpense[] = data?.data?.items ?? data?.items ?? (Array.isArray(data?.data) ? data.data : []) ?? (Array.isArray(data) ? data : []);
      setExps(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("expenses");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function decide(id: string, decision: "APPROVE" | "REJECT" | "REIMBURSE") {
    try {
      const res = await fetch(`/api/expenses/${id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) { toast(res.status === 403 ? "Not allowed" : "Couldn't update"); return; }
      toast(decision === "APPROVE" ? "Approved" : decision === "REJECT" ? "Rejected" : "Marked reimbursed");
      void load();
    } catch { toast("Couldn't update"); }
  }

  async function submitDraft(id: string) {
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submit: true }),
      });
      if (!res.ok) { toast("Couldn't submit"); return; }
      toast("Submitted for approval");
      void load();
    } catch { toast("Couldn't submit"); }
  }

  async function quickAdd() {
    try {
      const res = await fetch("/api/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Untitled expense",
          amount: 0, currency: "INR", category: "OTHER",
          expenseDate: new Date().toISOString(),
        }),
      });
      if (!res.ok) { toast("Couldn't create draft"); return; }
      toast("Draft created — fill in the details");
      void load();
    } catch { toast("Couldn't create draft"); }
  }

  const stats = useMemo(() => {
    const list = exps ?? [];
    const draft = list.filter((e) => e.status === "DRAFT");
    const submitted = list.filter((e) => e.status === "SUBMITTED");
    const approved = list.filter((e) => e.status === "APPROVED");
    const rejected = list.filter((e) => e.status === "REJECTED");
    const reimbursed = list.filter((e) => e.status === "REIMBURSED");
    const pendingValue = submitted.reduce((a, e) => a + e.amount, 0);
    const reimbursedValue = reimbursed.reduce((a, e) => a + e.amount, 0);
    const cur = list[0]?.currency ?? "INR";
    return {
      total: list.length, draft, submitted, approved, rejected, reimbursed,
      pendingValue, reimbursedValue, cur,
    };
  }, [exps]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of exps ?? []) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [exps]);

  const filtered = useMemo(() => {
    let list = exps ?? [];
    if (filter !== "ALL") list = list.filter((e) => e.status === filter);
    if (activeCategory) list = list.filter((e) => e.category === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((e) =>
      e.description.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      `${e.reporter?.firstName ?? ""} ${e.reporter?.lastName ?? ""}`.toLowerCase().includes(q));
    return list;
  }, [exps, filter, activeCategory, search]);

  const grouped = useMemo(() => {
    const m = new Map<ExpStatus, ApiExpense[]>();
    for (const s of GROUP_ORDER) m.set(s, []);
    for (const e of filtered) {
      if (!m.has(e.status)) m.set(e.status, []);
      m.get(e.status)!.push(e);
    }
    return GROUP_ORDER.map((s) => ({ status: s, items: m.get(s) ?? [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <>
      <OsTitleBar
        title="Expenses"
        Icon={Receipt}
        iconGradient={GRAD.brownOrange}
        description={exps === null ? "Loading expenses…" : `${stats.total} expense${stats.total === 1 ? "" : "s"} · ${stats.submitted.length} pending · ${fmtCurrency(stats.reimbursedValue, stats.cur)} reimbursed`}
        actions={
          <div className="exp__head-actions">
            <button type="button" className="exp__btn-primary" onClick={quickAdd}>
              <Plus /> New expense
            </button>
          </div>
        }
      />

      <div className="exp">
        <div className="exp__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}        label="Pending approval" value={`${stats.submitted.length}`} sub={stats.submitted.length ? fmtCurrency(stats.pendingValue, stats.cur) : "all clear"} />
          <KpiTile accent="var(--os-c-blue)"   Icon={CheckCircle2} label="Approved"        value={`${stats.approved.length}`} sub="awaiting reimburse" />
          <KpiTile accent="var(--os-c-green)"  Icon={Banknote}     label="Reimbursed"      value={fmtCurrency(stats.reimbursedValue, stats.cur)} sub={`${stats.reimbursed.length} settled`} />
          <KpiTile accent="var(--os-c-indigo)" Icon={FileText}     label="Drafts"          value={`${stats.draft.length}`}    sub="ready to submit" />
        </div>

        <div className="exp__toolbar">
          <div className="exp__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description, category, reporter…" />
          </div>
          <div className="exp__filters">
            {(["ALL", "SUBMITTED", "DRAFT", "APPROVED", "REJECTED", "REIMBURSED"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`exp__filter${filter === s ? " is-active" : ""}`}
                style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_COLOR[s as ExpStatus] } : undefined}
                onClick={() => setFilter(s)}
              >
                {s === "ALL" ? <Hash /> : (() => { const I = STATUS_ICON[s as ExpStatus]; return <I />; })()}
                {s === "ALL" ? "All" : STATUS_LABEL[s as ExpStatus]}
                <span className="exp__filter-n">
                  {s === "ALL" ? stats.total : (
                    s === "DRAFT" ? stats.draft.length :
                    s === "SUBMITTED" ? stats.submitted.length :
                    s === "APPROVED" ? stats.approved.length :
                    s === "REJECTED" ? stats.rejected.length :
                    stats.reimbursed.length
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {categories.length > 0 && (
          <div className="exp__cats">
            <button type="button" className={`exp__cat${activeCategory === null ? " is-active" : ""}`} onClick={() => setActiveCategory(null)}>
              <Layers /> All categories
            </button>
            {categories.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                className={`exp__cat${activeCategory === cat ? " is-active" : ""}`}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                {cat.replace(/_/g, " ").toLowerCase()}
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={Receipt} iconGradient={GRAD.redPink} title="Couldn't load expenses" subtitle={loadError} cta="Retry" />
        ) : exps === null ? (
          <div className="exp__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Receipt}
            iconGradient={GRAD.brownOrange}
            title="No expenses yet"
            subtitle="Submit your first expense — upload a receipt and we'll route it to your manager."
            chips={["Travel", "Meals", "Lodging", "Supplies", "Subscription"]}
            cta="New expense"
          />
        ) : grouped.length === 0 ? (
          <div className="exp__no-match"><AlertTriangle /> No expenses match the current filter.</div>
        ) : (
          <div className="exp__groups">
            {grouped.map((g) => {
              const Icon = STATUS_ICON[g.status];
              return (
                <section key={g.status} className="exp__group" style={{ ["--g-c" as unknown as string]: STATUS_COLOR[g.status] }}>
                  <header className="exp__group-head">
                    <span className="exp__group-tag"><Icon /> {STATUS_LABEL[g.status]}</span>
                    <span className="exp__group-count">{g.items.length}</span>
                    <span className="exp__group-line" />
                    <span className="exp__group-total">
                      {fmtCurrency(g.items.reduce((a, e) => a + e.amount, 0), g.items[0]?.currency ?? stats.cur)}
                    </span>
                  </header>
                  <div className="exp__list">
                    {g.items.map((e) => (
                      <ExpenseRow
                        key={e.id}
                        e={e}
                        onSubmit={() => submitDraft(e.id)}
                        onApprove={() => decide(e.id, "APPROVE")}
                        onReject={() => decide(e.id, "REJECT")}
                        onReimburse={() => decide(e.id, "REIMBURSE")}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ExpenseRow({ e, onSubmit, onApprove, onReject, onReimburse }: {
  e: ApiExpense;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReimburse: () => void;
}) {
  const reporter = e.reporter;
  const dateStr = e.expenseDate ? new Date(e.expenseDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  return (
    <Link href={`/expenses/${e.id}`} className="exp__row" style={{ ["--s-c" as unknown as string]: STATUS_COLOR[e.status] }}>
      <span className="exp__row-av" style={{ background: reporter ? avColor(reporter.id) : "var(--os-ink-3)" }}>
        {reporter ? initials(reporter.firstName, reporter.lastName) : "?"}
      </span>
      <div className="exp__row-main">
        <div className="exp__row-title">{e.description}</div>
        <div className="exp__row-meta">
          <span className="exp__row-cat">{e.category.replace(/_/g, " ").toLowerCase()}</span>
          <span className="exp__row-date"><CalendarIcon /> {dateStr}</span>
          {reporter && <span className="exp__row-rep">{reporter.firstName ?? ""} {reporter.lastName ?? ""}</span>}
          {e.receiptUrl && <span className="exp__row-receipt"><FileText /> receipt</span>}
        </div>
      </div>
      <div className="exp__row-amt">{fmtCurrency(e.amount, e.currency)}</div>
      <div className="exp__row-actions" onClick={(ev) => ev.preventDefault()}>
        {e.status === "DRAFT" && (
          <button type="button" className="exp__row-btn exp__row-btn--submit" onClick={(ev) => { ev.preventDefault(); onSubmit(); }}>
            <Activity /> Submit
          </button>
        )}
        {e.status === "SUBMITTED" && (
          <>
            <button type="button" className="exp__row-btn exp__row-btn--approve" onClick={(ev) => { ev.preventDefault(); onApprove(); }}>
              <CheckCircle2 /> Approve
            </button>
            <button type="button" className="exp__row-btn exp__row-btn--reject" onClick={(ev) => { ev.preventDefault(); onReject(); }}>
              <XCircle /> Reject
            </button>
          </>
        )}
        {e.status === "APPROVED" && (
          <button type="button" className="exp__row-btn exp__row-btn--reimburse" onClick={(ev) => { ev.preventDefault(); onReimburse(); }}>
            <Banknote /> Reimburse
          </button>
        )}
      </div>
      <ChevronRight className="exp__row-arrow" />
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Receipt; label: string; value: string; sub: string }) {
  return (
    <div className="exp__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="exp__kpi-accent" aria-hidden="true" />
      <div className="exp__kpi-row">
        <div className="exp__kpi-icon"><Icon /></div>
        <div className="exp__kpi-label">{label}</div>
      </div>
      <div className="exp__kpi-value">{value}</div>
      <div className="exp__kpi-sub">{sub}</div>
    </div>
  );
}
