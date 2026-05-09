"use client";

// Adaptive Planning workspace. Three views:
//   - Plans: list of budgets/forecasts/scenarios; create new.
//   - Lines: simple grid editor for the selected plan.
//   - Variance: actual vs budget read-out for a published plan.
// Studio (workflow + custom field admin) is a sibling page; this
// keeps the planning concern focused.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Target, Plus, TrendingUp } from "lucide-react";

type PlanType = "BUDGET" | "FORECAST" | "STRATEGIC" | "WHAT_IF";
type PlanStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type FiscalYear = { id: string; label: string };

type BudgetPlanRow = {
  id: string;
  name: string;
  type: PlanType;
  status: PlanStatus;
  version: number;
  description: string | null;
  fiscalYear: FiscalYear;
  scenarios: Array<{ id: string; name: string; isDefault: boolean }>;
  _count: { lines: number };
};

type VarianceRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  periodId: string;
  periodLabel: string;
  plan: number;
  actual: number;
  variance: number;
};

const STATUS_STYLE: Record<PlanStatus, string> = {
  DRAFT: "text-muted border-white/20",
  PUBLISHED: "text-green-400 border-green-400/30",
  ARCHIVED: "text-muted border-white/20",
};

const TYPE_LABEL: Record<PlanType, string> = {
  BUDGET: "Budget",
  FORECAST: "Forecast",
  STRATEGIC: "Strategic",
  WHAT_IF: "What-if",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

export default function PlanningPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Target size={20} /> Planning
        </h1>
        <p className="text-muted text-sm mt-1">
          Budgets, forecasts, and variance analysis tied to your GL.
        </p>
      </div>
      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="variance">Variance</TabsTrigger>
        </TabsList>
        <TabsContent value="plans" className="mt-4"><PlansTab /></TabsContent>
        <TabsContent value="variance" className="mt-4"><VarianceTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function PlansTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BudgetPlanRow[]>([]);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, yearsRes] = await Promise.all([
        fetch("/api/budget-plans").then((r) => r.json()),
        fetch("/api/fiscal-years").then((r) => r.json()),
      ]);
      setRows(Array.isArray(plansRes) ? plansRes : []);
      setYears(Array.isArray(yearsRes) ? yearsRes.map((y: { id: string; label: string }) => ({ id: y.id, label: y.label })) : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)} disabled={years.length === 0}>
          <Plus size={14} className="mr-1.5" /> New plan
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            {years.length === 0
              ? "Create a fiscal year in Financials first, then you can build a plan against it."
              : "No plans yet. Create a budget or forecast for the current fiscal year."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Plan</th>
                  <th className="px-4 py-2.5 font-normal">Type</th>
                  <th className="px-4 py-2.5 font-normal">Fiscal year</th>
                  <th className="px-4 py-2.5 font-normal">Version</th>
                  <th className="px-4 py-2.5 font-normal text-right">Lines</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-violet-50/50 dark:hover:bg-card-2/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/planning/${p.id}`} className="font-medium hover:text-violet-700">{p.name}</Link>
                      {p.description && <div className="text-[10px] text-muted">{p.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{TYPE_LABEL[p.type]}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{p.fiscalYear.label}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">v{p.version}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{p._count.lines}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[p.status]}`}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {showCreate && (
        <CreatePlanDialog
          years={years}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Plan created" }); load(); }}
        />
      )}
    </>
  );
}

function CreatePlanDialog({
  years,
  onClose,
  onCreated,
}: {
  years: FiscalYear[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<PlanType>("BUDGET");
  const [fiscalYearId, setFiscalYearId] = useState(years[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/budget-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, fiscalYearId, description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't create", description: data?.error });
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New plan</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FY2027 Budget" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as PlanType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Fiscal year</Label>
              <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (<SelectItem key={y.id} value={y.id}>{y.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Description (optional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || !fiscalYearId || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VarianceTab() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<BudgetPlanRow[]>([]);
  const [planId, setPlanId] = useState("");
  const [data, setData] = useState<{
    plan: { name: string; status: string };
    fiscalYear: { label: string };
    scenario: { name: string };
    rows: VarianceRow[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/budget-plans")
      .then((r) => r.json())
      .then((data) => {
        setPlans(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data[0]) setPlanId(data[0].id);
      })
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    if (!planId) return;
    setLoading(true);
    fetch(`/api/plan-variance?planId=${planId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          toast({ type: "error", title: "Couldn't load variance", description: d.error });
          setData(null);
        } else {
          setData(d);
        }
      })
      .finally(() => setLoading(false));
  }, [planId, toast]);

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <Label className="text-xs text-muted">Plan</Label>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Pick a plan" /></SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · v{p.version} · {p.fiscalYear.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : !data ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">Pick a plan to see variance.</CardContent>
        </Card>
      ) : data.rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No plan lines on this scenario yet. Add lines to see variance against actuals.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-white/5 text-xs text-muted flex items-center gap-2">
              <TrendingUp size={12} />
              <span>{data.plan.name} · {data.fiscalYear.label} · scenario {data.scenario.name}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Account</th>
                  <th className="px-4 py-2.5 font-normal">Period</th>
                  <th className="px-4 py-2.5 font-normal text-right">Plan</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actual</th>
                  <th className="px-4 py-2.5 font-normal text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  // For expenses, going over budget is bad → red. For
                  // revenue, exceeding budget is good → green.
                  const isExpenseLike = r.accountType === "EXPENSE" || r.accountType === "ASSET";
                  const goodColor = (r.variance > 0 && !isExpenseLike) || (r.variance < 0 && isExpenseLike);
                  const badColor = (r.variance < 0 && !isExpenseLike) || (r.variance > 0 && isExpenseLike);
                  return (
                    <tr key={`${r.accountId}-${r.periodId}-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-xs">
                        <span className="font-mono text-muted mr-2">{r.accountCode}</span>{r.accountName}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono">{r.periodLabel}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{fmtMoney(r.plan)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{fmtMoney(r.actual)}</td>
                      <td className={`px-4 py-2 text-right font-mono text-xs ${goodColor ? "text-green-400" : badColor ? "text-red-400" : "text-muted"}`}>
                        {r.variance === 0 ? "—" : `${r.variance > 0 ? "+" : ""}${fmtMoney(r.variance)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
