"use client";

// Expenses — list + submit + approve. Three tabs:
//   Mine     → reporter view, default for everyone
//   Approve  → manager+ approval queue (SUBMITTED rows waiting)
//   All      → org-wide auditing (admins/managers)
// Inline create dialog so the common case (submit a $30 lunch) is one
// click away. Detail / cost-center tagging lives on /expenses/[id].

import { useState, useEffect, useCallback, useMemo } from "react";
import { BulkApproveBar } from "@/components/ui/bulk-approve-bar";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Label } from "@/components/ui/label";
import { useRole } from "@/hooks/use-role";
import { useToast } from "@/components/ui/toast";
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
} from "lucide-react";

type ExpenseRow = {
  id: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  status: string;
  expenseDate: string;
  submittedAt: string | null;
  decisionAt: string | null;
  receiptUrl: string | null;
  reporter: { id: string; firstName: string; lastName: string } | null;
  approver: { id: string; firstName: string; lastName: string } | null;
};

const CATEGORIES = [
  "TRAVEL",
  "MEALS",
  "LODGING",
  "TRANSPORT",
  "SUPPLIES",
  "SUBSCRIPTION",
  "EQUIPMENT",
  "CLIENT_ENTERTAINMENT",
  "TRAINING",
  "OTHER",
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  TRAVEL: "Travel",
  MEALS: "Meals",
  LODGING: "Lodging",
  TRANSPORT: "Transport",
  SUPPLIES: "Supplies",
  SUBSCRIPTION: "Subscription",
  EQUIPMENT: "Equipment",
  CLIENT_ENTERTAINMENT: "Client entertainment",
  TRAINING: "Training",
  OTHER: "Other",
};

