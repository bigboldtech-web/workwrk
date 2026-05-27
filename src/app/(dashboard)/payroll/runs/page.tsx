"use client";

/* Payroll · Runs — pay-run progress board.
 *
 * 4-stage horizontal stepper per pay group (DRAFT -> CALCULATED ->
 * POSTED), with each pay run as a row showing pay group, period span,
 * pay date countdown, totals (gross / net), payslip count, and a
 * single-step "advance" button.
 *
 * GET   /api/pay-runs
 * PATCH /api/pay-runs/[id]   { action: "calculate"|"post"|"cancel" }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDollarSign, ChevronRight, AlertCircle, CheckCircle2, Ban } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";

type ApiPayRun = {
  id: string;
  status: Status;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  totalGross?: number | string | null;
  totalNet?: number | string | null;
  totalTax?: number | string | null;
  totalDeductions?: number | string | null;
  payGroup?: { id: string; name: string } | null;
  _count?: { payslips?: number };
};

const STATUS_LABEL: Record<Status, string> = {
  DRAFT: "Draft", CALCULATING: "Calculating", CALCULATED: "Calculated", POSTED: "Posted", CANCELLED: "Cancelled",
};
const STATUS_HUE: Record<Status, string> = {
  DRAFT: "var(--os-c-indigo)", CALCULATING: "var(--os-c-orange)",
  CALCULATED: "var(--os-c-purple)", POSTED: "var(--os-c-green)", CANCELLED: "var(--os-c-darkgray)",
};
const STEPS: { id: Status; label: string }[] = [
  { id: "DRAFT", label: "Draft" },
  { id: "CALCULATED", label: "Calculated" },
  { id: "POSTED", label: "Posted" },
];

function num(v?: number | string | null): number { if (v == null) return 0; return typeof v === "string" ? parseFloat(v) : v; }
function money(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}
function fmtPeriod(start: string, end: string): string {
  const s = new Date(start); const e = new Date(end);
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
const MS_DAY = 86_400_000;
function daysToPayDate(iso: string): number { return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_DAY); }

function nextAction(s: Status): { action: string; label: string; tone: "primary" | "ghost" } | null {
  if (s === "DRAFT") return { action: "calculate", label: "Calculate", tone: "primary" };
  if (s === "CALCULATED") return { action: "post", label: "Post & release", tone: "primary" };
  return null;
}
function statusStep(s: Status): number {
  if (s === "DRAFT" || s === "CALCULATING") return 0;
  if (s === "CALCULATED") return 1;
  if (s === "POSTED") return 2;
  return 0;
}

export default function PayrollRunsPage() {
  const [runs, setRuns] = useState<ApiPayRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pay-runs?limit=100");
      if (res.status === 403) { setLoadError("Org-admin access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("payroll");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function act(id: string, action: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/pay-runs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(action === "calculate" ? "Calculating pay run…" : action === "post" ? "Pay run posted" : "Pay run cancelled");
      void load();
    } catch { toast("Couldn't update pay run"); }
    setBusyId(null);
  }

  const active = useMemo(() => (runs ?? []).filter((r) => r.status !== "CANCELLED"), [runs]);
  const upcoming = active.filter((r) => r.status === "DRAFT" || r.status === "CALCULATING" || r.status === "CALCULATED");
  const posted = active.filter((r) => r.status === "POSTED");
  const cancelled = (runs ?? []).filter((r) => r.status === "CANCELLED");

  const totalPosted = posted.reduce((acc, r) => acc + num(r.totalNet), 0);
  const inFlightCount = upcoming.length;

  return (
    <div className="payruns">
      <header className="payruns__head">
        <div className="payruns__head-l">
          <div className="payruns__icon"><CircleDollarSign /></div>
          <div>
            <h1 className="payruns__title">Pay runs</h1>
            <div className="payruns__sub">
              {runs === null ? "Loading…" : `${inFlightCount} in flight · ${posted.length} posted · ${money(totalPosted)} disbursed`}
            </div>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="payruns__error">{loadError}</div>
      ) : runs === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : runs.length === 0 ? (
        <div className="payruns__empty">
          <CircleDollarSign />
          <div>
            <h3>No pay runs yet</h3>
            <p>Set up a pay group first, then run payroll for a period. Calculate → review → post.</p>
          </div>
        </div>
      ) : (
        <>
          <section className="payruns__section">
            <header className="payruns__section-head">
              <h2>In flight</h2>
              <span>{upcoming.length}</span>
            </header>
            {upcoming.length === 0 ? (
              <div className="payruns__empty-soft">Nothing to action right now.</div>
            ) : (
              <div className="payruns__list">
                {upcoming.map((r) => {
                  const days = daysToPayDate(r.payDate);
                  const next = nextAction(r.status);
                  const step = statusStep(r.status);
                  return (
                    <article key={r.id} className="payrun">
                      <div className="payrun__group">
                        <div className="payrun__group-name">{r.payGroup?.name ?? "Pay group"}</div>
                        <div className="payrun__period">{fmtPeriod(r.periodStart, r.periodEnd)}</div>
                      </div>
                      <div className="payrun__stepper">
                        {STEPS.map((s, i) => (
                          <div key={s.id} className={`payrun-step ${i <= step ? "is-on" : ""} ${i === step ? "is-current" : ""}`}>
                            <span className="payrun-step__dot" />
                            <span className="payrun-step__lbl">{s.label}</span>
                          </div>
                        ))}
                      </div>
                      <div className="payrun__numbers">
                        <div><span>Gross</span><strong>{money(num(r.totalGross))}</strong></div>
                        <div><span>Net</span><strong>{money(num(r.totalNet))}</strong></div>
                        <div><span>Payslips</span><strong>{r._count?.payslips ?? 0}</strong></div>
                      </div>
                      <div className="payrun__paydate">
                        <span className={`payrun__paydate-days ${days < 0 ? "is-late" : days === 0 ? "is-today" : ""}`}>
                          {days < 0 ? `${-days}d late` : days === 0 ? "Pay date today" : `Pay date in ${days}d`}
                        </span>
                        <span className="payrun__paydate-iso">{new Date(r.payDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                      <div className="payrun__actions">
                        {next && (
                          <button
                            type="button"
                            className={`payrun__btn payrun__btn--${next.tone}`}
                            disabled={busyId === r.id}
                            onClick={() => act(r.id, next.action)}
                          >
                            {next.label} <ChevronRight />
                          </button>
                        )}
                        {r.status === "CALCULATING" && <span className="payrun__btn payrun__btn--busy">Calculating…</span>}
                        {(r.status === "DRAFT" || r.status === "CALCULATED") && (
                          <button type="button" className="payrun__btn payrun__btn--ghost" onClick={() => act(r.id, "cancel")}>
                            <Ban /> Cancel
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {posted.length > 0 && (
            <section className="payruns__section">
              <header className="payruns__section-head">
                <h2>Posted</h2>
                <span>{posted.length} · {money(totalPosted)}</span>
              </header>
              <div className="payruns__posted-list">
                {posted.slice(0, 12).map((r) => (
                  <div key={r.id} className="payrun-posted">
                    <CheckCircle2 />
                    <span className="payrun-posted__group">{r.payGroup?.name ?? "Pay group"}</span>
                    <span className="payrun-posted__period">{fmtPeriod(r.periodStart, r.periodEnd)}</span>
                    <span className="payrun-posted__net">{money(num(r.totalNet))}</span>
                    <span className="payrun-posted__slips">{r._count?.payslips ?? 0} slips</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cancelled.length > 0 && (
            <details className="payruns__cancelled">
              <summary><AlertCircle /> Cancelled · {cancelled.length}</summary>
              <ul>
                {cancelled.slice(0, 8).map((r) => (
                  <li key={r.id}>{r.payGroup?.name} · {fmtPeriod(r.periodStart, r.periodEnd)}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
