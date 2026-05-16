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
import { PageHeader } from "@/components/dashboard/page-header";
import { Plus, BarChart3, Calendar as CalIcon, FileText, Lock, Unlock } from "lucide-react";

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
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Financials" }]}
        kicker="Financials · ledger"
        title="Financials"
        subtitle="Chart of accounts, journal entries, fiscal calendar, and exportable reports."
      />
      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Chart of accounts</TabsTrigger>
          <TabsTrigger value="entries">Journal entries</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="statements">Statements</TabsTrigger>
          <TabsTrigger value="calendar">Fiscal calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-3"><AccountsTab /></TabsContent>
        <TabsContent value="entries" className="mt-3"><EntriesTab /></TabsContent>
        <TabsContent value="reports" className="mt-3"><ReportsTab /></TabsContent>
        <TabsContent value="statements" className="mt-3"><StatementsTab /></TabsContent>
        <TabsContent value="calendar" className="mt-3"><CalendarTab /></TabsContent>
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
                  <tr key={a.id} className="border-b border-white/5 hover:bg-surface-2">
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
              <tr key={r.id} className="border-b border-white/5 hover:bg-surface-2">
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

// ─── Reports ───────────────────────────────────────────────────────

type AccountRow = { id: string; code: string; name: string; type: AccountType; debit: number; credit: number; balance: number };

function fmtMoney(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

function ReportsTab() {
  const [report, setReport] = useState<"trial-balance" | "income-statement" | "balance-sheet">("trial-balance");
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/financial-reports?report=${report}&from=${from}&to=${to}`);
      const json = await res.json();
      setData(json);
    } finally { setLoading(false); }
  }, [report, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {([
            ["trial-balance", "Trial balance"],
            ["income-statement", "P&L"],
            ["balance-sheet", "Balance sheet"],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setReport(k)}
              className={`px-2.5 py-1 rounded border text-xs ${
                report === k ? "border-fg/30 text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Label className="text-xs text-muted">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 text-xs w-36" />
          <Label className="text-xs text-muted">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 text-xs w-36" />
        </div>
      </div>
      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : !data ? null : report === "trial-balance" ? (
        <TrialBalanceView data={data as { rows: AccountRow[]; totalDebits: number; totalCredits: number; delta: number }} />
      ) : report === "income-statement" ? (
        <IncomeStatementView data={data as { revenue: AccountRow[]; expense: AccountRow[]; totalRevenue: number; totalExpense: number; netIncome: number }} />
      ) : (
        <BalanceSheetView data={data as { assets: AccountRow[]; liabilities: AccountRow[]; equity: AccountRow[]; totalAssets: number; totalLiabilities: number; totalEquityBooked: number; netIncome: number; totalEquity: number; delta: number }} />
      )}
    </>
  );
}

