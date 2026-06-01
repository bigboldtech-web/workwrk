"use client";

/* Payroll · Payslip — printable paystub.
 *
 *  GET /api/payslips/[id]
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CircleDollarSign, ArrowLeft, Printer, Share2, MoreHorizontal,
  FileText, Calendar as CalendarIcon, CreditCard, Mail, User as UserIcon,
  TrendingUp, TrendingDown, Percent, CheckCircle2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Line = {
  id: string;
  kind: "EARNING" | "DEDUCTION" | "TAX";
  amount: number | string;
  hours: number | string | null;
  rate: number | string | null;
  ytdAmount: number | string | null;
  taxLabel: string | null;
  earningCode: { code: string; name: string } | null;
  deductionCode: { code: string; name: string } | null;
};

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
  payRun: { id: string; periodStart: string; periodEnd: string; payDate: string; status: string };
  payGroup: { id: string; name: string; currency: string };
  lines: Line[];
};

const METHOD_LABELS: Record<Payslip["payMethod"], string> = {
  DIRECT_DEPOSIT: "Direct deposit",
  CHECK: "Check",
  WIRE: "Wire",
  MANUAL: "Manual",
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

function num(v?: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}
function fmtMoney(n: number, currency = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}
function fmtFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/payslips/${id}`);
      if (!res.ok) { setNotFound(true); return; }
      const data = await res.json();
      setSlip(data);
      setNotFound(false);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function copyLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy"),
    );
  }

  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading paystub…" Icon={CircleDollarSign} iconGradient={GRAD.greenTeal} showInvite={false} />
        <div className="pyps__loading">Loading paystub…</div>
      </>
    );
  }
  if (notFound || !slip) {
    return (
      <>
        <OsTitleBar title="Paystub not found" Icon={CircleDollarSign} iconGradient={GRAD.redPink} showInvite={false} />
        <OsEmptyView Icon={CircleDollarSign} iconGradient={GRAD.redPink} title="We couldn't find that paystub" subtitle="It may have been removed or you don't have access." cta="Back to payroll" />
      </>
    );
  }

  const cur = slip.payGroup.currency;
  const earnings = slip.lines.filter((l) => l.kind === "EARNING");
  const deductions = slip.lines.filter((l) => l.kind === "DEDUCTION");
  const taxes = slip.lines.filter((l) => l.kind === "TAX");

  const subjName = `${slip.subject.firstName} ${slip.subject.lastName}`;
  const avBg = avColor(slip.subject.id);
  const shortId = slip.id.slice(0, 8).toUpperCase();
  const gross = num(slip.gross);
  const taxNum = num(slip.tax);
  const dedNum = num(slip.deductions);
  const net = num(slip.net);

  return (
    <>
      <div className="pyps__hide-print">
        <OsTitleBar
          title={`Paystub · ${subjName}`}
          Icon={CircleDollarSign}
          iconGradient={GRAD.greenTeal}
          description={`#${shortId} · ${slip.payGroup.name}`}
          actions={
            <div className="pyps__head-actions">
              <button type="button" className="pyps__back" onClick={() => router.push(`/payroll/${slip.payRun.id}`)}>
                <ArrowLeft /> Pay run
              </button>
              <button type="button" className="pyps__btn" onClick={copyLink}>
                <Share2 /> Copy link
              </button>
              <button type="button" className="pyps__btn pyps__btn--primary" onClick={() => window.print()}>
                <Printer /> Print
              </button>
              <button type="button" className="pyps__btn pyps__btn--icon" aria-label="More"><MoreHorizontal /></button>
            </div>
          }
        />
      </div>

      <div className="pyps">
        {/* Paystub document */}
        <article className="pyps__doc">
          {/* Header */}
          <header className="pyps__doc-head">
            <div className="pyps__doc-org">
              <div className="pyps__doc-mark">
                <FileText />
              </div>
              <div className="pyps__doc-org-info">
                <div className="pyps__doc-org-name">{slip.payGroup.name}</div>
                <div className="pyps__doc-org-sub">Payroll · Statement of earnings</div>
              </div>
            </div>
            <div className="pyps__doc-meta">
              <div className="pyps__doc-meta-row">
                <span className="pyps__doc-meta-label">Paystub #</span>
                <span className="pyps__doc-meta-val">{shortId}</span>
              </div>
              <div className="pyps__doc-meta-row">
                <span className="pyps__doc-meta-label">Status</span>
                <span className={`pyps__doc-status${slip.payRun.status === "POSTED" ? " is-posted" : ""}`}>
                  {slip.payRun.status === "POSTED" && <CheckCircle2 />}
                  {slip.payRun.status}
                </span>
              </div>
            </div>
          </header>

          {/* Subject + period */}
          <section className="pyps__subject">
            <div className="pyps__subject-info">
              <span className="pyps__subject-av" style={{ background: avBg }}>{initials(slip.subject.firstName, slip.subject.lastName)}</span>
              <div>
                <div className="pyps__subject-label">Paid to</div>
                <div className="pyps__subject-name">{subjName}</div>
                <div className="pyps__subject-email"><Mail /> {slip.subject.email}</div>
              </div>
            </div>
            <div className="pyps__period">
              <div className="pyps__period-row">
                <span className="pyps__period-label">Pay period</span>
                <span className="pyps__period-val">
                  {new Date(slip.payRun.periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {" → "}
                  {new Date(slip.payRun.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <div className="pyps__period-row">
                <span className="pyps__period-label">Pay date</span>
                <span className="pyps__period-val pyps__period-val--strong">{fmtFullDate(slip.payRun.payDate)}</span>
              </div>
              <div className="pyps__period-row">
                <span className="pyps__period-label">Hours worked</span>
                <span className="pyps__period-val">{num(slip.hoursWorked).toFixed(2)}</span>
              </div>
            </div>
          </section>

          {/* 3 columns: Earnings · Taxes · Deductions */}
          <section className="pyps__columns">
            <PaystubColumn title="Earnings" Icon={TrendingUp} accent="var(--os-c-green)" lines={earnings} currency={cur} kind="EARNING" />
            <PaystubColumn title="Taxes" Icon={Percent} accent="var(--os-c-orange)" lines={taxes} currency={cur} kind="TAX" />
            <PaystubColumn title="Deductions" Icon={TrendingDown} accent="var(--os-c-red)" lines={deductions} currency={cur} kind="DEDUCTION" />
          </section>

          {/* Net summary */}
          <section className="pyps__summary">
            <div className="pyps__summary-grid">
              <div className="pyps__summary-cell">
                <span>Gross pay</span>
                <strong>{fmtMoney(gross, cur)}</strong>
              </div>
              <span className="pyps__summary-op">−</span>
              <div className="pyps__summary-cell">
                <span>Tax</span>
                <strong className="pyps__summary-tax">{fmtMoney(taxNum, cur)}</strong>
              </div>
              <span className="pyps__summary-op">−</span>
              <div className="pyps__summary-cell">
                <span>Deductions</span>
                <strong className="pyps__summary-ded">{fmtMoney(dedNum, cur)}</strong>
              </div>
              <span className="pyps__summary-op">=</span>
              <div className="pyps__summary-cell pyps__summary-cell--net">
                <span>Net pay</span>
                <strong>{fmtMoney(net, cur)}</strong>
              </div>
            </div>

            <div className="pyps__pay-method">
              <CreditCard />
              <span><strong>{METHOD_LABELS[slip.payMethod]}</strong>{slip.bankLast4 ? ` · ending ····${slip.bankLast4}` : ""}</span>
            </div>
          </section>

          {/* Footer / legal */}
          <footer className="pyps__doc-foot">
            <span>This statement is for informational purposes only.</span>
            <Link href={`/payroll/${slip.payRun.id}`} className="pyps__doc-foot-link pyps__hide-print">
              <UserIcon /> View pay run
            </Link>
          </footer>
        </article>
      </div>
    </>
  );
}

function PaystubColumn({
  title, Icon, accent, lines, currency, kind,
}: {
  title: string;
  Icon: typeof TrendingUp;
  accent: string;
  lines: Line[];
  currency: string;
  kind: "EARNING" | "DEDUCTION" | "TAX";
}) {
  const total = lines.reduce((acc, l) => acc + num(l.amount), 0);
  return (
    <div className="pyps__col" style={{ ["--col-c" as unknown as string]: accent }}>
      <header className="pyps__col-head">
        <Icon />
        <h3>{title}</h3>
        <span className="pyps__col-count">{lines.length}</span>
      </header>
      {lines.length === 0 ? (
        <div className="pyps__col-empty">None this period.</div>
      ) : (
        <ul className="pyps__col-lines">
          {lines.map((l) => {
            const hasHours = l.hours != null && num(l.hours) > 0;
            const name = kind === "EARNING" ? (l.earningCode?.name ?? "—")
                       : kind === "DEDUCTION" ? (l.deductionCode?.name ?? "—")
                       : (l.taxLabel ?? "Tax");
            return (
              <li key={l.id} className="pyps__col-line">
                <div className="pyps__col-line-main">
                  <div className="pyps__col-line-name">{name}</div>
                  {hasHours && (
                    <div className="pyps__col-line-rate">
                      {num(l.hours).toFixed(2)}h × {l.rate != null ? num(l.rate).toFixed(2) : "—"}
                    </div>
                  )}
                </div>
                <div className="pyps__col-line-amounts">
                  <div className="pyps__col-line-amt">{fmtMoney(num(l.amount), currency)}</div>
                  {l.ytdAmount != null && num(l.ytdAmount) > 0 && (
                    <div className="pyps__col-line-ytd">YTD {fmtMoney(num(l.ytdAmount), currency)}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="pyps__col-total">
        <span>Total {title.toLowerCase()}</span>
        <strong>{fmtMoney(total, currency)}</strong>
      </footer>
    </div>
  );
}
