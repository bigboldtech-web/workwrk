"use client";

// Variance report — Plan vs Actuals for a given plan, scenario, and period.
// Reads /api/financials/variance and renders a sortable table with
// $ delta + % delta + favorable/unfavorable flags.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ChevronLeft, Target, ArrowDownUp } from "lucide-react";

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

interface Period {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
}

interface Scenario {
  id: string;
  name: string;
  isDefault: boolean;
}

interface PlanResp {
  plan: {
    id: string;
    name: string;
    fiscalYear: { id: string; label: string; periods: Period[] };
    scenarios: Scenario[];
  };
}

interface VarianceRow {
  account: { id: string; code: string; name: string; type: AccountType };
  planned: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  favorable: boolean | null;
}

interface VarianceResp {
  plan: { id: string; name: string };
  scenario: { id: string; name: string };
  period: { id: string; label: string };
  rows: VarianceRow[];
  summary: { totalPlanned: number; totalActual: number; totalVariance: number };
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export default function VariancePage() {
  const params = useParams<{ id: string }>();
  const planId = params.id;

  const [planResp, setPlanResp] = useState<PlanResp | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [scenarioId, setScenarioId] = useState<string>("");
  const [periodId, setPeriodId] = useState<string>("");
  const [variance, setVariance] = useState<VarianceResp | null>(null);
  const [loading, setLoading] = useState(false);

  // Pull the plan once so we know its scenarios + fiscal-year periods.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/budget-plans/${planId}`);
        const json = await res.json();
        if (!mounted) return;
        const data = json?.data ?? json;
        setPlanResp(data);
        const defScenario = data.plan.scenarios.find((s: Scenario) => s.isDefault) ?? data.plan.scenarios[0];
        if (defScenario) setScenarioId(defScenario.id);
        // Default to the most recent OPEN period for relevant comparison.
        const periods = data.plan.fiscalYear.periods;
        const open = periods.find((p: Period) => p.status === "OPEN") ?? periods[0];
        if (open) setPeriodId(open.id);
      } finally {
        if (mounted) setPlanLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [planId]);

  const loadVariance = useCallback(async () => {
    if (!planId || !scenarioId || !periodId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/financials/variance?plan=${planId}&scenario=${scenarioId}&period=${periodId}`);
      const json = await res.json();
      const data = json?.data ?? (json?.error ? null : json);
      setVariance(data);
    } finally {
      setLoading(false);
    }
  }, [planId, scenarioId, periodId]);

  useEffect(() => { loadVariance(); }, [loadVariance]);

  if (planLoading) {
    return <div className="text-center py-12 text-sm text-zinc-500">Loading plan…</div>;
  }
  if (!planResp) {
    return (
      <div className="text-center py-12 text-sm text-zinc-500">
        Plan not found.{" "}
        <Link href="/planning" className="underline">Back to plans</Link>
      </div>
    );
  }

  const plan = planResp.plan;
  const periods = plan.fiscalYear.periods;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/planning/${planId}`} className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mb-3">
          <ChevronLeft size={12} /> Back to plan
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <ArrowDownUp size={18} className="text-violet-600" />
              <h1 className="text-2xl font-bold tracking-tight">Variance · {plan.name}</h1>
            </div>
            <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-3 flex-wrap">
              <span>Plan vs Actual</span>
              <span>·</span>
              <span>{plan.fiscalYear.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {plan.scenarios.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-zinc-500">Scenario</Label>
                <Select value={scenarioId} onValueChange={setScenarioId}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <SelectValue placeholder="Scenario" />
                  </SelectTrigger>
                  <SelectContent>
                    {plan.scenarios.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-zinc-500">Period</Label>
              <select
                className="h-8 text-xs rounded-md border border-line bg-card-2/40 px-2"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.status === "CLOSED" ? "· closed" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-zinc-500">Loading variance…</div>
      ) : !variance ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-zinc-500">
            Couldn't compute variance for this plan/scenario/period combination.
            Make sure the plan has lines for this scenario and the period has posted actuals.
          </CardContent>
        </Card>
      ) : variance.rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-zinc-500">
            No accounts moved on either side. Either the plan has no lines for this period
            or no actuals were posted to GL.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Total Planned</div>
                  <div className="font-mono text-base">{fmtMoney(variance.summary.totalPlanned)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Total Actual</div>
                  <div className="font-mono text-base">{fmtMoney(variance.summary.totalActual)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Total Variance</div>
                  <div className={`font-mono text-base ${variance.summary.totalVariance < 0 ? "text-amber-400" : variance.summary.totalVariance > 0 ? "text-green-400" : ""}`}>
                    {fmtMoney(variance.summary.totalVariance)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-white/5">
                    <th className="px-4 py-2.5 font-normal">Code</th>
                    <th className="px-4 py-2.5 font-normal">Account</th>
                    <th className="px-4 py-2.5 font-normal">Type</th>
                    <th className="px-4 py-2.5 font-normal text-right">Planned</th>
                    <th className="px-4 py-2.5 font-normal text-right">Actual</th>
                    <th className="px-4 py-2.5 font-normal text-right">Variance</th>
                    <th className="px-4 py-2.5 font-normal text-right">%</th>
                    <th className="px-4 py-2.5 font-normal">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.rows.map((r) => {
                    const flagClass =
                      r.favorable === true ? "text-green-400 border-green-400/30" :
                      r.favorable === false ? "text-red-400 border-red-400/30" :
                      "text-zinc-500 border-white/20";
                    const flagLabel =
                      r.favorable === true ? "Favorable" :
                      r.favorable === false ? "Unfavorable" :
                      "—";
                    return (
                      <tr key={r.account.id} className="border-b border-white/5 hover:bg-zinc-50">
                        <td className="px-4 py-2 font-mono text-xs">{r.account.code}</td>
                        <td className="px-4 py-2">{r.account.name}</td>
                        <td className="px-4 py-2 text-xs text-zinc-500">{r.account.type}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{fmtMoney(r.planned)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{fmtMoney(r.actual)}</td>
                        <td className={`px-4 py-2 text-right font-mono text-xs ${r.favorable === false ? "text-red-400" : r.favorable === true ? "text-green-400" : ""}`}>
                          {fmtMoney(r.variance)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-xs ${r.favorable === false ? "text-red-400" : r.favorable === true ? "text-green-400" : ""}`}>
                          {fmtPct(r.variancePct)}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={`text-[10px] ${flagClass}`}>{flagLabel}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
