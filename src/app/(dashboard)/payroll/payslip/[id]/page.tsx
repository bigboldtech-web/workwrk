"use client";

// Paystub detail. The employee whose stub it is can read theirs;
// org-admins can read any. Layout mimics a real paystub: header
// (employee + period), earnings + deductions + taxes columns, net
// pay summary at the bottom.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ChevronLeft, FileText, Printer } from "lucide-react";

type Line = {
  id: string;
  kind: "EARNING" | "DEDUCTION" | "TAX";
  amount: number;
  hours: number | null;
  rate: number | null;
  ytdAmount: number | null;
  taxLabel: string | null;
  earningCode: { code: string; name: string } | null;
  deductionCode: { code: string; name: string } | null;
};

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
  payRun: { id: string; periodStart: string; periodEnd: string; payDate: string; status: string };
  payGroup: { id: string; name: string; currency: string };
  lines: Line[];
};

function fmtMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/payslips/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load paystub", description: data?.error });
        return;
      }
      setSlip(data);
    } finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-muted py-8 text-center">Loading…</div>;
  if (!slip) return <div className="text-sm text-muted py-8 text-center">Not found.</div>;

  const cur = slip.payGroup.currency;
  const earnings = slip.lines.filter((l) => l.kind === "EARNING");
  const deductions = slip.lines.filter((l) => l.kind === "DEDUCTION");
  const taxes = slip.lines.filter((l) => l.kind === "TAX");

  return (
    <div className="space-y-5 print:space-y-2">
      <div className="flex items-start justify-between flex-wrap gap-3 print:hidden">
        <Link href={`/payroll/${slip.payRun.id}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ChevronLeft size={12} /> Back to pay run
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-line text-fg hover:bg-card-2/40"
        >
          <Printer size={12} /> Print
        </button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText size={16} /> Paystub — {slip.subject.firstName} {slip.subject.lastName}
              </CardTitle>
              <div className="text-xs text-muted mt-1">
                {slip.subject.email} · {slip.payGroup.name}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Period</div>
              <div className="text-sm font-mono">
                {new Date(slip.payRun.periodStart).toLocaleDateString()} → {new Date(slip.payRun.periodEnd).toLocaleDateString()}
              </div>
              <div className="text-xs text-muted mt-1">Pay date</div>
              <div className="text-sm font-mono">{new Date(slip.payRun.payDate).toLocaleDateString()}</div>
              <Badge variant="outline" className="text-[10px] mt-2">{slip.payRun.status}</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PaystubColumn title="Earnings" lines={earnings} currency={cur} kind="EARNING" />
        <PaystubColumn title="Taxes" lines={taxes} currency={cur} kind="TAX" />
        <PaystubColumn title="Deductions" lines={deductions} currency={cur} kind="DEDUCTION" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted">Hours worked</div>
              <div className="font-mono text-sm mt-1">{Number(slip.hoursWorked).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted">Gross pay</div>
              <div className="font-mono text-sm mt-1">{fmtMoney(slip.gross, cur)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted">Tax + deductions</div>
              <div className="font-mono text-sm mt-1">{fmtMoney(slip.tax + slip.deductions, cur)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted">Net pay</div>
              <div className="font-mono text-base font-semibold mt-1">{fmtMoney(slip.net, cur)}</div>
            </div>
          </div>
          <div className="text-xs text-muted mt-3">
            Pay method: {slip.payMethod}{slip.bankLast4 ? ` · ending in ${slip.bankLast4}` : ""}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PaystubColumn({
  title,
  lines,
  currency,
  kind,
}: {
  title: string;
  lines: Line[];
  currency: string;
  kind: "EARNING" | "DEDUCTION" | "TAX";
}) {
  const total = lines.reduce((acc, l) => acc + Number(l.amount), 0);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted mb-2">{title}</div>
        {lines.length === 0 ? (
          <div className="text-xs text-muted py-2">None.</div>
        ) : (
          <ul className="space-y-1.5">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between text-xs">
                <span className="truncate">
                  {kind === "EARNING" ? l.earningCode?.name ?? "—"
                    : kind === "DEDUCTION" ? l.deductionCode?.name ?? "—"
                    : l.taxLabel ?? "Tax"}
                  {l.hours != null && (
                    <span className="text-muted ml-2 font-mono">{Number(l.hours).toFixed(2)}h × {l.rate != null ? Number(l.rate).toFixed(2) : "—"}</span>
                  )}
                </span>
                <span className="font-mono">{fmtMoney(Number(l.amount), currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line my-2" />
        <div className="flex items-center justify-between text-xs font-semibold">
          <span>Total</span>
          <span className="font-mono">{fmtMoney(total, currency)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