const STATUS_STYLE: Record<string, { label: string; className: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  DRAFT: { label: "Draft", className: "text-muted border-white/20", Icon: Clock },
  SUBMITTED: { label: "Submitted", className: "text-blue-400 border-blue-400/30", Icon: Send },
  APPROVED: { label: "Approved", className: "text-green-400 border-green-400/30", Icon: CheckCircle2 },
  REJECTED: { label: "Rejected", className: "text-red-400 border-red-400/30", Icon: XCircle },
  REIMBURSED: { label: "Reimbursed", className: "text-[color:var(--accent-strong)] border-[#d4ff2e]/30", Icon: CheckCircle2 },
};

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function ExpensesPage() {
  const { isManager } = useRole();
  const { toast } = useToast();
  const [tab, setTab] = useState<"mine" | "approve" | "all">("mine");
  const [items, setItems] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // Bulk-approve selection — only meaningful in the approve tab.
  // Reset whenever tab or items change so stale ids don't linger.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [tab, items]);
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const load = useCallback(
    async (scope: "mine" | "approve" | "all") => {
      setLoading(true);
      try {
        const res = await fetch(`/api/expenses?scope=${scope}&limit=100`);
        const data = await res.json();
        if (!res.ok) {
          toast({ type: "error", title: "Couldn't load expenses", description: data?.error });
          return;
        }
        setItems(Array.isArray(data?.items) ? data.items : []);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function decide(id: string, decision: "APPROVE" | "REJECT" | "REIMBURSE", note?: string) {
    const res = await fetch(`/api/expenses/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: note ?? null }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: `Expense ${decision.toLowerCase()}d` });
    load(tab);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Receipt size={20} /> Expenses
          </h1>
          <p className="text-muted text-sm mt-1">
            Submit, approve, and audit reimbursable expenses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export/expenses?scope=${tab}`}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-md border border-line text-fg hover:bg-card-2/40"
          >
            Export CSV
          </a>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={14} className="mr-1.5" /> New expense
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="mine">My expenses</TabsTrigger>
          {isManager && <TabsTrigger value="approve">Approval queue</TabsTrigger>}
          {isManager && <TabsTrigger value="all">All</TabsTrigger>}
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted">Loading…</div>
              ) : items.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted">
                  {tab === "mine" && "No expenses yet. Submit your first one above."}
                  {tab === "approve" && "Nothing waiting on you."}
                  {tab === "all" && "No expenses for this org."}
                </div>
              ) : (
                <ExpenseTable
                  rows={items}
                  showApprovalActions={tab === "approve"}
                  onDecide={decide}
                  selectedIds={selectedIds}
                  onToggleSelected={(id) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onToggleAll={(allSelected) => {
                    if (allSelected) setSelectedIds(new Set());
                    else setSelectedIds(new Set(items.filter((e) => e.status === "SUBMITTED").map((e) => e.id)));
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showCreate && (
        <CreateExpenseDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load(tab);
          }}
        />
      )}

      {/* Floating bulk-action bar — mounts in the approve tab when
          one or more SUBMITTED rows are checked. */}
      {tab === "approve" && (
        <BulkApproveBar
          entityType="expense"
          selectedIds={selectedArray}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => load(tab)}
        />
      )}
    </div>
  );
}

function ExpenseTable({
  rows,
  showApprovalActions,
  onDecide,
  selectedIds,
  onToggleSelected,
  onToggleAll,
}: {
  rows: ExpenseRow[];
  showApprovalActions: boolean;
  onDecide: (id: string, decision: "APPROVE" | "REJECT" | "REIMBURSE", note?: string) => void;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAll: (allSelected: boolean) => void;
}) {
  const submittedRows = rows.filter((r) => r.status === "SUBMITTED");
  const allChecked = showApprovalActions && submittedRows.length > 0
    && submittedRows.every((r) => selectedIds.has(r.id));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-white/5">
            {showApprovalActions && (
              <th className="px-3 py-2.5 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => onToggleAll(allChecked)}
                  aria-label="Select all submitted"
                />
              </th>
            )}
            <th className="px-4 py-2.5 font-normal">Date</th>
            <th className="px-4 py-2.5 font-normal">Description</th>
            <th className="px-4 py-2.5 font-normal">Category</th>
            <th className="px-4 py-2.5 font-normal text-right">Amount</th>
            <th className="px-4 py-2.5 font-normal">Reporter</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
            {showApprovalActions && <th className="px-4 py-2.5 font-normal text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const style = STATUS_STYLE[e.status] ?? STATUS_STYLE.DRAFT;
            const StatusIcon = style.Icon;
            const checkable = e.status === "SUBMITTED";
            return (
              <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                {showApprovalActions && (
                  <td className="px-3 py-2.5">
                    {checkable && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(e.id)}
                        onChange={() => onToggleSelected(e.id)}
                        aria-label={`Select ${e.description}`}
                      />
                    )}
                  </td>
                )}
                <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                  {new Date(e.expenseDate).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/expenses/${e.id}`} className="font-medium hover:underline">
                    {e.description}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted">{CATEGORY_LABEL[e.category] ?? e.category}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(e.amount, e.currency)}</td>
                <td className="px-4 py-2.5 text-xs text-muted truncate max-w-32">
                  {e.reporter ? `${e.reporter.firstName} ${e.reporter.lastName}` : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant="outline" className={`text-[10px] gap-1 ${style.className}`}>
                    <StatusIcon size={10} />
                    {style.label}
                  </Badge>
                </td>
                {showApprovalActions && (
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => onDecide(e.id, "APPROVE")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-red-400"
                        onClick={() => {
                          const note = prompt("Reason for rejection?") ?? undefined;
                          if (note !== undefined) onDecide(e.id, "REJECT", note);
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateExpenseDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [category, setCategory] = useState<string>("MEALS");
  const [expenseDate, setExpenseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [saving, setSaving] = useState(false);

  async function save(submit: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          notes: notes.trim() || undefined,
          amount: Number(amount),
          currency,
          category,
          expenseDate,
          submit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      toast({
        type: "success",
        title: submit ? "Expense submitted" : "Expense saved as draft",
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const valid = description.trim() && Number(amount) > 0 && expenseDate;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New expense</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this for?"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Receipt details, attendees, project context…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={!valid || saving}
            onClick={() => save(false)}
          >
            Save draft
          </Button>
          <Button disabled={!valid || saving} onClick={() => save(true)}>
            {saving ? "Saving…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
