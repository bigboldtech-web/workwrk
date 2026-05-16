"use client";

// Plan detail — spreadsheet-like grid editor. Rows are accounts
// (revenue + expense), columns are accounting periods, cells hold
// PlanLine.amount for the active scenario. Edits flush to the
// server on blur via /api/plan-lines (manual upsert handles the
// nullable cost-center column).
//
// Compact ClickUp-style: tight 24-column grid, sticky header,
// keyboard-navigable cells (arrow keys), inline scenario picker,
// sticky totals row at the bottom.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  Send,
  Archive as ArchiveIcon,
  Target,
  Loader2,
  ArrowDownUp,
} from "lucide-react";

type AccountType = "REVENUE" | "EXPENSE";
type PlanStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
};

type Period = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
};

type Scenario = {
  id: string;
  name: string;
  isDefault: boolean;
  multiplier: number | null;
};

type PlanLine = {
  id: string;
  accountId: string;
  costCenterId: string | null;
  periodId: string;
  scenarioId: string;
  amount: number;
};

type PlanDetail = {
  plan: {
    id: string;
    name: string;
    status: PlanStatus;
    version: number;
    description: string | null;
    fiscalYear: { id: string; label: string; periods: Period[] };
    scenarios: Scenario[];
    lines: PlanLine[];
  };
  accounts: Account[];
};

const STATUS_STYLE: Record<PlanStatus, string> = {
  DRAFT: "text-slate-500 border-slate-300",
  PUBLISHED: "text-emerald-700 border-emerald-300 bg-emerald-50",
  ARCHIVED: "text-slate-400 border-slate-200",
};

