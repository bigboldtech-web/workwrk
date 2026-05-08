"use client";

// Workforce planning view. Top-row KPI tiles for current state, a
// per-department snapshot table with planned vs actual variance,
// and an admin-gated dialog for upserting plans.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  Users as UsersIcon,
  TrendingUp,
  TrendingDown,
  UserPlus,
  UserMinus,
  Target,
  Pencil,
  Plus,
} from "lucide-react";

export type DepartmentSnapshot = {
  departmentId: string | null;
  name: string;
  currentHeadcount: number;
  plannedHeadcount: number | null;
  variance: number | null; // current - planned
  plannedBudget: number | null;
  budgetCurrency: string;
  planId: string | null;
};

export type PlanRow = {
  id: string;
  period: string;
  departmentId: string | null;
  departmentName: string | null;
  plannedHeadcount: number;
  plannedBudget: number | null;
  budgetCurrency: string;
  notes: string | null;
};

function fmtMoney(n: number | null, currency: string): string {
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export function WorkforcePlanningView({
  period,
  isAdmin,
  totalActive,
  openJobs,
  hiresThisYear,
  leaversThisYear,
  orgRow,
  snapshots,
  departments,
}: {
  period: string;
  isAdmin: boolean;
  totalActive: number;
  openJobs: number;
  hiresThisYear: number;
  leaversThisYear: number;
  orgRow: DepartmentSnapshot | null;
  snapshots: DepartmentSnapshot[];
  allPlans: PlanRow[];
  departments: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<DepartmentSnapshot | null>(null);
  const [periodInput, setPeriodInput] = useState(period);

  const netGrowth = hiresThisYear - leaversThisYear;
  const turnoverPct = totalActive > 0 ? (leaversThisYear / totalActive) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target size={20} /> Workforce planning
          </h1>
          <p className="text-muted text-sm mt-1">
            Headcount and budget plan vs live state. Plan period:{" "}
            <code className="text-[#d4ff2e] font-mono">{period}</code>
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/workforce-planning?period=${encodeURIComponent(periodInput.trim())}`);
          }}
        >
          <Input
            value={periodInput}
            onChange={(e) => setPeriodInput(e.target.value)}
            placeholder="e.g. 2026-Q2"
            className="h-8 text-xs w-32"
          />
          <Button type="submit" size="sm" variant="outline">Switch period</Button>
        </form>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Active employees</p>
            <p className="text-2xl font-bold mt-1 flex items-center gap-1.5">
              <UsersIcon size={16} className="text-blue-400" />
              {totalActive}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Open requisitions</p>
            <p className="text-2xl font-bold mt-1 flex items-center gap-1.5">
              <Target size={16} className="text-[#d4ff2e]" />
              {openJobs}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Hires YTD</p>
            <p className="text-2xl font-bold mt-1 flex items-center gap-1.5">
              <UserPlus size={16} className="text-green-400" />
              {hiresThisYear}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Leavers YTD ({turnoverPct.toFixed(1)}%)</p>
            <p className="text-2xl font-bold mt-1 flex items-center gap-1.5">
              <UserMinus size={16} className="text-red-400" />
              {leaversThisYear}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted">
        Net growth this year:{" "}
        <span className={netGrowth >= 0 ? "text-green-400" : "text-red-400"}>
          {netGrowth >= 0 ? "+" : ""}{netGrowth} {netGrowth >= 0 ? <TrendingUp size={10} className="inline" /> : <TrendingDown size={10} className="inline" />}
        </span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Plan vs actual ({period})</CardTitle>
            {isAdmin && (
              <Button size="sm" onClick={() => setEditing({
                departmentId: null,
                name: "(Organization-wide)",
                currentHeadcount: totalActive,
                plannedHeadcount: null,
                variance: null,
                plannedBudget: null,
                budgetCurrency: "USD",
                planId: null,
              })}>
                <Plus size={12} className="mr-1.5" /> Add plan
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-white/5">
                <th className="px-4 py-2.5 font-normal">Department</th>
                <th className="px-4 py-2.5 font-normal text-right">Current</th>
                <th className="px-4 py-2.5 font-normal text-right">Planned</th>
                <th className="px-4 py-2.5 font-normal text-right">Variance</th>
                <th className="px-4 py-2.5 font-normal text-right">Budget</th>
                {isAdmin && <th className="px-4 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              {orgRow && <SnapshotRow row={orgRow} isAdmin={isAdmin} onEdit={setEditing} />}
              {snapshots.map((s) => (
                <SnapshotRow key={s.departmentId ?? "org"} row={s} isAdmin={isAdmin} onEdit={setEditing} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing !== null && (
        <PlanDialog
          period={period}
          row={editing}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function SnapshotRow({
  row,
  isAdmin,
  onEdit,
}: {
  row: DepartmentSnapshot;
  isAdmin: boolean;
  onEdit: (row: DepartmentSnapshot) => void;
}) {
  const varianceClass =
    row.variance === null ? "text-muted"
      : row.variance > 0 ? "text-amber-400"
      : row.variance < 0 ? "text-red-400"
      : "text-green-400";

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02]">
      <td className="px-4 py-2.5 font-medium">{row.name}</td>
      <td className="px-4 py-2.5 text-right font-mono text-xs">{row.currentHeadcount}</td>
      <td className="px-4 py-2.5 text-right font-mono text-xs">{row.plannedHeadcount ?? "—"}</td>
      <td className={`px-4 py-2.5 text-right font-mono text-xs ${varianceClass}`}>
        {row.variance === null ? "—" : `${row.variance > 0 ? "+" : ""}${row.variance}`}
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-xs">
        {fmtMoney(row.plannedBudget, row.budgetCurrency)}
      </td>
      {isAdmin && (
        <td className="px-4 py-2.5 text-right">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onEdit(row)}>
            <Pencil size={12} />
          </Button>
        </td>
      )}
    </tr>
  );
}

function PlanDialog({
  period,
  row,
  departments,
  onClose,
  onSaved,
}: {
  period: string;
  row: DepartmentSnapshot;
  departments: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [departmentId, setDepartmentId] = useState<string>(row.departmentId ?? "");
  const [plannedHeadcount, setPlannedHeadcount] = useState(String(row.plannedHeadcount ?? ""));
  const [plannedBudget, setPlannedBudget] = useState(row.plannedBudget === null ? "" : String(row.plannedBudget));
  const [budgetCurrency, setBudgetCurrency] = useState(row.budgetCurrency);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/headcount-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          departmentId: departmentId || null,
          plannedHeadcount: Number(plannedHeadcount) || 0,
          plannedBudget: plannedBudget || null,
          budgetCurrency,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Plan saved" });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row.planId ? "Edit plan" : "New plan"} — {period}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={departmentId || "org"} onValueChange={(v) => setDepartmentId(v === "org" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="org">(Organization-wide)</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Planned headcount</Label>
            <Input value={plannedHeadcount} onChange={(e) => setPlannedHeadcount(e.target.value)} inputMode="numeric" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Planned salary budget (optional)</Label>
              <Input value={plannedBudget} onChange={(e) => setPlannedBudget(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input value={budgetCurrency} onChange={(e) => setBudgetCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What's this plan for?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={saving || !plannedHeadcount} onClick={save}>{saving ? "Saving…" : "Save plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
