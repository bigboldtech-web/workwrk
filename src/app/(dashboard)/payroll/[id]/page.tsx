"use client";

// Pay run detail. Shows the run header (period, pay date, totals,
// status), the list of paystubs, and action buttons that flip the
// run through DRAFT → CALCULATING → CALCULATED → POSTED. Paystub
// rows link to per-employee detail pages.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  ChevronLeft,
  Banknote,
  Calculator,
  Send,
  XCircle,
  Calendar,
} from "lucide-react";

type PayRunStatus = "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";

type Payslip = {
  id: string;
  gross: number;
  net: number;
  tax: number;
  deductions: number;
  hoursWorked: number;
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
  totalGross: number;
  totalNet: number;
  totalTax: number;
  totalDeductions: number;
  notes: string | null;
  payGroup: { id: string; name: string; frequency: string; currency: string };
  payslips: Payslip[];
};

const STATUS_STYLE: Record<PayRunStatus, string> = {
  DRAFT: "text-muted border-white/20",
  CALCULATING: "text-amber-400 border-amber-400/30",
  CALCULATED: "text-blue-400 border-blue-400/30",
  POSTED: "text-green-400 border-green-400/30",
  CANCELLED: "text-red-400 border-red-400/30",
};

function fmtMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export default function PayRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [run, setRun] = useState<PayRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pay-runs/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load run", description: data?.error });
        return;
      }
      setRun(data);
    } finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function action(name: "calculate" | "post" | "cancel", reason?: string) {
    setBusy(name);
    try {
      const res = await fetch(`/api/pay-runs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, reason: reason ?? null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: `Couldn't ${name}`, description: data?.error });
        return;
      }
      toast({ type: "success", title: `Run ${name}d` });
      load();
    } finally { setBusy(null); }
  }

  if (loading) return <div className="text-sm text-muted py-8 text-center">Loading…</div>;
  if (!run) return <div className="text-sm text-muted py-8 text-center">Not found.</div>;

  const cur = run.payGroup.currency;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/payroll" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg mb-3">
          <ChevronLeft size={12} /> Back to payroll
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Banknote size={20} />
              <h1 className="text-2xl font-bold tracking-tight">{run.payGroup.name}</h1>
              <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[run.status]}`}>{run.status}</Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted mt-2 flex-wrap">
              <span><Calendar size={11} className="inline mr-1" />Period {new Date(run.periodStart).toLocaleDateString()} → {new Date(run.periodEnd).toLocaleDateString()}</span>
              <span>Pay date: {new Date(run.payDate).toLocaleDateString()}</span>
              <span>{run.payGroup.frequency} · {cur}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(run.status === "DRAFT" || run.status === "CALCULATED") && (
              <Button onClick={() => action("calculate")} disabled={busy !== null}>
                <Calculator size={14} className="mr-1.5" />
                {busy === "calculate" ? "Calculating…" : "Calculate"}
              </Button>
            )}
            {run.status === "CALCULATED" && (
              <Button onClick={() => action("post")} disabled={busy !== null}>
                <Send size={14} className="mr-1.5" />
                {busy === "post" ? "Posting…" : "Post run"}
              </Button>
            )}
            {(run.status === "DRAFT" || run.status === "CALCULATED") && (
              <Button
                variant="outline"
                onClick={() => {
                  const reason = prompt("Reason for cancelling?");
                  if (reason === null) return;
                  action("cancel", reason);
                }}
                disabled={busy !== null}
                className="text-red-400"
              >
                <XCircle size={14} className="mr-1.5" /> Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Gross" value={fmtMoney(run.totalGross, cur)} />
        <KpiTile label="Tax" value={fmtMoney(run.totalTax, cur)} />
        <KpiTile label="Deductions" value={fmtMoney(run.totalDeductions, cur)} />
        <KpiTile label="Net" value={fmtMoney(run.totalNet, cur)} highlight />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Paystubs ({run.payslips.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {run.payslips.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              {run.status === "DRAFT" ? "Click Calculate to generate paystubs." : "No paystubs in this run."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Employee</th>
                  <th className="px-4 py-2.5 font-normal text-right">Hours</th>
                  <th className="px-4 py-2.5 font-normal text-right">Gross</th>
                  <th className="px-4 py-2.5 font-normal text-right">Tax</th>
                  <th className="px-4 py-2.5 font-normal text-right">Deductions</th>
                  <th className="px-4 py-2.5 font-normal text-right">Net</th>
                  <th className="px-4 py-2.5 font-normal">Method</th>
                </tr>
              </thead>
              <tbody>
                {run.payslips.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <Link href={`/payroll/payslip/${p.id}`} className="font-medium hover:underline">
                        {p.subject.firstName} {p.subject.lastName}
                      </Link>
                      <div className="text-[10px] text-muted">{p.subject.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{Number(p.hoursWorked).toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{fmtMoney(p.gross, cur)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{fmtMoney(p.tax, cur)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{fmtMoney(p.deductions, cur)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono font-medium">{fmtMoney(p.net, cur)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {p.payMethod}{p.bankLast4 ? ` · ${p.bankLast4}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {run.notes && (
        <Card>
          <CardContent className="p-4 text-sm text-muted">
            <span className="font-medium text-fg">Notes: </span>{run.notes}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className={`p-4 ${highlight ? "bg-emerald-50/30 dark:bg-emerald-500/5" : ""}`}>
        <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
        <div className="text-xl font-mono mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
