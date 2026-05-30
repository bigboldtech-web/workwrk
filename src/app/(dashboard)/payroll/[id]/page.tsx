"use client";

/* Payroll · Run detail — bespoke hero + status flow + payslips table.
 *
 *  GET   /api/pay-runs/[id]
 *  PATCH /api/pay-runs/[id]   { action: calculate | post | cancel, reason? }
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CircleDollarSign, ArrowLeft, Share2, MoreHorizontal,
  Calendar as CalendarIcon, Calculator, Send, XCircle, ChevronRight,
  CheckCircle2, Loader2, Play, Receipt, FileText,
  CreditCard, ArrowRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type PayRunStatus = "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";

type Payslip = {
  id: string;
  gross: number | string;
  net: number | string;
  tax: number | string;
  deductions: number | string;
  hoursWorked: number | string;
  payMethod: "DIRECT_DEPOSIT" | "CHECK" | "WIRE" | "MANUAL";
  bankLast4: string | null;
  subject: { id: string; firstName: string; lastName: string; email: string };
};

type PayRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: PayRunStatus;
  totalGross: number | string;
  totalNet: number | string;
  totalTax: number | string;
  totalDeductions: number | string;
  notes: string | null;
  payGroup: { id: string; name: string; frequency: string; currency: string };
  payslips: Payslip[];
};

const STATUS_LABELS: Record<PayRunStatus, string> = {
  DRAFT: "Draft", CALCULATING: "Calculating", CALCULATED: "Calculated",
  POSTED: "Posted", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<PayRunStatus, string> = {
  DRAFT: C.indigo, CALCULATING: C.orange, CALCULATED: C.purple,
  POSTED: C.green, CANCELLED: C.gray,
};
const STATUS_FLOW: PayRunStatus[] = ["DRAFT", "CALCULATING", "CALCULATED", "POSTED"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?";
}

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number, currency = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${currency} ${Math.round(n).toLocaleString()}`; }
}
function fmtFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function fmtPeriod(start: string, end: string): string {
  return `${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

const METHOD_LABELS: Record<Payslip["payMethod"], string> = {
  DIRECT_DEPOSIT: "Direct deposit",
  CHECK: "Check",
  WIRE: "Wire",
  MANUAL: "Manual",
};
const METHOD_COLORS: Record<Payslip["payMethod"], string> = {
  DIRECT_DEPOSIT: C.green, CHECK: C.blue, WIRE: C.purple, MANUAL: C.orange,
};

export default function PayRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const { bumpRowVersion } = useOsShell();
  const [run, setRun] = useState<PayRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"net-desc" | "net-asc" | "name" | "hours">("net-desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pay-runs/${id}`);
      if (!res.ok) { setNotFound(true); return; }
      const data = await res.json();
      setRun(data);
      setNotFound(false);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function action(name: "calculate" | "post" | "cancel", reason?: string) {
    setBusy(name);
    try {
      const res = await fetch(`/api/pay-runs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, reason: reason ?? null }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only org admins can move payroll");
        else toast(`Couldn't ${name}`);
        return;
      }
      bumpRowVersion("payroll");
      toast(`Run ${name}d`);
      void load();
    } catch { toast(`Couldn't ${name}`); }
    finally { setBusy(null); }
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy"),
    );
  }

  // ─── Filter + sort payslips ──────────────────────────────
  const filteredSlips = useMemo(() => {
    if (!run) return [];
    let list = run.payslips ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        `${p.subject.firstName} ${p.subject.lastName}`.toLowerCase().includes(q) ||
        p.subject.email.toLowerCase().includes(q));
    }
    const sorted = list.slice();
    if (sortKey === "net-desc") sorted.sort((a, b) => num(b.net) - num(a.net));
    else if (sortKey === "net-asc") sorted.sort((a, b) => num(a.net) - num(b.net));
    else if (sortKey === "name") sorted.sort((a, b) => `${a.subject.firstName} ${a.subject.lastName}`.localeCompare(`${b.subject.firstName} ${b.subject.lastName}`));
    else if (sortKey === "hours") sorted.sort((a, b) => num(b.hoursWorked) - num(a.hoursWorked));
    return sorted;
  }, [run, search, sortKey]);

  // Method mix (hook must be before any early return)
  const methodCounts = useMemo(() => {
    if (!run) return [] as { method: Payslip["payMethod"]; count: number }[];
    const m = new Map<Payslip["payMethod"], number>();
    for (const p of run.payslips) m.set(p.payMethod, (m.get(p.payMethod) ?? 0) + 1);
    return Array.from(m.entries()).map(([k, c]) => ({ method: k, count: c }));
  }, [run]);

  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading run…" Icon={CircleDollarSign} iconGradient={GRAD.greenTeal} showInvite={false} />
        <div className="pyrd__loading">Loading pay run…</div>
      </>
    );
  }
  if (notFound || !run) {
    return (
      <>
        <OsTitleBar title="Run not found" Icon={CircleDollarSign} iconGradient={GRAD.redPink} showInvite={false} />
        <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.redPink} title="We couldn't find that pay run" subtitle="It may have been deleted, or you don't have access." cta="Back to payroll" />
      </>
    );
  }

  const statusColor = STATUS_COLORS[run.status];
  const currentIdx = STATUS_FLOW.indexOf(run.status);
  const cur = run.payGroup.currency;
  const StatusIcon = run.status === "POSTED" ? CheckCircle2 : run.status === "CALCULATING" ? Loader2 : run.status === "CANCELLED" ? XCircle : Play;
  const dayDelta = daysUntil(run.payDate);
  const dayLabel = dayDelta > 0 ? `in ${dayDelta} day${dayDelta === 1 ? "" : "s"}`
                  : dayDelta === 0 ? "today"
                  : `${-dayDelta} day${dayDelta === -1 ? "" : "s"} ago`;
  const shortId = run.id.slice(0, 8).toUpperCase();

  return (
    <>
      <OsTitleBar
        title={run.payGroup.name}
        Icon={CircleDollarSign}
        iconGradient={GRAD.greenTeal}
        description={`#${shortId} · ${STATUS_LABELS[run.status]} · ${fmtPeriod(run.periodStart, run.periodEnd)}`}
        actions={
          <div className="pyrd__head-actions">
            <button type="button" className="pyrd__back" onClick={() => router.push("/payroll")}>
              <ArrowLeft /> Payroll
            </button>
            <button type="button" className="pyrd__btn" onClick={copyLink}>
              <Share2 /> Copy link
            </button>
            <button type="button" className="pyrd__btn pyrd__btn--icon" aria-label="More"><MoreHorizontal /></button>
          </div>
        }
      />

      <div className="pyrd">
        {/* Hero card */}
        <section className="pyrd__hero" style={{ ["--hero-c" as unknown as string]: statusColor }}>
          <span className="pyrd__hero-accent" aria-hidden="true" />
          <div className="pyrd__hero-main">
            <div className="pyrd__hero-meta">
              <span className="pyrd__hero-id">#{shortId}</span>
              <span className="pyrd__hero-status">
                <StatusIcon /> {STATUS_LABELS[run.status]}
              </span>
              <span className="pyrd__hero-freq">{run.payGroup.frequency} · {cur}</span>
            </div>
            <h1 className="pyrd__hero-title">{run.payGroup.name}</h1>
            <div className="pyrd__hero-period">
              <CalendarIcon /> {fmtPeriod(run.periodStart, run.periodEnd)} · Pay {fmtFullDate(run.payDate)} ({dayLabel})
            </div>

            {/* Status flow */}
            <div className="pyrd__flow">
              {STATUS_FLOW.map((s, i) => {
                const isCurrent = s === run.status;
                const isPast = currentIdx >= 0 && i < currentIdx;
                const tone = isCurrent ? "current" : isPast ? "past" : "future";
                return (
                  <span key={s} className={`pyrd__flow-step pyrd__flow-step--${tone}`} style={{ ["--step-c" as unknown as string]: STATUS_COLORS[s] }}>
                    <span className="pyrd__flow-dot">{i + 1}</span>
                    <span className="pyrd__flow-label">{STATUS_LABELS[s]}</span>
                    {i < STATUS_FLOW.length - 1 && <ChevronRight className="pyrd__flow-sep" />}
                  </span>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="pyrd__actions">
              {(run.status === "DRAFT" || run.status === "CALCULATED") && (
                <button type="button" className="pyrd__action pyrd__action--primary" onClick={() => action("calculate")} disabled={busy !== null}>
                  <Calculator /> {busy === "calculate" ? "Calculating…" : "Calculate"}
                </button>
              )}
              {run.status === "CALCULATED" && (
                <button type="button" className="pyrd__action pyrd__action--win" onClick={() => action("post")} disabled={busy !== null}>
                  <Send /> {busy === "post" ? "Posting…" : "Post run"}
                </button>
              )}
              {(run.status === "DRAFT" || run.status === "CALCULATED") && (
                <button
                  type="button"
                  className="pyrd__action pyrd__action--danger"
                  disabled={busy !== null}
                  onClick={() => {
                    const reason = typeof window !== "undefined" ? window.prompt("Reason for cancelling?") : null;
                    if (reason === null) return;
                    action("cancel", reason);
                  }}
                >
                  <XCircle /> Cancel
                </button>
              )}
            </div>
          </div>

          {/* Totals */}
          <div className="pyrd__hero-totals">
            <Total label="Gross"      value={fmtMoney(num(run.totalGross), cur)}      accent="var(--os-ink)" />
            <Total label="Tax"        value={fmtMoney(num(run.totalTax), cur)}        accent="var(--os-c-orange)" />
            <Total label="Deductions" value={fmtMoney(num(run.totalDeductions), cur)} accent="var(--os-c-red)" />
            <Total label="Net"        value={fmtMoney(num(run.totalNet), cur)}        accent="var(--os-c-green)" hero />
          </div>
        </section>

        {/* Method mix mini */}
        {methodCounts.length > 0 && (
          <div className="pyrd__methods">
            {methodCounts.map((m) => (
              <div key={m.method} className="pyrd__method" style={{ ["--m-c" as unknown as string]: METHOD_COLORS[m.method] }}>
                <CreditCard />
                <span className="pyrd__method-name">{METHOD_LABELS[m.method]}</span>
                <span className="pyrd__method-count">{m.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Payslips */}
        <section className="pyrd__panel">
          <header className="pyrd__panel-head">
            <Receipt /> Payslips
            <span className="pyrd__panel-sub">{run.payslips.length} total</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee…"
              aria-label="Search payslips"
              className="pyrd__panel-search"
            />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} className="pyrd__panel-sort">
              <option value="net-desc">Net (high → low)</option>
              <option value="net-asc">Net (low → high)</option>
              <option value="name">A–Z</option>
              <option value="hours">Hours worked</option>
            </select>
          </header>

          {filteredSlips.length === 0 ? (
            <div className="pyrd__panel-empty">
              {run.payslips.length === 0
                ? (run.status === "DRAFT" ? "Click Calculate to generate payslips." : "No payslips in this run.")
                : `No payslips match "${search}".`}
            </div>
          ) : (
            <div className="pyrd__slips">
              <div className="pyrd__slip-head">
                <span>Employee</span>
                <span className="pyrd__slip-num">Hours</span>
                <span className="pyrd__slip-num">Gross</span>
                <span className="pyrd__slip-num">Tax</span>
                <span className="pyrd__slip-num">Deductions</span>
                <span className="pyrd__slip-num">Net</span>
                <span>Method</span>
                <span />
              </div>
              {filteredSlips.map((p) => {
                const av = avColor(p.subject.id);
                return (
                  <Link key={p.id} href={`/payroll/payslip/${p.id}`} className="pyrd__slip">
                    <div className="pyrd__slip-emp">
                      <span className="pyrd__slip-av" style={{ background: av }}>{initials(p.subject.firstName, p.subject.lastName)}</span>
                      <div className="pyrd__slip-emp-info">
                        <div className="pyrd__slip-name">{p.subject.firstName} {p.subject.lastName}</div>
                        <div className="pyrd__slip-email">{p.subject.email}</div>
                      </div>
                    </div>
                    <span className="pyrd__slip-num pyrd__slip-val">{num(p.hoursWorked).toFixed(1)}</span>
                    <span className="pyrd__slip-num pyrd__slip-val">{fmtMoney(num(p.gross), cur)}</span>
                    <span className="pyrd__slip-num pyrd__slip-val pyrd__slip-tax">{fmtMoney(num(p.tax), cur)}</span>
                    <span className="pyrd__slip-num pyrd__slip-val pyrd__slip-ded">{fmtMoney(num(p.deductions), cur)}</span>
                    <span className="pyrd__slip-num pyrd__slip-val pyrd__slip-net">{fmtMoney(num(p.net), cur)}</span>
                    <span className="pyrd__slip-method" style={{ ["--m-c" as unknown as string]: METHOD_COLORS[p.payMethod] }}>
                      <CreditCard /> {METHOD_LABELS[p.payMethod]}{p.bankLast4 ? ` ····${p.bankLast4}` : ""}
                    </span>
                    <ArrowRight className="pyrd__slip-arrow" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Notes */}
        {run.notes && (
          <section className="pyrd__panel">
            <header className="pyrd__panel-head">
              <FileText /> Notes
            </header>
            <p className="pyrd__notes">{run.notes}</p>
          </section>
        )}
      </div>
    </>
  );
}

function Total({ label, value, accent, hero }: { label: string; value: string; accent: string; hero?: boolean }) {
  return (
    <div className={`pyrd__total${hero ? " pyrd__total--hero" : ""}`} style={{ ["--total-c" as unknown as string]: accent }}>
      <div className="pyrd__total-label">{label}</div>
      <div className="pyrd__total-value">{value}</div>
    </div>
  );
}