function fmtMoney(n: number): string {
  if (n === 0) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Math.abs(n) >= 100_000 ? "compact" : "standard",
  }).format(n);
}

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [scenarioId, setScenarioId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/budget-plans/${id}`);
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load plan", description: json?.error });
        return;
      }
      setData(json);
      if (!scenarioId && json.plan.scenarios.length > 0) {
        const def = json.plan.scenarios.find((s: Scenario) => s.isDefault) ?? json.plan.scenarios[0];
        setScenarioId(def.id);
      }
    } finally {
      setLoading(false);
    }
  }, [id, toast, scenarioId]);

  useEffect(() => { load(); }, [load]);

  async function transition(action: "publish" | "archive") {
    setBusy(action);
    try {
      const res = await fetch(`/api/budget-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: `Couldn't ${action}`, description: json?.error });
        return;
      }
      toast({ type: "success", title: `Plan ${action}d` });
      load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>;
  if (!data) return <div className="text-sm text-slate-500 py-8 text-center">Not found.</div>;

  const { plan, accounts } = data;
  const periods = plan.fiscalYear.periods;
  const scenario = plan.scenarios.find((s) => s.id === scenarioId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <Link href="/planning" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mb-3">
          <ChevronLeft size={12} /> Back to plans
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Target size={18} className="text-violet-600" />
              <h1 className="text-2xl font-bold tracking-tight">{plan.name}</h1>
              <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[plan.status]}`}>
                {plan.status}
              </Badge>
              <span className="text-xs text-slate-500 font-mono">v{plan.version}</span>
            </div>
            <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-3 flex-wrap">
              <span>{plan.fiscalYear.label}</span>
              <span>·</span>
              <span>{periods.length} periods</span>
              <span>·</span>
              <span>{accounts.length} accounts</span>
              {plan.description && (
                <>
                  <span>·</span>
                  <span className="opacity-80">{plan.description}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {plan.scenarios.length > 0 && (
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
            )}
            {plan.status === "DRAFT" && (
              <Button
                size="sm"
                className="h-8 text-xs bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-500 hover:to-violet-600"
                onClick={() => transition("publish")}
                disabled={busy !== null}
              >
                <Send size={11} className="mr-1.5" />
                {busy === "publish" ? "Publishing…" : "Publish"}
              </Button>
            )}
            <Link
              href={`/planning/${plan.id}/variance`}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-line text-fg hover:bg-card-2/40"
            >
              <ArrowDownUp size={11} /> Variance
            </Link>
            {plan.status !== "ARCHIVED" && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => {
                  if (!confirm("Archive this plan? Lines stay in history.")) return;
                  transition("archive");
                }}
                disabled={busy !== null}
              >
                <ArchiveIcon size={11} className="mr-1.5" /> Archive
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      {scenario && (
        <PlanGrid
          planId={plan.id}
          scenarioId={scenario.id}
          accounts={accounts}
          periods={periods}
          allLines={plan.lines}
          editable={plan.status === "DRAFT"}
          onSaved={load}
        />
      )}
    </div>
  );
}

function PlanGrid({
  planId,
  scenarioId,
  accounts,
  periods,
  allLines,
  editable,
  onSaved,
}: {
  planId: string;
  scenarioId: string;
  accounts: Account[];
  periods: Period[];
  allLines: PlanLine[];
  editable: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();

  // Index lines by `${accountId}::${periodId}` for the active scenario.
  const linesByKey = useMemo(() => {
    const map = new Map<string, PlanLine>();
    for (const l of allLines) {
      if (l.scenarioId !== scenarioId) continue;
      // costCenterId is part of the unique constraint but the grid
      // edits the unscoped cell — we only render lines without a
      // cost center. (Cost-center splitting is v2.)
      if (l.costCenterId) continue;
      map.set(`${l.accountId}::${l.periodId}`, l);
    }
    return map;
  }, [allLines, scenarioId]);

  // Local cell edits — flushed to /api/plan-lines on blur.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // Reset drafts when scenario changes — abandons unsaved input,
  // which is correct behavior since the scenario context is gone.
  useEffect(() => { setDraft({}); }, [scenarioId]);

  const cellValue = useCallback(
    (accountId: string, periodId: string) => {
      const k = `${accountId}::${periodId}`;
      if (k in draft) return draft[k];
      const line = linesByKey.get(k);
      return line ? String(Number(line.amount)) : "";
    },
    [draft, linesByKey],
  );

  async function flushCell(accountId: string, periodId: string) {
    const k = `${accountId}::${periodId}`;
    if (!(k in draft)) return;
    const raw = draft[k].trim();
    const existing = linesByKey.get(k);
    const amount = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(amount)) {
      toast({ type: "error", title: "Invalid number" });
      return;
    }
    // No-op when nothing changed.
    if (existing && Number(existing.amount) === amount) {
      setDraft((d) => {
        const next = { ...d };
        delete next[k];
        return next;
      });
      return;
    }
    setSaving(k);
    try {
      const res = await fetch("/api/plan-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          lines: [{ scenarioId, accountId, periodId, amount }],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Save failed", description: json?.error });
        return;
      }
      setDraft((d) => {
        const next = { ...d };
        delete next[k];
        return next;
      });
      onSaved();
    } finally {
      setSaving(null);
    }
  }

  // Totals per period (column) and per account (row).
  const colTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of periods) {
      let sum = 0;
      for (const a of accounts) {
        sum += Number(cellValue(a.id, p.id) || 0);
      }
      t[p.id] = sum;
    }
    return t;
  }, [accounts, periods, cellValue]);

  const rowTotal = useCallback(
    (accountId: string) =>
      periods.reduce((acc, p) => acc + Number(cellValue(accountId, p.id) || 0), 0),
    [periods, cellValue],
  );

  const grandTotal = useMemo(
    () => Object.values(colTotals).reduce((a, b) => a + b, 0),
    [colTotals],
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-card-2/30">
                <th className="sticky left-0 z-10 bg-slate-50 dark:bg-card-2/30 text-left px-3 py-2.5 font-semibold border-b border-slate-200 dark:border-line min-w-[220px]">
                  Account
                </th>
                {periods.map((p) => (
                  <th
                    key={p.id}
                    className="text-right px-2 py-2.5 font-medium font-mono text-slate-600 dark:text-muted border-b border-slate-200 dark:border-line min-w-[88px]"
                    title={`${new Date(p.startDate).toLocaleDateString()} → ${new Date(p.endDate).toLocaleDateString()}`}
                  >
                    {p.label}
                  </th>
                ))}
                <th className="text-right px-3 py-2.5 font-semibold border-b border-slate-200 dark:border-line min-w-[100px] sticky right-0 bg-slate-50 dark:bg-card-2/30">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, idx) => (
                <PlanGridRow
                  key={a.id}
                  account={a}
                  periods={periods}
                  cellValue={cellValue}
                  setDraft={setDraft}
                  flushCell={flushCell}
                  saving={saving}
                  editable={editable}
                  rowTotal={rowTotal(a.id)}
                  zebra={idx % 2 === 1}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 dark:bg-card-2/30 font-semibold">
                <td className="sticky left-0 z-10 bg-slate-50 dark:bg-card-2/30 px-3 py-2 border-t-2 border-slate-300 dark:border-line">
                  <span className="flex items-center gap-1.5">
                    <ArrowDownUp size={11} className="text-slate-400" /> Total
                  </span>
                </td>
                {periods.map((p) => (
                  <td key={p.id} className="px-2 py-2 text-right font-mono border-t-2 border-slate-300 dark:border-line">
                    {fmtMoney(colTotals[p.id] ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono border-t-2 border-slate-300 dark:border-line sticky right-0 bg-slate-50 dark:bg-card-2/30">
                  {fmtMoney(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!editable && (
          <div className="px-4 py-2 text-[11px] text-slate-600 bg-amber-50 border-t border-amber-200">
            Plan is locked. Cells are read-only — branch a new draft to make changes.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanGridRow({
  account,
  periods,
  cellValue,
  setDraft,
  flushCell,
  saving,
  editable,
  rowTotal,
  zebra,
}: {
  account: Account;
  periods: Period[];
  cellValue: (a: string, p: string) => string;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  flushCell: (accountId: string, periodId: string) => Promise<void>;
  saving: string | null;
  editable: boolean;
  rowTotal: number;
  zebra: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <tr className={`group ${zebra ? "bg-slate-50/40 dark:bg-card-2/10" : ""}`}>
      <td className="sticky left-0 z-10 bg-white dark:bg-card group-hover:bg-violet-50/50 dark:group-hover:bg-card-2/30 px-3 py-1.5 border-b border-slate-100 dark:border-line/50">
        <span className="flex items-center gap-2">
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
              account.type === "REVENUE"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-rose-100 text-rose-700"
            }`}
          >
            {account.type === "REVENUE" ? "REV" : "EXP"}
          </span>
          <span className="font-mono text-[10px] text-slate-400">{account.code}</span>
          <span className="font-medium truncate">{account.name}</span>
        </span>
      </td>
      {periods.map((p) => {
        const k = `${account.id}::${p.id}`;
        const v = cellValue(account.id, p.id);
        const isSaving = saving === k;
        return (
          <td key={p.id} className="px-1 py-0.5 border-b border-slate-100 dark:border-line/50 relative">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              disabled={!editable}
              value={v}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              onBlur={() => flushCell(account.id, p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="—"
              className={`w-full px-1.5 py-1 text-right font-mono text-[12px] rounded ${
                editable
                  ? "border border-transparent hover:border-slate-200 focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  : "border border-transparent text-slate-500 cursor-not-allowed"
              } ${isSaving ? "opacity-60" : ""}`}
            />
            {isSaving && (
              <Loader2 size={10} className="animate-spin text-violet-500 absolute right-2 top-1/2 -translate-y-1/2" />
            )}
          </td>
        );
      })}
      <td className="px-3 py-1.5 text-right font-mono font-semibold border-b border-slate-100 dark:border-line/50 sticky right-0 bg-white dark:bg-card group-hover:bg-violet-50/50 dark:group-hover:bg-card-2/30">
        {fmtMoney(rowTotal)}
      </td>
    </tr>
  );
}
