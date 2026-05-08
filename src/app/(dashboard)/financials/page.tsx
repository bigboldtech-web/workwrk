"use client";

// Core Financials workspace. Three tabs: Chart of accounts, Journal
// entries, Fiscal calendar. Reports (P&L, balance sheet, trial
// balance) are v2 — they read aggregations across these tables.

import { useState, useEffect, useCallback } from "react";
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
import { BookOpen, Plus, BarChart3, Calendar as CalIcon } from "lucide-react";

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

type GlAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  currency: string;
  description: string | null;
  active: boolean;
};

type JournalEntry = {
  id: string;
  reference: string;
  description: string;
  postedAt: string;
  source: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "POSTED" | "REVERSED" | "VOIDED";
  period: { id: string; label: string };
  _count: { lines: number };
};

type FiscalYear = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
  periods: Array<{ id: string; label: string; startDate: string; endDate: string; status: "OPEN" | "CLOSED" }>;
};

const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expense",
};

const ENTRY_STATUS_STYLE: Record<JournalEntry["status"], string> = {
  DRAFT: "text-muted border-white/20",
  PENDING: "text-amber-400 border-amber-400/30",
  APPROVED: "text-blue-400 border-blue-400/30",
  POSTED: "text-green-400 border-green-400/30",
  REVERSED: "text-muted border-white/20",
  VOIDED: "text-red-400 border-red-400/30",
};

export default function FinancialsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen size={20} /> Financials
        </h1>
        <p className="text-muted text-sm mt-1">
          Chart of accounts, journal entries, and fiscal calendar.
        </p>
      </div>
      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Chart of accounts</TabsTrigger>
          <TabsTrigger value="entries">Journal entries</TabsTrigger>
          <TabsTrigger value="calendar">Fiscal calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4"><AccountsTab /></TabsContent>
        <TabsContent value="entries" className="mt-4"><EntriesTab /></TabsContent>
        <TabsContent value="calendar" className="mt-4"><CalendarTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Chart of accounts ─────────────────────────────────────────────

function AccountsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<AccountType | "ALL">("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/gl-accounts?includeInactive=1");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter === "ALL" ? rows : rows.filter((a) => a.type === filter);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          {(["ALL", "ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2.5 py-1 rounded border text-xs ${
                filter === t ? "border-fg/30 text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              {t === "ALL" ? "All" : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> New account
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No accounts in this view. Create your chart of accounts to start posting journal entries.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Code</th>
                  <th className="px-4 py-2.5 font-normal">Name</th>
                  <th className="px-4 py-2.5 font-normal">Type</th>
                  <th className="px-4 py-2.5 font-normal">Currency</th>
                  <th className="px-4 py-2.5 font-normal">State</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-mono text-xs">{a.code}</td>
                    <td className="px-4 py-2.5 font-medium">{a.name}</td>
                    <td className="px-4 py-2.5 text-xs">{TYPE_LABEL[a.type]}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{a.currency}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${a.active ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                        {a.active ? "Active" : "Archived"}
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
        <CreateAccountDialog
          accounts={rows}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Account created" }); load(); }}
        />
      )}
    </>
  );
}

function CreateAccountDialog({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: GlAccount[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("EXPENSE");
  const [currency, setCurrency] = useState("USD");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Show only same-type parents — type compatibility is enforced
  // server-side, but the picker filters first so users never see
  // an option that will be rejected.
  const parentOptions = accounts.filter((a) => a.type === type);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/gl-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          type,
          currency: currency.trim().toUpperCase(),
          parentId: parentId || undefined,
          description: description.trim() || undefined,
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
        <DialogHeader><DialogTitle>New account</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6010" autoFocus /></div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => { setType(v as AccountType); setParentId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Salaries — Engineering" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} /></div>
            <div className="space-y-1.5">
              <Label>Parent (optional)</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger><SelectValue placeholder="No parent" /></SelectTrigger>
                <SelectContent>
                  {parentOptions.length === 0 ? (
                    <div className="p-2 text-xs text-muted">No same-type parents yet.</div>
                  ) : parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Description (optional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!code.trim() || !name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Journal entries ───────────────────────────────────────────────

function EntriesTab() {
  const [rows, setRows] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/journal-entries?limit=100");
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
          No journal entries yet. Posted entries from payroll, AP invoices, and expenses land here.
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
              <th className="px-4 py-2.5 font-normal">Reference</th>
              <th className="px-4 py-2.5 font-normal">Description</th>
              <th className="px-4 py-2.5 font-normal">Period</th>
              <th className="px-4 py-2.5 font-normal flex items-center gap-1"><CalIcon size={11} /> Posted</th>
              <th className="px-4 py-2.5 font-normal">Source</th>
              <th className="px-4 py-2.5 font-normal text-right">Lines</th>
              <th className="px-4 py-2.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-2.5 font-mono text-xs">{r.reference}</td>
                <td className="px-4 py-2.5 truncate max-w-md">{r.description}</td>
                <td className="px-4 py-2.5 text-xs font-mono">{r.period.label}</td>
                <td className="px-4 py-2.5 text-xs">{new Date(r.postedAt).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{r.source}</td>
                <td className="px-4 py-2.5 text-right text-xs font-mono">{r._count.lines}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="outline" className={`text-[10px] ${ENTRY_STATUS_STYLE[r.status]}`}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Fiscal calendar ───────────────────────────────────────────────

function CalendarTab() {
  const { toast } = useToast();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fiscal-years");
      const data = await res.json();
      setYears(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> New fiscal year
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : years.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No fiscal years yet. Create one to enable journal-entry posting.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {years.map((y) => (
            <Card key={y.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <BarChart3 size={16} className="text-muted" />
                    <div>
                      <div className="font-semibold text-sm">{y.label}</div>
                      <div className="text-xs text-muted">
                        {new Date(y.startDate).toLocaleDateString()} → {new Date(y.endDate).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${y.status === "OPEN" ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
                    {y.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                  {y.periods.map((p) => (
                    <div
                      key={p.id}
                      className={`text-xs px-2 py-1.5 rounded border text-center ${
                        p.status === "OPEN" ? "border-line text-fg" : "border-line text-muted bg-card-2/40"
                      }`}
                    >
                      {p.label}
                      <div className="text-[10px] opacity-60 mt-0.5">{p.status}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {showCreate && (
        <CreateFiscalYearDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); toast({ type: "success", title: "Fiscal year created" }); load(); }}
        />
      )}
    </>
  );
}

function CreateFiscalYearDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const today = new Date();
  const defaultStart = `${today.getUTCFullYear()}-01-01`;
  const defaultEnd = `${today.getUTCFullYear()}-12-31`;
  const [label, setLabel] = useState(`FY${today.getUTCFullYear()}`);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/fiscal-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), startDate, endDate }),
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
        <DialogHeader><DialogTitle>New fiscal year</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="FY2026" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>End date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted">Monthly accounting periods are auto-generated for the date range.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!label.trim() || saving} onClick={save}>{saving ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