function TrialBalanceView({ data }: { data: { rows: AccountRow[]; totalDebits: number; totalCredits: number; delta: number } }) {
  if (data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted">
          No posted entries in this range. Post a journal entry to populate the trial balance.
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
              <th className="px-4 py-2.5 font-normal">Code</th>
              <th className="px-4 py-2.5 font-normal">Account</th>
              <th className="px-4 py-2.5 font-normal">Type</th>
              <th className="px-4 py-2.5 font-normal text-right">Debit</th>
              <th className="px-4 py-2.5 font-normal text-right">Credit</th>
              <th className="px-4 py-2.5 font-normal text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-surface-2">
                <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-xs text-muted">{TYPE_LABEL[r.type]}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.debit ? fmtMoney(r.debit) : "—"}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.credit ? fmtMoney(r.credit) : "—"}</td>
                <td className="px-4 py-2 text-right font-mono text-xs font-medium">{fmtMoney(r.balance)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-fg/20 font-medium">
              <td colSpan={3} className="px-4 py-3 text-right text-xs">Totals</td>
              <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(data.totalDebits)}</td>
              <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(data.totalCredits)}</td>
              <td className={`px-4 py-3 text-right font-mono text-xs ${Math.abs(data.delta) > 0.005 ? "text-red-400" : "text-green-400"}`}>
                {Math.abs(data.delta) > 0.005 ? `Δ ${fmtMoney(data.delta)}` : "Balanced"}
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function IncomeStatementView({ data }: { data: { revenue: AccountRow[]; expense: AccountRow[]; totalRevenue: number; totalExpense: number; netIncome: number } }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-2 flex items-center gap-1">
            <FileText size={12} /> Revenue
          </div>
          <ReportLines rows={data.revenue} total={data.totalRevenue} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-2 flex items-center gap-1">
            <FileText size={12} /> Expense
          </div>
          <ReportLines rows={data.expense} total={data.totalExpense} />
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="text-sm font-semibold">Net income</div>
          <div className={`font-mono text-lg ${data.netIncome >= 0 ? "text-green-400" : "text-red-400"}`}>
            {fmtMoney(data.netIncome)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceSheetView({ data }: { data: { assets: AccountRow[]; liabilities: AccountRow[]; equity: AccountRow[]; totalAssets: number; totalLiabilities: number; totalEquityBooked: number; netIncome: number; totalEquity: number; delta: number } }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">Assets</div>
          <ReportLines rows={data.assets} total={data.totalAssets} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">Liabilities</div>
          <ReportLines rows={data.liabilities} total={data.totalLiabilities} />
          <div className="border-t border-line my-3" />
          <div className="text-xs uppercase tracking-wide text-muted mb-2">Equity</div>
          <ReportLines rows={data.equity} total={data.totalEquityBooked} />
          <div className="flex items-center justify-between text-xs mt-2">
            <span className="text-muted">+ Net income (period)</span>
            <span className="font-mono">{fmtMoney(data.netIncome)}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1.5 font-semibold">
            <span>Total equity</span>
            <span className="font-mono">{fmtMoney(data.totalEquity)}</span>
          </div>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="text-sm font-semibold">Assets vs (Liabilities + Equity)</div>
          <div className={`font-mono text-sm ${Math.abs(data.delta) > 0.005 ? "text-red-400" : "text-green-400"}`}>
            {Math.abs(data.delta) > 0.005 ? `Out of balance: ${fmtMoney(data.delta)}` : "Balanced"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReportLines({ rows, total }: { rows: AccountRow[]; total: number }) {
  if (rows.length === 0) {
    return <div className="text-xs text-muted py-1">No accounts.</div>;
  }
  return (
    <>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between text-xs">
            <span className="truncate"><span className="font-mono text-muted mr-2">{r.code}</span>{r.name}</span>
            <span className="font-mono">{fmtMoney(r.balance)}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-line my-2" />
      <div className="flex items-center justify-between text-xs font-semibold">
        <span>Total</span>
        <span className="font-mono">{fmtMoney(total)}</span>
      </div>
    </>
  );
}

// ─── Statements (period-scoped) ────────────────────────────────────

type StatementKind = "pnl" | "bs" | "cf";

interface PeriodRef { id: string; label: string; status?: "OPEN" | "CLOSED" }

interface StatementAccountTotals {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number;
}

type StatementResponse =
  | {
      period: PeriodRef;
      kind: "pnl";
      revenue: StatementAccountTotals[];
      expense: StatementAccountTotals[];
      totals: { revenue: number; expense: number; netIncome: number };
    }
  | {
      period: PeriodRef;
      kind: "bs";
      assets: StatementAccountTotals[];
      liabilities: StatementAccountTotals[];
      equity: StatementAccountTotals[];
      totals: { assets: number; liabilities: number; equity: number; plug: number };
    }
  | {
      period: PeriodRef;
      kind: "cf";
      operating: StatementAccountTotals[];
      investing: StatementAccountTotals[];
      financing: StatementAccountTotals[];
      totals: { operating: number; investing: number; financing: number; netChange: number };
      note?: string;
    };

function StatementsTab() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [kind, setKind] = useState<StatementKind>("pnl");
  const [data, setData] = useState<StatementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);

  // Pull fiscal years once so the period dropdown can group by year.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/fiscal-years");
        const json = await res.json();
        if (!mounted) return;
        const list = Array.isArray(json) ? json : [];
        setYears(list);
        // Default to the most recent OPEN period for fast first-paint.
        const allPeriods = list.flatMap((y: FiscalYear) => y.periods.map((p) => ({ ...p, yearStatus: y.status })));
        const firstOpen = allPeriods.find((p) => p.status === "OPEN");
        const first = firstOpen ?? allPeriods[0];
        if (first) setPeriodId(first.id);
      } finally {
        if (mounted) setCalendarLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/financials/statements?period=${periodId}&kind=${kind}`);
      const json = await res.json();
      // jsonSuccess wraps payloads in { data }; jsonError surfaces { error }.
      setData(json?.data ?? (json?.error ? null : json));
    } finally {
      setLoading(false);
    }
  }, [periodId, kind]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {([
            ["pnl", "Income Statement (P&L)"],
            ["bs", "Balance Sheet"],
            ["cf", "Cash Flow"],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-2.5 py-1 rounded border text-xs ${
                kind === k ? "border-fg/30 text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Label className="text-xs text-muted">Period</Label>
          <select
            className="h-8 text-xs rounded-md border border-line bg-card-2/40 px-2"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            disabled={calendarLoading}
          >
            {calendarLoading && <option value="">Loading…</option>}
            {!calendarLoading && years.length === 0 && (
              <option value="">No fiscal periods yet</option>
            )}
            {years.map((y) => (
              <optgroup key={y.id} label={y.label}>
                {y.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.status === "CLOSED" ? "· closed" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {!periodId && !calendarLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted">
            Set up a fiscal year in the Calendar tab first, then come back to generate statements.
          </CardContent>
        </Card>
      ) : loading || calendarLoading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : !data ? null : data.kind === "pnl" ? (
        <PnlView data={data} />
      ) : data.kind === "bs" ? (
        <BalanceSheetStatementView data={data} />
      ) : (
        <CashFlowView data={data} />
      )}
    </div>
  );
}

function PnlView({ data }: { data: Extract<StatementResponse, { kind: "pnl" }> }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-1">{data.period.label} · Income Statement</div>
          <div className="flex items-baseline gap-4 mt-1">
            <div className="text-2xl font-mono font-semibold">{fmtMoney(data.totals.netIncome)}</div>
            <div className="text-xs text-muted">Net Income</div>
            <div className="ml-auto text-xs text-muted">
              Revenue {fmtMoney(data.totals.revenue)} · Expense {fmtMoney(data.totals.expense)}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2 flex items-center gap-1">
              <FileText size={12} /> Revenue
            </div>
            <ReportLines rows={data.revenue} total={data.totals.revenue} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2 flex items-center gap-1">
              <FileText size={12} /> Expense
            </div>
            <ReportLines rows={data.expense} total={data.totals.expense} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BalanceSheetStatementView({ data }: { data: Extract<StatementResponse, { kind: "bs" }> }) {
  const plugFlagged = Math.abs(data.totals.plug) > 0.005;
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-1">{data.period.label} · Balance Sheet (point-in-time)</div>
          <div className="grid grid-cols-3 gap-3 mt-2 text-sm">
            <div>
              <div className="text-[10px] uppercase text-muted">Total Assets</div>
              <div className="font-mono text-base">{fmtMoney(data.totals.assets)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted">Total Liabilities</div>
              <div className="font-mono text-base">{fmtMoney(data.totals.liabilities)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted">Total Equity</div>
              <div className="font-mono text-base">{fmtMoney(data.totals.equity)}</div>
            </div>
          </div>
          {plugFlagged && (
            <div className="mt-3 text-[11px] text-amber-400 border border-amber-400/30 rounded px-2 py-1">
              A = L + E delta: {fmtMoney(data.totals.plug)} — either an out-of-balance ledger, a
              multi-period roll (v1 limitation: BS shows only the entries posted to this period),
              or unposted P&L close.
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Assets</div>
            <ReportLines rows={data.assets} total={data.totals.assets} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Liabilities</div>
            <ReportLines rows={data.liabilities} total={data.totals.liabilities} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Equity</div>
            <ReportLines rows={data.equity} total={data.totals.equity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CashFlowView({ data }: { data: Extract<StatementResponse, { kind: "cf" }> }) {
  const empty =
    data.operating.length === 0 &&
    data.investing.length === 0 &&
    data.financing.length === 0;
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-1">{data.period.label} · Cash Flow (indirect, v1 shell)</div>
          <div className="grid grid-cols-4 gap-3 mt-2 text-sm">
            <div>
              <div className="text-[10px] uppercase text-muted">Operating</div>
              <div className="font-mono">{fmtMoney(data.totals.operating)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted">Investing</div>
              <div className="font-mono">{fmtMoney(data.totals.investing)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted">Financing</div>
              <div className="font-mono">{fmtMoney(data.totals.financing)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted">Net Change</div>
              <div className="font-mono">{fmtMoney(data.totals.netChange)}</div>
            </div>
          </div>
          {data.note && (
            <div className="mt-3 text-[11px] text-muted border border-line rounded px-2 py-1">
              {data.note}
            </div>
          )}
        </CardContent>
      </Card>
      {!empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Operating activities</div>
            <ReportLines rows={data.operating} total={data.totals.operating} />
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Investing activities</div>
            <ReportLines rows={data.investing} total={data.totals.investing} />
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Financing activities</div>
            <ReportLines rows={data.financing} total={data.totals.financing} />
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

// ─── Fiscal calendar ───────────────────────────────────────────────

function CalendarTab() {
  const { toast } = useToast();
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busyPeriodId, setBusyPeriodId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fiscal-years");
      const data = await res.json();
      setYears(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close / reopen a single accounting period. The server enforces
  // the "can't close while DRAFT entries exist" rule; we surface the
  // failure as a toast and refetch so the UI stays consistent with
  // whatever state the server is in.
  const togglePeriod = useCallback(async (id: string, currentStatus: "OPEN" | "CLOSED") => {
    if (busyPeriodId) return;
    const action = currentStatus === "OPEN" ? "close" : "reopen";
    const confirmed = currentStatus === "OPEN"
      ? confirm("Close this period? No new journal entries can be posted to it until reopened.")
      : confirm("Reopen this period? Reopening shows up in the audit log as a warning event.");
    if (!confirmed) return;
    setBusyPeriodId(id);
    try {
      const res = await fetch(`/api/accounting-periods/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ type: "error", title: err?.error || "Failed to update period" });
        return;
      }
      toast({ type: "success", title: action === "close" ? "Period closed" : "Period reopened" });
      load();
    } finally {
      setBusyPeriodId(null);
    }
  }, [busyPeriodId, toast, load]);

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
                  {y.periods.map((p) => {
                    const busy = busyPeriodId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePeriod(p.id, p.status)}
                        disabled={busy}
                        title={p.status === "OPEN" ? "Close period" : "Reopen period"}
                        className={`group text-xs px-2 py-1.5 rounded border text-center transition-colors ${
                          p.status === "OPEN"
                            ? "border-line text-fg hover:border-[color:var(--accent-strong)]"
                            : "border-line text-muted bg-card-2/40 hover:border-amber-400"
                        } ${busy ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                      >
                        {p.label}
                        <div className="text-[10px] opacity-60 mt-0.5 flex items-center justify-center gap-1">
                          {p.status === "OPEN" ? <Unlock size={9} /> : <Lock size={9} />}
                          {p.status}
                        </div>
                      </button>
                    );
                  })}
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
