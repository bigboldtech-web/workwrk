"use client";

// Payroll workspace — Pay Groups list + Pay Runs list. Detail
// pages (per-group calendar, per-run paystubs) are v2; this view
// gets the org running today and surfaces upcoming pay dates.

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
import { Banknote, Plus, Calendar, Users } from "lucide-react";

type PayGroup = {
  id: string;
  name: string;
  country: string;
  currency: string;
  frequency: "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY";
  anchorDate: string;
  payOffsetDays: number;
  active: boolean;
  _count: { payRuns: number; payslips: number };
};

type PayRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: "DRAFT" | "CALCULATING" | "CALCULATED" | "POSTED" | "CANCELLED";
  totalGross: number;
  totalNet: number;
  totalTax: number;
  totalDeductions: number;
  payGroup: { id: string; name: string };
  _count: { payslips: number };
};

const FREQUENCY_LABEL: Record<PayGroup["frequency"], string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMIMONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

const RUN_STATUS_STYLE: Record<PayRun["status"], string> = {
  DRAFT: "text-muted border-white/20",
  CALCULATING: "text-amber-400 border-amber-400/30",
  CALCULATED: "text-blue-400 border-blue-400/30",
  POSTED: "text-green-400 border-green-400/30",
  CANCELLED: "text-red-400 border-red-400/30",
};

function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export default function PayrollPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Banknote size={20} /> Payroll
        </h1>
        <p className="text-muted text-sm mt-1">
          Pay groups, pay runs, and paystubs. Tax calc + direct deposit are handled by your provider.
        </p>
      </div>
      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Pay runs</TabsTrigger>
          <TabsTrigger value="groups">Pay groups</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="mt-4">
          <PayRunsTab />
        </TabsContent>
        <TabsContent value="groups" className="mt-4">
          <PayGroupsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Pay groups ─────────────────────────────────────────────────────

function PayGroupsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pay-groups");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> New pay group
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No pay groups yet. Create one to start running payroll.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Name</th>
                  <th className="px-4 py-2.5 font-normal">Frequency</th>
                  <th className="px-4 py-2.5 font-normal">Country / Currency</th>
                  <th className="px-4 py-2.5 font-normal">Pay offset</th>
                  <th className="px-4 py-2.5 font-normal text-right">Runs</th>
                  <th className="px-4 py-2.5 font-normal text-right">Paystubs</th>
                  <th className="px-4 py-2.5 font-normal">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-medium">{g.name}</td>
                    <td className="px-4 py-2.5 text-xs">{FREQUENCY_LABEL[g.frequency]}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{g.country} · {g.currency}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{g.payOffsetDays} days</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{g._count.payRuns}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">{g._count.payslips}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${g.active ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                        {g.active ? "Active" : "Archived"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {showCreate && (
        <CreatePayGroupDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Pay group created" }); load(); }}
        />
      )}
    </>
  );
}

function CreatePayGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("US");
  const [currency, setCurrency] = useState("USD");
  const [frequency, setFrequency] = useState<PayGroup["frequency"]>("BIWEEKLY");
  const [anchorDate, setAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payOffsetDays, setPayOffsetDays] = useState("3");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/pay-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          country: country.trim().toUpperCase(),
          currency: currency.trim().toUpperCase(),
          frequency,
          anchorDate,
          payOffsetDays: Number(payOffsetDays) || 3,
        }),
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
        <DialogHeader><DialogTitle>New pay group</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="US Salaried" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as PayGroup["frequency"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="BIWEEKLY">Biweekly</SelectItem>
                  <SelectItem value="SEMIMONTHLY">Semi-monthly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Anchor date</Label>
              <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Pay offset (days)</Label>
              <Input value={payOffsetDays} onChange={(e) => setPayOffsetDays(e.target.value)} inputMode="numeric" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pay runs ────────────────────────────────────────────────────────

function PayRunsTab() {
  const [rows, setRows] = useState<PayRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pay-runs?limit=50");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-center py-8 text-sm text-muted">Loading…</div>;
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted">
          No pay runs yet. Create a pay group, then schedule the first run.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-white/5">
              <th className="px-4 py-2.5 font-normal">Period</th>
              <th className="px-4 py-2.5 font-normal">Pay group</th>
              <th className="px-4 py-2.5 font-normal flex items-center gap-1"><Calendar size={11} /> Pay date</th>
              <th className="px-4 py-2.5 font-normal flex items-center gap-1"><Users size={11} /> Paystubs</th>
              <th className="px-4 py-2.5 font-normal text-right">Gross</th>
              <th className="px-4 py-2.5 font-normal text-right">Net</th>
              <th className="px-4 py-2.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-2.5 text-xs">
                  <Link href={`/payroll/${r.id}`} className="hover:underline">
                    {new Date(r.periodStart).toLocaleDateString()} → {new Date(r.periodEnd).toLocaleDateString()}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs">{r.payGroup.name}</td>
                <td className="px-4 py-2.5 text-xs font-mono">{new Date(r.payDate).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-xs font-mono">{r._count.payslips}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtMoney(r.totalGross, "USD")}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtMoney(r.totalNet, "USD")}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="outline" className={`text-[10px] ${RUN_STATUS_STYLE[r.status]}`}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
